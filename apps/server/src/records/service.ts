import { randomUUID } from "node:crypto";
import {
  CabinetRecordSchema,
  HistoryEventSchema,
  type CabinetRecord,
  type SessionUser,
  type CreateRecordInput,
  type UpdateRecordInput,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { fail } from "../errors.js";
import { idempotent } from "../storage/operations.js";
import { hasPermission, requireAccess } from "./permissions.js";
export async function loadRecord(
  tx: Connection,
  id: string,
): Promise<CabinetRecord> {
  const rows = await tx.query(
    "SELECT content FROM cabinet_records WHERE id=$1",
    [id],
  );
  if (!rows[0]) fail(404, "NOT_FOUND", "Ressource inaccessible.");
  return CabinetRecordSchema.parse(rows[0].content);
}
export async function listRecords(
  tx: Connection,
  user: SessionUser,
  action: "read" | "export" = "read",
) {
  const rows = await tx.query(
    "SELECT content FROM cabinet_records ORDER BY id",
  );
  const records: CabinetRecord[] = [];
  for (const row of rows) {
    const record = CabinetRecordSchema.parse(row.content);
    if (await canRead(tx, user, action, record)) records.push(record);
  }
  return records;
}
async function canRead(
  tx: Connection,
  user: SessionUser,
  action: "read" | "export",
  record: CabinetRecord,
) {
  try {
    await requireAccess(tx, user, "read", record);
    if (action === "export") await requireAccess(tx, user, "export", record);
    return true;
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 404)
      return false;
    throw error;
  }
}
export async function saveRecord(
  tx: Connection,
  user: SessionUser,
  input: CreateRecordInput | UpdateRecordInput,
  now: Date,
  id?: string,
  action: "created" | "updated" | "transitioned" = id ? "updated" : "created",
  command?: unknown,
) {
  const previous = id ? await loadRecord(tx, id) : null;
  if (previous)
    await requireAccess(
      tx,
      user,
      action === "transitioned" ? "transition" : "update",
      previous,
    );
  else if (
    !hasPermission(
      user,
      "create",
      input.record.kind,
      input.record.dossierId ?? null,
    )
  )
    fail(403, "FORBIDDEN", "Création non autorisée.");
  const result = await idempotent(
    tx,
    user,
    input.operationId,
    command ?? { id: id ?? null, action, input },
    async () => {
      const record = CabinetRecordSchema.parse({
        ...input.record,
        id: id ?? randomUUID(),
        version: (previous?.version ?? 0) + 1,
        createdAt: previous?.createdAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
      });
      if (previous && previous.kind !== record.kind)
        fail(
          400,
          "IMMUTABLE_KIND",
          "Le type de ressource ne peut pas changer.",
        );
      if (record.kind === "dossier" && record.dossierId !== null)
        fail(
          400,
          "INVALID_RELATION",
          "Un dossier ne dépend pas d’un autre dossier.",
        );
      if (record.kind === "obligation" && !record.dossierId)
        fail(
          400,
          "DOSSIER_REQUIRED",
          "Une obligation doit être rattachée à un dossier.",
        );
      if (record.dossierId) {
        const parent = await loadRecord(tx, record.dossierId);
        if (parent.kind !== "dossier")
          fail(400, "INVALID_RELATION", "Dossier attendu.");
        await requireAccess(tx, user, "read", parent);
      }
      await requireAccess(
        tx,
        user,
        previous
          ? action === "transitioned"
            ? "transition"
            : "update"
          : "create",
        record,
      );
      if (
        record.kind === "obligation" &&
        (previous?.kind === "obligation"
          ? record.data.validation !== previous.data.validation
          : record.data.validation === "validee_localement")
      )
        await requireAccess(tx, user, "approve", record);
      if (record.kind === "tache") {
        const previousAssignees =
          previous?.kind === "tache" ? previous.data.assigneeIds : [];
        if (
          JSON.stringify([...previousAssignees].sort()) !==
          JSON.stringify([...record.data.assigneeIds].sort())
        )
          await requireAccess(tx, user, "assign", record);
      }
      if (record.kind === "tache" && record.data.assigneeIds.length) {
        const assigned = await tx.query(
          "SELECT id FROM cabinet_users WHERE active=true AND id=ANY($1::uuid[])",
          [record.data.assigneeIds],
        );
        if (assigned.length !== new Set(record.data.assigneeIds).size)
          fail(400, "INVALID_ASSIGNEE", "Responsable inconnu ou inactif.");
      }
      if (
        previous?.kind === "tache" &&
        record.kind === "tache" &&
        previous.data.state !== record.data.state &&
        action !== "transitioned"
      )
        fail(
          400,
          "TRANSITION_REQUIRED",
          "Utiliser la commande de transition pour changer l’étape.",
        );
      if (
        record.kind === "tache" &&
        record.data.state === "terminee" &&
        record.data.checklist.some((item) => !item.done)
      )
        fail(
          409,
          "CHECKLIST_INCOMPLETE",
          "Terminer la checklist avant de clôturer la tâche.",
        );
      if (
        previous?.kind === "tache" &&
        record.kind === "tache" &&
        action === "transitioned" &&
        previous.data.state === record.data.state
      )
        fail(409, "STATE_UNCHANGED", "La tâche est déjà dans cette étape.");
      if (
        previous &&
        "expectedVersion" in input &&
        previous.version !== input.expectedVersion
      )
        fail(
          409,
          "VERSION_CONFLICT",
          "Cette ressource a changé. Rechargez-la avant de modifier.",
        );
      await tx.query(
        "INSERT INTO cabinet_records(id,kind,content) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO UPDATE SET content=EXCLUDED.content",
        [record.id, record.kind, JSON.stringify(record)],
      );
      const event = HistoryEventSchema.parse({
        id: randomUUID(),
        recordId: record.id,
        operationId: input.operationId,
        actorId: user.id,
        action,
        version: record.version,
        at: now.toISOString(),
        snapshot: record,
      });
      await tx.query(
        "INSERT INTO cabinet_history(id,record_id,actor_id,operation_id,event) VALUES($1,$2,$3,$4,$5::jsonb)",
        [
          event.id,
          record.id,
          user.id,
          input.operationId,
          JSON.stringify(event),
        ],
      );
      return record;
    },
  );
  await requireAccess(tx, user, "read", await loadRecord(tx, result.id));
  await requireAccess(tx, user, "read", result);
  return CabinetRecordSchema.parse(result);
}
