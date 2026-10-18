import {
  productionPeriod,
  type ProductionColumn,
  type ProductionRow,
  type ProductionTemplate,
} from "@memlia/contracts";
// Each planned stage retains its frozen civil date/period independently of progress.
export function productionStages(
  row: ProductionRow,
  initial: ProductionRow,
  model: ProductionTemplate,
) {
  const year = /^\d{4}/.test(row.period)
    ? Number(row.period.slice(0, 4))
    : Number((initial.dueDate ?? initial.createdAt).slice(0, 4));
  const stages: {
    key: string;
    column: ProductionColumn | null;
    date: string;
    userId: string | null;
    minutes: number | null;
  }[] = [];
  for (const c of model.columns) {
    const anchor = c.plannedDate ?? initial.dueDate;
    if (model.kind === "custom" && anchor) {
      stages.push({
        key: c.id + ":" + productionPeriod(c, initial.dueDate ?? anchor),
        column: c,
        date: anchor,
        userId: c.assigneeId ?? model.assigneeId ?? initial.assigneeId,
        minutes: c.plannedMinutes,
      });
      continue;
    }
    if (c.frequency === "once") {
      if (anchor)
        stages.push({
          key: c.id + ":once",
          column: c,
          date: anchor,
          userId: c.assigneeId ?? model.assigneeId ?? initial.assigneeId,
          minutes: c.plannedMinutes,
        });
      continue;
    }
    const anchorMonth = anchor ? Number(anchor.slice(5, 7)) : 1,
      day = anchor ? Number(anchor.slice(8, 10)) : 1;
    const months =
      c.frequency === "monthly"
        ? Array.from({ length: 12 }, (_, i) => i + 1)
        : c.frequency === "quarterly"
          ? Array.from(
              { length: 4 },
              (_, i) => ((anchorMonth - 1) % 3) + 1 + i * 3,
            )
          : [anchorMonth];
    for (const month of months) {
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const date = `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
      stages.push({
        key: c.id + ":" + productionPeriod(c, date),
        column: c,
        date,
        userId: c.assigneeId ?? model.assigneeId ?? initial.assigneeId,
        minutes: c.plannedMinutes,
      });
    }
  }
  if (!model.columns.length && initial.dueDate)
    stages.push({
      key: "occurrence",
      column: null,
      date: initial.dueDate,
      userId: model.assigneeId ?? initial.assigneeId,
      minutes: null,
    });
  return stages;
}
