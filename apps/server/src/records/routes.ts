import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
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
) {
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
        resources: RecordKindSchema.options.map((kind, index) => ({
          kind,
          label: labels[kind],
          actions: (
            [
              "read",
              "create",
              "update",
              ...(kind === "tache" ? ["transition", "assign"] : []),
              ...(kind === "obligation" ? ["approve"] : []),
              "export",
              "audit",
            ] as Action[]
          ).filter((action) =>
            actor.permissions.some(
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
  const filtered = async (
    tx: Connection,
    actor: SessionUser,
    query: ReturnType<typeof RecordListQuerySchema.parse>,
    action: "read" | "export",
  ) =>
    (await listRecords(tx, actor, action))
      .filter(
        (record) =>
          (!query.kind || record.kind === query.kind) &&
          (!query.dossierId || record.dossierId === query.dossierId) &&
          (!query.q ||
            record.title
              .toLocaleLowerCase("fr")
              .includes(query.q.toLocaleLowerCase("fr"))) &&
          record.data.archived === (query.archived === "true"),
      )
      .sort(
        (a, b) =>
          a.title.localeCompare(b.title, "fr") || a.id.localeCompare(b.id),
      );
  app.get("/api/v1/records", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req);
      const query = RecordListQuerySchema.parse(req.query);
      if (
        !actor.permissions.some(
          (p) =>
            p.action === "read" &&
            (!query.kind || p.kind === "*" || p.kind === query.kind),
        )
      )
        fail(403, "FORBIDDEN", "Lecture non autorisée.");
      const all = await filtered(tx, actor, query, "read");
      return RecordListSchema.parse({
        items: all.slice(query.offset, query.offset + query.limit),
        total: all.length,
        offset: query.offset,
        limit: query.limit,
      });
    }),
  );
  app.get("/api/v1/records/export.csv", async (req, reply) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req);
      const query = RecordListQuerySchema.parse(req.query);
      if (
        !actor.permissions.some(
          (p) =>
            p.action === "export" &&
            (!query.kind || p.kind === "*" || p.kind === query.kind),
        )
      )
        fail(403, "FORBIDDEN", "Export non autorisé.");
      const records = await filtered(tx, actor, query, "export");
      const cell = (value: unknown) => {
        let s = value == null ? "" : String(value);
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        return `"${s.replaceAll('"', '""')}"`;
      };
      const rows = [
        [
          "id",
          "kind",
          "title",
          "dossierId",
          "dueDate",
          "state",
          "amount",
          "version",
          "data",
        ],
        ...records.map((r) => {
          const data = r.data;
          return [
            r.id,
            r.kind,
            r.title,
            r.dossierId,
            "dueDate" in data ? data.dueDate : "",
            "state" in data ? data.state : "",
            "amount" in data ? data.amount : "",
            r.version,
            JSON.stringify(data),
          ];
        }),
      ];
      reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", 'attachment; filename="memlia.csv"');
      return (
        "\uFEFF" +
        rows.map((row) => row.map(cell).join(";")).join("\r\n") +
        "\r\n"
      );
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
      if (!actor.permissions.some((p) => p.action === "read"))
        fail(403, "FORBIDDEN", "Lecture non autorisée.");
      const records = (await listRecords(tx, actor)).filter(
        (r) => !r.data.archived,
      );
      const counts = { dossier: 0, contact: 0, tache: 0, obligation: 0 };
      let openTasks = 0,
        overdueTasks = 0;
      for (const record of records) {
        counts[record.kind]++;
        if (record.kind === "tache" && record.data.state !== "terminee") {
          openTasks++;
          if (
            record.data.dueDate &&
            record.data.dueDate < now().toISOString().slice(0, 10)
          )
            overdueTasks++;
        }
      }
      return DashboardSchema.parse({
        asOf: now().toISOString(),
        counts,
        openTasks,
        overdueTasks,
      });
    }),
  );
}
