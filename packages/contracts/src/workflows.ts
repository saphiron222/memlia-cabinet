import { z } from "zod";
import { CivilDateSchema } from "./records.js";
export const RecurrenceRuleSchema = z
  .object({
    frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
    start: CivilDateSchema,
    end: CivilDateSchema,
    nominalDay: z.number().int().min(1).max(31),
    lastDay: z.boolean(),
    weekDay: z.number().int().min(1).max(7),
  })
  .strict()
  .refine((r) => r.end >= r.start, "La fin précède le début.");
export type RecurrenceRule = z.infer<typeof RecurrenceRuleSchema>;
export const RecurrencePreviewSchema = z
  .object({
    rule: RecurrenceRuleSchema,
    from: CivilDateSchema,
    to: CivilDateSchema,
  })
  .strict()
  .refine(
    (x) =>
      x.to >= x.from &&
      x.to <= `${Number(x.from.slice(0, 4)) + 10}${x.from.slice(4)}`,
    "Période maximale : dix ans.",
  );
/** Pure civil arithmetic: UTC is only a Gregorian arithmetic carrier, never a cabinet instant. */
export function previewOccurrences(
  rule: RecurrenceRule,
  from: string,
  to: string,
): string[] {
  RecurrencePreviewSchema.parse({ rule, from, to });
  const dates: string[] = [];
  const date = (y: number, m: number, d: number) => {
    const v = new Date(0);
    v.setUTCFullYear(y, m, d);
    return v;
  };
  const iso = (v: Date) => v.toISOString().slice(0, 10);
  const lower = from > rule.start ? from : rule.start,
    upper = to < rule.end ? to : rule.end;
  const [sy, sm] = rule.start.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  if (rule.frequency === "weekly") {
    const current = new Date(lower + "T00:00:00Z");
    current.setUTCDate(
      current.getUTCDate() +
        ((rule.weekDay - (current.getUTCDay() || 7) + 7) % 7),
    );
    while (iso(current) <= upper) {
      dates.push(iso(current));
      current.setUTCDate(current.getUTCDate() + 7);
    }
  } else {
    const interval =
      rule.frequency === "monthly"
        ? 1
        : rule.frequency === "quarterly"
          ? 3
          : 12;
    const [ly, lm] = lower.split("-").map(Number) as [number, number, number];
    const first = Math.max(
      0,
      Math.floor(((ly - sy) * 12 + lm - sm) / interval),
    );
    for (let n = first; n < first + 121; n++) {
      const month = sm - 1 + n * interval,
        last = date(sy, month + 1, 0),
        day = rule.lastDay
          ? last.getUTCDate()
          : Math.min(rule.nominalDay, last.getUTCDate());
      const value = iso(date(sy, month, day));
      if (value > upper) break;
      if (value >= lower) dates.push(value);
    }
  }
  return dates;
}
import {
  RecordListSchema,
  CabinetRecordSchema,
  ChecklistItemSchema,
  TaskDataSchema,
} from "./records.js";
const idsUnique = (a: { id: string }[]) =>
  new Set(a.map((x) => x.id)).size === a.length;
export const ChecklistModelSchema = z
  .object({
    kind: z.literal("checklist"),
    name: z.string().trim().min(1).max(150),
    targetKinds: z.array(z.string().min(1).max(100)).min(1).max(20),
    items: z
      .array(ChecklistItemSchema.omit({ done: true }))
      .max(100)
      .refine(idsUnique),
  })
  .strict();
export const TaskTypeModelSchema = z
  .object({
    kind: z.literal("task_type"),
    name: z.string().trim().min(1).max(150),
    color: z.enum(["blue", "green", "orange", "red", "purple", "gray"]),
    steps: z
      .array(
        z
          .object({
            id: z.uuid(),
            name: z.string().trim().min(1).max(80),
            final: z.boolean(),
          })
          .strict(),
      )
      .min(2)
      .max(20)
      .refine(idsUnique)
      .refine(
        (a) => a.filter((x) => x.final).length === 1,
        "Une étape finale unique est requise.",
      ),
  })
  .strict();
