import { z } from "zod";
import { CivilDateSchema } from "./records.js";
const id = z.uuid(),
  nullableId = id.nullable();
const minutes = z.number().int().min(0).max(525600);
const dated = { from: CivilDateSchema, to: CivilDateSchema.nullable() };
const money = z.string().regex(/^\d{1,12}\.\d{2}$/);
export const TimeLinkSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("free"),
      label: z.string().trim().min(1).max(300),
    })
    .strict(),
  z.object({ kind: z.literal("record"), id }).strict(),
  z.object({ kind: z.literal("production"), id }).strict(),
]);
export const TimeDataSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("nature"),
      name: z.string().trim().min(1).max(120),
      active: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("plan"),
      level: z.enum(["cabinet", "dossier", "occurrence", "production"]),
      targetId: nullableId,
      minutes: minutes.nullable(),
      component: z.enum(["fixed", "variable"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("capacity"),
      userId: nullableId,
      ...dated,
      dailyMinutes: z.array(minutes.max(1440)).length(7),
    })
    .strict(),
  z
    .object({
      kind: z.literal("rate"),
      userId: nullableId,
      ...dated,
      hourlyAmount: money,
      currency: z.literal("EUR"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("forfait"),
      dossierId: id,
      roleId: id,
      ...dated,
      activityStart: CivilDateSchema,
      monthlyMinutes: minutes,
      amount: money,
      currency: z.literal("EUR"),
      prorating: z.enum(["calendar_days", "working_days"]),
      policyVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("assignment"),
      dossierId: id,
      roleId: id,
      userId: id,
      ...dated,
      weight: z.number().int().min(1).max(10000),
      policyVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("entry"),
      userId: id,
      date: CivilDateSchema,
      natureId: id,
      link: TimeLinkSchema,
      seconds: z.number().int().min(1).max(604800),
      source: z.enum(["manual", "timer"]),
      timerId: nullableId,
      rate: z
        .object({
          id,
          version: z.number().int().positive(),
          hourlyAmount: money,
          currency: z.literal("EUR"),
        })
        .nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("timer"),
      userId: id,
      date: CivilDateSchema,
      natureId: id,
      link: TimeLinkSchema,
      startedAt: z.iso.datetime(),
      stoppedAt: z.iso.datetime().nullable(),
      entryId: nullableId,
    })
    .strict(),
  z
    .object({
      kind: z.literal("period"),
      from: CivilDateSchema,
      to: CivilDateSchema,
      closed: z.boolean(),
      reason: z.string().trim().min(1).max(300),
    })
    .strict(),
  z
    .object({
      kind: z.literal("allocation"),
      target: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("record"), id }).strict(),
        z.object({ kind: z.literal("production"), id }).strict(),
      ]),
      ...dated,
      weights: z
        .array(
          z
            .object({ userId: id, weight: z.number().int().min(1).max(10000) })
            .strict(),
        )
        .min(1)
        .max(100),
      policyVersion: z.number().int().positive(),
    })
    .strict(),
]);
export type TimeData = z.infer<typeof TimeDataSchema>;
export const TimeEntitySchema = z.object({
  id,
  version: z.number().int().positive(),
  actorId: id,
  updatedAt: z.iso.datetime(),
  data: TimeDataSchema,
});
export type TimeEntity = z.infer<typeof TimeEntitySchema>;
export const TimeSaveSchema = z
  .object({
    id,
    expectedVersion: z.number().int().nonnegative(),
    operationId: id,
    data: TimeDataSchema,
  })
  .strict();
export const TimeQuerySchema = z
  .object({
    from: CivilDateSchema,
    to: CivilDateSchema,
    userId: id.optional(),
    recordId: id.optional(),
    dossierId: id.optional(),
    groupId: id.optional(),
    natureId: id.optional(),
    offset: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  })
  .strict();
export type TimeQuery = z.infer<typeof TimeQuerySchema>;
export const TimeListSchema = z.object({
  items: z.array(TimeEntitySchema),
  total: z.number().int(),
  offset: z.number().int(),
});
export const TimePlanSchema = z.object({
  minutes: minutes.nullable(),
  source: z.enum([
    "occurrence",
    "production",
    "task",
    "dossier",
    "cabinet",
    "unknown",
  ]),
  sourceId: id.nullable(),
  version: z.number().int().nullable(),
  override: z.boolean(),
  component: z.enum(["fixed", "variable"]),
  explanation: z.string(),
});
export const TimeReportSchema = z.object({
  from: CivilDateSchema,
  to: CivilDateSchema,
  realizedSeconds: z.number().int(),
  planned: TimePlanSchema.nullable(),
  entries: z.array(TimeEntitySchema),
  total: z.number().int(),
  hasMore: z.boolean(),
  amount: money.nullable(),
  unratedSeconds: z.number().int(),
});
export const TimerStartSchema = z
  .object({
    operationId: id,
    date: CivilDateSchema,
    natureId: id,
    link: TimeLinkSchema,
  })
  .strict();
export const TimerStopSchema = z
  .object({ operationId: id, expectedVersion: z.number().int().positive() })
  .strict();
export const WorkloadRowSchema = z.object({
  key: z.string(),
  target: TimeLinkSchema.nullable(),
  label: z.string(),
  dossierId: nullableId,
  userId: nullableId,
  roleId: nullableId,
  component: z.enum(["fixed", "variable"]),
  plannedMinutes: z.number().int().nullable(),
  realizedSeconds: z.number().int(),
  provenance: z.string(),
  sourceVersions: z.record(z.string(), z.number().int()),
  from: CivilDateSchema,
  to: CivilDateSchema,
});
export const WorkloadSchema = z.object({
  from: CivilDateSchema,
  to: CivilDateSchema,
  rows: z.array(WorkloadRowSchema),
  people: z.array(
    z.object({
      id,
      name: z.string(),
      capacityMinutes: z.number().int().nullable(),
      capacitySource: z.string(),
      plannedMinutes: z.number().int(),
      realizedSeconds: z.number().int(),
      overloadMinutes: z.number().int().nullable(),
    }),
  ),
  unknownPlans: z.number().int(),
});
export const TimeOptionsSchema = z.object({
  canManage: z.boolean(),
  canReadOthers: z.boolean(),
  canLock: z.boolean(),
  users: z.array(z.object({ id, name: z.string() })).max(200),
  natures: z.array(TimeEntitySchema).max(200),
});
export const TimeExportSchema = z.object({
  id,
  entity: z.enum(["current", "history"]),
  data: TimeEntitySchema,
});
