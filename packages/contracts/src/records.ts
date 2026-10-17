import { z } from "zod";
export const RecordKindSchema = z.enum([
  "dossier",
  "contact",
  "tache",
  "obligation",
]);
export type RecordKind = z.infer<typeof RecordKindSchema>;
export const CivilDateSchema = z.iso.date();
export const TaskStateSchema = z.enum(["a_faire", "en_cours", "terminee"]);
export const ChecklistItemSchema = z
  .object({
    id: z.string().uuid(),
    label: z.string().trim().min(1).max(300),
    done: z.boolean(),
  })
  .strict();
const uniqueIds = (items: { id: string }[]) =>
  new Set(items.map((x) => x.id)).size === items.length;
export const AddressSchema = z
  .object({
    line1: z.string().max(300).default(""),
    line2: z.string().max(300).default(""),
    postalCode: z.string().max(30).default(""),
    city: z.string().max(150).default(""),
    country: z.string().max(100).default(""),
  })
  .strict();
export const FieldOriginSchema = z
  .object({
    kind: z.enum(["manual", "import", "public", "simulated", "supplier"]),
    reference: z.string().max(500),
    version: z.string().max(100),
    at: z.iso.datetime(),
  })
  .strict();
export type FieldOrigin = z.infer<typeof FieldOriginSchema>;
export const CustomValueSchema = z.union([
  z.string().max(10000),
  z.boolean(),
  z.null(),
]);
const extensible = {
  customFields: z.record(z.uuid(), CustomValueSchema).default({}),
  fieldOrigins: z.record(z.string().max(100), FieldOriginSchema).default({}),
};
export const EstablishmentSchema = z
  .object({
    id: z.uuid(),
    siret: z
      .string()
      .regex(/^\d{14}$/)
      .nullable()
      .default(null),
    name: z.string().max(300).default(""),
    address: AddressSchema.default(() => AddressSchema.parse({})),
    headOffice: z.boolean().default(false),
    active: z.boolean().default(true),
    openedOn: CivilDateSchema.nullable().default(null),
    closedOn: CivilDateSchema.nullable().default(null),
  })
  .strict();
export const DossierDataSchema = z
  .object({
    ...extensible,
    siren: z
      .string()
      .regex(/^\d{9}$/)
      .nullable()
      .default(null),
    identifiers: z
      .array(
        z
          .object({
            kind: z.string().trim().min(1).max(80),
            value: z.string().trim().min(1).max(100),
          })
          .strict(),
      )
      .max(30)
      .default([]),
    legalForm: z.string().max(100).default(""),
    capital: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .nullable()
      .default(null),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("EUR"),
    address: AddressSchema.default(() => AddressSchema.parse({})),
    email: z.email().nullable().default(null),
    phone: z.string().max(50).default(""),
    activityCode: z.string().max(20).default(""),
    activity: z.string().max(500).default(""),
    createdOn: CivilDateSchema.nullable().default(null),
    startedOn: CivilDateSchema.nullable().default(null),
    endedOn: CivilDateSchema.nullable().default(null),
    financialYearEnd: CivilDateSchema.nullable().default(null),
    incomeTaxRegime: z
      .enum(["IS", "IR_BIC", "IR_BNC", "IR_BA", "exonere", "autre"])
      .nullable()
      .default(null),
    vatRegime: z
      .enum([
        "franchise",
        "reel_simplifie",
        "reel_normal",
        "exonere",
        "hors_champ",
      ])
      .nullable()
      .default(null),
    vatFrequency: z
      .enum(["mensuelle", "trimestrielle", "annuelle"])
      .nullable()
      .default(null),
    establishments: z
      .array(EstablishmentSchema)
      .max(200)
      .refine(uniqueIds, "Identités d’établissement uniques")
      .refine(
        (items) =>
          new Set(items.filter((x) => x.siret).map((x) => x.siret)).size ===
          items.filter((x) => x.siret).length,
        "SIRET uniques",
      )
      .default([]),
    obligations: z
      .array(
        z.enum([
          "TVA",
          "IS",
          "CFE",
          "CVAE",
          "DAS2",
          "DSN",
          "IRPP",
          "RCM",
          "IFU",
          "DES",
          "TF",
        ]),
      )
      .max(11)
      .default([]),
    notes: z.string().max(10000).default(""),
    archived: z.boolean().default(false),
  })
  .strict();