export const RecurrenceModelSchema = z
  .object({
    kind: z.literal("recurrence"),
    name: z.string().trim().min(1).max(150),
    dossierId: z.uuid(),
    rule: RecurrenceRuleSchema,
    task: TaskDataSchema,
    checklistModelId: z.uuid().nullable(),
  })
  .strict();
export const ReminderModelSchema = z
  .object({
    kind: z.literal("reminder"),
    name: z.string().trim().min(1).max(150),
    targetIds: z.array(z.uuid()).min(1).max(100),
    recipientIds: z.array(z.uuid()).min(1).max(100),
    event: z.enum(["schedule", "deadline"]),
    message: z.string().trim().min(1).max(1000),
    hour: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
    enabled: z.boolean(),
    rule: RecurrenceRuleSchema,
  })
  .strict();
export const WorkflowModelDataSchema = z.discriminatedUnion("kind", [
  ChecklistModelSchema,
  TaskTypeModelSchema,
  RecurrenceModelSchema,
  ReminderModelSchema,
]);
export const WorkflowModelSchema = z
  .object({
    id: z.uuid(),
    actorId: z.uuid(),
    version: z.number().int().positive(),
    model: WorkflowModelDataSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type WorkflowModel = z.infer<typeof WorkflowModelSchema>;
export const WorkflowModelCommandSchema = z
  .object({
    operationId: z.uuid(),
    id: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    model: WorkflowModelDataSchema,
  })
  .strict();
export const WorkChecklistSchema = z
  .object({
    id: z.uuid(),
    modelId: z.uuid().nullable(),
    modelVersion: z.number().int().positive().nullable(),
    knownItemIds: z.array(z.uuid()).max(1000),
    items: z.array(ChecklistItemSchema).max(100).refine(idsUnique),
  })
  .strict();
export const WorkCommentSchema = z
  .object({
    id: z.uuid(),
    authorId: z.uuid(),
    text: z.string().trim().min(1).max(5000),
    mentions: z.array(z.uuid()).max(100),
    audience: z.literal("internal"),
    at: z.iso.datetime(),
  })
  .strict();
export const WorkStateSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().nonnegative(),
    target: CabinetRecordSchema,
    comments: z.array(WorkCommentSchema).max(200).default([]),
    subscriberIds: z.array(z.uuid()).max(100).default([]),
    checklist: WorkChecklistSchema.nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type WorkState = z.infer<typeof WorkStateSchema>;
export const WorkCommandSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    command: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("comment"),
          text: z.string().trim().min(1).max(5000),
          mentions: z.array(z.uuid()).max(100),
          audience: z.literal("internal"),
        })
        .strict(),
      z.object({ kind: z.literal("subscribe"), enabled: z.boolean() }).strict(),
      z
        .object({
          kind: z.literal("instantiate"),
          modelId: z.uuid(),
          modelVersion: z.number().int().positive().optional(),
        })
        .strict(),
      z.object({ kind: z.literal("merge"), modelId: z.uuid() }).strict(),
      z
        .object({
          kind: z.literal("checklist"),
          items: z.array(ChecklistItemSchema).max(100).refine(idsUnique),
        })
        .strict(),
    ]),
  })
  .strict();
export type WorkCommand = z.infer<typeof WorkCommandSchema>;

export const NotificationPreferencesSchema = z
  .object({
    version: z.number().int().nonnegative(),
    mentions: z.boolean(),
    subscriptions: z.boolean(),
    reminders: z.boolean(),
    inApp: z.boolean(),
  })
  .strict();
export const NotificationSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    targetId: z.uuid(),
    commentId: z.uuid().nullable(),
    reminderId: z.uuid().nullable().default(null),
    reminderVersion: z.number().int().positive().nullable().default(null),
    recipientId: z.uuid(),
    kind: z.enum(["mention", "subscription", "reminder"]),
    state: z.enum(["unread", "read", "dismissed"]),
    at: z.iso.datetime(),
  })
  .strict();
