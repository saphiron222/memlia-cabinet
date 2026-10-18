import { z } from "zod";
import { NotificationSchema } from "./workflows.js";
import { CivilDateSchema, FieldOriginSchema } from "./records.js";
import { StageStatusSchema } from "./production.js";
const text = z.string().max(10000).default("");
const label = z.string().trim().min(1).max(300);
const ids = z
  .array(z.uuid())
  .max(100)
  .refine((a) => new Set(a).size === a.length)
  .default([]);
const money = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/)
  .nullable()
  .default(null);
const unique = (a: { id: string }[]) =>
  new Set(a.map((x) => x.id)).size === a.length;
export const PipelineSchema = z
  .object({
    kind: z.literal("pipeline"),
    name: label,
    active: z.boolean().default(true),
    stages: z.array(StageStatusSchema).min(1).max(30).refine(unique),
    conversionStageId: z.uuid().nullable().default(null),
    triggers: z
      .object({
        quoteStageId: z.uuid().nullable().default(null),
        letterStageId: z.uuid().nullable().default(null),
      })
      .strict()
      .default({ quoteStageId: null, letterStageId: null }),
  })
  .strict()
  .refine(
    (p) =>
      [
        p.conversionStageId,
        p.triggers.quoteStageId,
        p.triggers.letterStageId,
      ].every((id) => !id || p.stages.some((s) => s.id === id)),
    "Étape de déclenchement absente",
  );
export const MissionSchema = z
  .object({
    kind: z.literal("mission"),
    name: label,
    category: label,
    unit: label,
    quantified: z.boolean().default(true),
    order: z.number().int().min(0).max(10000).default(0),
    active: z.boolean().default(true),
  })
  .strict();
export const ProspectSchema = z
  .object({
    kind: z.literal("prospect"),
    contactId: z.uuid(),
    mainContactId: z.uuid().nullable().default(null),
    pipelineId: z.uuid(),
    stageId: z.uuid(),
    identity: z.enum(["company", "person", "future_company"]),
    source: z.string().max(300).default(""),
    temperature: z.enum(["unknown", "cold", "warm", "hot"]).default("unknown"),
    manualRisk: z.enum(["unknown", "low", "medium", "high"]).default("unknown"),
    calculatedScore: z.null().default(null),
    riskFlags: z.array(z.string().max(200)).max(30).default([]),
    riskNotes: text,
    proposedFee: money,
    notes: text,
    interactions: z
      .array(
        z.object({ id: z.uuid(), date: CivilDateSchema, description: label }),
      )
      .max(100)
      .refine(unique)
      .default([]),
    missions: z
      .array(
        z.object({
          missionId: z.uuid(),
          missionVersion: z.number().int().positive(),
          quantity: z.string().regex(/^\d{1,9}(\.\d{1,4})?$/),
          amount: money,
        }),
      )
      .max(100)
      .default([]),
    origin: z
      .enum(["creation", "reprise_without_cabinet", "reprise_with_cabinet"])
      .default("creation"),
    repriseDate: CivilDateSchema.nullable().default(null),
    formerCabinet: z.string().max(300).default(""),
    createdOn: CivilDateSchema.nullable().default(null),
    headcount: z.number().int().nonnegative().nullable().default(null),
    purpose: text,
    sector: z.string().max(300).default(""),
    closingMonth: z.number().int().min(1).max(12).nullable().default(null),
    activity: text,
    monthlyPieces: z.number().int().nonnegative().nullable().default(null),
    bankAccounts: z.number().int().nonnegative().nullable().default(null),
    vatFrequency: z
      .enum(["monthly", "quarterly", "annual"])
      .nullable()
      .default(null),
    pieceSources: text,
    banks: text,
    tools: text,
    missingInformation: text,
    hypotheses: text,
    assigneeIds: ids,
    teamIds: ids,
    tags: z.array(z.string().max(50)).max(30).default([]),
    dossierId: z.uuid().nullable().default(null),
  })
  .strict();
export const OnboardingStepSchema = z
  .object({
    id: z.uuid(),
    name: label,
    type: z.enum(["boolean", "text", "date", "status"]),
    semantic: z
      .enum([
        "identity",
        "mandate",
        "beneficial_owners",
        "letter",
        "fiscal",
        "custom",
      ])
      .default("custom"),
    source: z.enum(["manual", "system"]).default("manual"),
    required: z.boolean().default(false),
    active: z.boolean().default(true),
    stageTypeId: z.uuid().nullable().default(null),
    stageTypeVersion: z.number().int().positive().nullable().default(null),
    statuses: z.array(StageStatusSchema).max(30).refine(unique).default([]),
  })
  .strict();
