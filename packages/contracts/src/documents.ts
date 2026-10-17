import { z } from "zod";
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const DocumentSourceSchema = z
  .object({
    kind: z.string().trim().min(1).max(100),
    reference: z.string().trim().min(1).max(500),
    version: z.string().trim().min(1).max(200),
  })
  .strict();
export const DocumentInputSchema = z
  .object({
    operationId: z.uuid(),
    dossierId: z.uuid(),
    filename: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine(
        (v) => !/[\\/\u0000-\u001f\u007f]/.test(v) && v !== "." && v !== "..",
        "Nom de fichier invalide.",
      ),
    mediaType: z.enum([
      "application/pdf",
      "text/plain",
      "application/octet-stream",
    ]),
    source: DocumentSourceSchema,
    confidential: z.boolean().default(false),
    previousVersionId: z.uuid().nullable().default(null),
  })
  .strict();
export type DocumentInput = z.infer<typeof DocumentInputSchema>;
export const ExtractionSchema = z.object({
  status: z.enum(["complete", "needs_ocr", "unsupported"]),
  engine: z.string(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  pages: z.number().int().nonnegative(),
});
export const DocumentReferenceSchema = DocumentInputSchema.omit({
  operationId: true,
}).extend({
  id: z.uuid(),
  logicalId: z.uuid(),
  version: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  actorId: z.uuid(),
  extraction: ExtractionSchema,
});
export type DocumentReference = z.infer<typeof DocumentReferenceSchema>;
export const DocumentSchema = DocumentReferenceSchema.extend({
  availability: z.enum(["available", "missing", "corrupt"]),
});
export type Document = z.infer<typeof DocumentSchema>;
export const DocumentQuerySchema = z
  .object({
    dossierId: z.uuid().optional(),
    logicalId: z.uuid().optional(),
    q: z.string().trim().max(200).default(""),
    offset: z.coerce.number().int().nonnegative().default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type DocumentQuery = z.infer<typeof DocumentQuerySchema>;
export const DocumentListSchema = z.object({
  items: z.array(DocumentSchema),
  total: z.number().int().nonnegative(),
});
export const DocumentCatalogueSchema = z.object({
  maxBytes: z.number().int().positive(),
  formats: z.array(
    z.object({
      mediaType: z.string(),
      label: z.string(),
      extraction: z.boolean(),
    }),
  ),
});