export type Notification = z.infer<typeof NotificationSchema>;
export const NotificationListSchema = z.object({
  items: z
    .array(
      NotificationSchema.extend({
        title: z.string(),
        text: z.string(),
        targetKind: z.enum(["tache", "obligation"]),
      }),
    )
    .max(100),
  unread: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
});
export const NotificationCommandSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    state: z.enum(["read", "dismissed"]),
  })
  .strict();

export const WorkflowGenerationSchema = z
  .object({
    operationId: z.uuid(),
    modelId: z.uuid(),
    from: CivilDateSchema,
    to: CivilDateSchema,
  })
  .strict();
export const TaskMoveSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    stepId: z.uuid(),
  })
  .strict();

import {
  ImportParseOptionsSchema,
  ImportMappingSchema,
  IMPORT_MAX_BYTES,
} from "./imports.js";
export const ChecklistExchangeSchema = ImportParseOptionsSchema.extend({
  operationId: z.uuid(),
  exchange: z.literal("memlia-checklists-1"),
  bytes: z
    .string()
    .max(Math.ceil(IMPORT_MAX_BYTES / 3) * 4)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  mapping: ImportMappingSchema,
}).strict();
export const ChecklistRepriseSchema = z.object({
  id: z.uuid(),
  actorId: z.uuid(),
  sourceHash: z.string(),
  exchange: z.literal("memlia-checklists-1"),
  headers: z.array(z.string()),
  unmapped: z.array(z.string()),
  errors: z.array(z.object({ line: z.number(), message: z.string() })),
  models: z
    .array(
      z.object({
        id: z.uuid(),
        expectedVersion: z.number().int().nonnegative(),
        model: ChecklistModelSchema,
      }),
    )
    .max(20),
  createdAt: z.iso.datetime(),
});
export type ChecklistReprise = z.infer<typeof ChecklistRepriseSchema>;
export const ReminderPreparationSchema = z.object({
  id: z.uuid(),
  modelId: z.uuid(),
  modelVersion: z.number().int().positive(),
  actorId: z.uuid(),
  nextDate: CivilDateSchema,
  complete: z.boolean(),
  error: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});
export const WorkflowExportSchema = z.discriminatedUnion("entity", [
  z.object({
    id: z.uuid(),
    entity: z.literal("reminder_preparation"),
    data: ReminderPreparationSchema,
  }),
  z.object({
    id: z.uuid(),
    entity: z.literal("model"),
    data: WorkflowModelSchema,
  }),
  z.object({
    id: z.uuid(),
    entity: z.literal("model_version"),
    data: WorkflowModelSchema,
  }),
  z.object({ id: z.uuid(), entity: z.literal("work"), data: WorkStateSchema }),
  z.object({
    id: z.uuid(),
    entity: z.literal("work_event"),
    data: WorkStateSchema,
    actorId: z.uuid(),
    operationId: z.uuid(),
  }),
  z.object({
    id: z.uuid(),
    entity: z.literal("notification"),
    data: NotificationSchema,
  }),
  z.object({
    id: z.uuid(),
    entity: z.literal("notification_preferences"),
    userId: z.uuid(),
    data: NotificationPreferencesSchema,
  }),
  z.object({
    id: z.uuid(),
    entity: z.literal("checklist_import"),
    data: ChecklistRepriseSchema,
  }),
]);
export type WorkflowExport = z.infer<typeof WorkflowExportSchema>;

export const WorkflowCalendarSchema = RecordListSchema.extend({
  productionIds: z.array(z.uuid()).default([]),
  dossiers: z.record(z.uuid(), z.string()),
});

import { JobSchema } from "./jobs.js";
export const ReminderRunListSchema = z.object({
  preparation: z.array(ReminderPreparationSchema),
  items: z.array(
    z.object({
      date: CivilDateSchema,
      modelVersion: z.number().int(),
      job: JobSchema,
    }),
  ),
  nextOffset: z.number().int().nullable(),
});
