import { requireGlobal } from "../records/permissions.js";
import { ApiFault } from "../errors.js";
import { stableId } from "../workflows/generation.js";
import { RelationshipBulkSchema } from "@memlia/contracts";
import type { LabReminders } from "./notifications.js";
import { onboardingStatus, activate } from "./onboarding.js";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { RouteContext } from "../context.js";
import {
  RelationshipSaveSchema,
  RelationshipMoveSchema,
  RelationshipQuerySchema,
  RelationshipEntitySchema,
  RelationshipEventSchema,
} from "@memlia/contracts";
import { save, load, page, move } from "./service.js";
const id = (value: unknown) => z.object({ id: z.uuid() }).parse(value).id;
export function registerRelationshipRoutes(
  app: FastifyInstance,
  { db, user, now }: RouteContext,
  civilDate: (date: Date) => string,
  labReminders: LabReminders,
) {
  app.get("/api/v1/relationship/catalog/:kind", (req) =>
    db.transaction(async (tx) => {
      const a = await user(tx, req);
      requireGlobal(a, "read");
      const kind = z
        .object({ kind: z.enum(["people", "teams"]) })
        .parse(req.params).kind;
      const q = z
        .object({
          q: z.string().max(200).default(""),
          offset: z.coerce.number().int().nonnegative().default(0),
          id: z.uuid().optional(),
        })
        .parse(req.query);
      const table = kind === "people" ? "cabinet_users" : "cabinet_groups",
        active = kind === "people" ? "active=true" : "content->>'kind'='team'";
      const column = kind === "people" ? "name" : "content->>'name'";
      const filter = q.id ? "id=$1::uuid" : `${active} AND ${column} ILIKE $1`;
      const arg = q.id ?? "%" + q.q.replace(/[\\%_]/g, "\\$&") + "%";
      const items = await tx.query(
        `SELECT id,${column} name FROM ${table} WHERE ${filter} ORDER BY name,id LIMIT 100 OFFSET $2`,
        [arg, q.offset],
      );
      const total = await tx.query(
        `SELECT count(*) n FROM ${table} WHERE ${filter}`,
        [arg],
      );
      return { items, total: Number(total[0]!.n) };
    }),
  );
  app.post("/api/v1/relationship/lab/reminders", async (req, reply) => {
    z.object({ operationId: z.uuid() }).strict().parse(req.body);
    return reply
      .code(202)
      .send(
        await db.transaction(async (tx) =>
          labReminders.process(tx, await user(tx, req)),
        ),
      );
  });
  app.get("/api/v1/relationship/onboarding/:id/status", (req) =>
    db.transaction(async (tx) =>
      onboardingStatus(
        tx,
        await user(tx, req),
        id(req.params),
        civilDate(now()),
      ),
    ),
  );
  app.post("/api/v1/relationship/onboarding/:id/activate", (req) =>
    db.transaction(async (tx) =>
      activate(
        tx,
        await user(tx, req),
        id(req.params),
        z
          .object({
            operationId: z.uuid(),
            expectedVersion: z.number().int().positive(),
          })
          .strict()
          .parse(req.body),
        now(),
        civilDate(now()),
      ),
    ),
  );
  app.post("/api/v1/relationship/prospects/bulk-move", async (req) => {
    const i = RelationshipBulkSchema.parse(req.body),
      items = [];
    for (const item of i.items) {
      try {
        const result = await db.transaction(async (tx) =>
          move(
            tx,
            await user(tx, req),
            item.id,
            {
              operationId: stableId(i.operationId + ":" + item.id),
              expectedVersion: item.expectedVersion,
              stageId: i.stageId,
            },
            now(),
          ),
        );
        items.push({
          id: item.id,
          state: "succeeded",
          version: result.version,
        });
      } catch (e) {
        if (!(e instanceof ApiFault)) throw e;
        items.push({
          id: item.id,
          state: "failed",
          code: e.code,
          message: e.message,
        });
      }
    }
    return { items };
  });
  app.get("/api/v1/relationship/entities/:id/capabilities", (req) =>
    db.transaction(async (tx) => {
      const a = await user(tx, req);
      await load(tx, a, id(req.params));
      const actions = [];
      for (const action of ["update", "export"] as const) {
        try {
          await load(tx, a, id(req.params), action);
          actions.push(action);
        } catch (e) {
          if (!(e instanceof ApiFault && [403, 404].includes(e.status)))
            throw e;
        }
      }
      return { actions };
    }),
  );
  app.post("/api/v1/relationship/entities", (req) =>
    db.transaction(async (tx) =>
      save(
        tx,
        await user(tx, req),
        RelationshipSaveSchema.parse(req.body),
        now(),
      ),
    ),
  );
  app.get("/api/v1/relationship/entities", (req) =>
    db.transaction(async (tx) =>
      page(
        tx,
        await user(tx, req),
        RelationshipQuerySchema.parse(req.query),
        "read",
        civilDate(now()),
      ),
    ),
  );
  app.get("/api/v1/relationship/entities/:id", (req) =>
    db.transaction(async (tx) => load(tx, await user(tx, req), id(req.params))),
  );
  app.post("/api/v1/relationship/prospects/:id/move", (req) =>
    db.transaction(async (tx) =>
      move(
        tx,
        await user(tx, req),
        id(req.params),
        RelationshipMoveSchema.parse(req.body),
        now(),
      ),
    ),
  );
  app.get("/api/v1/relationship/:id/history", (req) =>
    db.transaction(async (tx) => {
      await load(tx, await user(tx, req), id(req.params));
      const offset = z
        .object({ offset: z.coerce.number().int().nonnegative().default(0) })
        .parse(req.query).offset;
      return {
        items: (
          await tx.query(
            "SELECT content FROM cabinet_relationship_history WHERE id=$1 ORDER BY version DESC LIMIT 100 OFFSET $2",
            [id(req.params), offset],
          )
        ).map((r) => RelationshipEntitySchema.parse(r.content)),
      };
    }),
  );
  app.get("/api/v1/relationship/:id/events", (req) =>
    db.transaction(async (tx) => {
      await load(tx, await user(tx, req), id(req.params));
      return {
        items: (
          await tx.query(
            "SELECT content FROM cabinet_relationship_events WHERE entity_id=$1 ORDER BY id",
            [id(req.params)],
          )
        ).map((r) => RelationshipEventSchema.parse(r.content)),
      };
    }),
  );
}
