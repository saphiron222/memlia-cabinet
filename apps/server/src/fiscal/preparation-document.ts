import { DocumentInputSchema, type SessionUser } from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import type { DocumentStore } from "../documents/store.js";
import { idempotent } from "../storage/operations.js";
import { requireModule } from "../administration/settings.js";
import { requireAccess } from "../records/permissions.js";
import { fail } from "../errors.js";
import { fiscalDetail, commandFiscal } from "./service.js";
import { childOperation } from "./batches.js";
export async function preparationDocument(
  tx: Connection,
  actor: SessionUser,
  id: string,
  input: { operationId: string; expectedVersion: number },
  store: DocumentStore,
  now: Date,
) {
  await requireModule(tx, "fiscal");
  await requireModule(tx, "ged");
  const current = await fiscalDetail(tx, actor, id, now);
  await requireAccess(tx, actor, "update", current.record);
  await requireAccess(tx, actor, "export", current.record);
  const stored = await idempotent(
    tx,
    actor,
    input.operationId,
    { action: "fiscal.preparation-document", id, input },
    async () => {
      if (current.record.version !== input.expectedVersion)
        fail(
          409,
          "VERSION_CONFLICT",
          "La préparation a changé. Rechargez la fiche.",
        );
      if (!current.situation.ifu)
        fail(409, "IFU_REQUIRED", "Une proposition IFU est requise.");
      const bytes = Buffer.from(
        "PRÉPARATION LOCALE NON CERTIFIÉE — aucun dépôt ni paiement\n" +
          JSON.stringify(
            {
              obligationId: id,
              recordVersion: current.record.version,
              declarationVersion: current.situation.declarationVersion,
              period: current.record.data.fiscal!.period,
              preparedAt: now.toISOString(),
              ifu: current.situation.ifu,
            },
            null,
            2,
          ),
      );
      const prior = current.timeline.findLast(
        (e) =>
          e.event.kind === "evidence" &&
          e.event.purpose === "generated_preparation",
      )?.event;
      const prepared = await store.prepare(
        DocumentInputSchema.parse({
          operationId: childOperation(input.operationId, "document"),
          dossierId: current.record.dossierId,
          filename: `preparation-IFU-${current.record.data.fiscal!.period.start.slice(0, 4)}.txt`,
          mediaType: "text/plain",
          source: {
            kind: "preparation-locale-ifu",
            reference: id,
            version: String(current.record.version),
          },
          confidential: current.record.confidential,
          previousVersionId:
            prior?.kind === "evidence" ? (prior.documentIds[0] ?? null) : null,
        }),
        bytes,
      );
      try {
        const document = await store.commit(tx, actor, prepared, now);
        const detail = await commandFiscal(
          tx,
          actor,
          id,
          {
            operationId: childOperation(input.operationId, "evidence"),
            expectedVersion: current.record.version,
            event: {
              kind: "evidence",
              documentIds: [document.id],
              purpose: "generated_preparation",
              reason:
                "Préparation locale IFU, non certifiée, versions sources figées",
            },
          },
          now,
        );
        return { documentId: document.id, record: detail.record };
      } finally {
        await store.discard(prepared);
      }
    },
  );
  await requireAccess(tx, actor, "read", stored.record);
  await requireAccess(tx, actor, "export", stored.record);
  return {
    detail: await fiscalDetail(tx, actor, id, now),
    document: await store.get(tx, actor, stored.documentId),
  };
}
