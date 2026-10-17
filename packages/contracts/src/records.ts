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
export const DossierDataSchema = z
  .object({
    siren: z
      .string()
      .regex(/^\d{9}$/)
      .nullable()
      .default(null),
    legalForm: z.string().max(100).default(""),
    notes: z.string().max(10000).default(""),
    archived: z.boolean().default(false),
  })
  .strict();
export const ContactDataSchema = z
  .object({
    contactType: z.enum(["personne", "organisation"]).default("personne"),
    email: z.email().nullable().default(null),
    phone: z.string().max(50).default(""),
    notes: z.string().max(10000).default(""),
    archived: z.boolean().default(false),
  })
  .strict();
export const TaskDataSchema = z
  .object({
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
});
export type Dashboard = z.infer<typeof DashboardSchema>;

export const RecordListQuerySchema = z
  .object({
    kind: RecordKindSchema.optional(),
    q: z.string().max(300).optional(),
    dossierId: z.uuid().optional(),
    archived: z.enum(["true", "false"]).default("false"),
    offset: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type RecordListQuery = z.infer<typeof RecordListQuerySchema>;
