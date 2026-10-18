import { z } from "zod";
import {
  RelationshipEntitySchema,
  NotificationSchema,
  type SessionUser,
  type Notification,
} from "@memlia/contracts";
import type { Connection, Database } from "../storage/database.js";
import type { JobRunner } from "../jobs/runner.js";
import { load, authorize, record } from "./service.js";
import { notificationPreferences } from "../notifications/service.js";
import { effectiveUser } from "../identity/service.js";
import { stableId } from "../workflows/generation.js";
import { ApiFault, fail } from "../errors.js";
export async function visibleLab(
  tx: Connection,
  a: SessionUser,
  n: Notification,
) {
  try {
    if (!n.relationshipId || !n.relationshipVersion) return null;
    const current = await load(tx, a, n.relationshipId);
    if (current.data.kind !== "lab") return null;
    const rows = await tx.query(
      "SELECT content FROM cabinet_relationship_history WHERE id=$1 AND version=$2",
      [n.relationshipId, n.relationshipVersion],
    );
    if (!rows[0]) return null;
    const old = RelationshipEntitySchema.parse(rows[0].content);
    await authorize(tx, a, old);
    if (old.data.kind !== "lab") return null;
    const target = await record(tx, a, old.data.dossierId);
    return { target: { ...target, kind: "lab" as const }, comments: [] };
  } catch (e) {
    if (e instanceof ApiFault && [403, 404].includes(e.status)) return null;
    throw e;
  }
}
export class LabReminders {
  private enqueue;
  constructor(
    private db: Database,
    jobs: JobRunner,
    private now: () => Date,
    private civilDate: (d: Date) => string,
  ) {
    this.enqueue = jobs.register({
      kind: "lab-reminder",
      input: z.object({ review: RelationshipEntitySchema }),
      checkpoint: z.object({ delivered: z.boolean() }),
      result: z.object({ processed: z.boolean() }),
      initial: { delivered: false },
      scope: (i) => ({
        dossierId:
          i.review.data.kind === "lab" ? i.review.data.dossierId : null,
        resourceKey: "lab:" + i.review.id,
      }),
      authorize: async (tx, a, i) => {
        await load(tx, a, i.review.id);
        await authorize(tx, a, i.review);
      },
      execute: async (i, ctx) => {
        if (!ctx.checkpoint.delivered)
          await ctx.commit(
            { delivered: true },
            "lab.reminder",
            "Révision de vigilance traitée.",
            async (tx, a) => {
              const current = await load(tx, a, i.review.id),
                d = i.review.data;
              if (d.kind !== "lab" || current.version !== i.review.version)
                return;
              for (const recipientId of d.recipientIds) {
                const rows = await tx.query(
                  "SELECT * FROM cabinet_users WHERE id=$1 AND active=true",
                  [recipientId],
                );
                if (!rows[0]) continue;
                const recipient = await effectiveUser(tx, rows[0]),
                  prefs = await notificationPreferences(tx, recipientId);
                if (!prefs.inApp || !prefs.reminders) continue;
                const key = `lab:${i.review.id}:${i.review.version}:${d.nextReviewOn}`,
                  notice = NotificationSchema.parse({
                    id: stableId(key + recipientId),
                    version: 1,
                    source: "lab",
                    targetId: d.dossierId,
                    relationshipId: i.review.id,
                    relationshipVersion: i.review.version,
                    commentId: null,
                    recipientId,
                    kind: "reminder",
                    state: "unread",
                    at: this.now().toISOString(),
                  });
                if (!(await visibleLab(tx, recipient, notice))) continue;
                await tx.query(
                  "INSERT INTO cabinet_notifications(id,recipient_id,target_id,dedupe_key,content) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(recipient_id,dedupe_key) DO NOTHING",
                  [
                    notice.id,
                    recipientId,
                    d.dossierId,
                    key,
                    JSON.stringify(notice),
                  ],
                );
              }
            },
          );
        return { processed: true };
      },
    }).enqueue;
  }
  async process(tx: Connection, a: SessionUser) {
    const today = this.civilDate(this.now());
    let scheduled = 0;
    const rows = await tx.query(
      "SELECT content FROM cabinet_relationship WHERE kind='lab' AND content->>'actorId'=$1 AND content->'data'->>'nextReviewOn'<=$2 AND NOT EXISTS(SELECT 1 FROM cabinet_jobs j WHERE j.kind='lab-reminder' AND j.resource_key='lab:'||cabinet_relationship.id::text AND (j.input->'review'->>'version')::integer=(cabinet_relationship.content->>'version')::integer) ORDER BY id LIMIT 20",
      [a.id, today],
    );
    for (const row of rows) {
      const review = RelationshipEntitySchema.parse(row.content);
      try {
        await load(tx, a, review.id);
        await this.enqueue(
          tx,
          a,
          stableId("lab-job:" + review.id + ":" + review.version),
          { review },
        );
        scheduled++;
      } catch (e) {
        if (!(e instanceof ApiFault && [403, 404].includes(e.status))) throw e;
      }
    }
    return { scheduled, date: today };
  }
  async tick() {
    await this.db.transaction(async (tx) => {
      const rows = await tx.query(
        "SELECT DISTINCT u.* FROM cabinet_users u JOIN cabinet_relationship r ON r.content->>'actorId'=u.id::text WHERE u.active=true AND r.kind='lab'",
      );
      for (const row of rows)
        await this.process(tx, await effectiveUser(tx, row));
    });
  }
}
