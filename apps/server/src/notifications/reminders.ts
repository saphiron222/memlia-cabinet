import { z } from "zod";
import {
  WorkflowModelSchema,
  NotificationSchema,
  previewOccurrences,
  type SessionUser,
} from "@memlia/contracts";
import type { Connection, Database } from "../storage/database.js";
import { JobRunner } from "../jobs/runner.js";
import { loadModel, workTarget } from "../workflows/service.js";
import { effectiveUser } from "../identity/service.js";
import { notificationPreferences, visibleWork } from "./service.js";
import { stableId } from "../workflows/generation.js";
import { ApiFault, fail } from "../errors.js";
export class Reminders {
  private enqueue;
  constructor(
    private db: Database,
    private jobs: JobRunner,
    private now: () => Date,
    private civilDate: (d: Date) => string,
    private zone: string,
  ) {
    this.enqueue = jobs.register({
      kind: "workflow-reminder",
      input: z.object({ model: WorkflowModelSchema, date: z.iso.date() }),
      checkpoint: z.object({ index: z.number().int().nonnegative() }),
      result: z.object({ processed: z.number().int().nonnegative() }),
      initial: { index: 0 },
      scope: (i) => ({
        dossierId: null,
        resourceKey: "reminder:" + i.model.id,
      }),
      authorize: async (tx, actor, i) => {
        await this.authorize(tx, actor, i.model);
        await this.authorize(tx, actor, await loadModel(tx, i.model.id));
      },
      execute: async (i, ctx) => {
        const m = i.model.model;
        if (m.kind !== "reminder") fail(400, "MODEL_KIND", "Rappel requis.");
        for (let n = ctx.checkpoint.index; n < m.targetIds.length; n++) {
          await ctx.commit(
            { index: n + 1 },
            "reminder.captured",
            "Rappel local traité.",
            async (tx, actor) => {
              const current = await loadModel(tx, i.model.id);
              if (current.model.kind !== "reminder" || !current.model.enabled)
                return;
              const target = await workTarget(tx, actor, m.targetIds[n]!);
              if (
                m.event === "deadline" &&
                ("dueDate" in target.data ? target.data.dueDate : null) !==
                  i.date
              )
                return;
              for (const id of m.recipientIds) {
                const users = await tx.query(
                  "SELECT * FROM cabinet_users WHERE id=$1 AND active=true",
                  [id],
                );
                if (!users[0]) continue;
                const recipient = await effectiveUser(tx, users[0]);
                if (!(await visibleWork(tx, recipient, target.id))) continue;
                const prefs = await notificationPreferences(tx, id);
                if (!prefs.inApp || !prefs.reminders) continue;
                const key = `reminder:${i.model.id}:${target.id}:${i.date}`,
                  notice = NotificationSchema.parse({
                    id: stableId(key + id),
                    version: 1,
                    targetId: target.id,
                    commentId: null,
                    reminderId: i.model.id,
                    reminderVersion: i.model.version,
                    recipientId: id,
                    kind: "reminder",
                    state: "unread",
                    at: this.now().toISOString(),
                  });
                await tx.query(
                  "INSERT INTO cabinet_notifications(id,recipient_id,target_id,dedupe_key,content) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(recipient_id,dedupe_key) DO NOTHING",
                  [notice.id, id, target.id, key, JSON.stringify(notice)],
                );
              }
            },
          );
        }
        return { processed: m.targetIds.length };
      },
    }).enqueue;
  }
  async authorize(
    tx: Connection,
    actor: SessionUser,
    m: z.infer<typeof WorkflowModelSchema>,
  ) {
    if (m.model.kind !== "reminder") fail(400, "MODEL_KIND", "Rappel requis.");
    for (const id of m.model.targetIds) await workTarget(tx, actor, id);
  }
  async list(
    tx: Connection,
    actor: SessionUser,
    modelId: string,
    offset: number,
  ) {
    await this.authorize(tx, actor, await loadModel(tx, modelId));
    const rows = await tx.query(
      "SELECT id FROM cabinet_jobs WHERE actor_id=$1 AND kind='workflow-reminder' AND resource_key=$2 ORDER BY created_at DESC,id OFFSET $3 LIMIT 51",
      [actor.id, "reminder:" + modelId, offset],
    );
    const items = [];
    for (const row of rows.slice(0, 50)) {
      const run = await this.jobs.get(tx, String(row.id));
      const input = z
        .object({ model: WorkflowModelSchema, date: z.iso.date() })
        .parse(run.input);
      await this.authorize(tx, actor, input.model);
      items.push({
        date: input.date,
        modelVersion: input.model.version,
        job: run.job,
      });
    }
    return { items, nextOffset: rows.length > 50 ? offset + 50 : null };
  }
  async process(tx: Connection, actor: SessionUser) {
    const now = this.now(),
      date = this.civilDate(now),
      parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: this.zone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(now),
      hour = ["hour", "minute"]
        .map((k) => parts.find((p) => p.type === k)!.value)
        .join(":");
    let scheduled = 0;
    let after: string | null = null;
    while (true) {
      const rows: Record<string, unknown>[] = await tx.query(
        "SELECT id,content FROM cabinet_workflow_models WHERE content->'model'->>'kind'='reminder' AND content->>'actorId'=$1 AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT 100",
        [actor.id, after],
      );
      if (!rows.length) break;
      for (const row of rows) {
        const model = WorkflowModelSchema.parse(row.content),
          m = model.model;
        if (
          m.kind !== "reminder" ||
          !m.enabled ||
          hour < m.hour ||
          !previewOccurrences(m.rule, date, date).length
        )
          continue;
        try {
          await this.authorize(tx, actor, model);
        } catch (e) {
          if (e instanceof ApiFault && [403, 404].includes(e.status)) continue;
          throw e;
        }
        const operation = stableId(`reminder-job:${model.id}:${date}`);
        if (
          (
            await tx.query(
              "SELECT operation_id FROM cabinet_operations WHERE actor_id=$1 AND operation_id=$2",
              [actor.id, operation],
            )
          ).length
        )
          continue;
        await this.enqueue(
          tx,
          actor,
          stableId(`reminder-job:${model.id}:${date}`),
          { model, date },
        );
        scheduled++;
      }
      after = String(rows.at(-1)!.id);
    }
    return { scheduled, date, timeZone: this.zone };
  }
  async tick() {
    await this.db.transaction(async (tx) => {
      let after: string | null = null;
      while (true) {
        const rows: Record<string, unknown>[] = await tx.query(
          "SELECT DISTINCT u.* FROM cabinet_users u JOIN cabinet_workflow_models m ON m.content->>'actorId'=u.id::text WHERE u.active=true AND m.content->'model'->>'kind'='reminder' AND ($1::uuid IS NULL OR u.id>$1::uuid) ORDER BY u.id LIMIT 100",
          [after],
        );
        if (!rows.length) break;
        for (const row of rows)
          await this.process(tx, await effectiveUser(tx, row));
        after = String(rows.at(-1)!.id);
      }
    });
  }
}
