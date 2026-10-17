import { csvHeader, csvRow } from "./csv.js";
import { queryRecords, recordFilter } from "./query.js";
import { availablePermissions } from "../administration/access.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  deriveSourceFreshness,
  FiscalSourceEvidenceSchema,
  CabinetRecordSchema,
  RecordContentSchema,
  CreateRecordInputSchema,
  UpdateRecordInputSchema,
  TaskTransitionInputSchema,
  RecordListSchema,
  RecordListQuerySchema,
  RecordKindSchema,
  HistorySchema,
  DashboardSchema,
  CatalogueSchema,
  FiscalNatureSchema,
  FiscalCreateSchema,
  FiscalCommandSchema,
  type SessionUser,
  type Action,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import type { RouteContext } from "../context.js";
import { fail } from "../errors.js";
import { canAccess, requireAccess } from "./permissions.js";
import { loadRecord, listRecords, saveRecord } from "./service.js";
export function registerRecordRoutes(
  app: FastifyInstance,
  { db, now, user }: RouteContext,
  civilDate: (instant: Date) => string,
  csvSyncRows = 1000,
) {
  if (!Number.isInteger(csvSyncRows) || csvSyncRows < 1 || csvSyncRows > 1000)
    throw Error("Borne CSV invalide.");
  const labels = {
    dossier: "Dossiers",
    contact: "Contacts",
    tache: "Tâches",
    obligation: "Obligations",
  };
  app.get("/api/v1/catalogue", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req);
      return CatalogueSchema.parse({
        fiscal: {
          natures: FiscalNatureSchema.options,
          createSchema: z.toJSONSchema(FiscalCreateSchema, { io: "input" }),
          commandSchema: z.toJSONSchema(FiscalCommandSchema, { io: "input" }),
          realTransmission: false,
        },
        resources: RecordKindSchema.options.map((kind, index) => ({
          kind,
          label: labels[kind],
          actions: (
            [
              "read",
              "create",
              "update",
              ...(kind === "tache" ? ["transition", "assign"] : []),
              ...(kind === "obligation"
                ? ["approve", "transmit", "assign"]
                : []),
              "export",
              "audit",
            ] as Action[]
          ).filter((action) =>
            availablePermissions(actor).some(
              (p) => p.action === action && (p.kind === "*" || p.kind === kind),
            ),
          ),
          inputSchema: z.toJSONSchema(RecordContentSchema.options[index]!, {
            io: "input",
          }),
        })),
      });
    }),
  );
  app.get("/api/v1/records", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req);
      const query = RecordListQuerySchema.parse(req.query);
      if (
        !availablePermissions(actor).some(
          (p) =>
            p.action === "read" &&
            (!query.kind || p.kind === "*" || p.kind === query.kind),
        )
      )
        fail(403, "FORBIDDEN", "Lecture non autorisée.");
      return RecordListSchema.parse(
        await queryRecords(tx, actor, query, "read"),
      );
    }),
  );
  app.get("/api/v1/records/export.csv", async (req, reply) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req);
      const query = RecordListQuerySchema.parse(req.query);
      if (
        !availablePermissions(actor).some(
          (p) =>
            p.action === "export" &&
            (!query.kind || p.kind === "*" || p.kind === query.kind),
        )
      )
        fail(403, "FORBIDDEN", "Export non autorisé.");
      const f = recordFilter(actor, query, "export");
      const totals = await tx.query(
        `SELECT count(*) AS n,COALESCE(sum(octet_length(r.content::text)),0) AS bytes FROM cabinet_records r WHERE ${f.where}`,
        f.params,
      );
      if (
        Number(totals[0]!.n) > csvSyncRows ||
        Number(totals[0]!.bytes) > 2 * 1024 * 1024
      )
        fail(
          413,
          "EXPORT_ASYNC_REQUIRED",
          "Cette vue nécessite une préparation CSV en arrière-plan.",
          { path: "/api/v1/administration/exports", query },
        );
      const records = (await queryRecords(tx, actor, query, "export", false))
        .items;
      const csv =
        csvHeader(query) +
        records.map((r) => csvRow(r, query, now(), civilDate(now()))).join("");
      if (Buffer.byteLength(csv) > 4 * 1024 * 1024)
        fail(
          413,
          "EXPORT_ASYNC_REQUIRED",
          "Cette vue nécessite une préparation CSV en arrière-plan.",
          { path: "/api/v1/administration/exports", query },
        );
      reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", 'attachment; filename="memlia.csv"');
      return csv;
    }),
  );
  const idSchema = z.object({ id: z.uuid() });
  app.get("/api/v1/records/:id", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req);
      const { id } = idSchema.parse(req.params);
      const record = await loadRecord(tx, id);
      await requireAccess(tx, actor, "read", record);
      return CabinetRecordSchema.parse(record);
    }),
  );
  app.post("/api/v1/records", async (req, reply) => {
    const input = CreateRecordInputSchema.parse(req.body);
    const record = await db.transaction(async (tx) =>
      saveRecord(tx, await user(tx, req), input, now()),
    );
    reply.code(201);
    return record;
  });
  app.put("/api/v1/records/:id", async (req) => {
    const input = UpdateRecordInputSchema.parse(req.body);
    const { id } = idSchema.parse(req.params);
    return db.transaction(async (tx) =>
      saveRecord(tx, await user(tx, req), input, now(), id),
    );
  });
  app.post("/api/v1/records/:id/transition", async (req) => {
    const input = TaskTransitionInputSchema.parse(req.body);
    const { id } = idSchema.parse(req.params);
    return db.transaction(async (tx) => {
      const actor = await user(tx, req);
      const record = await loadRecord(tx, id);
      await requireAccess(tx, actor, "transition", record);
      if (record.kind !== "tache")
        fail(400, "INVALID_KIND", "Transition réservée aux tâches.");
      return saveRecord(
        tx,
        actor,
        {
          operationId: input.operationId,
          expectedVersion: input.expectedVersion,
          record: {
            kind: record.kind,
            title: record.title,
            dossierId: record.dossierId,
            confidential: record.confidential,
            data: { ...record.data, state: input.state },
          },
        },
        now(),
        id,
        "transitioned",
        { id, action: "transition", input },
      );
    });
  });
  app.get("/api/v1/records/:id/history", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req);
      const { id } = idSchema.parse(req.params);
      const record = await loadRecord(tx, id);
      await requireAccess(tx, actor, "read", record);
      await requireAccess(tx, actor, "audit", record);
      const rows = await tx.query(
        "SELECT event FROM cabinet_history WHERE record_id=$1 ORDER BY (event->>'version')::int",
        [id],
      );
      const items = [];
      for (const row of rows) {
        const event = HistorySchema.shape.items.element.parse(row.event);
        if (
          (await canAccess(tx, actor, "read", event.snapshot)) &&
          (await canAccess(tx, actor, "audit", event.snapshot))
        )
          items.push(event);
      }
      return HistorySchema.parse({ items });
    }),
  );
  app.get("/api/v1/dashboard", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req);
      if (!availablePermissions(actor).some((p) => p.action === "read"))
        fail(403, "FORBIDDEN", "Lecture non autorisée.");
      const query = RecordListQuerySchema.parse(req.query);
      const asOf = now(),
        today = civilDate(asOf),
        f = recordFilter(actor, query, "read");
      const groups = await tx.query(
        `SELECT r.kind,r.content->'data'->>'state' AS state,r.content->'data'->>'preparation' AS preparation,r.content->'data'->>'source' AS source,count(*) AS n,sum(CASE WHEN r.kind='tache' AND r.content->'data'->>'state'<>'terminee' THEN 1 ELSE 0 END) AS open,sum(CASE WHEN r.kind='tache' AND r.content->'data'->>'state'<>'terminee' AND r.content->'data'->>'dueDate'<$${f.params.length + 1} THEN 1 ELSE 0 END) AS overdue,sum(CASE WHEN r.kind='tache' AND r.content->'data'->>'state'<>'terminee' AND r.content->'data'->>'dueDate'>=$${f.params.length + 1} THEN 1 ELSE 0 END) AS upcoming FROM cabinet_records r WHERE ${f.where} GROUP BY r.kind,r.content->'data'->>'state',r.content->'data'->>'preparation',r.content->'data'->>'source'`,
        [...f.params, today],
      );
      const counts = { dossier: 0, contact: 0, tache: 0, obligation: 0 };
      let openTasks = 0,
        overdueTasks = 0,
        upcomingTasks = 0;
      for (const group of groups) {
        counts[RecordKindSchema.parse(group.kind)] += Number(group.n);
        openTasks += Number(group.open);
        overdueTasks += Number(group.overdue);
        upcomingTasks += Number(group.upcoming);
      }
      const sourceGroups = await tx.query(
        `SELECT r.content->'data'->'sourceEvidence' AS evidence,count(*) AS n FROM cabinet_records r WHERE ${f.where} AND r.kind='obligation' GROUP BY r.content->'data'->'sourceEvidence'`,
        f.params,
      );
      const freshnessCounts = { fresh: 0, stale: 0, unknown: 0 };
      for (const row of sourceGroups)
        freshnessCounts[
          deriveSourceFreshness(
            FiscalSourceEvidenceSchema.nullable().parse(row.evidence ?? null),
            asOf,
            today,
          ).state
        ] += Number(row.n);
      return DashboardSchema.parse({
        asOf: asOf.toISOString(),
        counts,
        openTasks,
        overdueTasks,
        upcomingTasks,
        obligationSources: {
          manual: groups
            .filter((r) => r.kind === "obligation" && r.source === "manuelle")
            .reduce((n, r) => n + Number(r.n), 0),
          simulated: groups
            .filter((r) => r.kind === "obligation" && r.source === "simulee")
            .reduce((n, r) => n + Number(r.n), 0),
          ...freshnessCounts,
          withoutVerifiedFresh: counts.obligation,
          verified: 0,
          freshness: "unknown",
        },
        tasks: (["a_faire", "en_cours", "terminee"] as const).map((state) => ({
          state,
          count: groups
            .filter((r) => r.kind === "tache" && r.state === state)
            .reduce((n, r) => n + Number(r.n), 0),
        })),
        obligations: (["a_preparer", "en_cours", "preparee"] as const).map(
          (state) => ({
            state,
            count: groups
              .filter((r) => r.kind === "obligation" && r.preparation === state)
              .reduce((n, r) => n + Number(r.n), 0),
          }),
        ),
      });
    }),
  );
}