export const OnboardingModelSchema = z
  .object({
    kind: z.literal("onboarding_model"),
    name: label,
    active: z.boolean().default(true),
    steps: z.array(OnboardingStepSchema).min(1).max(100).refine(unique),
  })
  .strict();
export const EvidenceSchema = z
  .object({
    documentId: z.uuid(),
    version: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    origin: z.enum(["client", "manual", "import", "registry"]),
    reference: z.string().max(500),
    acquiredOn: CivilDateSchema,
    scope: label,
    result: z.enum(["to_review", "examined", "insufficient"]),
  })
  .strict();
export const IdentityReviewSchema = z
  .object({
    kind: z.literal("identity"),
    personId: z.uuid(),
    dossierId: z.uuid(),
    evidence: z.array(EvidenceSchema).min(1).max(30),
    result: z.enum(["to_review", "examined", "insufficient"]),
    observedOn: CivilDateSchema,
    expiresOn: CivilDateSchema,
    method: label,
    address: label,
    birthIdentity: label,
    reason: label,
  })
  .strict();
export const OnboardingValueSchema = z
  .object({
    stepId: z.uuid(),
    value: z.union([z.boolean(), z.string().max(10000), z.null()]),
    status: z
      .enum(["pending", "in_progress", "done", "blocked", "not_applicable"])
      .default("pending"),
    note: text,
    date: CivilDateSchema.nullable().default(null),
    expiresOn: CivilDateSchema.nullable().default(null),
    evidence: z.array(EvidenceSchema).max(30).default([]),
  })
  .strict();
export const OnboardingSchema = z
  .object({
    kind: z.literal("onboarding"),
    dossierId: z.uuid(),
    personId: z.uuid(),
    modelId: z.uuid(),
    values: z
      .array(OnboardingValueSchema)
      .max(100)
      .refine((a) => new Set(a.map((v) => v.stepId)).size === a.length)
      .default([]),
    assigneeIds: ids,
    teamIds: ids,
    tags: z.array(z.string().max(50)).max(30).default([]),
    followedBy: ids,
    origin: z.enum(["creation", "reprise"]).default("creation"),
  })
  .strict();
export const LabPolicySchema = z
  .object({
    kind: z.literal("lab_policy"),
    name: label,
    periodDays: z.number().int().min(1).max(3650),
    reason: label,
    active: z.boolean().default(true),
  })
  .strict();
export const LabReviewSchema = z
  .object({
    kind: z.literal("lab"),
    dossierId: z.uuid(),
    personId: z.uuid().nullable().default(null),
    level: z.enum(["simplified", "standard", "enhanced"]),
    reason: label,
    role: label,
    observedOn: CivilDateSchema,
    decisionOn: CivilDateSchema,
    nextReviewOn: CivilDateSchema,
    policyId: z.uuid(),
    policyVersion: z.number().int().positive(),
    evidence: z.array(EvidenceSchema).min(1).max(100),
    recipientIds: ids,
    signals: z.array(z.string().max(300)).max(30).default([]),
    status: z.enum(["reviewed", "reopened"]).default("reviewed"),
  })
  .strict()
  .refine(
    (d) => d.nextReviewOn >= d.decisionOn,
    "Révision antérieure à la décision",
  );
export const RelationshipDataSchema = z.discriminatedUnion("kind", [
  PipelineSchema,
  MissionSchema,
  ProspectSchema,
  OnboardingModelSchema,
  OnboardingSchema,
  IdentityReviewSchema,
  LabPolicySchema,
  LabReviewSchema,
]);
export const RelationshipEntitySchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    actorId: z.uuid(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    valueOrigins: z.record(z.uuid(), FieldOriginSchema).default({}),
    identityFingerprint: z.string().nullable().default(null),
    origin: FieldOriginSchema,
    data: RelationshipDataSchema,
  })
  .strict();
export type RelationshipEntity = z.infer<typeof RelationshipEntitySchema>;
export type RelationshipData = z.infer<typeof RelationshipDataSchema>;
export const RelationshipSaveSchema = z
  .object({
    id: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    operationId: z.uuid(),
    data: RelationshipDataSchema,
  })
  .strict();
