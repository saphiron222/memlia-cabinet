import { z } from "zod";
import { CivilDateSchema, CabinetRecordSchema } from "./records.js";
import { RecurrenceRuleSchema } from "./workflows.js";
const name = z.string().trim().min(1).max(200);
const unique = (xs: { id: string }[]) =>
  new Set(xs.map((x) => x.id)).size === xs.length;
export const StageStatusSchema = z
  .object({
    id: z.uuid(),
    name,
    color: z.enum(["gray", "blue", "green", "orange", "red", "purple"]),
    icon: z.enum(["circle", "check", "clock", "alert", "minus"]),
    final: z.boolean().default(false),
  })
  .strict();
export const StageTypeSchema = z
  .object({
    kind: z.literal("stage_type"),
    name,
    statuses: z.array(StageStatusSchema).min(1).max(30).refine(unique),
  })
  .strict();
export const ProductionColumnSchema = z
  .object({
    id: z.uuid(),
    name,
    type: z.enum([
      "status",
      "date",
      "text",
      "boolean",
      "decimal",
      "completion",
    ]),
    stageTypeId: z.uuid().nullable().default(null),
    frequency: z
      .enum(["once", "monthly", "quarterly", "yearly"])
      .default("once"),
    requiredRoleId: z.uuid().nullable().default(null),
    approval: z.boolean().default(false),
    assigneeId: z.uuid().nullable().default(null),
    plannedDate: CivilDateSchema.nullable().default(null),
    plannedMinutes: z.number().int().min(0).max(100000).default(0),
  })
  .strict()
  .refine(
    (c) => c.type !== "status" || c.stageTypeId !== null,
    "Type de statut requis",
  );
export const ProductionTemplateSchema = z
  .object({
    kind: z.enum(["balance", "custom", "process", "followup"]),
    name,
    target: z.enum(["dossier", "contact", "utilisateur", "libre"]),
    year: z.number().int().min(1900).max(2200).nullable().default(null),
    family: z.string().max(100).default(""),
    columns: z.array(ProductionColumnSchema).max(60).refine(unique).default([]),
    allowDuplicates: z.boolean().default(false),
    closed: z.boolean().default(false),
    paused: z.boolean().default(false),
    fee: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .nullable()
      .default(null),
    nature: z
      .enum(["personnalisee", "DAS2", "depot_comptes", "CVAE"])
      .default("personnalisee"),
    rule: RecurrenceRuleSchema.nullable().default(null),
    population: z.array(z.uuid()).max(2000).default([]),
    assigneeId: z.uuid().nullable().default(null),
    checklistModelId: z.uuid().nullable().default(null),
    documentIds: z.array(z.uuid()).max(100).default([]),
    tags: z.array(z.string().max(80)).max(30).default([]),
  })
  .strict()
  .refine(
    (m) => m.kind !== "balance" || (m.target === "dossier" && m.year !== null),
    "Bilan annuel par dossier",
  )
  .refine(
    (m) => m.kind !== "custom" || (m.target === "dossier" && m.rule !== null),
    "Règle personnalisée par dossier requise",
  )
  .refine(
    (m) => m.kind !== "followup" || ["dossier", "contact"].includes(m.target),
    "Cible de suivi dossier ou contact",
  );
export const ProductionModelDataSchema = z.union([
  StageTypeSchema,
  ProductionTemplateSchema,
]);
export const ProductionModelSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  actorId: z.uuid(),
  updatedAt: z.iso.datetime(),
  model: ProductionModelDataSchema,
});
export type ProductionModel = z.infer<typeof ProductionModelSchema>;
export type ProductionTemplate = z.infer<typeof ProductionTemplateSchema>;
export type ProductionColumn = z.infer<typeof ProductionColumnSchema>;
export const ProductionModelCommandSchema = z
  .object({
    operationId: z.uuid(),
    id: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    model: ProductionModelDataSchema,
  })
  .strict();
export const ProductionTargetSchema = z
  .object({
    kind: z.enum(["dossier", "contact", "utilisateur", "libre"]),
    id: z.uuid().nullable(),
    label: name,
  })
  .strict()
  .refine(
    (t) => (t.kind === "libre" ? t.id === null : t.id !== null),
    "Identité de cible requise",
  );
export const ProductionCellSchema = z.object({
  columnId: z.uuid(),
  period: z.string().max(20),
  value: z.union([z.string().max(10000), z.boolean(), z.null()]),
  at: z.iso.datetime(),
  actorId: z.uuid(),
  approved: z.boolean(),
  documentIds: z.array(z.uuid()).max(50).default([]),
  note: z.string().max(4000).default(""),
});
export const DepositSchema = z
  .object({
    applicable: z.boolean().default(true),
    assemblyDate: CivilDateSchema.nullable().default(null),
    liasseDate: CivilDateSchema.nullable().default(null),
    plannedDepositDate: CivilDateSchema.nullable().default(null),
    manualComplete: z.boolean().default(false),
    attempts: z
      .array(
        z.object({
          id: z.uuid(),
          date: CivilDateSchema,
          state: z.enum(["submitted", "waiting", "rejected", "accepted"]),
          source: z.enum(["manual", "supplier", "simulated"]),
          reference: name,
          documentIds: z.array(z.uuid()).max(20),
          receiptDocumentId: z.uuid().nullable(),
        }),
      )
      .max(100)
      .default([]),
  })
  .strict();
