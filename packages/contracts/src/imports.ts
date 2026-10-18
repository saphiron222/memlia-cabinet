import { z } from "zod";
import { RecordContentSchema, CabinetRecordSchema } from "./records.js";
import { AssignmentRowSchema } from "./administration.js";
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const ImportKindSchema = z.enum(["dossier", "contact", "assignment"]);
export const ImportMappingSchema = z
  .record(z.string().regex(/^\d{1,2}$/), z.string().max(100))
  .refine((mapping) => {
    const values = Object.values(mapping).filter(Boolean);
    return new Set(values).size === values.length;
  }, "Une seule colonne par champ");
export const ImportParseOptionsSchema = z.object({
  format: z.enum(["csv", "xlsx"]),
  delimiter: z.enum([";", ",", "\t"]).default(";"),
  sheet: z.string().min(1).max(100).optional(),
});
export const ImportCellSchema = z
  .object({
    value: z.union([z.string().max(32768), z.boolean(), z.null()]),
    type: z.enum(["text", "number", "date", "boolean", "blank"]),
  })
  .strict();
export const ImportTableSchema = z
  .object({
    sheet: z.string().max(100),
    sheets: z.array(z.string().max(100)).max(20),
    headers: z.array(z.string().min(1).max(300)).min(1).max(100),
    rows: z
      .array(
        z.object({
          number: z.number().int().min(2).max(10001),
          cells: z.array(ImportCellSchema).max(100),
        }),
      )
      .max(10000),
  })
  .strict();
export type ImportTable = z.infer<typeof ImportTableSchema>;
export const ImportUploadSchema = ImportParseOptionsSchema.extend({
  operationId: z.uuid(),
  filename: z.string().min(1).max(255),
  kind: ImportKindSchema,
  bytes: z
    .string()
    .max(Math.ceil(IMPORT_MAX_BYTES / 3) * 4)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  mapping: ImportMappingSchema.default({}),
  sourceInstallationId: z.uuid().nullable().default(null),
}).strict();
export const ImportPreviewSchema = ImportParseOptionsSchema.extend({
  id: z.uuid(),
  actorId: z.uuid(),
  version: z.number().int().positive(),
  filename: z.string(),
  kind: ImportKindSchema,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceInstallationId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  headers: z.array(z.string()),
  total: z.number().int().nonnegative().max(10000),
  mapping: ImportMappingSchema,
  state: z.enum(["preview", "queued", "running", "completed", "failed"]),
  jobId: z.uuid().nullable(),
  processed: z.number().int().nonnegative(),
  error: z.string().nullable(),
  sheets: z.array(z.string()),
}).strict();
export type ImportPreview = z.infer<typeof ImportPreviewSchema>;
export const ImportLineSchema = z
  .object({
    lineId: z.string().regex(/^[a-f0-9]{64}$/),
    number: z.number().int(),
    cells: z.array(ImportCellSchema),
    record: RecordContentSchema.nullable(),
    assignment: AssignmentRowSchema.nullable(),
    errors: z.array(z.string().max(500)).max(100),
    candidates: z
      .array(
        z.object({
          id: z.uuid(),
          title: z.string(),
          version: z.number().int(),
        }),
      )
      .max(100),
    duplicate: z.boolean(),
    accepted: z.boolean(),
    targetId: z.uuid().nullable(),
    expectedRecordVersion: z.number().int().positive().nullable(),
    overwriteFields: z.array(z.string()).max(100),
    fields: z.array(z.string()).max(100),
    changes: z
      .array(
        z.object({
          field: z.string(),
          before: z.unknown(),
          after: z.unknown(),
        }),
      )
      .max(100),
    status: z.enum([
      "pending",
      "created",
      "updated",
      "assigned",
      "removed",
      "refused",
    ]),
    resultId: z.uuid().nullable(),
  })
  .strict();
export type ImportLine = z.infer<typeof ImportLineSchema>;
export const ImportRowsSchema = z.object({
  items: z.array(ImportLineSchema).max(100),
  total: z.number().int(),
  offset: z.number().int(),
});
export const ImportSelectionSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    rows: z
      .array(
        z
          .object({
            lineId: ImportLineSchema.shape.lineId,
            accepted: z.boolean(),
            targetId: z.uuid().nullable().optional(),
            expectedRecordVersion: z.number().int().positive().optional(),
            overwriteFields: z.array(z.string().max(100)).max(100).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const ImportCommitSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    sourceHash: ImportPreviewSchema.shape.sourceHash,
    lineIds: z
      .array(ImportLineSchema.shape.lineId)
      .min(1)
      .max(10000)
      .refine((a) => new Set(a).size === a.length),
  })
  .strict();
export const ImportRemapSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    mapping: ImportMappingSchema,
  })
  .strict();
export const ImportCatalogueSchema = z.object({
  fields: z.record(
    ImportKindSchema,
    z.array(
      z.object({ key: z.string(), label: z.string(), required: z.boolean() }),
    ),
  ),
  maxBytes: z.number(),
  maxRows: z.number(),
  maxColumns: z.number(),
});
export const ImportListSchema = z.object({
  items: z.array(ImportPreviewSchema).max(10),
});
export const ImportAcceptedSchema = z.object({
  version: z.number().int().positive(),
  sourceHash: ImportPreviewSchema.shape.sourceHash,
  lineIds: z.array(ImportLineSchema.shape.lineId).max(10000),
});