export const ContactDataSchema = z
  .object({
    ...extensible,
    contactType: z.enum(["personne", "organisation"]).default("personne"),
    firstName: z.string().max(150).default(""),
    lastName: z.string().max(150).default(""),
    sex: z.enum(["homme", "femme", "autre"]).nullable().default(null),
    birthDate: CivilDateSchema.nullable().default(null),
    birthCity: z.string().max(150).default(""),
    birthCountry: z.string().max(100).default(""),
    nationality: z.string().max(100).default(""),
    taxNumber: z.string().max(50).default(""),
    siren: z
      .string()
      .regex(/^\d{9}$/)
      .nullable()
      .default(null),
    legalForm: z.string().max(100).default(""),
    capital: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .nullable()
      .default(null),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("EUR"),
    address: AddressSchema.default(() => AddressSchema.parse({})),
    email: z.email().nullable().default(null),
    phone: z.string().max(50).default(""),
    relatedDossierIds: z
      .array(z.uuid())
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length)
      .default([]),
    notes: z.string().max(10000).default(""),
    archived: z.boolean().default(false),
  })
  .strict();
export const TaskDataSchema = z
  .object({
    ...extensible,
    description: z.string().max(10000).default(""),
    dueDate: CivilDateSchema.nullable().default(null),
    state: TaskStateSchema.default("a_faire"),
    priority: z.enum(["normale", "haute", "urgente"]).default("normale"),
    assigneeIds: z.array(z.uuid()).max(100).default([]),
    checklist: z
      .array(ChecklistItemSchema)
      .max(100)
      .refine(uniqueIds, "Identifiants de checklist uniques")
      .default([]),
    tags: z.array(z.string().max(50)).max(30).default([]),
    archived: z.boolean().default(false),
  })
  .strict();
export const ObligationDataSchema = z
  .object({
    ...extensible,
    nature: z.string().trim().min(1).max(100),
    period: z.string().trim().min(1).max(50),
    dueDate: CivilDateSchema.nullable().default(null),
    preparation: z
      .enum(["a_preparer", "en_cours", "preparee"])
      .default("a_preparer"),
    validation: z
      .enum(["non_validee", "validee_localement"])
      .default("non_validee"),
    amount: z
      .string()
      .regex(/^-?\d+(\.\d{1,2})?$/)
      .nullable()
      .default(null),
    source: z.enum(["manuelle", "simulee"]).default("manuelle"),
    archived: z.boolean().default(false),
  })
  .strict();
const fields = {
  title: z.string().trim().min(1).max(300),
  dossierId: z.uuid().nullable().default(null),
  confidential: z.boolean().default(false),
};
export const RecordContentSchema = z.discriminatedUnion("kind", [
  z
    .object({ ...fields, kind: z.literal("dossier"), data: DossierDataSchema })
    .strict(),
  z
    .object({ ...fields, kind: z.literal("contact"), data: ContactDataSchema })
    .strict(),
  z
    .object({ ...fields, kind: z.literal("tache"), data: TaskDataSchema })
    .strict(),
  z
    .object({
      ...fields,
      kind: z.literal("obligation"),
      data: ObligationDataSchema,
    })
    .strict(),
]);
const metadata = {
  id: z.uuid(),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};
export const CabinetRecordSchema = z.discriminatedUnion("kind", [
  RecordContentSchema.options[0].extend(metadata),
  RecordContentSchema.options[1].extend(metadata),
  RecordContentSchema.options[2].extend(metadata),
  RecordContentSchema.options[3].extend(metadata),
]);
export type CabinetRecord = z.infer<typeof CabinetRecordSchema>;
export const OperationIdSchema = z.uuid();
export const CreateRecordInputSchema = z
  .object({ operationId: OperationIdSchema, record: RecordContentSchema })
  .strict();
