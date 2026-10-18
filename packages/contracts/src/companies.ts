import { z } from "zod";
import {
  DossierDataSchema,
  FieldOriginSchema,
  CabinetRecordSchema,
} from "./records.js";
export const CompanyValuesSchema = z
  .object({
    siren: DossierDataSchema.shape.siren.removeDefault().optional(),
    legalForm: DossierDataSchema.shape.legalForm.removeDefault().optional(),
    address: DossierDataSchema.shape.address.removeDefault().optional(),
    activityCode: DossierDataSchema.shape.activityCode
      .removeDefault()
      .optional(),
    activity: DossierDataSchema.shape.activity.removeDefault().optional(),
    createdOn: DossierDataSchema.shape.createdOn.removeDefault().optional(),
    establishments: DossierDataSchema.shape.establishments
      .removeDefault()
      .optional(),
    capital: DossierDataSchema.shape.capital.removeDefault().optional(),
  })
  .extend({ title: z.string().trim().min(1).max(300) })
  .strict();
export type CompanyValues = z.infer<typeof CompanyValuesSchema>;
export const DetectionSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    actorId: z.uuid(),
    scopeDossierId: z.uuid().nullable().default(null),
    sourceId: z.string().min(1).max(500),
    origin: FieldOriginSchema,
    values: CompanyValuesSchema,
    dossierId: z.uuid().nullable(),
    hidden: z.boolean(),
    automatic: z.boolean(),
    status: z.enum(["pending", "linked", "needs_decision"]),
  })
  .strict();
export type Detection = z.infer<typeof DetectionSchema>;
export const DetectionListSchema = z.object({
  items: z.array(DetectionSchema).max(200),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
});
export const DetectionSimulationSchema = z
  .object({
    operationId: z.uuid(),
    sourceId: z.string().min(1).max(500),
    sourceVersion: z.string().min(1).max(100),
    values: CompanyValuesSchema,
    automatic: z.boolean().default(false),
  })
  .strict();
export const DetectionDecisionSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    decision: z.enum(["create", "merge", "hide", "restore"]),
    targetId: z.uuid().optional(),
    expectedRecordVersion: z.number().int().positive().optional(),
    choices: z
      .record(z.string(), z.enum(["keep_manual", "use_source"]))
      .default({}),
  })
  .strict();
export type DetectionDecision = z.infer<typeof DetectionDecisionSchema>;
export const DetectionPreviewSchema = z.object({
  detection: DetectionSchema,
  target: CabinetRecordSchema.nullable(),
  conflicts: z.array(z.string()),
});
export const CompanySearchQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(200),
    page: z.coerce.number().int().min(1).max(1000).default(1),
  })
  .strict();
export const CompanySearchResultSchema = z.object({
  items: z.array(
    z.object({ candidateId: z.uuid(), values: CompanyValuesSchema }),
  ),
  page: z.number().int(),
  total: z.number().int(),
  capped: z.boolean(),
  observedAt: z.iso.datetime(),
});
export const ProposeCompanySchema = z
  .object({ operationId: z.uuid(), candidateId: z.uuid() })
  .strict();
