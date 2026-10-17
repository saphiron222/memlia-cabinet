import { loadRecord } from "../records/service.js";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import {
  ActionSchema,
  CabinetRecordSchema,
  CapabilitiesSchema,
  CapabilitiesQuerySchema,
  CreationCapabilitiesQuerySchema,
  CreationCapabilitiesSchema,
} from "@memlia/contracts";
import type { RouteContext } from "../context.js";
import { canAccess, requireAccess } from "../records/permissions.js";
export function registerCapabilitiesRoutes(
  app: FastifyInstance,
  { db, user, now }: RouteContext,
) {
  app.get("/api/v1/capabilities/records", async (req) => {
    const { ids } = CapabilitiesQuerySchema.parse(req.query);
    return db.transaction(async (tx) => {
      const actor = await user(tx, req),
        rows = await tx.query(
          "SELECT content FROM cabinet_records WHERE id=ANY($1::uuid[])",
          [ids],
        );
      const items = [];
      for (const row of rows) {
        const record = CabinetRecordSchema.parse(row.content);
        if (!(await canAccess(tx, actor, "read", record))) continue;
        const actions = [];
        for (const action of ActionSchema.options)
          if (await canAccess(tx, actor, action, record)) actions.push(action);
        items.push({ id: record.id, actions });
      }
      return CapabilitiesSchema.parse({ items });
    });
  });
  app.get("/api/v1/capabilities/create", async (req) => {
    const input = CreationCapabilitiesQuerySchema.parse(req.query);
    return db.transaction(async (tx) => {
      const actor = await user(tx, req),
        at = now().toISOString();
      if (input.id)
        await requireAccess(tx, actor, "read", await loadRecord(tx, input.id));
      const candidate = CabinetRecordSchema.parse({
        kind: input.kind,
        id: input.id ?? randomUUID(),
        version: 1,
        title: "Création",
        dossierId: input.dossierId ?? null,
        confidential: input.confidential === "true",
        data:
          input.kind === "obligation"
            ? { nature: "À préciser", period: "À préciser" }
            : {},
        createdAt: at,
        updatedAt: at,
      });
      const actions = [];
      for (const action of ActionSchema.options)
        if (await canAccess(tx, actor, action, candidate)) actions.push(action);
      return CreationCapabilitiesSchema.parse({ actions });
    });
  });
}
