import { requireAccess } from "../records/permissions.js";
import { FiscalResponsiblesSchema } from "@memlia/contracts";
import { preparationDocument } from "./preparation-document.js";
import type { DocumentStore } from "../documents/store.js";
import { generateFiscal, bulkFiscal } from "./batches.js";
import { queryRecords, authorizedPredicate } from "../records/query.js";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  deriveSourceFreshness,
  type FiscalDetail,
  FiscalCreateSchema,
  FiscalMatrixSchema,
  FiscalCommandSchema,
  FiscalGenerationSchema,
  FiscalBulkSchema,
  RecordListQuerySchema,
  RecordListSchema,
} from "@memlia/contracts";
import type { RouteContext } from "../context.js";
import { createFiscal, commandFiscal, fiscalDetail } from "./service.js";
export function registerFiscalRoutes(
  app: FastifyInstance,
  { db, user, now }: RouteContext,
  documents: DocumentStore,
  civilDate: (instant: Date) => string,
) {
  const localize = (detail: FiscalDetail) => ({
    ...detail,
    freshness: deriveSourceFreshness(
      detail.record.data.sourceEvidence,
      new Date(detail.freshness.asOf),
      civilDate(new Date(detail.freshness.asOf)),
    ),
  });
  const id = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;
  app.get("/api/v1/fiscal", async (req) =>
    db.transaction(async (tx) =>
      RecordListSchema.parse(
        await queryRecords(
          tx,
          await user(tx, req),
          RecordListQuerySchema.parse({
            ...(req.query as object),
            kind: "obligation",
            fiscalOnly: "true",
          }),
        ),
      ),
    ),
  );
  // Dossier pagination and occurrence coverage are separate: empty visible cells never
  // claim the absence of unauthorized or unobserved supplier data.
  app.get("/api/v1/fiscal/matrix", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req);
      const query = RecordListQuerySchema.parse(req.query);
      const dossiers = await queryRecords(
        tx,
        actor,
        RecordListQuerySchema.parse({
          kind: "dossier",
          q: query.dossierQuery,
          dossierId: query.dossierId,
          own: query.own,
          archived: query.archived,
          offset: query.offset,
          limit: Math.min(query.limit, 50),
        }),
      );
      const rows = [];
      for (const dossier of dossiers.items) {
        const occurrences = await queryRecords(
          tx,
          actor,
          RecordListQuerySchema.parse({
            ...query,
            kind: "obligation",
            fiscalOnly: "true",
            dossierId: dossier.id,
            offset: 0,
            limit: 200,
          }),
        );
        rows.push({
          dossier,
          occurrences: occurrences.items,
          total: occurrences.total,
          complete: occurrences.total <= occurrences.items.length,
        });
      }
      return FiscalMatrixSchema.parse({
        rows,
        total: dossiers.total,
        offset: dossiers.offset,
        limit: dossiers.limit,
      });
    }),
  );
  app.get("/api/v1/fiscal/responsibles", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req),
        query = z
          .object({
            q: z.string().max(200).default(""),
            offset: z.coerce.number().int().nonnegative().default(0),
          })
          .strict()
          .parse(req.query),
        params: unknown[] = [];
      const parameter = (v: unknown) => {
        params.push(v);
        return "$" + params.length;
      };
      const predicate = authorizedPredicate(actor, "read", parameter),
        pattern = parameter("%" + query.q.replace(/[\\%_]/g, "\\$&") + "%");
      const where = `u.name ILIKE ${pattern} AND EXISTS(SELECT 1 FROM cabinet_records r WHERE r.kind='obligation' AND r.content->'data'->'fiscal' IS NOT NULL AND COALESCE(r.content->'data'->'fiscal'->'responsibleIds','[]'::jsonb) ? u.id::text AND ${predicate})`;
      const count = await tx.query(
        `SELECT count(*)::integer AS total FROM cabinet_users u WHERE ${where}`,
        params,
      );
      const offset = parameter(query.offset);
      const items = await tx.query(
        `SELECT u.id,u.name FROM cabinet_users u WHERE ${where} ORDER BY u.name,u.id LIMIT 100 OFFSET ${offset}`,
        params,
      );
      return FiscalResponsiblesSchema.parse({ items, total: count[0]!.total });
    }),
  );
  app.post("/api/v1/fiscal/:id/preparation-document", async (req, reply) =>
    reply.code(201).send(
      await db.transaction(async (tx) =>
        preparationDocument(
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
          documents,
          now(),
        ).then((result) => ({ ...result, detail: localize(result.detail) })),
      ),
    ),
  );
  app.post("/api/v1/fiscal/generate", async (req) =>
    db.transaction(async (tx) =>
      generateFiscal(
        tx,
        await user(tx, req),
        FiscalGenerationSchema.parse(req.body),
        now(),
      ),
    ),
  );
  app.post("/api/v1/fiscal/bulk", async (req) =>
    db.transaction(async (tx) =>
      bulkFiscal(
        tx,
        await user(tx, req),
        FiscalBulkSchema.parse(req.body),
        now(),
      ),
    ),
  );
  app.post("/api/v1/fiscal", async (req, reply) =>
    reply
      .code(201)
      .send(
        await db.transaction(async (tx) =>
          createFiscal(
            tx,
            await user(tx, req),
            FiscalCreateSchema.parse(req.body),
            now(),
          ).then(localize),
        ),
      ),
  );
  app.get("/api/v1/fiscal/:id/responsibles", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req),
        detail = await fiscalDetail(tx, actor, id(req.params), now());
      await requireAccess(tx, actor, "assign", detail.record);
      const query = z
        .object({
          q: z.string().max(200).default(""),
          offset: z.coerce.number().int().nonnegative().default(0),
        })
        .strict()
        .parse(req.query);
      const pattern = "%" + query.q.replace(/[\\%_]/g, "\\$&") + "%";
      const items = await tx.query(
        "SELECT id,name FROM cabinet_users WHERE active=true AND name ILIKE $1 ORDER BY name,id LIMIT 100 OFFSET $2",
        [pattern, query.offset],
      );
      const count = await tx.query(
        "SELECT count(*)::integer AS total FROM cabinet_users WHERE active=true AND name ILIKE $1",
        [pattern],
      );
      return FiscalResponsiblesSchema.parse({ items, total: count[0]!.total });
    }),
  );
  app.get("/api/v1/fiscal/:id", async (req) =>
    db.transaction(async (tx) =>
      fiscalDetail(
        tx,
        await user(tx, req),
        id(req.params),
        now(),
        civilDate(now()),
      ),
    ),
  );
  app.post("/api/v1/fiscal/:id/commands", async (req) =>
    db.transaction(async (tx) =>
      commandFiscal(
        tx,
        await user(tx, req),
        id(req.params),
        FiscalCommandSchema.parse(req.body),
        now(),
      ).then(localize),
    ),
  );
}
