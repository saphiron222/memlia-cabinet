import { z } from "zod";
import { DocumentReferenceSchema } from "./documents.js";
import { JobSchema, JobEventSchema } from "./jobs.js";
const ref = z.string().trim().min(1).max(160);
export const ConnectorIdSchema = z.enum([
  "dgfip-cfe",
  "dgfip-taxe-fonciere",
  "dgfip-attestation-fiscale",
  "dgfip-dettes",
  "dgfip-tva-documents",
  "dgfip-is-documents",
  "dgfip-messages",
  "dgfip-habilitations",
  "urssaf-attestations",
  "urssaf-echeances",
  "urssaf-messages",
  "inpi-creations",
  "inpi-actes",
  "inpi-comptes",
  "jedeclare-retours",
  "pennylane-dossiers",
  "pennylane-echeances",
]);
export type ConnectorId = z.infer<typeof ConnectorIdSchema>;
export const CollectionScenarioSchema = z.enum([
  "nominal",
  "variation",
  "wrong-identity",
  "missing-page",
  "html-login",
  "empty",
  "unavailable",
  "interrupted",
  "challenge",
  "source-failure",
]);
export const CollectionScopeSchema = z
  .object({
    dossierId: z.uuid(),
    companyId: ref,
    accountId: ref,
    establishmentId: ref.nullable(),
    contributorId: ref.nullable(),
    service: ref,
    profile: z.enum(["employeur", "TI", "PAM", "company", "public"]),
  })
  .strict();
export const CollectionPeriodSchema = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .strict()
  .refine((p) => p.from <= p.to, "La fin précède le début.")
  .refine(
    (p) => Date.parse(p.to) - Date.parse(p.from) <= 366 * 86400000,
    "Fenêtre limitée à 366 jours.",
  );
export const CollectionInputSchema = z
  .object({
    operationId: z.uuid(),
    connectorId: ConnectorIdSchema,
    mode: z.enum(["simulation", "real"]),
    credentialRef: ref,
    cabinetRef: ref,
    scope: CollectionScopeSchema,
    period: CollectionPeriodSchema,
    scenario: CollectionScenarioSchema,
  })
  .strict();
