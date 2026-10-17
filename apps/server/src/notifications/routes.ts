import type { Reminders } from "./reminders.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  NotificationSchema,
  NotificationCommandSchema,
  NotificationListSchema,
  NotificationPreferencesSchema,
} from "@memlia/contracts";
import type { RouteContext } from "../context.js";
import {
  listNotifications,
  notificationPreferences,
  visibleWork,
} from "./service.js";
import { idempotent } from "../storage/operations.js";
import { fail } from "../errors.js";
export function registerNotificationRoutes(
  app: FastifyInstance,
  { db, user }: RouteContext,
  reminders: Reminders,
) {
  app.post("/api/v1/notifications/process", async (req, reply) => {
    z.object({ operationId: z.uuid() }).strict().parse(req.body);
    return reply
      .code(202)
      .send(
        await db.transaction(async (tx) =>
          reminders.process(tx, await user(tx, req)),
        ),
      );
  });
  app.get("/api/v1/notifications", async (req) =>
    db.transaction(async (tx) =>
      NotificationListSchema.parse(
        await listNotifications(
          tx,
          await user(tx, req),
          z
            .object({
              offset: z.coerce.number().int().nonnegative().default(0),
            })
            .parse(req.query).offset,
        ),
      ),
    ),
  );
  app.get("/api/v1/notifications/preferences", async (req) =>
    db.transaction(async (tx) =>
      notificationPreferences(tx, (await user(tx, req)).id),
    ),
  );
  app.post("/api/v1/notifications/preferences", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req),
        i = NotificationPreferencesSchema.extend({ operationId: z.uuid() })
          .strict()
          .parse(req.body);
      return idempotent(
        tx,
        actor,
        i.operationId,
        { notificationPreferences: i },
        async () => {
          const prior = await notificationPreferences(tx, actor.id);
          if (prior.version !== i.version)
            fail(409, "VERSION_CONFLICT", "Les préférences ont changé.");
          const value = NotificationPreferencesSchema.parse({
            ...i,
            version: i.version + 1,
          });
          await tx.query(
            "INSERT INTO cabinet_notification_preferences(user_id,content) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO UPDATE SET content=EXCLUDED.content",
            [actor.id, JSON.stringify(value)],
          );
          return value;
        },
      );
    }),
  );
  app.post("/api/v1/notifications/:id", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req),
        id = z.object({ id: z.uuid() }).parse(req.params).id,
        i = NotificationCommandSchema.parse(req.body);
      const rows = await tx.query(
        "SELECT content FROM cabinet_notifications WHERE id=$1 AND recipient_id=$2",
        [id, actor.id],
      );
      if (!rows[0]) fail(404, "NOT_FOUND", "Notification inaccessible.");
      const old = NotificationSchema.parse(rows[0].content);
      if (!(await visibleWork(tx, actor, old.targetId)))
        fail(404, "NOT_FOUND", "Notification inaccessible.");
      return idempotent(
        tx,
        actor,
        i.operationId,
        { notification: id, input: i },
        async () => {
          if (old.version !== i.expectedVersion)
            fail(409, "VERSION_CONFLICT", "La notification a changé.");
          const value = { ...old, version: old.version + 1, state: i.state };
          await tx.query(
            "UPDATE cabinet_notifications SET content=$1::jsonb WHERE id=$2",
            [JSON.stringify(value), id],
          );
          return value;
        },
      );
    }),
  );
}
