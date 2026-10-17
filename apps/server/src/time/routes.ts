import { calculateWorkload } from "./workload.js";
import { startTimer, stopTimer } from "./timers.js";
import { TimerStartSchema, TimerStopSchema } from "@memlia/contracts";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { RouteContext } from "../context.js";
import {
  TimeSaveSchema,
  TimeQuerySchema,
  TimeReportSchema,
  TimeOptionsSchema,
} from "@memlia/contracts";
import { save, report, entities, readsOthers, manages } from "./service.js";
import { hasPermission } from "../records/permissions.js";
export function registerTimeRoutes(
  app: FastifyInstance,
  { db, user, now }: RouteContext,
) {
  app.post("/api/v1/time/timers/start", async (req) =>
    db.transaction(async (tx) =>
      startTimer(
        tx,
        await user(tx, req),
        TimerStartSchema.parse(req.body),
        now(),
      ),
    ),
  );
  app.post("/api/v1/time/timers/:id/stop", async (req) =>
    db.transaction(async (tx) =>
      stopTimer(
        tx,
        await user(tx, req),
        z.object({ id: z.uuid() }).parse(req.params).id,
        TimerStopSchema.parse(req.body),
        now(),
      ),
    ),
  );
  app.post("/api/v1/time/entities", async (req) =>
    db.transaction(async (tx) =>
      save(tx, await user(tx, req), TimeSaveSchema.parse(req.body), now()),
    ),
  );
  app.get("/api/v1/time/workload", async (req) =>
    db.transaction(async (tx) =>
      calculateWorkload(
        tx,
        await user(tx, req),
        TimeQuerySchema.parse(req.query),
      ),
    ),
  );
  app.get("/api/v1/time/report", async (req) =>
    db.transaction(async (tx) =>
      TimeReportSchema.parse(
        await report(tx, await user(tx, req), TimeQuerySchema.parse(req.query)),
      ),
    ),
  );
  app.get("/api/v1/time/options", async (req) =>
    db.transaction(async (tx) => {
      const a = await user(tx, req),
        all = readsOthers(a);
      const users = await tx.query(
        `SELECT id,name FROM cabinet_users WHERE active=true ${all ? "" : "AND id=$1"} ORDER BY name LIMIT 200`,
        all ? [] : [a.id],
      );
      return TimeOptionsSchema.parse({
        canManage: manages(a),
        canReadOthers: all,
        canLock: hasPermission(a, "time_lock", "*"),
        users,
        natures: (await entities(tx, a, "nature")).slice(0, 200),
      });
    }),
  );
  app.get("/api/v1/time/entities", async (req) =>
    db.transaction(async (tx) => {
      const a = await user(tx, req),
        q = z
          .object({
            kind: z.string().max(30).optional(),
            offset: z.coerce.number().int().min(0).default(0),
          })
          .strict()
          .parse(req.query);
      const all = await entities(tx, a, q.kind);
      return {
        items: all.slice(q.offset, q.offset + 100),
        total: all.length,
        offset: q.offset,
      };
    }),
  );
}