export const ProductionRowSchema = z.object({
  id: z.uuid(),
  modelId: z.uuid(),
  modelVersion: z.number().int().positive(),
  version: z.number().int().positive(),
  target: ProductionTargetSchema,
  period: z.string().max(30),
  occurrenceKey: z.string().max(300),
  touched:z.boolean().default(false),
  recordId: z.uuid().nullable(),
  scope: CabinetRecordSchema.nullable(),
  cells: z.array(ProductionCellSchema).max(2000).default([]),
  state: z.enum(["not_done", "done", "not_applicable"]).default("not_done"),
  dueDate: CivilDateSchema.nullable().default(null),
  assigneeId: z.uuid().nullable().default(null),
  tags: z.array(z.string().max(80)).max(30).default([]),
  documentIds: z.array(z.uuid()).max(100).default([]),
  deposit: DepositSchema.default(() => DepositSchema.parse({})),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ProductionRow = z.infer<typeof ProductionRowSchema>;
export const ProductionRowCreateSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    target: ProductionTargetSchema,
    period: z.string().max(30).default("once"),
  })
  .strict();
export const ProductionCommandSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    command: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("cell"),
        columnId: z.uuid(),
        period: z.string().max(20),
        value: z.union([z.string().max(10000), z.boolean(), z.null()]),
        approve: z.boolean().default(false),
        documentIds: z.array(z.uuid()).max(50).default([]),
        note: z.string().max(4000).default(""),
      }),
      z.object({
        kind: z.literal("properties"),
        dueDate: CivilDateSchema.nullable(),
        assigneeId: z.uuid().nullable(),
        tags: z.array(z.string().max(80)).max(30),
        state: z.enum(["not_done", "done", "not_applicable"]),
        documentIds: z.array(z.uuid()).max(100),
      }),
      z.object({ kind: z.literal("deposit"), deposit: DepositSchema }),
    ]),
  })
  .strict();
export const ProductionDuplicateSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    year: z.number().int().min(1900).max(2200),
  })
  .strict();
export const ProductionMigrationSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    target: z.enum(["dossier", "contact", "utilisateur", "libre"]),
    mappings: z
      .array(
        z.object({
          rowId: z.uuid(),
          expectedVersion: z.number().int().positive(),
          target: ProductionTargetSchema,
        }),
      )
      .max(2000),
    reason: name,
  })
  .strict();
export const ProductionGenerationSchema = z
  .object({
    operationId: z.uuid(),
    modelId: z.uuid(),
    from: CivilDateSchema,
    to: CivilDateSchema,
  })
  .strict();
export const ProductionQuerySchema = z.object({
  after: z.uuid().optional(),
  q: z.string().max(200).default(""),
  period: z.string().max(30).default(""),
  state: z.enum(["", "not_done", "done", "not_applicable"]).default(""),
  tag: z.string().max(80).default(""),
  deposit: z
    .enum([
      "",
      "waiting",
      "rejected",
      "accepted",
      "not_applicable",
      "not_submitted",
    ])
    .default(""),
  sort: z.enum(["id", "title", "dueDate"]).default("id"),
  direction: z.enum(["asc", "desc"]).default("asc"),
  offset: z.coerce.number().int().min(0).default(0),
});
export const ProductionRowListSchema = z.object({
  items: z.array(ProductionRowSchema),
  hasMore: z.boolean(),
});
export const ProductionModelListSchema = z.object({
  items: z.array(ProductionModelSchema),
  nextCursor: z.uuid().nullable(),
});
export function productionPeriod(c: ProductionColumn, date: string) {
  if (c.frequency === "once") return "once";
  if (c.frequency === "yearly") return date.slice(0, 4);
  if (c.frequency === "monthly") return date.slice(0, 7);
  return `${date.slice(0, 4)}-Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`;
}
export const ProductionImportSchema = z
  .object({
    format: z.literal("memlia-stages-1"),
    filename: name,
    base64: z.string().max(8000000),
    mapping: z
      .object({
        model: z.string(),
        status: z.string(),
        color: z.string(),
        icon: z.string(),
        final: z.string(),
      })
      .strict(),
  })
  .strict();
export const ProductionImportPreviewSchema = z.object({
  id: z.uuid(),
  actorId: z.uuid(),
  source: z.object({ filename: z.string(), sha256: z.string() }),
  models: z.array(StageTypeSchema).max(200),
  unmapped: z
    .array(z.object({ line: z.number().int(), reason: z.string() }))
    .max(2000),
  committed: z.boolean(),
});
export type ProductionImportPreview = z.infer<
  typeof ProductionImportPreviewSchema
>;
export const ProductionExportSchema = z.object({
  id: z.uuid(),
  entity: z.enum([
    "model",
    "model_version",
    "row",
    "row_version",
    "stage_import",
  ]),
  data: z.union([
    ProductionModelSchema,
    ProductionRowSchema,
    ProductionImportPreviewSchema,
  ]),
});
export const ProductionPeopleSchema = z.object({
  items: z.array(z.object({ id: z.uuid(), name: z.string() })),
  total: z.number().int().nonnegative(),
});
export const ProductionCapabilitiesSchema = z.object({
  update: z.boolean(),
  assign: z.boolean(),
  columns: z.array(
    z.object({ id: z.uuid(), edit: z.boolean(), approve: z.boolean() }),
  ),
});
