import { FiscalTimelineEntrySchema } from "./fiscal.js";
import { z } from "zod";
import { CabinetRecordSchema, RecordListQuerySchema } from "./records.js";
import { DocumentSchema } from "./documents.js";
import { CustomFieldSchema } from "./administration.js";
export const CabinetExportSchema = z.object({
  format: z.literal("memlia-cabinet-1"),
  generatedAt: z.iso.datetime(),
  sourceInstallation: z.object({ id: z.uuid(), name: z.string() }),
  scope: z.literal(
    "objets autorisés actifs et archivés, avec leurs références documentaires",
  ),
  records: z.array(CabinetRecordSchema),
  fiscalEvents: z.array(FiscalTimelineEntrySchema).default([]),
  customFields: z.array(CustomFieldSchema),
  documents: z.array(DocumentSchema.extend({ downloadUrl: z.string() })),
  errors: z.array(
    z.object({
      documentId: z.uuid(),
      code: z.enum(["DOCUMENT_MISSING", "DOCUMENT_CORRUPT"]),
      message: z.string(),
    }),
  ),
});
import { JobSchema } from "./jobs.js";
export const ExportRunSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  job: JobSchema,
  error: z.string().nullable(),
  encoding: z.enum(["json", "csv", "tar"]),
  query: RecordListQuerySchema.nullable(),
  records: z.number().int().nonnegative(),
  documents: z.number().int().nonnegative(),
});
export const ExportListSchema = z.object({
  items: z.array(ExportRunSchema).max(5),
});
export const ExportCommandSchema = z
  .object({
    operationId: z.uuid(),
    query: RecordListQuerySchema.optional(),
    originals: z.boolean().default(false),
  })
  .strict();

export const ExportManifestSchema = CabinetExportSchema.omit({
  fiscalEvents: true,
  records: true,
  documents: true,
  customFields: true,
  errors: true,
}).extend({
  format: z.literal("memlia-cabinet-manifest-1"),
  encoding: z.enum(["json", "csv", "tar"]),
  query: RecordListQuerySchema.nullable(),
  records: z.number().int().nonnegative(),
  documents: z.number().int().nonnegative(),
  parts: z.array(
    z.object({
      number: z.number().int().positive(),
      count: z.number().int().positive(),
      maximumBytes: z.number().int().positive(),
      downloadUrl: z.string(),
    }),
  ),
});
