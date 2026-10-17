import { z } from "zod";
export const FiscalNatureSchema = z.enum([
  "TVA",
  "IS",
  "CVAE",
  "CFE_IFER",
  "TF",
  "DAS2",
  "DSN",
  "IRPP",
  "RCM_2777",
  "IFU_2561",
  "DES",
  "CUSTOM",
]);
export const FiscalMoneySchema = z
  .string()
  .regex(
    /^-?(?:0|[1-9]\d{0,13})\.\d{2}$/,
    "Montant décimal exact à deux décimales attendu",
  );
export const FiscalProvenanceSchema = z
  .object({
    kind: z.enum(["manual", "simulated", "supplier"]),
    source: z.string().trim().min(1).max(300),
    account: z.string().trim().min(1).max(300),
    reference: z.string().trim().min(1).max(300),
    version: z.string().trim().min(1).max(100),
    observedAt: z.iso.datetime(),
    sourceUpdatedAt: z.iso.datetime().nullable(),
    coverage: z.enum([
      "complete",
      "partial",
      "unknown",
      "unavailable",
      "unauthorized",
      "not_published",
    ]),
    rawState: z.string().max(2000),
    rawAmount: z.string().max(500).nullable().default(null),
    amountPrecision: z
      .enum(["exact", "approximate", "unknown"])
      .default("unknown"),
    rawSourceUpdatedAt: z.string().max(300).nullable().default(null),
    sourceTimeZone: z.string().max(100).nullable().default(null),
    documentIds: z.array(z.uuid()).max(100).default([]),
  })
  .strict();
