import { requireGlobal } from "../records/permissions.js";
import { ProductionGeneration } from "./generation.js";
import type { JobRunner } from "../jobs/runner.js";
import { productionRows } from "./query.js";
import { ApiFault } from "../errors.js";
import { z } from "zod";
import {
  ProductionModelCommandSchema,
  ProductionDuplicateSchema,
  ProductionModelSchema,
  ProductionQuerySchema,
  ProductionRowCreateSchema,
  ProductionCommandSchema,
  ProductionMigrationSchema,
  ProductionGenerationSchema,
} from "@memlia/contracts";
import type { FastifyInstance } from "fastify";
import type { RouteContext } from "../context.js";
import {
  saveProductionModel,
  duplicateProductionModel,
  loadProductionModel,
  modelAccess,
  createProductionRow,
  loadProductionRow,
  commandProductionRow,
  migrateProductionTargets,
  authorizeRow,
  columnRole,
} from "./service.js";
export function registerProductionRoutes(
  app: FastifyInstance,
  { db, user, now }: RouteContext,
  jobs: JobRunner,
  civilDate: (instant: Date) => string,
) {
  app.get("/api/v1/production/calendar", async (req) =>
    db.transaction(async (tx) => {
      await user(tx, req);
      return { today: civilDate(now()) };
    }),
  );
  app.get("/api/v1/production/people", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req);
      requireGlobal(actor, "read");
      const q = z
        .object({
          q: z.string().max(200).default(""),
          offset: z.coerce.number().int().min(0).default(0),
        })
        .parse(req.query);
      const pattern = "%" + q.q.replace(/[\\%_]/g, "\\$&") + "%";
      const items = await tx.query(
        "SELECT id,name FROM cabinet_users WHERE active=true AND name ILIKE $1 ORDER BY name,id LIMIT 100 OFFSET $2",
        [pattern, q.offset],
      );
      const count = await tx.query(
        "SELECT count(*) AS n FROM cabinet_users WHERE active=true AND name ILIKE $1",
        [pattern],
      );
      return { items, total: Number(count[0]!.n) };
    }),
  );
  app.get("/api/v1/production/rows/:id/capabilities", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req),
        row = await loadProductionRow(tx, actor, id(req.params)),
        m = await loadProductionModel(tx, row.modelId, row.modelVersion);
      const can = async (action: "update" | "approve" | "assign") => {
        try {
          await authorizeRow(tx, actor, row, action);
          return true;
        } catch (e) {
          if (e instanceof ApiFault && [403, 404].includes(e.status))
            return false;
          throw e;
        }
      };
      const update = await can("update"),
        approve = await can("approve"),
        assign = await can("assign"),
        columns = [];
      if (m.model.kind !== "stage_type")
        for (const c of m.model.columns) {
          let role = true;
          try {
            await columnRole(
              tx,
              actor,
              c.requiredRoleId,
              row.scope?.kind === "dossier"
                ? row.scope.id
                : (row.scope?.dossierId ?? null),
            );
          } catch (e) {
            if (e instanceof ApiFault && [403, 404].includes(e.status))
              role = false;
            else throw e;
          }
          columns.push({
            id: c.id,
            edit: update && role && (!c.approval || approve),
            approve: approve && role,
          });
        }
      return { update, assign, columns };
    }),
  );
  const generator = new ProductionGeneration(jobs, now);
  app.post("/api/v1/production/preview", async (req) =>
    db.transaction(async (tx) =>
      generator.preview(
        tx,
        await user(tx, req),
        ProductionGenerationSchema.parse(req.body),
      ),
    ),
  );
  app.post("/api/v1/production/generate", async (req, reply) =>
    reply
      .code(202)
      .send(
        await db.transaction(async (tx) =>
          generator.generate(
            tx,
            await user(tx, req),
            ProductionGenerationSchema.parse(req.body),
          ),
        ),
      ),
  );
  app.get("/api/v1/production/jobs/:id", async (req) =>
    db.transaction(async (tx) =>
      generator.get(tx, await user(tx, req), id(req.params)),
    ),
  );
  app.get("/api/v1/production/jobs/:id/results", async (req) =>
    db.transaction(async (tx) =>
      generator.results(
        tx,
        await user(tx, req),
        id(req.params),
        z
          .object({ offset: z.coerce.number().int().min(0).default(0) })
          .parse(req.query).offset,
      ),
    ),
  );
  const id = (p: unknown) => z.object({ id: z.uuid() }).parse(p).id;
  app.post("/api/v1/production/models", async (req) =>
    db.transaction(async (tx) =>
      saveProductionModel(
        tx,
        await user(tx, req),
        ProductionModelCommandSchema.parse(req.body),
        now(),
      ),
    ),
  );
  app.post("/api/v1/production/models/:id/duplicate", async (req) =>
    db.transaction(async (tx) =>
      duplicateProductionModel(
        tx,
        await user(tx, req),
        id(req.params),
        ProductionDuplicateSchema.parse(req.body),
        now(),
      ),
    ),
  );
  app.get("/api/v1/production/models/:id/rows", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req);
      return productionRows(
        tx,
        actor,
        id(req.params),
        ProductionQuerySchema.parse(req.query),
      );
    }),
  );
  app.get("/api/v1/production/models/:id", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req),
        m = await loadProductionModel(
          tx,
          id(req.params),
          z
            .object({ version: z.coerce.number().int().positive().optional() })
            .parse(req.query).version,
        );
      await modelAccess(tx, actor, await loadProductionModel(tx, m.id));
      await modelAccess(tx, actor, m);
      return m;
    }),
  );
  app.get("/api/v1/production/models", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req),
        query = z.object({ after: z.uuid().optional() }).parse(req.query);
      let cursor = query.after ?? null;
      const items = [];
      while (items.length < 100) {
        const rows: Record<string, unknown>[] = await tx.query(
          "SELECT id,content FROM cabinet_production_models WHERE ($1::uuid IS NULL OR id>$1::uuid) ORDER BY id LIMIT 100",
          [cursor],
        );
        if (!rows.length) return { items, nextCursor: null };
        for (const row of rows) {
          cursor = String(row.id);
          const m = ProductionModelSchema.parse(row.content);
          try {
            await modelAccess(tx, actor, m);
          } catch (e) {
            if (e instanceof ApiFault && [403, 404].includes(e.status))
              continue;
            throw e;
          }
          items.push(m);
          if (items.length === 100) return { items, nextCursor: cursor };
        }
      }
      return { items, nextCursor: cursor };
    }),
  );
  app.post("/api/v1/production/models/:id/rows", async (req) =>
    db.transaction(async (tx) =>
      createProductionRow(
        tx,
        await user(tx, req),
        id(req.params),
        ProductionRowCreateSchema.parse(req.body),
        now(),
      ),
    ),
  );
  app.get("/api/v1/production/rows/:id", async (req) =>
    db.transaction(async (tx) =>
      loadProductionRow(tx, await user(tx, req), id(req.params)),
    ),
  );
  app.post("/api/v1/production/rows/:id/commands", async (req) =>
    db.transaction(async (tx) =>
      commandProductionRow(
        tx,
        await user(tx, req),
        id(req.params),
        ProductionCommandSchema.parse(req.body),
        now(),
      ),
    ),
  );
  app.post("/api/v1/production/models/:id/migrate-targets", async (req) =>
    db.transaction(async (tx) =>
      migrateProductionTargets(
        tx,
        await user(tx, req),
        id(req.params),
        ProductionMigrationSchema.parse(req.body),
        now(),
      ),
    ),
  );
}
