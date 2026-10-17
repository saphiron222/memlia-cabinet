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
      Number(x.to.slice(0, 4)) - Number(x.from.slice(0, 4)) <= 10,
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
