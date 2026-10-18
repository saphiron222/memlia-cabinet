import { prepareIfu } from "./ifu.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  FiscalDetailSchema,
  deriveSourceFreshness,
  FiscalMoneySchema,
  FiscalCreateSchema,
  FiscalProfileSchema,
  FiscalCommandSchema,
  FiscalTimelineEntrySchema,
  type SessionUser,
  type CabinetRecord,
  type FiscalTimelineEntry,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { fiscalDocumentPredicate } from "../records/query.js";
import { requireAccess, canAccess } from "../records/permissions.js";
import { loadRecord, saveRecord } from "../records/service.js";
import { requireModule } from "../administration/settings.js";
import { fail } from "../errors.js";
import { deriveFiscalSituation, fiscalObservedValues } from "./situation.js";
export async function fiscalTimeline(tx: Connection, id: string) {
  return (
    await tx.query(
      "SELECT content FROM cabinet_fiscal_events WHERE obligation_id=$1 ORDER BY version",
      [id],
    )
  ).map((r) => FiscalTimelineEntrySchema.parse(r.content));
}
export async function fiscalDetail(
  tx: Connection,
  actor: SessionUser,
  id: string,
  now = new Date(),
  today = now.toISOString().slice(0, 10),
) {
  const record = await loadRecord(tx, id);
  await requireAccess(tx, actor, "read", record);
  if (record.kind !== "obligation" || !record.data.fiscal)
    fail(404, "NOT_FOUND", "Obligation fiscale inaccessible.");
  const timeline = await fiscalTimeline(tx, id);
  const situation = deriveFiscalSituation(
    record.data.fiscal.initialAmount,
    timeline,
  );
  if (situation.ifu)
    for (const source of situation.ifu.sourceVersions) {
      const current = await loadRecord(tx, source.id);
      await requireAccess(tx, actor, "read", current);
      if (current.version !== source.version) situation.ifu.stale = true;
    }
  const actions = [];
  for (const action of [
    "update",
    "approve",
    "transmit",
    "export",
    "assign",
  ] as const)
    if (await canAccess(tx, actor, action, record)) actions.push(action);
  return FiscalDetailSchema.parse({
    record,
    timeline,
    capabilities: { actions, realTransmission: false as const },
    freshness: deriveSourceFreshness(record.data.sourceEvidence, now, today),
    situation,
  });
}
export async function createFiscal(
  tx: Connection,
  actor: SessionUser,
  input: z.infer<typeof FiscalCreateSchema>,
  now: Date,
  occurrence?: {
    key: string;
    rule: NonNullable<z.infer<typeof FiscalProfileSchema>["generationRule"]>;
  },
) {
  await requireModule(tx, "fiscal");
  const profile = FiscalProfileSchema.parse({
    initialAmount: input.amount,
    occurrenceKey: occurrence?.key,
    generationRule: occurrence?.rule,
    period: input.period,
    contactId: input.contactId,
    establishmentId: input.establishmentId,
    responsibleIds: input.responsibleIds,
    financialYearEnd: input.financialYearEnd,
    regime: input.regime,
  });
  const record = await saveRecord(
    tx,
    actor,
    {
      operationId: input.operationId,
      record: {
        kind: "obligation",
        title: input.title,
        dossierId: input.dossierId,
        confidential: input.confidential,
        data: {
          nature: input.nature,
          period: `${input.period.start}/${input.period.end}`,
          amount: input.amount,
          fiscal: profile,
        },
      },
    },
    now,
    undefined,
    "created",
    { action: "fiscal.create", input },
    undefined,
    {
      validate: async (record: CabinetRecord) => {
        if (input.responsibleIds.length)
          await requireAccess(tx, actor, "assign", record);
      },
      commit: async (next: CabinetRecord) => {
        if (input.amount === null) return;
        const entry = FiscalTimelineEntrySchema.parse({
          id: randomUUID(),
          obligationId: next.id,
          version: next.version,
          actorId: actor.id,
          at: now.toISOString(),
          event: {
            kind: "observation",
            id: randomUUID(),
            field: "amount",
            value: input.amount,
            provenance: {
              kind: "manual",
              source: "Saisie cabinet",
              account: "cabinet",
              reference: "initial",
              version: "1",
              observedAt: now.toISOString(),
              sourceUpdatedAt: null,
              coverage: "complete",
              rawState: "Montant initial saisi",
              amountPrecision: "exact",
            },
          },
        });
        await tx.query(
          "INSERT INTO cabinet_fiscal_events(id,obligation_id,version,content) VALUES($1,$2,$3,$4::jsonb)",
          [entry.id, next.id, next.version, JSON.stringify(entry)],
        );
      },
    },
  );
  return fiscalDetail(tx, actor, record.id, now);
}
export async function commandFiscal(
  tx: Connection,
  actor: SessionUser,
  id: string,
  command: z.infer<typeof FiscalCommandSchema>,
  now: Date,
) {
  await requireModule(tx, "fiscal");
  const detail = await fiscalDetail(tx, actor, id, now),
    { record, situation } = detail;
  let event = command.event;
  if (
    "provenance" in event &&
    "id" in event &&
    ["payment", "debt", "apurement", "observation", "notice"].includes(
      event.kind,
    )
  ) {
    const provenance = event.provenance;
    const sameSource = detail.timeline.findLast(
      (e) =>
        e.event.kind === event.kind &&
        "provenance" in e.event &&
        e.event.provenance.source === provenance.source &&
        e.event.provenance.account === provenance.account &&
        e.event.provenance.kind === provenance.kind &&
        e.event.provenance.reference === provenance.reference &&
        (event.kind !== "observation" ||
          (e.event.kind === "observation" &&
            e.event.field === event.field &&
            e.event.provenance.version === provenance.version)),
    );
    if (sameSource && "id" in sameSource.event)
      event = { ...event, id: sameSource.event.id };
    const sameId = detail.timeline.findLast(
      (e) =>
        e.event.kind === event.kind &&
        "id" in e.event &&
        e.event.id === ("id" in event ? event.id : null),
    );
    if (
      sameId &&
      "provenance" in sameId.event &&
      (sameId.event.provenance.kind !== provenance.kind ||
        sameId.event.provenance.source !== provenance.source ||
        sameId.event.provenance.account !== provenance.account ||
        sameId.event.provenance.reference !== provenance.reference)
    )
      fail(
        409,
        "SOURCE_IDENTITY_CONFLICT",
        "L’identité de la source ne peut pas changer.",
      );
    if (
      sameSource &&
      "provenance" in sameSource.event &&
      sameSource.event.provenance.version === provenance.version
    ) {
      const normalized = {
        ...event,
        provenance: {
          ...provenance,
          observedAt: sameSource.event.provenance.observedAt,
        },
      };
      if (JSON.stringify(normalized) !== JSON.stringify(sameSource.event))
        fail(
          409,
          "SOURCE_VERSION_CONFLICT",
          "Une même version source contient des valeurs contradictoires ; conserver une nouvelle version explicite.",
        );
      event = sameSource.event;
    }
    if (event.kind === "payment") {
      const elsewhere = await tx.query(
        "SELECT 1 FROM cabinet_fiscal_events WHERE obligation_id<>$1 AND content->'event'->>'kind'='payment' AND content->'event'->'provenance'->>'source'=$2 AND content->'event'->'provenance'->>'account'=$3 AND content->'event'->'provenance'->>'reference'=$4 LIMIT 1",
        [id, provenance.source, provenance.account, provenance.reference],
      );
      if (elsewhere.length)
        fail(
          409,
          "PAYMENT_RELATION_AMBIGUOUS",
          "Le règlement possède déjà une relation ; résoudre son affectation avant de le rapprocher.",
        );
    }
  }
  await requireAccess(
    tx,
    actor,
    event.kind === "approval"
      ? "approve"
      : event.kind === "attempt"
        ? "transmit"
        : event.kind === "responsibility"
          ? "assign"
          : "update",
    record,
  );
  const ifu =
    event.kind === "ifu_prepare"
      ? await prepareIfu(tx, actor, record, event)
      : undefined;
  const data = { ...record.data };
  if (event.kind === "responsibility" && data.fiscal)
    data.fiscal = { ...data.fiscal, responsibleIds: event.responsibleIds };
  if (ifu && data.fiscal) {
    data.fiscal = {
      ...data.fiscal,
      relatedRecordIds: [
        ...new Set([
          ...data.fiscal.relatedRecordIds,
          ...ifu.sourceVersions.map((s) => s.id),
        ]),
      ],
    };
    data.validation = "non_validee";
    data.preparation = "a_preparer";
  }
  if (event.kind === "deadlines" && data.fiscal) {
    const { kind, ...deadlines } = event;
    data.fiscal = { ...data.fiscal, deadlines };
    data.dueDate = event.observed ?? event.campaignDate;
  }
  if (event.kind === "notice" && data.fiscal) {
    const notices = [
      ...detail.situation.notices.filter((n) => n.id !== event.id),
      event,
    ];
    data.fiscal = {
      ...data.fiscal,
      noticeYears: [...new Set(notices.map((n) => n.year))],
      properties: [...new Set(notices.flatMap((n) => n.properties))],
    };
  }
  if (event.kind === "link_task" && data.fiscal)
    data.fiscal = {
      ...data.fiscal,
      relatedRecordIds: [
        ...new Set([...data.fiscal.relatedRecordIds, event.taskId]),
      ],
    };
  const documentIds = [
    ...new Set([
      ...(event.kind === "notice"
        ? [event.originalId, ...event.suiteIds].filter(
            (id): id is string => id !== null,
          )
        : []),
      ...("documentIds" in event ? event.documentIds : []),
      ...("provenance" in event ? event.provenance.documentIds : []),
    ]),
  ];
  for (const documentId of documentIds) {
    const params: unknown[] = [documentId];
    const predicate = fiscalDocumentPredicate(
      actor,
      (v) => {
        params.push(v);
        return "$" + params.length;
      },
      "cabinet_documents.id",
    );
    const rows = await tx.query(
      `SELECT content FROM cabinet_documents WHERE id=$1 AND ${predicate}`,
      params,
    );
    if (!rows[0]) fail(404, "NOT_FOUND", "Pièce inaccessible.");
    const doc = rows[0].content as { dossierId: string; confidential: boolean };
    if (doc.dossierId !== record.dossierId)
      fail(
        400,
        "INVALID_DOCUMENT_SCOPE",
        "La pièce doit appartenir au dossier.",
      );
    const parent = await loadRecord(tx, doc.dossierId);
    await requireAccess(tx, actor, "read", parent);
    if (doc.confidential) {
      await requireAccess(tx, actor, "confidential", parent);
    }
  }
  if (data.fiscal && documentIds.length)
    data.fiscal = {
      ...data.fiscal,
      documentIds: [...new Set([...data.fiscal.documentIds, ...documentIds])],
    };
  if (event.kind === "source_freshness")
    data.sourceEvidence = {
      provenance: event.provenance,
      policy: event.policy,
    };
  if (event.kind === "classification" && data.fiscal) {
    data.fiscal = { ...data.fiscal, classification: event.state };
    data.archived = event.state === "archived";
  }
  if (event.kind === "preparation") data.preparation = event.state;
  if (event.kind === "approval")
    data.validation =
      event.decision === "approved" ? "validee_localement" : "non_validee";
  if (event.kind === "revision") {
    data.amount = event.amount;
    data.validation = "non_validee";
    data.preparation = "a_preparer";
  }
  if (
    data.fiscal &&
    (event.kind === "observation" || event.kind === "resolution")
  )
    data.fiscal = {
      ...data.fiscal,
      observedValues: fiscalObservedValues([
        ...detail.timeline,
        {
          id: command.operationId,
          obligationId: id,
          version: record.version + 1,
          actorId: actor.id,
          at: now.toISOString(),
          event,
        },
      ]),
    };
  const saved = await saveRecord(
    tx,
    actor,
    {
      operationId: command.operationId,
      expectedVersion: command.expectedVersion,
      record: {
        kind: "obligation",
        title: record.title,
        dossierId: record.dossierId,
        confidential: record.confidential,
        data,
      },
    },
    now,
    id,
    "updated",
    { action: "fiscal.command", id, command },
    undefined,
    {
      action:
        event.kind === "approval"
          ? "approve"
          : event.kind === "attempt"
            ? "transmit"
            : event.kind === "responsibility"
              ? "assign"
              : "update",
      validate: async () => {
        if (event.kind === "client_validation" && record.data.nature !== "IRPP")
          fail(
            400,
            "INVALID_CLIENT_VALIDATION",
            "Validation client réservée à l’IRPP.",
          );
        if (
          "provenance" in event &&
          event.provenance.kind === "manual" &&
          (((event.kind === "return" || event.kind === "client_validation") &&
            event.state === "accepted") ||
            (event.kind === "payment" &&
              ["debit_confirmed", "settled_source"].includes(event.state))) &&
          !event.provenance.documentIds.length
        )
          fail(
            400,
            "PROOF_REQUIRED",
            "Lier une preuve documentaire pour confirmer ce constat manuel.",
          );
        if (event.kind === "link_task") {
          const task = await loadRecord(tx, event.taskId);
          await requireAccess(tx, actor, "read", task);
          if (task.kind !== "tache" || task.dossierId !== record.dossierId)
            fail(400, "INVALID_TASK", "Tâche du même dossier requise.");
        }
        if (event.kind === "notice") {
          if (!["TF", "CFE_IFER"].includes(record.data.nature))
            fail(
              400,
              "INVALID_NOTICE",
              "Avis réservé à CFE/IFER ou taxe foncière.",
            );
          if (event.suiteIds.length > event.expectedSuites)
            fail(400, "INVALID_SUITES", "Nombre de suites incohérent.");
          if (event.establishmentId) {
            const parent = await loadRecord(tx, record.dossierId!);
            if (
              parent.kind !== "dossier" ||
              !parent.data.establishments.some(
                (e) => e.id === event.establishmentId,
              )
            )
              fail(
                400,
                "INVALID_ESTABLISHMENT",
                "Établissement du même dossier requis.",
              );
          }
        }
        if (
          event.kind === "income" &&
          (record.data.nature !== "RCM_2777" ||
            (event.coverage === "confirmed_zero" && event.lines.length))
        )
          fail(
            400,
            "INVALID_INCOME",
            "Ventilation RCM et zéro confirmé doivent être cohérents.",
          );
        if (event.kind === "ifu_prepare" && situation.approval === "approved")
          fail(
            409,
            "REVISION_REQUIRED",
            "Créer une révision avant de remplacer une préparation IFU approuvée.",
          );
        if (
          event.kind === "approval" &&
          event.decision === "approved" &&
          record.data.nature === "IFU_2561" &&
          (!situation.ifu?.complete || situation.ifu.stale)
        )
          fail(
            409,
            "IFU_INCOMPLETE",
            "Préparation IFU complète et à jour requise.",
          );
        if (event.kind === "observation" || event.kind === "resolution") {
          if (
            [
              "amount",
              "gross",
              "net",
              "estimate",
              "referenceTurnover",
            ].includes(event.field) &&
            event.value !== null
          )
            FiscalMoneySchema.parse(event.value);
          if (event.field === "observedDueDate" && event.value !== null)
            z.iso.date().parse(event.value);
        }
        if (event.kind === "resolution") {
          const observations = detail.timeline.filter(
            (e) =>
              (e.event.kind === "observation" &&
                e.event.field === event.field &&
                event.observationIds.includes(e.event.id)) ||
              (e.event.kind === "revision" &&
                event.field === "amount" &&
                event.observationIds.includes(e.id)),
          );
          if (observations.length !== new Set(event.observationIds).size)
            fail(
              400,
              "INVALID_RESOLUTION",
              "Observations de la même obligation requises.",
            );
        }
        if (
          event.kind === "cancel_mark" &&
          !situation.manualMarks.some(
            (m) => m.id === event.markId && !m.cancelled,
          )
        )
          fail(409, "INVALID_MARK", "Marque absente ou déjà annulée.");
        if (
          ["payment", "apurement", "schedule", "bank_candidate"].includes(
            event.kind,
          ) &&
          "debtId" in event &&
          event.debtId &&
          !situation.debts.some((d) => d.id === event.debtId)
        )
          fail(
            400,
            "INVALID_DEBT",
            "Dette liée inaccessible dans cette obligation.",
          );
        if (event.kind === "apurement") {
          if (event.nature === "payment" && !event.paymentId)
            fail(
              400,
              "PAYMENT_LINK_REQUIRED",
              "Rapprocher le règlement avant l’apurement de paiement.",
            );
          if (event.nature !== "payment" && event.paymentId)
            fail(
              400,
              "INVALID_PAYMENT_LINK",
              "Cet apurement ne représente pas un paiement.",
            );
          if (event.paymentId) {
            const payment = detail.timeline.findLast(
              (e) =>
                e.event.kind === "payment" && e.event.id === event.paymentId,
            )?.event;
            if (
              !payment ||
              payment.kind !== "payment" ||
              payment.debtId !== event.debtId ||
              payment.amount !== event.amount
            )
              fail(
                400,
                "INVALID_PAYMENT_LINK",
                "Le paiement et l’apurement doivent avoir la même dette et le même montant.",
              );
          }
        }
        if (event.kind === "payment") {
          const attempt = situation.attempts.find(
            (a) => a.id === event.attemptId,
          );
          if (
            (event.attemptId !== null &&
              (!attempt ||
                attempt.declarationVersion !== event.declarationVersion)) ||
            (event.attemptId === null && event.declarationVersion !== null)
          )
            fail(
              400,
              "INVALID_PAYMENT_ATTEMPT",
              "Choisir une tentative de cette obligation et sa version ; laisser le rattachement inconnu si la source ne le précise pas.",
            );
        }
        if (event.kind === "preparation" && situation.approval === "approved")
          fail(
            409,
            "REVISION_REQUIRED",
            "Créer une révision de la déclaration approuvée.",
          );
        if (
          event.kind === "approval_request" &&
          situation.approval === "approved"
        )
          fail(
            409,
            "REVISION_REQUIRED",
            "Créer une révision de la déclaration approuvée.",
          );
        if (
          event.kind === "approval_request" &&
          situation.approval === "requested"
        )
          fail(
            409,
            "APPROVAL_ALREADY_REQUESTED",
            "La demande d’approbation est déjà en cours.",
          );
        if (
          event.kind === "approval_request" &&
          situation.preparation !== "preparee"
        )
          fail(
            409,
            "NOT_PREPARED",
            "Terminer la préparation avant de demander une approbation.",
          );
        if (
          event.kind === "approval" &&
          (situation.approval !== "requested" ||
            situation.preparation !== "preparee")
        )
          fail(
            409,
            "APPROVAL_NOT_REQUESTED",
            "Une demande d’approbation est requise.",
          );
        if (event.kind === "attempt") {
          if (
            record.data.nature === "IFU_2561" &&
            (!situation.ifu?.complete ||
              situation.ifu.stale ||
              situation.ifu.rule.status !== "released")
          )
            fail(
              409,
              "IFU_CONTRACT_UNAVAILABLE",
              "Campagne définitive et préparation complète à jour requises pour constater un dépôt IFU.",
            );
          if (
            event.declarationVersion !== situation.declarationVersion ||
            situation.approval !== "approved"
          )
            fail(
              409,
              "NOT_APPROVED",
              "Version approuvée requise pour constater la tentative.",
            );
          if (situation.attempts.some((a) => a.id === event.id))
            fail(409, "DUPLICATE_ATTEMPT", "Tentative déjà conservée.");
        }
        if (event.kind === "return") {
          const attempt = situation.attempts.find(
            (a) => a.id === event.attemptId,
          );
          if (
            !attempt ||
            (event.target === "recipient" &&
              (!event.recipient || !(event.recipient in attempt.recipients))) ||
            (event.target === "platform" && event.recipient)
          )
            fail(
              400,
              "INVALID_ATTEMPT_RETURN",
              "Tentative ou destinataire incohérent.",
            );
        }
      },
      commit: async (next: CabinetRecord) => {
        if (
          "provenance" in event &&
          detail.timeline.some(
            (e) => JSON.stringify(e.event) === JSON.stringify(event),
          )
        )
          return;
        const entry: FiscalTimelineEntry = {
          id: randomUUID(),
          obligationId: id,
          version: next.version,
          actorId: actor.id,
          at: now.toISOString(),
          event,
          ...(ifu ? { ifu } : {}),
        };
        await tx.query(
          "INSERT INTO cabinet_fiscal_events(id,obligation_id,version,content) VALUES($1,$2,$3,$4::jsonb)",
          [entry.id, id, next.version, JSON.stringify(entry)],
        );
      },
    },
  );
  // saveRecord validates the historical replay scope. Return the current authorized detail.
  return fiscalDetail(tx, actor, saved.id, now);
}
