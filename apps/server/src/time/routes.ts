import { TimeCsv } from "./csv.js";
import { TimeCsvCommandSchema } from "@memlia/contracts";
import type { JobRunner } from "../jobs/runner.js";
import { previewReassignment, commitReassignment } from "./reassignment.js";
import { TimeReassignmentSchema } from "@memlia/contracts";
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
import {
  save,
  report,
  entities,
  readsOthers,
  manages,
  targets,
  load,
} from "./service.js";
import { hasPermission } from "../records/permissions.js";
export function registerTimeRoutes(
  app: FastifyInstance,
  { db, user, now }: RouteContext,
  jobs: JobRunner,
) {
  const csv = new TimeCsv(jobs);
  app.post("/api/v1/time/exports", async (req, reply) =>
    reply
      .code(202)
      .send(
        await db.transaction(async (tx) =>
          csv.start(
            tx,
            await user(tx, req),
            TimeCsvCommandSchema.parse(req.body),
          ),
        ),
      ),
  );
  app.get("/api/v1/time/exports/:id", async (req) =>
    db.transaction(async (tx) =>
      csv.get(
        tx,
        await user(tx, req),
        z.object({ id: z.uuid() }).parse(req.params).id,
      ),
    ),
  );
  app.get("/api/v1/time/exports/:id/parts/:part", async (req, reply) => {
    const p = z
      .object({ id: z.uuid(), part: z.coerce.number().int().positive() })
      .parse(req.params);
    const text = await db.transaction(async (tx) =>
      csv.part(tx, await user(tx, req), p.id, p.part),
    );
    return reply
      .type("text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="memlia-temps.csv"')
      .send(text);
  });
  app.get("/api/v1/time/targets", async (req) =>
    db.transaction(async (tx) => {
      const q = z
        .object({
          kind: z.enum(["dossier", "tache", "obligation", "production"]),
          q: z.string().max(200).default(""),
          offset: z.coerce.number().int().min(0).default(0),
        })
        .parse(req.query);
      return targets(tx, await user(tx, req), q.kind, q.q, q.offset);
    }),
  );
  app.get("/api/v1/time/:id/history", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req),
        id = z.object({ id: z.uuid() }).parse(req.params).id;
      await load(tx, actor, id);
      const q = z
        .object({ offset: z.coerce.number().int().min(0).default(0) })
        .parse(req.query);
      const rows = await tx.query(
        "SELECT content FROM cabinet_time_history WHERE id=$1 ORDER BY version DESC LIMIT 100 OFFSET $2",
        [id, q.offset],
      );
      return {
        items: rows.map((r) => r.content),
        offset: q.offset,
        total: Number(
          (
            await tx.query(
              "SELECT count(*) total FROM cabinet_time_history WHERE id=$1",
              [id],
            )
          )[0]!.total,
        ),
      };
    }),
  );
  app.post("/api/v1/time/reassignment/preview", async (req) =>
    db.transaction(async (tx) =>
      previewReassignment(
        tx,
        await user(tx, req),
        TimeReassignmentSchema.parse(req.body),
      ),
    ),
  );
  app.post("/api/v1/time/reassignment/commit", async (req) =>
    db.transaction(async (tx) =>
      commitReassignment(
        tx,
        await user(tx, req),
        TimeReassignmentSchema.parse(req.body),
        now(),
      ),
    ),
  );
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
        TimeQuerySchema.extend({ roleId: z.uuid().optional() }).parse(
          req.query,
        ),
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
        roles: await tx.query(
          "SELECT id,content->>'name' name FROM cabinet_roles ORDER BY id LIMIT 200",
        ),
        groups: await tx.query(
          "SELECT id,content->>'name' name,content->>'kind' kind FROM cabinet_groups ORDER BY id LIMIT 200",
        ),
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
            active: z.enum(["true", "false"]).optional(),
            userId: z.uuid().optional(),
            referenceId: z.uuid().optional(),
            offset: z.coerce.number().int().min(0).default(0),
          })
          .strict()
          .parse(req.query);
      const all = await entities(tx, a, q.kind, "read", undefined, q);
      return {
        items: all.slice(q.offset, q.offset + 100),
        total: all.length,
        offset: q.offset,
      };
    }),
  );
}
