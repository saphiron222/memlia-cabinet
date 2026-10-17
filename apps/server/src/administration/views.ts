import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  SavedViewSchema,
  SavedViewCommandSchema,
  SavedViewListSchema,
} from "@memlia/contracts";
import type { RouteContext } from "../context.js";
import { idempotent } from "../storage/operations.js";
import { fail } from "../errors.js";
export function registerViewRoutes(
  app: FastifyInstance,
  { db, user }: RouteContext,
) {
  const id = (raw: unknown) => z.object({ id: z.uuid() }).parse(raw).id;
  app.get("/api/v1/administration/views", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req);
      return SavedViewListSchema.parse({
        items: (
          await tx.query(
            "SELECT content FROM cabinet_saved_views WHERE user_id=$1 ORDER BY content->>'name',id LIMIT 100",
            [actor.id],
          )
        ).map((r) => r.content),
      });
    }),
  );
  const save =
    (update: boolean) => async (req: FastifyRequest, reply: FastifyReply) => {
      const input = SavedViewCommandSchema.parse(req.body),
        viewId = update ? id(req.params) : randomUUID();
      const result = await db.transaction(async (tx) => {
        const actor = await user(tx, req);
        if (
          update &&
          !(
            await tx.query(
              "SELECT id FROM cabinet_saved_views WHERE id=$1 AND user_id=$2",
              [viewId, actor.id],
            )
          ).length
        )
          fail(404, "NOT_FOUND", "Vue inaccessible.");
        return idempotent(
          tx,
          actor,
          input.operationId,
          { action: "view.save", id: update ? viewId : null, input },
          async () => {
            const previous = update
              ? SavedViewSchema.parse(
                  (
                    await tx.query(
                      "SELECT content FROM cabinet_saved_views WHERE id=$1 AND user_id=$2",
                      [viewId, actor.id],
                    )
                  )[0]!.content,
                )
              : null;
            if (previous?.version !== input.expectedVersion && previous)
              fail(409, "VERSION_CONFLICT", "La vue a changé.");
            if (
              !previous &&
              Number(
                (
                  await tx.query(
                    "SELECT count(*) AS n FROM cabinet_saved_views WHERE user_id=$1",
                    [actor.id],
                  )
                )[0]!.n,
              ) >= 100
            )
              fail(409, "VIEW_LIMIT", "Maximum 100 vues personnelles.");
            const next = SavedViewSchema.parse({
              id: viewId,
              version: (previous?.version ?? 0) + 1,
              name: input.name,
              query: input.query,
            });
            await tx.query(
              "INSERT INTO cabinet_saved_views(id,user_id,content) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO UPDATE SET content=EXCLUDED.content",
              [viewId, actor.id, JSON.stringify(next)],
            );
            return next;
          },
        );
      });
      return reply.code(update ? 200 : 201).send(result);
    };
  app.post("/api/v1/administration/views", save(false));
  app.put("/api/v1/administration/views/:id", save(true));
  app.post("/api/v1/administration/views/:id/remove", async (req) => {
    const input = z
        .object({
          operationId: z.uuid(),
          expectedVersion: z.number().int().positive(),
        })
        .strict()
        .parse(req.body),
      viewId = id(req.params);
    return db.transaction(async (tx) => {
      const actor = await user(tx, req);
      return idempotent(
        tx,
        actor,
        input.operationId,
        { action: "view.remove", viewId, input },
        async () => {
          const rows = await tx.query(
            "SELECT content FROM cabinet_saved_views WHERE id=$1 AND user_id=$2",
            [viewId, actor.id],
          );
          if (!rows[0]) fail(404, "NOT_FOUND", "Vue inaccessible.");
          if (
            SavedViewSchema.parse(rows[0].content).version !==
            input.expectedVersion
          )
            fail(409, "VERSION_CONFLICT", "La vue a changé.");
          await tx.query(
            "DELETE FROM cabinet_saved_views WHERE id=$1 AND user_id=$2",
            [viewId, actor.id],
          );
          return { removed: true };
        },
      );
    });
  });
}
