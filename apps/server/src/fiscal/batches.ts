import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CabinetRecordSchema,
  FiscalCreateSchema,
  FiscalGenerationSchema,
  FiscalBulkSchema,
  type SessionUser,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { idempotent } from "../storage/operations.js";
import { requireModule } from "../administration/settings.js";
import { loadRecord } from "../records/service.js";
import { requireAccess, scopedPermission } from "../records/permissions.js";
import { ApiFault, fail } from "../errors.js";
import { createFiscal, commandFiscal } from "./service.js";
export function childOperation(operation: string, key: string) {
  const hash = createHash("sha256")
    .update(operation + "/" + key)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export async function generateFiscal(
  tx: Connection,
  actor: SessionUser,
  input: z.infer<typeof FiscalGenerationSchema>,
  now: Date,
) {
  await requireModule(tx, "fiscal");
  const dossier = await loadRecord(tx, input.dossierId);
  await requireAccess(tx, actor, "read", dossier);
  if (!(await scopedPermission(tx, actor, "create", "obligation", dossier.id)))
    fail(403, "FORBIDDEN", "Création non autorisée.");
  if (dossier.kind !== "dossier")
    fail(400, "INVALID_DOSSIER", "Dossier requis.");
  const result = await idempotent(
    tx,
    actor,
    input.operationId,
    { action: "fiscal.generate", input },
    async () => {
      if (dossier.version !== input.expectedDossierVersion)
        fail(409, "VERSION_CONFLICT", "Le profil du dossier a changé.");
      if (
        input.nature === "TVA" &&
        ["franchise", "exonere", "hors_champ"].includes(
          dossier.data.vatRegime ?? "",
        )
      )
        return {
          items: [],
          reason: "Aucune occurrence TVA attendue pour ce profil.",
        };
      if (input.nature === "TVA" && !dossier.data.vatFrequency)
        fail(
          409,
          "PROFILE_REQUIRED",
          "Fréquence TVA requise avant génération.",
        );
      if (["CFE_IFER", "TF"].includes(input.nature))
        fail(
          409,
          "NOTICE_REQUIRED",
          "Créer chaque avis depuis sa référence observée ; une campagne seule ne prouve pas les avis attendus.",
        );
      const frequency =
        input.nature === "TVA"
          ? dossier.data.vatFrequency
          : ["DSN", "RCM_2777", "DES"].includes(input.nature)
            ? "mensuelle"
            : input.nature === "CUSTOM"
              ? input.customFrequency
              : "annuelle";
      if (!frequency)
        fail(409, "PROFILE_REQUIRED", "Fréquence personnalisée requise.");
      const periods: { start: string; end: string; subtype: string }[] = [];
      if (input.nature === "IS") {
        const end = dossier.data.financialYearEnd;
        if (!end || !end.startsWith(String(input.year)))
          fail(409, "CLOSURE_REQUIRED", "Clôture de cet exercice requise.");
        const date = new Date(end + "T00:00:00Z");
        date.setUTCDate(date.getUTCDate() + 1);
        date.setUTCFullYear(date.getUTCFullYear() - 1);
        for (const subtype of [
          "acompte_1",
          "acompte_2",
          "acompte_3",
          "acompte_4",
          "solde",
        ])
          periods.push({
            start: date.toISOString().slice(0, 10),
            end,
            subtype,
          });
      } else {
        const step =
          frequency === "mensuelle"
            ? 1
            : frequency === "trimestrielle"
              ? 3
              : 12;
        for (let month = 0; month < 12; month += step)
          periods.push({
            start: new Date(Date.UTC(input.year, month, 1))
              .toISOString()
              .slice(0, 10),
            end: new Date(Date.UTC(input.year, month + step, 0))
              .toISOString()
              .slice(0, 10),
            subtype: input.nature === "CVAE" ? "solde" : "declaration",
          });
        if (input.nature === "CVAE")
          periods.push(
            { ...periods[0]!, subtype: "acompte_1" },
            { ...periods[0]!, subtype: "acompte_2" },
          );
      }
      const items = [];
      for (const period of periods) {
        const key = [
          input.dossierId,
          input.nature,
          input.contactId ?? "",
          input.establishmentId ?? "",
          period.start,
          period.end,
          period.subtype,
        ].join("/");
        const existing = await tx.query(
          "SELECT id FROM cabinet_records WHERE content->'data'->'fiscal'->>'occurrenceKey'=$1",
          [key],
        );
        if (existing[0]) {
          const record = await loadRecord(tx, String(existing[0].id));
          await requireAccess(tx, actor, "read", record);
          items.push({ id: record.id });
          continue;
        }
        const detail = await createFiscal(
          tx,
          actor,
          FiscalCreateSchema.parse({
            operationId: childOperation(input.operationId, key),
            dossierId: dossier.id,
            title: `${input.nature} · ${period.start} · ${period.subtype}`,
            nature: input.nature,
            period: { ...period, campaign: input.campaign },
            contactId: input.contactId,
            establishmentId: input.establishmentId,
            financialYearEnd: dossier.data.financialYearEnd,
            regime:
              input.nature === "TVA"
                ? dossier.data.vatRegime
                : dossier.data.incomeTaxRegime,
          }),
          now,
          { key, rule: input.rule },
        );
        items.push({ id: detail.record.id });
      }
      return {
        items,
        reason: "Occurrences locales ; échéances à confirmer séparément.",
      };
    },
  );
  for (const item of result.items)
    await requireAccess(tx, actor, "read", await loadRecord(tx, item.id));
  return result;
}
export async function bulkFiscal(
  tx: Connection,
  actor: SessionUser,
  input: z.infer<typeof FiscalBulkSchema>,
  now: Date,
) {
  await requireModule(tx, "fiscal");
  const result = await idempotent(
    tx,
    actor,
    input.operationId,
    { action: "fiscal.bulk", input },
    async () => {
      const items = [];
      for (const item of input.items) {
        await tx.query("SAVEPOINT fiscal_item");
        try {
          const detail = await commandFiscal(
            tx,
            actor,
            item.id,
            {
              operationId: childOperation(input.operationId, item.id),
              expectedVersion: item.expectedVersion,
              event: input.event,
            },
            now,
          );
          items.push({
            id: item.id,
            version: detail.record.version,
            status: "updated",
            error: null,
          });
          await tx.query("RELEASE SAVEPOINT fiscal_item");
        } catch (e) {
          await tx.query("ROLLBACK TO SAVEPOINT fiscal_item");
          await tx.query("RELEASE SAVEPOINT fiscal_item");
          if (!(e instanceof ApiFault)) throw e;
          items.push({
            id: item.id,
            version: null,
            status: "refused",
            error: e.code,
          });
        }
      }
      return { items };
    },
  );
  for (const item of result.items)
    if (item.status === "updated") {
      const current = await loadRecord(tx, item.id);
      await requireAccess(tx, actor, "read", current);
      await requireAccess(
        tx,
        actor,
        input.event.kind === "approval" ? "approve" : "update",
        current,
      );
      const history = await tx.query(
        "SELECT event FROM cabinet_history WHERE record_id=$1 AND (event->'snapshot'->>'version')::integer=$2",
        [item.id, item.version],
      );
      if (!history[0])
        fail(404, "NOT_FOUND", "Résultat historique inaccessible.");
      const snapshot = (history[0].event as { snapshot: unknown }).snapshot;
      await requireAccess(
        tx,
        actor,
        "read",
        CabinetRecordSchema.parse(snapshot),
      );
    }
  return result;
}
