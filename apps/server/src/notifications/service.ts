import { randomUUID } from "node:crypto";
import {
  NotificationSchema,
  NotificationPreferencesSchema,
  WorkflowModelSchema,
  type SessionUser,
  type WorkState,
  type WorkCommentSchema,
} from "@memlia/contracts";
import { z } from "zod";
import { effectiveUser } from "../identity/service.js";
import type { Connection } from "../storage/database.js";
import { readWork } from "../workflows/service.js";
import { ApiFault } from "../errors.js";
export async function notificationPreferences(tx: Connection, id: string) {
  const rows = await tx.query(
    "SELECT content FROM cabinet_notification_preferences WHERE user_id=$1",
    [id],
  );
  return NotificationPreferencesSchema.parse(
    rows[0]?.content ?? {
      version: 0,
      mentions: true,
      subscriptions: true,
      reminders: true,
      inApp: true,
    },
  );
}
export async function visibleWork(
  tx: Connection,
  actor: SessionUser,
  id: string,
) {
  try {
    return await readWork(tx, actor, id);
  } catch (error) {
    if (error instanceof ApiFault && [403, 404].includes(error.status))
      return null;
    throw error;
  }
}
export async function notifyWork(
  tx: Connection,
  work: WorkState,
  comment: z.infer<typeof WorkCommentSchema>,
  now: Date,
) {
  for (const id of new Set([...work.subscriberIds, ...comment.mentions])) {
    if (id === comment.authorId) continue;
    const rows = await tx.query(
      "SELECT * FROM cabinet_users WHERE id=$1 AND active=true",
      [id],
    );
    if (!rows[0]) continue;
    const actor = await effectiveUser(tx, rows[0]);
    if (!(await visibleWork(tx, actor, work.id))) continue;
    const prefs = await notificationPreferences(tx, id);
    const mentioned = comment.mentions.includes(id);
    if (!prefs.inApp || !(mentioned ? prefs.mentions : prefs.subscriptions))
      continue;
    const item = NotificationSchema.parse({
      id: randomUUID(),
      version: 1,
      targetId: work.id,
      commentId: comment.id,
      recipientId: id,
      kind: mentioned ? "mention" : "subscription",
      state: "unread",
      at: now.toISOString(),
    });
    await tx.query(
      "INSERT INTO cabinet_notifications(id,recipient_id,target_id,dedupe_key,content) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(recipient_id,dedupe_key) DO NOTHING",
      [item.id, id, work.id, comment.id, JSON.stringify(item)],
    );
  }
}
export async function listNotifications(
  tx: Connection,
  actor: SessionUser,
  offset: number,
) {
  const items = [];
  let unread = 0,
    position = 0,
    nextOffset: number | null = null;
  // Walk bounded database pages so a hidden record does not affect the public count or pagination.
  let after: string | null = null;
  while (true) {
    const rows: Record<string, unknown>[] = await tx.query(
      "SELECT id,content FROM cabinet_notifications WHERE recipient_id=$1 AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT 100",
      [actor.id, after],
    );
    if (!rows.length) break;
    for (const row of rows) {
      const n = NotificationSchema.parse(row.content);
      if (n.state === "dismissed") continue;
      const work = await visibleWork(tx, actor, n.targetId);
      if (!work) continue;
      const comment = n.commentId
        ? work.comments.find((c) => c.id === n.commentId)
        : null;
      if (n.commentId && !comment) continue;
      let reminderText = "Échéance à suivre.";
      if (n.reminderId) {
        const rows = await tx.query(
          "SELECT content FROM cabinet_workflow_model_versions WHERE id=$1 AND version=$2",
          [n.reminderId, n.reminderVersion],
        );
        if (!rows[0]) continue;
        const m = WorkflowModelSchema.parse(rows[0].content).model;
        if (m.kind !== "reminder") continue;
        reminderText = m.message;
      }
      if (n.state === "unread") unread++;
      if (position >= offset && items.length < 100)
        items.push({
          ...n,
          title: work.target.title,
          text: comment?.text ?? reminderText,
        });
      else if (position >= offset) nextOffset = offset + 100;
      position++;
    }
    after = String(rows.at(-1)!.id);
  }
  return { items, unread, nextOffset };
}
