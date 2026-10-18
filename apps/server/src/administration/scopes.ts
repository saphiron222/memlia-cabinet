import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RecordScopesSchema, RecordListQuerySchema } from "@memlia/contracts";
import type { RouteContext } from "../context.js";
import { queryRecords, recordFilter } from "../records/query.js";
export function registerScopeRoutes(
  app: FastifyInstance,
  { db, user }: RouteContext,
) {
  app.get("/api/v1/administration/scopes", async (req) => {
    const query = z
      .object({
        kind: z.enum(["dossier", "group"]),
        q: z.string().max(300).default(""),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .strict()
      .parse(req.query);
    return db.transaction(async (tx) => {
      const actor = await user(tx, req);
      if (query.kind === "dossier") {
        const result = await queryRecords(
          tx,
          actor,
          RecordListQuerySchema.parse({
            kind: "dossier",
            q: query.q,
            offset: query.offset,
            limit: 100,
          }),
        );
        return RecordScopesSchema.parse({
          ...result,
          items: result.items.map((r) => ({
            id: r.id,
            title: r.title,
            kind: "dossier",
          })),
        });
      }
      const f = recordFilter(
        actor,
        RecordListQuerySchema.parse({ kind: "dossier" }),
        "read",
      );
      const params = [
        ...f.params,
        "%" + query.q.toLocaleLowerCase("fr").replace(/[\\%_]/g, "\\$&") + "%",
      ];
      const filter = `lower(g.content->>'name') LIKE $${params.length} AND EXISTS(SELECT 1 FROM cabinet_assignments a JOIN cabinet_records r ON r.id=a.dossier_id WHERE a.subject_id=g.id AND a.subject_kind IN ('team','site') AND ${f.where})`;
      const count = await tx.query(
        `SELECT count(*) AS total FROM cabinet_groups g WHERE ${filter}`,
        params,
      );
      params.push(query.offset);
      const groups = await tx.query(
        `SELECT id,content FROM cabinet_groups g WHERE ${filter} ORDER BY g.content->>'name',g.id OFFSET $${params.length} LIMIT 100`,
        params,
      );
      return RecordScopesSchema.parse({
        items: groups.map((g) => ({
          id: g.id,
          title: (g.content as { name: string }).name,
          kind: (g.content as { kind: string }).kind,
        })),
        offset: query.offset,
        total: Number(count[0]!.total),
      });
    });
  });
}
