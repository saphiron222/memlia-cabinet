import { z } from "zod";
import {
  WorkflowModelSchema,
  ReminderPreparationSchema,
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
    const prep = await tx.query(
      "SELECT content FROM cabinet_reminder_preparation WHERE actor_id=$1 AND model_id=$2 ORDER BY model_version DESC OFFSET $3 LIMIT 50",
      [actor.id, modelId, offset],
    );
    for (const row of prep) {
      const p = ReminderPreparationSchema.parse(row.content);
      const old = await tx.query(
        "SELECT content FROM cabinet_workflow_model_versions WHERE id=$1 AND version=$2",
        [modelId, p.modelVersion],
      );
      await this.authorize(
        tx,
        actor,
        WorkflowModelSchema.parse(old[0]!.content),
      );
    }
    return {
      items,
      preparation: prep.map((r) => ReminderPreparationSchema.parse(r.content)),
      nextOffset: rows.length > 50 || prep.length === 50 ? offset + 50 : null,
    };
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
    const addDays = (day: string, amount: number) => {
      const d = new Date(day + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + amount);
      return d.toISOString().slice(0, 10);
    };
    const localTime = (instant: Date) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: this.zone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).format(instant);
    let scheduled = 0;
    // Immutable versions reconstruct an unprepared interval even if the app never ran on its due day.
    const rows = await tx.query(
      `WITH versions AS (SELECT v.*,lead(content->>'updatedAt') OVER(PARTITION BY id ORDER BY version) next_version_at FROM cabinet_workflow_model_versions v)
      SELECT v.content,v.next_version_at,p.content preparation FROM versions v JOIN cabinet_workflow_models current_model ON current_model.id=v.id LEFT JOIN cabinet_reminder_preparation p ON p.model_id=v.id AND p.model_version=v.version
      WHERE current_model.content->>'actorId'=$1 AND v.content->'model'->>'kind'='reminder' AND (v.content->'model'->>'enabled')::boolean
      AND NOT COALESCE((p.content->>'complete')::boolean,false) AND (COALESCE(p.content->>'nextDate','0000-01-01')<=$2 OR v.next_version_at IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM versions older LEFT JOIN cabinet_reminder_preparation op ON op.model_id=older.id AND op.model_version=older.version WHERE older.id=v.id AND older.version<v.version AND (older.content->'model'->>'enabled')::boolean AND NOT COALESCE((op.content->>'complete')::boolean,false))
      ORDER BY COALESCE(p.content->>'updatedAt',''),v.id,v.version LIMIT 20`,
      [actor.id, date],
    );
    for (const row of rows) {
      const model = WorkflowModelSchema.parse(row.content),
        m = model.model;
      if (m.kind !== "reminder") continue;
      const changedAt = new Date(model.updatedAt);
      const changedDay = this.civilDate(changedAt);
      const start =
        model.version === 1 || m.hour + ":00" >= localTime(changedAt)
          ? changedDay
          : addDays(changedDay, 1);
      let p = row.preparation
        ? ReminderPreparationSchema.parse(row.preparation)
        : ReminderPreparationSchema.parse({
            id: stableId(`reminder-preparation:${model.id}:${model.version}`),
            modelId: model.id,
            modelVersion: model.version,
            actorId: actor.id,
            nextDate: start > m.rule.start ? start : m.rule.start,
            complete: false,
            error: null,
            updatedAt: now.toISOString(),
          });
      const nextVersion = row.next_version_at
        ? new Date(String(row.next_version_at))
        : null;
      const endVersion = nextVersion
        ? addDays(
            this.civilDate(nextVersion),
            m.hour + ":00" < localTime(nextVersion) ? 0 : -1,
          )
        : m.rule.end;
      const end = endVersion < m.rule.end ? endVersion : m.rule.end;
      const available = hour >= m.hour ? date : addDays(date, -1);
      const stop = [end, available, addDays(p.nextDate, 30)].sort()[0]!;
      p = {
        ...p,
        actorId: actor.id,
        error: null,
        updatedAt: now.toISOString(),
      };
      try {
        await this.authorize(tx, actor, model);
        await this.authorize(tx, actor, await loadModel(tx, model.id));
        if (p.nextDate <= stop) {
          for (const due of previewOccurrences(m.rule, p.nextDate, stop)) {
            const operation = stableId(`reminder-job:${model.id}:${due}`);
            const exists = await tx.query(
              "SELECT id FROM cabinet_jobs WHERE kind='workflow-reminder' AND resource_key=$1 AND input->>'date'=$2 LIMIT 1",
              ["reminder:" + model.id, due],
            );
            if (!exists.length) {
              await this.enqueue(tx, actor, operation, { model, date: due });
              scheduled++;
            }
            p.nextDate = addDays(due, 1);
          }
          p.nextDate = addDays(stop, 1);
        }
        p.complete = p.nextDate > end;
      } catch (e) {
        if (!(e instanceof ApiFault)) throw e;
        // Keep the exact interval retryable; do not expose inaccessible object names.
        p.error =
          e.code === "JOBS_PAUSED"
            ? "Préparation suspendue ; reprise au prochain passage."
            : "Préparation refusée ; vérifier les droits et reprendre.";
      }
      await tx.query(
        "INSERT INTO cabinet_reminder_preparation(id,model_id,model_version,actor_id,content) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(id) DO UPDATE SET actor_id=EXCLUDED.actor_id,content=EXCLUDED.content",
        [p.id, p.modelId, p.modelVersion, p.actorId, JSON.stringify(p)],
      );
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
