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
import { readWork, commandWork, saveModel, workTarget } from "./service.js";
import type { FastifyInstance } from "fastify";
import { RecurrencePreviewSchema, previewOccurrences } from "@memlia/contracts";
import type { RouteContext } from "../context.js";
export function registerWorkflowRoutes(
  app: FastifyInstance,
  { db, user, now }: RouteContext,
  jobs: JobRunner,
) {
  app.post("/api/v1/workflows/preview", async (req) =>
    db.transaction(async (tx) => {
      await user(tx, req);
      const i = RecurrencePreviewSchema.parse(req.body);
      return { dates: previewOccurrences(i.rule, i.from, i.to) };
    }),
  );
  const generator = new WorkflowGeneration(jobs, now);
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
      for (const row of await tx.query(
        "SELECT content FROM cabinet_workflow_models ORDER BY id LIMIT 200",
      )) {
        const m = WorkflowModelSchema.parse(row.content);
        if (
          m.model.kind === "recurrence" &&
          !(await canAccess(
            tx,
            actor,
            "read",
            await loadRecord(tx, m.model.dossierId),
          ))
        )
          continue;
        if (m.model.kind === "reminder") {
          let allowed = true;
          for (const id of m.model.targetIds)
            if (!(await canAccess(tx, actor, "read", await loadRecord(tx, id))))
              allowed = false;
          if (!allowed) continue;
        }
        items.push(m);
      }
      return { items };
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
}
