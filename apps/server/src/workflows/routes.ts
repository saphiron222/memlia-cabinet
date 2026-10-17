import { ApiFault } from "../errors.js";
import { RecordListSchema, RecordListQuerySchema } from "@memlia/contracts";
import { queryRecords } from "../records/query.js";
import { ensureFiscalTask } from "./tasks.js";
import { effectiveUser } from "../identity/service.js";
import { WorkflowGeneration } from "./generation.js";
import { JobRunner } from "../jobs/runner.js";
import {
  WorkflowGenerationSchema,
  TaskMoveSchema,
  WorkflowModelSchema,
} from "@memlia/contracts";
import { moveTask } from "./tasks.js";
import { canAccess } from "../records/permissions.js";
import { loadRecord } from "../records/service.js";
import { z } from "zod";
import {
  WorkflowModelCommandSchema,
  WorkCommandSchema,
} from "@memlia/contracts";
import {
  readWork,
  commandWork,
  saveModel,
  workTarget,
  requireModelAccess,
} from "./service.js";
import type { FastifyInstance } from "fastify";
import { RecurrencePreviewSchema, previewOccurrences } from "@memlia/contracts";
import type { RouteContext } from "../context.js";
export function registerWorkflowRoutes(
  app: FastifyInstance,
  { db, user, now }: RouteContext,
  jobs: JobRunner,
  civilDate: (date: Date) => string,
) {
  app.post("/api/v1/workflows/preview", async (req) =>
    db.transaction(async (tx) => {
      await user(tx, req);
      const i = RecurrencePreviewSchema.parse(req.body);
      return {
        dates: previewOccurrences(i.rule, i.from, i.to),
        today: civilDate(now()),
      };
    }),
  );
  const generator = new WorkflowGeneration(jobs, now);
  app.get("/api/v1/workflows/models/:id/job", async (req) =>
    db.transaction(async (tx) =>
      generator.latest(tx, await user(tx, req), id(req.params)),
    ),
  );
  app.post("/api/v1/workflows/generate", async (req, reply) =>
    reply
      .code(202)
      .send(
        await db.transaction(async (tx) =>
          generator.generate(
            tx,
            await user(tx, req),
            WorkflowGenerationSchema.parse(req.body),
          ),
        ),
      ),
  );
  app.get("/api/v1/workflows/jobs/:id", async (req) =>
    db.transaction(async (tx) =>
      generator.get(tx, await user(tx, req), id(req.params)),
    ),
  );
  app.post("/api/v1/workflows/tasks/:id/move", async (req) =>
    db.transaction(async (tx) =>
      moveTask(
        tx,
        await user(tx, req),
        id(req.params),
        TaskMoveSchema.parse(req.body),
        now(),
      ),
    ),
  );
  app.post("/api/v1/workflows/models", async (req) =>
    db.transaction(async (tx) =>
      saveModel(
        tx,
        await user(tx, req),
        WorkflowModelCommandSchema.parse(req.body),
        now(),
      ),
    ),
  );
  app.get("/api/v1/workflows/models", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req);
      const items = [];
      let cursor =
        z.object({ after: z.uuid().optional() }).parse(req.query).after ?? null;
      while (items.length < 200) {
        const rows: Record<string, unknown>[] = await tx.query(
          "SELECT id,content FROM cabinet_workflow_models WHERE ($1::uuid IS NULL OR id>$1::uuid) ORDER BY id LIMIT 100",
          [cursor],
        );
        if (!rows.length) return { items, nextCursor: null };
        for (const row of rows) {
          cursor = String(row.id);
          const m = WorkflowModelSchema.parse(row.content);
          try {
            await requireModelAccess(tx, actor, m.model);
          } catch (e) {
            if (e instanceof ApiFault && [403, 404].includes(e.status))
              continue;
            throw e;
          }
          items.push(m);
          if (items.length === 200) return { items, nextCursor: cursor };
        }
      }
      return { items, nextCursor: null };
    }),
  );
  const id = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;
  app.get("/api/v1/workflows/targets/:id", async (req) =>
    db.transaction(async (tx) =>
      readWork(tx, await user(tx, req), id(req.params)),
    ),
  );
  app.post("/api/v1/workflows/targets/:id/commands", async (req) =>
    db.transaction(async (tx) =>
      commandWork(
        tx,
        await user(tx, req),
        id(req.params),
        WorkCommandSchema.parse(req.body),
        now(),
      ),
    ),
  );
  app.get("/api/v1/workflows/calendar", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req);
      const result = await queryRecords(
        tx,
        actor,
        RecordListQuerySchema.parse(req.query),
      );
      const dossiers: Record<string, string> = {};
      for (const dossierId of new Set(
        result.items
          .map((r) => r.dossierId)
          .filter((id): id is string => id !== null),
      ))
        dossiers[dossierId] = (await loadRecord(tx, dossierId)).title;
      return { ...result, dossiers };
    }),
  );
  app.post("/api/v1/workflows/targets/:id/task", async (req) =>
    db.transaction(async (tx) =>
      ensureFiscalTask(
        tx,
        await user(tx, req),
        id(req.params),
        z.object({ operationId: z.uuid() }).strict().parse(req.body)
          .operationId,
        now(),
      ),
    ),
  );
  app.get("/api/v1/workflows/targets/:id/people", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req),
        target = await workTarget(tx, actor, id(req.params));
      const q = z
        .object({
          q: z.string().max(200).default(""),
          offset: z.coerce.number().int().nonnegative().default(0),
        })
        .parse(req.query);
      const rows = await tx.query(
        "SELECT * FROM cabinet_users WHERE active=true AND name ILIKE $1 ORDER BY name,id LIMIT 100 OFFSET $2",
        ["%" + q.q.replace(/[\\%_]/g, "\\$&") + "%", q.offset],
      );
      const items = [];
      for (const row of rows) {
        const candidate = await effectiveUser(tx, row);
        if (await canAccess(tx, candidate, "read", target))
          items.push({ id: candidate.id, name: candidate.name });
      }
      return { items, hasMore: rows.length === 100 };
    }),
  );
}