export type CreateRecordInput = z.input<typeof CreateRecordInputSchema>;
export const UpdateRecordInputSchema = z
  .object({
    operationId: OperationIdSchema,
    expectedVersion: z.number().int().positive(),
    record: RecordContentSchema,
  })
  .strict();
export type UpdateRecordInput = z.input<typeof UpdateRecordInputSchema>;
export const TaskTransitionInputSchema = z
  .object({
    operationId: OperationIdSchema,
    expectedVersion: z.number().int().positive(),
    state: TaskStateSchema,
  })
  .strict();
export type TaskTransitionInput = z.infer<typeof TaskTransitionInputSchema>;
export const RecordListSchema = z.object({
  items: z.array(CabinetRecordSchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});
export type RecordList = z.infer<typeof RecordListSchema>;
export const HistoryEventSchema = z.object({
  id: z.uuid(),
  recordId: z.uuid(),
  operationId: z.uuid(),
  actorId: z.uuid(),
  action: z.enum(["created", "updated", "transitioned"]),
  version: z.number().int().positive(),
  at: z.iso.datetime(),
  snapshot: CabinetRecordSchema,
});
export type HistoryEvent = z.infer<typeof HistoryEventSchema>;
export const HistorySchema = z.object({ items: z.array(HistoryEventSchema) });
export const DashboardSchema = z.object({
  asOf: z.iso.datetime(),
  counts: z.object({
    dossier: z.number(),
    contact: z.number(),
    tache: z.number(),
    obligation: z.number(),
  }),
  openTasks: z.number(),
  overdueTasks: z.number(),
  upcomingTasks: z.number(),
  obligationSources: z.object({
    manual: z.number(),
    simulated: z.number(),
    verified: z.literal(0),
    freshness: z.literal("unknown"),
  }),
  tasks: z.array(
    z.object({ state: TaskStateSchema, count: z.number().int().nonnegative() }),
  ),
  obligations: z.array(
    z.object({
      state: ObligationDataSchema.shape.preparation.removeDefault(),
      count: z.number().int().nonnegative(),
    }),
  ),
});
export type Dashboard = z.infer<typeof DashboardSchema>;

export const RecordColumnKeys = [
  "id",
  "kind",
  "title",
  "dossierId",
  "version",
  "createdAt",
  "updatedAt",
  "confidential",
  ...new Set([
    ...Object.keys(DossierDataSchema.shape),
    ...Object.keys(ContactDataSchema.shape),
    ...Object.keys(TaskDataSchema.shape),
    ...Object.keys(ObligationDataSchema.shape),
  ]),
];
export const RecordColumnsSchema = z
  .string()
  .max(5000)
  .refine((s) => {
    const cols = s.split(",");
    return (
      cols.length > 0 &&
      cols.length <= 100 &&
      new Set(cols).size === cols.length &&
      cols.every(
        (c) =>
          RecordColumnKeys.includes(c) || /^custom\.[a-f0-9-]{36}$/.test(c),
      )
    );
  }, "Colonnes invalides");
export const RecordListQuerySchema = z
  .object({
    kind: RecordKindSchema.optional(),
    q: z.string().max(300).optional(),
    dossierId: z.uuid().optional(),
    archived: z.enum(["true", "false"]).default("false"),
    from: CivilDateSchema.optional(),
    to: CivilDateSchema.optional(),
    groupId: z.uuid().optional(),
    assigneeId: z.uuid().optional(),
    state: TaskStateSchema.optional(),
    source: z.enum(["manuelle", "simulee"]).optional(),
    preparation: ObligationDataSchema.shape.preparation
      .removeDefault()
      .optional(),
    sort: z.enum(["title", "updatedAt", "dueDate", "state"]).default("title"),
    direction: z.enum(["asc", "desc"]).default("asc"),
    columns: RecordColumnsSchema.optional(),
    offset: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type RecordListQuery = z.infer<typeof RecordListQuerySchema>;