export type RelationshipSave = z.infer<typeof RelationshipSaveSchema>;
export const RelationshipMoveSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    stageId: z.uuid(),
  })
  .strict();
export const RelationshipQuerySchema = z
  .object({
    kind: z
      .enum([
        "pipeline",
        "mission",
        "prospect",
        "onboarding_model",
        "onboarding",
        "identity",
        "lab_policy",
        "lab",
      ])
      .optional(),
    q: z.string().max(300).default(""),
    origin: z.enum(["creation", "reprise"]).optional(),
    followed: z.enum(["true", "false"]).optional(),
    hideCompleted: z.enum(["true", "false"]).optional(),
    sort: z.enum(["name", "updated"]).default("name"),
    stageId: z.uuid().optional(),
    pipelineId: z.uuid().optional(),
    contactId: z.uuid().optional(),
    dossierId: z.uuid().optional(),
    active: z.enum(["true", "false"]).optional(),
    tag: z.string().max(50).optional(),
    assigneeId: z.uuid().optional(),
    teamId: z.uuid().optional(),
    offset: z.coerce.number().int().nonnegative().default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const RelationshipPageSchema = z.object({
  items: z.array(RelationshipEntitySchema),
  total: z.number().int(),
  offset: z.number().int(),
  limit: z.number().int(),
});
export const RelationshipEventSchema = z
  .object({
    id: z.uuid(),
    entityId: z.uuid(),
    version: z.number().int().positive(),
    actorId: z.uuid(),
    operationId: z.uuid(),
    at: z.iso.datetime(),
    type: z.enum([
      "converted",
      "quote_requested",
      "letter_requested",
      "activation_requested",
    ]),
    state: z.enum(["recorded", "pending_producer"]),
    dossierId: z.uuid().nullable(),
    modelId: z.uuid().nullable(),
    modelVersion: z.number().int().positive().nullable(),
  })
  .strict();
export const PipelineImportSchema = z
  .object({
    filename: z.string().min(1).max(200),
    base64: z.string().max(8 * 1024 * 1024),
    name: label,
    mapping: z
      .object({
        stage: label,
        color: label,
        icon: label,
        conversion: label,
        quote: label,
        letter: label,
      })
      .strict(),
  })
  .strict();
export const PipelineImportPreviewSchema = z.object({
  id: z.uuid(),
  actorId: z.uuid(),
  source: z.object({ filename: z.string(), sha256: z.string() }),
  model: PipelineSchema,
  correspondences: z.array(
    z.object({ line: z.number().int(), label: z.string(), stageId: z.uuid() }),
  ),
  unmapped: z.array(z.object({ line: z.number().int(), reason: z.string() })),
  committed: z.boolean(),
});
export const RelationshipExportSchema = z.discriminatedUnion("entity", [
  z.object({
    id: z.uuid(),
    entity: z.literal("notification"),
    data: NotificationSchema,
  }),
  z.object({
    id: z.uuid(),
    entity: z.literal("current"),
    data: RelationshipEntitySchema,
  }),
  z.object({
    id: z.uuid(),
    entity: z.literal("history"),
    data: RelationshipEntitySchema,
  }),
  z.object({
    id: z.uuid(),
    entity: z.literal("event"),
    data: RelationshipEventSchema,
  }),
  z.object({
    id: z.uuid(),
    entity: z.literal("import"),
    data: PipelineImportPreviewSchema,
  }),
]);
export const OnboardingStatusSchema = z.object({
  row: RelationshipEntitySchema,
  steps: z.array(
    OnboardingStepSchema.extend({
      value: z.union([z.boolean(), z.string(), z.null()]),
      status: z.string(),
      verifiedAccess: z.literal(false),
      provenance: FieldOriginSchema.nullable(),
      expired: z.boolean(),
    }),
  ),
  blockers: z.array(
    z.object({
      code: z.string(),
      stepId: z.uuid().nullable(),
      reason: z.string(),
    }),
  ),
  complete: z.boolean(),
  creationOrigins: z.record(z.string(), FieldOriginSchema),
  portalState: z.literal("not_activated"),
});
export const RelationshipBulkSchema = z
  .object({
    operationId: z.uuid(),
    stageId: z.uuid(),
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
      .max(20)
      .refine(unique),
  })
  .strict();
export const RelationshipBulkResultSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      state: z.enum(["succeeded", "failed"]),
      version: z.number().int().optional(),
      code: z.string().optional(),
      message: z.string().optional(),
    }),
  ),
});