export type CollectionInput = z.infer<typeof CollectionInputSchema>;
export const CollectionStatusSchema = z.enum([
  "complete",
  "partial",
  "empty-observed",
  "not-available",
  "needs-human",
  "failed",
]);
export const ObservationDataSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("tax-notice"),
      tax: z.enum(["CFE", "TF"]),
      role: z.enum(["general", "supplementary", "instalment"]),
      assessmentYear: z.number().int(),
      recoveryYear: z.number().int(),
      amountCents: z.number().int().nullable(),
      dueDate: z.iso.date().nullable(),
      directDebitEnabled: z.boolean().nullable(),
      paymentObserved: z.literal(false),
      parts: z.array(z.enum(["main", "continuation"])).max(2),
    })
    .strict(),
  z
    .object({
      kind: z.literal("certificate"),
      type: ref,
      issuedAt: z.iso.date().nullable(),
      assessedAt: z.iso.date().nullable(),
      state: z.enum(["available", "pending", "refused", "ineligible"]),
      group: ref.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("debt"),
      tax: ref,
      amountCents: z.number().int(),
      balanceCents: z.number().int(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("settlement"),
      debtReference: ref,
      nature: z.enum(["remission", "reallocation", "payment", "unknown"]),
      amountCents: z.number().int(),
      paymentReference: ref.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("payment"),
      amountCents: z.number().int(),
      state: z.enum(["observed", "rejected", "unknown"]),
      debtReference: ref.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("tax-document"),
      tax: z.enum(["TVA", "IS"]),
      form: ref,
      state: z.enum(["prepared", "filed", "accepted", "rejected", "unknown"]),
      financialYearEnd: z.iso.date(),
      paymentState: z.enum(["unknown", "observed", "rejected"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("message"),
      threadReference: ref,
      subject: ref,
      unreadBefore: z.boolean().nullable(),
      unreadAfter: z.boolean().nullable(),
      state: z.enum([
        "awaiting-source",
        "awaiting-client",
        "closed",
        "unknown",
      ]),
      attachmentsExpected: z.number().int().min(0).max(20),
      attachmentsMissing: z.number().int().min(0).max(20),
      portfolios: z.array(ref).max(20),
      channel: ref,
    })
    .strict(),
  z
    .object({
      kind: z.literal("entitlement"),
      service: ref,
      userReference: ref,
      role: ref,
      state: z.enum(["active", "dormant", "deleted"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("schedule"),
      profile: z.enum(["employeur", "TI", "PAM"]),
      axis: z.enum([
        "provisional",
        "called",
        "definitive",
        "regularisation",
        "accepted-debt-plan",
      ]),
      incomeYear: z.number().int(),
      contributionYear: z.number().int(),
      dueDate: z.iso.date(),
      amountCents: z.number().int(),
      paymentObserved: z.literal(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal("registry-event"),
      event: z.enum(["creation", "modification", "cessation"]),
      scope: z.literal("public-rne"),
      privateFormalityAccess: z.literal(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal("registry-document"),
      type: z.enum(["act", "annual-accounts"]),
      depositedAt: z.iso.date(),
      financialYearEnd: z.iso.date().nullable(),
      access: z.enum(["public", "confidential", "deleted", "unavailable"]),
      resource: z.enum(["pdf", "structured"]),
      scope: z.literal("public-rne"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("recipient-return"),
      attemptReference: ref,
      recipient: ref,
      stage: z.enum(["ADS", "ACS", "ARS"]),
      state: z.enum(["accepted", "rejected", "pending", "unknown"]),
      expectedReturnPolicy: z.enum(["explicit", "unknown"]),
      replacesAttempt: ref.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("company"),
      externalCompanyId: ref,
      connection: z.literal("firm-api"),
      visibility: z.enum(["visible", "unknown"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("tax-source"),
      externalCompanyId: ref,
      connection: z.literal("tax-data-sharing"),
      warehouse: ref,
      sourceUpdatedAt: z.iso.datetime(),
      state: z.enum(["done", "pending", "rejected", "unknown"]),
      isExpected: z.boolean(),
      accepted: z.boolean().nullable(),
      paymentValidated: z.boolean(),
      bankPaymentObserved: z.literal(false),
    })
    .strict(),
]);
export type ObservationData = z.infer<typeof ObservationDataSchema>;
export const CollectionProvenanceSchema = z
  .object({
    mode: z.literal("simulation"),
    connectorId: ConnectorIdSchema,
    adapterVersion: z.literal("fixture-1"),
    observedAt: z.iso.datetime(),
    sourceVersion: ref,
  })
  .strict();
export const CollectionObservationSchema = z
  .object({
    id: z.uuid(),
    reference: ref,
    version: ref,
    scope: CollectionScopeSchema,
    period: CollectionPeriodSchema,
    rawState: ref.nullable(),
    provenance: CollectionProvenanceSchema,
    data: ObservationDataSchema,
    documentIds: z.array(z.uuid()).max(20),
  })
  .strict();
export type CollectionObservation = z.infer<typeof CollectionObservationSchema>;
export const CollectionCheckpointSchema = z
  .object({
    page: z.number().int().min(0).max(100),
    lastReference: ref.nullable(),
  })
  .strict();
export const CollectionErrorSchema = z
  .object({
    code: ref,
    scope: ref,
    cause: z.string().max(500),
    retryable: z.boolean(),
    evidenceReference: ref.nullable(),
  })
  .strict();
export const SourceSnapshotSchema = z
  .object({
    page: z.number().int().min(1).max(100),
    identity: CollectionScopeSchema,
    period: CollectionPeriodSchema,
    boundary: z.enum(["last-page", "next-page", "unknown"]),
    references: z.array(ref).max(100),
    provenance: CollectionProvenanceSchema,
  })
  .strict();
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;
export const CollectionResultSchema = z
  .object({
    mode: z.literal("simulation"),
    connectorId: ConnectorIdSchema,
    status: CollectionStatusSchema,
    coverage: z
      .object({
        requested: z
          .object({
            scope: CollectionScopeSchema,
            period: CollectionPeriodSchema,
          })
          .strict(),
        observed: z.array(SourceSnapshotSchema).max(100),
        missing: z.array(ref).max(100),
        boundaryVerified: z.boolean(),
        emptyExplicit: z.boolean(),
      })
      .strict(),
    records: z.array(CollectionObservationSchema).max(200),
    artifacts: z.array(DocumentReferenceSchema).max(200),
    events: z.array(JobEventSchema).max(500),
    errors: z.array(CollectionErrorSchema).max(100),
    checkpoint: CollectionCheckpointSchema,
  })
  .strict();
export type CollectionResult = z.infer<typeof CollectionResultSchema>;
export const CollectionRunSchema = z
  .object({
    job: JobSchema,
    input: CollectionInputSchema.omit({
      credentialRef: true,
      operationId: true,
    }),
    checkpoint: CollectionCheckpointSchema,
    result: CollectionResultSchema.nullable(),
  })
  .strict();
export type CollectionRun = z.infer<typeof CollectionRunSchema>;
export const CollectionCatalogueSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: ConnectorIdSchema,
            label: ref,
            mode: z.literal("simulation"),
            realAvailable: z.literal(false),
          })
          .strict(),
      )
      .length(17),
    scenarios: z.array(CollectionScenarioSchema),
    fixture: z
      .object({
        identity: CollectionScopeSchema.omit({ dossierId: true }),
        period: CollectionPeriodSchema,
      })
      .strict(),
  })
  .strict();
