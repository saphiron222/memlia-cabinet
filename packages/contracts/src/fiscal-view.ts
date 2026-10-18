import { DocumentSchema } from "./documents.js";
import { z } from "zod";
import { CabinetRecordSchema } from "./records.js";
import {
  FiscalTimelineEntrySchema,
  FiscalSituationSchema,
  FiscalFreshnessSchema,
} from "./fiscal.js";
import { ActionSchema } from "./identity.js";
export const FiscalDetailSchema = z.object({
  record: CabinetRecordSchema.options[3],
  timeline: z.array(FiscalTimelineEntrySchema),
  situation: FiscalSituationSchema,
  freshness: FiscalFreshnessSchema,
  capabilities: z.object({
    actions: z.array(ActionSchema),
    realTransmission: z.literal(false),
  }),
});
export type FiscalDetail = z.infer<typeof FiscalDetailSchema>;
export const FiscalGenerationResultSchema = z.object({
  items: z.array(z.object({ id: z.uuid() })),
  reason: z.string(),
});
export const FiscalBulkResultSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      version: z.number().nullable(),
      status: z.enum(["updated", "refused"]),
      error: z.string().nullable(),
    }),
  ),
});

export const FiscalPreparationDocumentSchema = z.object({
  detail: FiscalDetailSchema,
  document: DocumentSchema,
});

export const FiscalResponsiblesSchema = z.object({
  items: z.array(z.object({ id: z.uuid(), name: z.string() })),
  total: z.number().int().nonnegative(),
});

export const FiscalMatrixSchema = z.object({
  rows: z.array(
    z.object({
      dossier: CabinetRecordSchema.options[0],
      occurrences: z.array(CabinetRecordSchema.options[3]),
      total: z.number().int().nonnegative(),
      complete: z.boolean(),
    }),
  ),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});
export type FiscalMatrix = z.infer<typeof FiscalMatrixSchema>;
