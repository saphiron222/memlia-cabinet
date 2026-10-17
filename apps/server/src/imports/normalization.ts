import { z } from "zod";
import { installation } from "../administration/settings.js";
import { checkAssignment } from "../administration/assignments.js";
import { validateReferentialContent } from "../records/validation.js";
import { ApiFault } from "../errors.js";
import { createHash, randomUUID } from "node:crypto";
import {
  RecordContentSchema,
  DossierDataSchema,
  ContactDataSchema,
  ImportLineSchema,
  AssignmentRowSchema,
  type ImportLine,
  type ImportPreview,
  type ImportTable,
  type SessionUser,
  type CabinetRecord,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { canAccess } from "../records/permissions.js";
import { CabinetRecordSchema } from "@memlia/contracts";
export const fields = {
  dossier: [
    "title",
    "recordId",
    "confidential",
    ...Object.keys(DossierDataSchema.shape).filter(
      (k) => !["fieldOrigins", "customFields", "address"].includes(k),
    ),
    ...Object.keys(DossierDataSchema.shape.address.removeDefault().shape).map(
      (k) => "address." + k,
    ),
  ],
  contact: [
    "title",
    "recordId",
    "dossierId",
    "confidential",
    ...Object.keys(ContactDataSchema.shape).filter(
      (k) => !["fieldOrigins", "customFields", "address"].includes(k),
    ),
    ...Object.keys(ContactDataSchema.shape.address.removeDefault().shape).map(
      (k) => "address." + k,
    ),
  ],
  assignment: ["dossierId", "subjectKind", "subjectId", "roleId", "remove"],
};
const arrayFields = new Set([
  "establishments",
  "identifiers",
  "obligations",
  "relatedDossierIds",
]);
const boolFields = new Set(["archived", "confidential", "remove"]);
const uuid = z.uuid();
const customKey = (key: string) =>
  key.startsWith("custom.") && uuid.safeParse(key.slice(7)).success;
export const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export const hash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
export function fieldValue(
  record: Pick<CabinetRecord, "title" | "dossierId" | "confidential" | "data">,
  key: string,
): unknown {
  if (["title", "dossierId", "confidential"].includes(key))
    return record[key as "title"];
  if (key.startsWith("custom.")) return record.data.customFields[key.slice(7)];
  if (key.startsWith("address."))
    return (record.data as unknown as { address: Record<string, unknown> })
      .address[key.slice(8)];
  return (record.data as unknown as Record<string, unknown>)[key];
}
export function mergeLine(target: CabinetRecord, line: ImportLine) {
  const source = line.record!;
  const result = {
    kind: target.kind,
    title: target.title,
    dossierId: target.dossierId,
    confidential: target.confidential,
    data: structuredClone(target.data),
  };
  for (const key of line.fields) {
    const value = fieldValue(source, key);
    if (["title", "dossierId", "confidential"].includes(key))
      (result as Record<string, unknown>)[key] = value;
    else if (key.startsWith("custom."))
      result.data.customFields[key.slice(7)] = value as string | boolean | null;
    else if (key.startsWith("address."))
      (result.data as unknown as { address: Record<string, unknown> }).address[
        key.slice(8)
      ] = value;
    else (result.data as unknown as Record<string, unknown>)[key] = value;
  }
  return RecordContentSchema.parse(result);
}
export async function normalize(
  tx: Connection,
  actor: SessionUser,
  preview: ImportPreview,
  raw: ImportTable["rows"][number],
): Promise<ImportLine> {
  const errors: string[] = [],
    values: Record<string, unknown> = {},
    provided: string[] = [];
  let targetId: string | null = null;
  const allowed = new Set(fields[preview.kind]);
  const customIds = Object.values(preview.mapping)
    .filter((k) => customKey(k))
    .map((k) => k.slice(7));
  const booleanFields = new Set(
    customIds.length
      ? (
          await tx.query(
            "SELECT id FROM cabinet_custom_fields WHERE id=ANY($1::uuid[]) AND content->>'type'='boolean'",
            [customIds],
          )
        ).map((r) => "custom." + r.id)
      : [],
  );
  const foreign =
    preview.sourceInstallationId !== null &&
    preview.sourceInstallationId !== (await installation(tx)).id;
  for (const [col, key] of Object.entries(preview.mapping)) {
    if (!key) continue;
    if (!allowed.has(key) && !customKey(key)) {
      errors.push("Champ non pris en charge : " + key);
      continue;
    }
    const c = raw.cells[Number(col)];
    if (!c) {
      errors.push("Colonne absente : " + col);
      continue;
    }
    let value: unknown = c.value;
    if (value === null || value === "") continue;
    if (
      /(siren|siret|taxNumber|postalCode|phone|recordId|dossierId|subjectId|roleId)$/i.test(
        key,
      ) &&
      c.type !== "text"
    ) {
      errors.push(
        key + " : identifiant attendu en texte, sans conversion de zéros.",
      );
      continue;
    }
    if (
      foreign &&
      [
        "recordId",
        "dossierId",
        "relatedDossierIds",
        "subjectId",
        "roleId",
      ].includes(key)
    ) {
      errors.push(
        "Identité issue d’une autre installation : rapprocher les fiches sans réutiliser leurs identifiants internes.",
      );
      continue;
    }
    if (boolFields.has(key) || booleanFields.has(key)) {
      if (value === "true" || value === "1" || value === "oui") value = true;
      else if (value === "false" || value === "0" || value === "non")
        value = false;
      else if (typeof value !== "boolean") {
        errors.push(key + " : booléen invalide.");
        continue;
      }
    }
    if (arrayFields.has(key)) {
      try {
        value = JSON.parse(String(value));
      } catch {
        errors.push(key + " : tableau JSON requis.");
        continue;
      }
    }
    if (key === "recordId") {
      targetId = String(value);
      continue;
    }
    values[key] = value;
    provided.push(key);
  }
  let record: ImportLine["record"] = null,
    assignment: ImportLine["assignment"] = null;
  if (preview.kind === "assignment") {
    const version =
      typeof values.dossierId === "string" &&
      uuid.safeParse(values.dossierId).success
        ? Number(
            (
              await tx.query(
                "SELECT version FROM cabinet_assignment_versions WHERE dossier_id=$1",
                [values.dossierId],
              )
            )[0]?.version ?? 1,
          )
        : 1;
    const parsed = AssignmentRowSchema.safeParse({
      dossierId: values.dossierId,
      expectedVersion: version,
      subject: { kind: values.subjectKind, id: values.subjectId },
      roleId: values.roleId,
      remove: values.remove ?? false,
    });
    if (parsed.success) {
      assignment = parsed.data;
      const check = await checkAssignment(tx, actor, assignment);
      if (check !== "ready")
        errors.push(
          check === "invalid"
            ? "Rôle ou sujet d’affectation invalide."
            : "Affectation non autorisée.",
        );
    } else
      errors.push(
        ...parsed.error.issues.map((i) => i.path.join(".") + " : " + i.message),
      );
  } else {
    const data: Record<string, unknown> = {},
      root: Record<string, unknown> = { kind: preview.kind };
    for (const [key, value] of Object.entries(values)) {
      if (["title", "dossierId", "confidential"].includes(key))
        root[key] = value;
      else if (key.startsWith("address.")) {
        data.address ??= {};
        (data.address as Record<string, unknown>)[key.slice(8)] = value;
      } else if (key.startsWith("custom.")) {
        data.customFields ??= {};
        (data.customFields as Record<string, unknown>)[key.slice(7)] = value;
      } else data[key] = value;
    }
    const parsed = RecordContentSchema.safeParse({ ...root, data });
    if (parsed.success) record = parsed.data;
    else
      errors.push(
        ...parsed.error.issues.map((i) => i.path.join(".") + " : " + i.message),
      );
  }
  const line: ImportLine = {
    lineId: hash(preview.sourceHash + ":" + preview.sheet + ":" + raw.number),
    number: raw.number,
    cells: raw.cells,
    record,
    assignment,
    errors: errors.slice(0, 100),
    candidates: [],
    duplicate: false,
    accepted: false,
    targetId: null,
    expectedRecordVersion: null,
    overwriteFields: [],
    fields: provided,
    changes: [],
    status: "pending",
    resultId: null,
  };
  if (record) {
    let matches: Record<string, unknown>[] = [];
    if (targetId) {
      if (!uuid.safeParse(targetId).success)
        line.errors.push("Identité de fiche invalide.");
      else
        matches = await tx.query(
          "SELECT content FROM cabinet_records WHERE id=$1 AND kind=$2",
          [targetId, preview.kind],
        );
      if (!matches.length) line.errors.push("Ressource inaccessible.");
    } else if (record.kind === "dossier" && record.data.siren)
      matches = await tx.query(
        "SELECT content FROM cabinet_records WHERE kind='dossier' AND content->'data'->>'siren'=$1 LIMIT 101",
        [record.data.siren],
      );
    else if (record.kind === "contact")
      matches = await tx.query(
        "SELECT content FROM cabinet_records WHERE kind='contact' AND ((content->'data'->>'email'=$1 AND $1::text IS NOT NULL) OR (content->'data'->>'taxNumber'=$2 AND $2!='') OR (content->>'title'=$3 AND COALESCE(content->'data'->>'birthDate','')=$4)) LIMIT 101",
        [
          record.data.email,
          record.data.taxNumber,
          record.title,
          record.data.birthDate ?? "",
        ],
      );
    for (const row of matches) {
      const candidate = CabinetRecordSchema.parse(row.content);
      if (
        (await canAccess(tx, actor, "read", candidate)) &&
        (await canAccess(tx, actor, "update", candidate))
      ) {
        if (line.candidates.length < 100)
          line.candidates.push({
            id: candidate.id,
            title: candidate.title,
            version: candidate.version,
          });
      } else line.errors.push("Ressource inaccessible.");
    }
    if (matches.length > 100)
      line.errors.push(
        "Plus de 100 rapprochements possibles : préciser l’identité de fiche.",
      );
    if (line.candidates.length === 1) {
      const target = CabinetRecordSchema.parse(
        matches.find(
          (r) => (r.content as CabinetRecord).id === line.candidates[0]!.id,
        )!.content,
      );
      line.targetId = target.id;
      line.expectedRecordVersion = target.version;
      line.changes = provided
        .filter((k) => !same(fieldValue(target, k), fieldValue(record, k)))
        .map((field) => ({
          field,
          before: fieldValue(target, field) ?? null,
          after: fieldValue(record, field) ?? null,
        }));
    }
  }
  if (line.record) {
    const target = line.targetId
      ? (
          await tx.query("SELECT content FROM cabinet_records WHERE id=$1", [
            line.targetId,
          ])
        )[0]
      : null;
    try {
      await validateReferentialContent(
        tx,
        actor,
        target
          ? mergeLine(CabinetRecordSchema.parse(target.content), line)
          : line.record,
      );
    } catch (e) {
      if (e instanceof ApiFault) line.errors.push(e.message);
      else throw e;
    }
  }
  return ImportLineSchema.parse(line);
}
export function duplicateKey(line: ImportLine) {
  const r = line.record;
  if (line.assignment)
    return JSON.stringify([line.assignment.dossierId, line.assignment.subject]);
  if (!r) return null;
  if (r.kind === "dossier")
    return r.data.siren ? "siren:" + r.data.siren : null;
  if (r.kind === "contact")
    return (
      "contact:" +
      (r.data.email || r.data.taxNumber || r.title + ":" + r.data.birthDate)
    );
  return null;
}