export type FiscalProvenance = z.infer<typeof FiscalProvenanceSchema>;
export const FiscalCadenceSchema = z
  .object({
    id: z.string().min(1).max(100),
    version: z.string().min(1).max(100),
    source: z.string().min(1).max(300),
    maximumAgeHours: z.number().int().positive().max(87840),
    validFrom: z.iso.date(),
    validTo: z.iso.date(),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict()
  .refine((p) => p.validFrom <= p.validTo, "Période de politique inversée");
export const FiscalSourceEvidenceSchema = z
  .object({
    provenance: FiscalProvenanceSchema,
    policy: FiscalCadenceSchema.nullable(),
  })
  .strict();
export const FiscalFreshnessSchema = z.object({
  state: z.enum(["fresh", "stale", "unknown"]),
  verifiedSupplier: z.literal(false),
  reason: z.string(),
  asOf: z.iso.datetime(),
  sourceUpdatedAt: z.iso.datetime().nullable(),
  observedAt: z.iso.datetime().nullable(),
  policyVersion: z.string().nullable(),
});
/** Operational assessment only. HTTP/manual/simulated evidence has no acquired supplier attestation. */
export function deriveSourceFreshness(
  evidence: z.infer<typeof FiscalSourceEvidenceSchema> | null,
  at: Date,
  today: string,
) {
  const source = evidence?.provenance,
    policy = evidence?.policy;
  let state: "fresh" | "stale" | "unknown" = "unknown",
    reason = "Date de source ou politique applicable absente";
  if (
    source?.sourceUpdatedAt &&
    policy &&
    source.source === policy.source &&
    policy.validFrom <= today &&
    policy.validTo >= today
  ) {
    const age = at.getTime() - new Date(source.sourceUpdatedAt).getTime();
    if (source.coverage !== "complete") reason = "Couverture non complète";
    else if (source.kind === "manual")
      reason = "Saisie manuelle sans vérification fournisseur";
    else if (age < 0) reason = "Date source future incohérente";
    else {
      state = age <= policy.maximumAgeHours * 3600000 ? "fresh" : "stale";
      reason =
        source.kind === "simulated"
          ? "Évaluation simulée selon la cadence configurée"
          : "Évaluation déclarée ; acquisition fournisseur non qualifiée";
    }
  }
  return FiscalFreshnessSchema.parse({
    state,
    verifiedSupplier: false,
    reason,
    asOf: at.toISOString(),
    sourceUpdatedAt: source?.sourceUpdatedAt ?? null,
    observedAt: source?.observedAt ?? null,
    policyVersion: policy?.version ?? null,
  });
}
export const FiscalPeriodSchema = z
  .object({
    start: z.iso.date(),
    end: z.iso.date(),
    campaign: z.string().trim().min(1).max(50),
    subtype: z.string().trim().min(1).max(100),
  })
  .strict()
  .refine((v) => v.start <= v.end, "Période inversée");
export const FiscalFieldSchema = z.enum([
  "amount",
  "gross",
  "net",
  "estimate",
  "referenceTurnover",
  "regime",
  "observedDueDate",
]);
export const FiscalClassificationSchema = z.enum([
  "active",
  "archived",
  "hidden",
  "nil",
  "not_applicable",
]);
export const FiscalDeadlinesSchema = z
  .object({
    observed: z.iso.date().nullable(),
    internalTarget: z.iso.date().nullable(),
    campaignDate: z.iso.date().nullable(),
    provenance: FiscalProvenanceSchema,
  })
  .strict();
export const FiscalNoticeSchema = z
  .object({
    id: z.uuid(),
    reference: z.string().trim().min(1).max(300),
    role: z.string().max(150),
    year: z.number().int().min(1900).max(2200),
    establishmentId: z.uuid().nullable(),
    properties: z.array(z.string().min(1).max(300)).max(100),
    municipalities: z.array(z.string().min(1).max(150)).max(100),
    amount: FiscalMoneySchema.nullable(),
    dueDate: z.iso.date().nullable(),
    directDebit: z.enum(["active", "inactive", "unknown"]),
    originalId: z.uuid().nullable(),
    suiteIds: z.array(z.uuid()).max(100),
    expectedSuites: z.number().int().min(0).max(100),
    provenance: FiscalProvenanceSchema,
  })
  .strict();
export const FiscalProfileSchema = z
  .object({
    observedValues: z
      .object({
        gross: FiscalMoneySchema.nullable().default(null),
        net: FiscalMoneySchema.nullable().default(null),
        estimate: FiscalMoneySchema.nullable().default(null),
        referenceTurnover: FiscalMoneySchema.nullable().default(null),
      })
      .default({
        gross: null,
        net: null,
        estimate: null,
        referenceTurnover: null,
      }),
    initialAmount: FiscalMoneySchema.nullable().default(null),
    documentIds: z.array(z.uuid()).max(1000).default([]),
    noticeYears: z.array(z.number().int()).max(200).default([]),
    properties: z.array(z.string().max(300)).max(1000).default([]),
    deadlines: FiscalDeadlinesSchema.nullable().default(null),
    occurrenceKey: z.string().max(500).nullable().default(null),
    generationRule: z
      .object({
        id: z.string().min(1).max(100),
        version: z.string().min(1).max(100),
        source: z.string().min(1).max(500),
        datedOn: z.iso.date(),
      })
      .nullable()
      .default(null),
    relatedRecordIds: z.array(z.uuid()).max(200).default([]),
    classification: FiscalClassificationSchema.default("active"),
    period: FiscalPeriodSchema,
    contactId: z.uuid().nullable().default(null),
    establishmentId: z.uuid().nullable().default(null),
    responsibleIds: z.array(z.uuid()).max(30).default([]),
    financialYearEnd: z.iso.date().nullable().default(null),
    regime: z.string().max(100).nullable().default(null),
  })
  .strict();
export type FiscalProfile = z.infer<typeof FiscalProfileSchema>;
export const FiscalCreateSchema = FiscalProfileSchema.extend({
  operationId: z.uuid(),
  dossierId: z.uuid(),
  title: z.string().trim().min(1).max(300),
  nature: FiscalNatureSchema,
  confidential: z.boolean().default(false),
  amount: FiscalMoneySchema.nullable().default(null),
}).strict();
const reason = z.string().trim().min(1).max(2000);
export const FiscalIncomeLineSchema = z
  .object({
    beneficiary: z
      .object({
        identity: z.string().max(300).nullable(),
        address: z.string().max(500).nullable(),
        type: z.enum(["personne", "organisation"]),
        siret: z
          .string()
          .regex(/^\d{14}$/)
          .nullable(),
        birthDate: z.iso.date().nullable(),
      })
      .strict(),
    category: z.string().max(100).nullable(),
    gross: FiscalMoneySchema.nullable(),
    withheld: FiscalMoneySchema.nullable(),
  })
  .strict();
export const FiscalAggregationRuleSchema = z
  .object({
    id: z.literal("compatible-income-sum"),
    version: z.literal("1"),
    campaign: z.string().min(1).max(50),
    source: z.string().min(1).max(500),
    datedOn: z.iso.date(),
    status: z.enum(["draft", "released"]),
  })
  .strict();
export const FiscalPayerSchema = z
  .object({
    identity: z.string().max(300).nullable(),
    address: z.string().max(500).nullable(),
    siret: z
      .string()
      .regex(/^\d{14}$/)
      .nullable(),
  })
  .strict();
export const FiscalIfuSchema = z.object({
  sourceVersions: z
    .array(z.object({ id: z.uuid(), version: z.number().int().positive() }))
    .max(200),
  payer: FiscalPayerSchema,
  rule: FiscalAggregationRuleSchema,
  coverage: z.object({
    missingMonths: z.array(z.number().int()),
    zeroMonths: z.array(z.number().int()),
    incompleteMonths: z.array(z.number().int()),
    duplicateMonths: z.array(z.number().int()),
  }),
  lines: z.array(FiscalIncomeLineSchema).max(10000),
  grossTotal: FiscalMoneySchema.nullable(),
  complete: z.boolean(),
  stale: z.boolean(),
  certifiedExport: z.literal(false),
});
export const FiscalEventSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("client_validation"),
      state: z.enum(["requested", "accepted", "rejected"]),
      reason,
      provenance: FiscalProvenanceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("preparation"),
      state: z.enum(["a_preparer", "en_cours", "preparee"]),
    })
    .strict(),
  z.object({ kind: z.literal("approval_request") }).strict(),
  z
    .object({
      kind: z.literal("approval"),
      decision: z.enum(["approved", "rejected"]),
      reason,
    })
    .strict(),
  z
    .object({
      kind: z.literal("revision"),
      amount: FiscalMoneySchema.nullable(),
      reason,
    })
    .strict(),
  z
    .object({
      kind: z.literal("attempt"),
      id: z.uuid(),
      declarationVersion: z.number().int().positive(),
      recipients: z
        .array(z.string().trim().min(1).max(150))
        .min(1)
        .max(30)
        .refine((a) => new Set(a).size === a.length),
      productionReference: z.string().trim().min(1).max(300),
      provenance: FiscalProvenanceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("return"),
      attemptId: z.uuid(),
      target: z.enum(["platform", "recipient"]),
      recipient: z.string().max(150).nullable().default(null),
      state: z.enum(["pending", "accepted", "rejected"]),
      reason,
      provenance: FiscalProvenanceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("debt"),
      id: z.uuid(),
      amount: FiscalMoneySchema.nullable(),
      sourceBalance: FiscalMoneySchema.nullable(),
      tax: z.string().trim().min(1).max(100),
      period: z.string().trim().min(1).max(100),
      reference: z.string().trim().min(1).max(300),
      provenance: FiscalProvenanceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("payment"),
      id: z.uuid(),
      attemptId: z.uuid().nullable().default(null),
      declarationVersion: z.number().int().positive().nullable().default(null),
      debtId: z.uuid().nullable().default(null),
      amount: FiscalMoneySchema.refine((v) => !v.startsWith("-")).nullable(),
      date: z.iso.date(),
      state: z.enum([
        "order",
        "validated",
        "presented",
        "debit_confirmed",
        "settled_source",
        "unknown",
        "cancelled",
      ]),
      reason,
      provenance: FiscalProvenanceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("apurement"),
      id: z.uuid(),
      debtId: z.uuid(),
      paymentId: z.uuid().nullable().default(null),
      amount: FiscalMoneySchema.refine((v) => !v.startsWith("-")),
      date: z.iso.date(),
      nature: z.enum(["payment", "remission", "relief", "allocation"]),
      reason,
      confirmed: z.boolean(),
      provenance: FiscalProvenanceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("schedule"),
      debtId: z.uuid(),
      instalments: z
        .array(
          z
            .object({
              date: z.iso.date(),
              amount: FiscalMoneySchema.refine((v) => !v.startsWith("-")),
            })
            .strict(),
        )
        .min(1)
        .max(120),
      decision: z.enum(["requested", "accepted", "rejected"]),
      reason,
      provenance: FiscalProvenanceSchema,
    })
    .strict(),

  z
    .object({
      kind: z.literal("bank_candidate"),
      id: z.uuid(),
      debtId: z.uuid().nullable().default(null),
      accountPresent: z.boolean(),
      pdfParsed: z.boolean(),
      iban: z.enum(["absent", "exact", "masked_unique", "masked_ambiguous"]),
      orderDate: z.iso.date().nullable(),
      evaluatedOn: z.iso.date(),
      rule: z
        .object({
          id: z.string().min(1).max(100),
          version: z.string().min(1).max(100),
          datedOn: z.iso.date(),
          maximumMonths: z.number().int().positive().max(120),
        })
        .strict(),
      confidence: z.enum(["low", "medium", "high"]),
      provenance: FiscalProvenanceSchema,
    })
    .strict(),

  z
    .object({
      kind: z.literal("manual_mark"),
      id: z.uuid(),
      state: z.enum(["done", "client_validated"]),
      reason,
      documentIds: z.array(z.uuid()).max(100),
    })
    .strict(),
  z
    .object({ kind: z.literal("cancel_mark"), markId: z.uuid(), reason })
    .strict(),
  z
    .object({
      kind: z.literal("classification"),
      state: FiscalClassificationSchema,
      reason,
    })
    .strict(),
  z
    .object({
      kind: z.literal("observation"),
      id: z.uuid(),
      field: FiscalFieldSchema,
      value: z.string().max(300).nullable(),
      provenance: FiscalProvenanceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("resolution"),
      field: FiscalFieldSchema,
      observationIds: z.array(z.uuid()).min(1).max(100),
      value: z.string().max(300).nullable(),
      reason,
    })
    .strict(),

  FiscalSourceEvidenceSchema.extend({
    kind: z.literal("source_freshness"),
  }).strict(),

  z
    .object({
      kind: z.literal("income"),
      coverage: z.enum(["complete", "partial", "confirmed_zero"]),
      lines: z.array(FiscalIncomeLineSchema).max(1000),
      provenance: FiscalProvenanceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("ifu_prepare"),
      sourceIds: z
        .array(z.uuid())
        .max(200)
        .refine((ids) => new Set(ids).size === ids.length),
      payer: FiscalPayerSchema,
      rule: FiscalAggregationRuleSchema,
    })
    .strict(),

  FiscalDeadlinesSchema.extend({ kind: z.literal("deadlines") }).strict(),
  FiscalNoticeSchema.extend({ kind: z.literal("notice") }).strict(),
  z
    .object({
      kind: z.literal("evidence"),
      documentIds: z.array(z.uuid()).min(1).max(100),
      purpose: z.enum([
        "prefilled",
        "receipt",
        "support",
        "generated_preparation",
      ]),
      reason,
    })
    .strict(),
  z
    .object({
      kind: z.literal("responsibility"),
      responsibleIds: z
        .array(z.uuid())
        .max(30)
        .refine((ids) => new Set(ids).size === ids.length),
      reason,
    })
    .strict(),
  z.object({ kind: z.literal("link_task"), taskId: z.uuid(), reason }).strict(),
]);
export type FiscalEvent = z.infer<typeof FiscalEventSchema>;
export const FiscalCommandSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    event: FiscalEventSchema,
  })
  .strict();
export const FiscalTimelineEntrySchema = z.object({
  ifu: FiscalIfuSchema.optional(),
  id: z.uuid(),
  obligationId: z.uuid(),
  version: z.number().int().positive(),
  actorId: z.uuid(),
  at: z.iso.datetime(),
  event: FiscalEventSchema,
});
export type FiscalTimelineEntry = z.infer<typeof FiscalTimelineEntrySchema>;
export const FiscalSituationSchema = z.object({
  clientValidation: z.enum([
    "not_requested",
    "requested",
    "accepted",
    "rejected",
  ]),
  ifu: FiscalIfuSchema.nullable(),
  declarationVersion: z.number().int().positive(),
  preparation: z.enum(["a_preparer", "en_cours", "preparee"]),
  approval: z.enum(["not_requested", "requested", "approved", "rejected"]),
  applicableAcceptedAmount: FiscalMoneySchema.nullable(),
  applicableAcceptedVersion: z.number().int().positive().nullable(),
  acceptanceRule: z.literal(
    "all-declared-recipients-accepted-no-platform-rejection/v1",
  ),
  attempts: z.array(
    z.object({
      id: z.uuid(),
      declarationVersion: z.number().int().positive(),
      platform: z.enum(["pending", "accepted", "rejected"]),
      recipients: z.record(
        z.string(),
        z.enum(["pending", "accepted", "rejected"]),
      ),
      accepted: z.boolean(),
    }),
  ),
  notices: z.array(FiscalNoticeSchema),
  manualMarks: z.array(
    z.object({
      id: z.uuid(),
      state: z.enum(["done", "client_validated"]),
      cancelled: z.boolean(),
      reason: z.string(),
    }),
  ),
  anomalies: z.array(
    z.object({
      field: FiscalFieldSchema,
      state: z.enum(["open", "resolved", "missing"]),
      retainedValue: z.string().nullable(),
      observations: z.array(
        z.object({
          id: z.uuid(),
          value: z.string().nullable(),
          provenance: FiscalProvenanceSchema,
        }),
      ),
    }),
  ),
  bankCandidates: z.array(
    z.object({
      id: z.uuid(),
      reasons: z.array(z.string()),
      eligible: z.boolean(),
      confidence: z.enum(["low", "medium", "high"]),
      confirmedPayment: z.literal(false),
    }),
  ),
  debts: z.array(
    z.object({
      id: z.uuid(),
      amount: FiscalMoneySchema.nullable(),
      remaining: FiscalMoneySchema.nullable(),
      paid: FiscalMoneySchema.nullable(),
      otherApurements: FiscalMoneySchema,
      sourceBalance: FiscalMoneySchema.nullable(),
      sourceConfirmedZero: z.boolean(),
      conflict: z.boolean(),
    }),
  ),
  amount: FiscalMoneySchema.nullable(),
  paid: FiscalMoneySchema.nullable(),
  remaining: FiscalMoneySchema.nullable(),
  ambiguities: z.array(z.string()),
});
export type FiscalSituation = z.infer<typeof FiscalSituationSchema>;

export const FiscalGenerationSchema = z
  .object({
    operationId: z.uuid(),
    dossierId: z.uuid(),
    expectedDossierVersion: z.number().int().positive(),
    nature: FiscalNatureSchema,
    year: z.number().int().min(1900).max(2200),
    campaign: z.string().min(1).max(50),
    contactId: z.uuid().nullable().default(null),
    establishmentId: z.uuid().nullable().default(null),
    customFrequency: z
      .enum(["mensuelle", "trimestrielle", "annuelle"])
      .optional(),
    rule: FiscalProfileSchema.shape.generationRule.removeDefault().unwrap(),
  })
  .strict();
export const FiscalBulkSchema = z
  .object({
    operationId: z.uuid(),
    items: z
      .array(
        z
          .object({
            id: z.uuid(),
            expectedVersion: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(200)
      .refine(
        (items) => new Set(items.map((item) => item.id)).size === items.length,
        "Obligations dupliquées",
      ),
    event: FiscalEventSchema.refine(
      (event) =>
        ["preparation", "approval_request", "approval"].includes(event.kind),
      "Action de lot non autorisée",
    ),
  })
  .strict();
