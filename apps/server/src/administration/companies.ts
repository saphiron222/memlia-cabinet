import { authorizedPredicate } from "../records/query.js";
import { requireModule } from "./settings.js";
import { CompanySearch } from "./company-search.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  CompanyValuesSchema,
  DetectionSchema,
  DetectionListSchema,
  DetectionSimulationSchema,
  DetectionDecisionSchema,
  DetectionPreviewSchema,
  CompanySearchQuerySchema,
  CompanySearchResultSchema,
  ProposeCompanySchema,
  type Detection,
  type DetectionDecision,
  type SessionUser,
  type FieldOrigin,
  type CompanyValues,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import type { RouteContext } from "../context.js";
import { fail } from "../errors.js";
import { idempotent } from "../storage/operations.js";
import { loadRecord, saveRecord } from "../records/service.js";
import {
  hasPermission,
  requireGlobal,
  requireAccess,
} from "../records/permissions.js";
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
async function persist(tx: Connection, d: Detection) {
  await tx.query(
    "INSERT INTO cabinet_detections(id,source_key,content) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO UPDATE SET content=EXCLUDED.content",
    [d.id, d.sourceId, JSON.stringify(d)],
  );
  return d;
}
async function authorize(tx: Connection, actor: SessionUser, d: Detection) {
  if (
    d.actorId !== actor.id &&
    !d.scopeDossierId &&
    !hasPermission(actor, "manage_users", "*")
  )
    fail(404, "NOT_FOUND", "Ressource inaccessible.");
  if (d.scopeDossierId)
    await requireAccess(
      tx,
      actor,
      "read",
      await loadRecord(tx, d.scopeDossierId),
    );
  if (d.dossierId)
    await requireAccess(tx, actor, "read", await loadRecord(tx, d.dossierId));
}
async function load(tx: Connection, actor: SessionUser, id: string) {
  const rows = await tx.query(
    "SELECT content FROM cabinet_detections WHERE id=$1",
    [id],
  );
  if (!rows[0]) fail(404, "NOT_FOUND", "Ressource inaccessible.");
  const d = DetectionSchema.parse(rows[0].content);
  await authorize(tx, actor, d);
  return d;
}
async function preview(
  tx: Connection,
  actor: SessionUser,
  d: Detection,
  targetId?: string,
) {
  let id = targetId ?? d.dossierId;
  if (d.dossierId && targetId && d.dossierId !== targetId)
    fail(
      409,
      "SOURCE_ALREADY_LINKED",
      "Cette source est déjà rapprochée d’un autre dossier.",
    );
  if (!id && d.values.siren) {
    const matches = await tx.query(
      "SELECT id FROM cabinet_records WHERE kind='dossier' AND content->'data'->>'siren'=$1",
      [d.values.siren],
    );
    if (matches.length > 1)
      fail(409, "AMBIGUOUS_MATCH", "Rapprochement à choisir explicitement.");
    if (matches[0]) id = String(matches[0].id);
  }
  const target = id ? await loadRecord(tx, id) : null;
  if (target) {
    if (target.kind !== "dossier")
      fail(400, "INVALID_RELATION", "Dossier attendu.");
    await requireAccess(tx, actor, "read", target);
  }
  const conflicts = Object.entries(d.values)
    .filter(([key, value]) => {
      if (!target) return false;
      const current =
        key === "title"
          ? target.title
          : (target.data as Record<string, unknown>)[key];
      return (
        current !== null &&
        current !== "" &&
        current !== undefined &&
        !same(current, value)
      );
    })
    .map(([key]) => key);
  return DetectionPreviewSchema.parse({ detection: d, target, conflicts });
}
async function reconcile(
  tx: Connection,
  actor: SessionUser,
  d: Detection,
  input: DetectionDecision,
  now: Date,
) {
  const p = await preview(tx, actor, d, input.targetId);
  if (p.target && input.decision === "create")
    fail(409, "MATCH_REQUIRES_MERGE", "Un rapprochement doit être confirmé.");
  if (input.decision === "merge" && !p.target)
    fail(400, "TARGET_REQUIRED", "Choisir un dossier cible.");
  if (p.target) {
    await requireAccess(tx, actor, "update", p.target);
    if (p.target.version !== input.expectedRecordVersion)
      fail(
        409,
        "VERSION_CONFLICT",
        "Le dossier a changé. Rechargez la proposition.",
      );
  } else if (!hasPermission(actor, "create", "dossier"))
    fail(403, "FORBIDDEN", "Création non autorisée.");
  if (p.conflicts.some((key) => !input.choices[key]))
    fail(
      409,
      "SOURCE_CONFLICT",
      "Choisir explicitement les valeurs à conserver.",
    );
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(d.values))
    if (input.choices[key] !== "keep_manual") values[key] = value;
  const title =
    typeof values.title === "string"
      ? values.title
      : (p.target?.title ?? d.values.title);
  delete values.title;
  const record = {
    kind: "dossier" as const,
    title,
    confidential: p.target?.confidential ?? false,
    data: { ...(p.target?.data ?? {}), ...values },
  };
  const saved = await saveRecord(
    tx,
    actor,
    {
      operationId: randomUUID(),
      ...(p.target ? { expectedVersion: p.target.version } : {}),
      record,
    },
    now,
    p.target?.id,
    undefined,
    undefined,
    d.origin,
  );
  return persist(tx, {
    ...d,
    dossierId: saved.id,
    version: d.version + 1,
    status: "linked",
    hidden: false,
  });
}
export async function observeCompany(
  tx: Connection,
  actor: SessionUser,
  sourceId: string,
  origin: FieldOrigin,
  values: CompanyValues,
  automatic: boolean,
  now: Date,
  scopeDossierId: string | null = null,
) {
  values = CompanyValuesSchema.parse(values);
  const rows = await tx.query(
    "SELECT content FROM cabinet_detections WHERE source_key=$1",
    [sourceId],
  );
  const previous = rows[0] ? DetectionSchema.parse(rows[0].content) : null;
  if (previous) {
    await authorize(tx, actor, previous);
    if (previous.origin.version === origin.version) {
      if (!same(previous.values, values))
        fail(
          409,
          "SOURCE_VERSION_CONFLICT",
          "La version source contient des valeurs différentes.",
        );
      return previous;
    }
  }
  let d = await persist(
    tx,
    DetectionSchema.parse({
      id: previous?.id ?? randomUUID(),
      version: (previous?.version ?? 0) + 1,
      actorId: previous?.actorId ?? actor.id,
      scopeDossierId: previous?.scopeDossierId ?? scopeDossierId,
      sourceId,
      origin,
      values,
      dossierId: previous?.dossierId ?? null,
      hidden: previous?.hidden ?? false,
      automatic,
      status: previous?.status ?? "pending",
    }),
  );
  if (automatic && !d.hidden) {
    const p = await preview(tx, actor, d);
    if (p.conflicts.length)
      d = await persist(tx, { ...d, status: "needs_decision" });
    else
      d = await reconcile(
        tx,
        actor,
        d,
        {
          operationId: randomUUID(),
          expectedVersion: d.version,
          decision: p.target ? "merge" : "create",
          targetId: p.target?.id,
          expectedRecordVersion: p.target?.version,
          choices: {},
        },
        now,
      );
  }
  return d;
}
export function registerCompanyRoutes(
  app: FastifyInstance,
  { db, user, now }: RouteContext,
  origin = "https://recherche-entreprises.api.gouv.fr",
) {
  const search = new CompanySearch(origin);
  app.get(
    "/api/v1/administration/companies/search",
    { config: { rateLimit: { max: 2, timeWindow: "1 second" } } },
    async (req) => {
      const query = CompanySearchQuerySchema.parse(req.query);
      const actor = await db.transaction(async (tx) => {
        await requireModule(tx, "recherche_publique");
        return user(tx, req);
      });
      const found = await search.search(query.q, query.page),
        at = now();
      return db.transaction(async (tx) => {
        await user(tx, req);
        await requireModule(tx, "recherche_publique");
        await tx.query(
          "DELETE FROM cabinet_company_candidates WHERE expires_at<$1 OR actor_id=$2",
          [at, actor.id],
        );
        const items = [];
        for (const values of found.values) {
          const candidateId = randomUUID();
          await tx.query(
            "INSERT INTO cabinet_company_candidates(id,actor_id,expires_at,content) VALUES($1,$2,$3,$4::jsonb)",
            [
              candidateId,
              actor.id,
              new Date(at.getTime() + 600000),
              JSON.stringify({
                values,
                origin: {
                  kind: "public",
                  reference: "recherche-entreprises.api.gouv.fr",
                  version: at.toISOString(),
                  at: at.toISOString(),
                },
              }),
            ],
          );
          items.push({ candidateId, values });
        }
        return CompanySearchResultSchema.parse({
          items,
          page: found.page,
          total: found.total,
          capped: found.total >= 10000,
          observedAt: at.toISOString(),
        });
      });
    },
  );
  app.post("/api/v1/administration/companies/propose", async (req) => {
    const input = ProposeCompanySchema.parse(req.body);
    return db.transaction(async (tx) => {
      await requireModule(tx, "recherche_publique");
      const actor = await user(tx, req);
      if (!hasPermission(actor, "create", "dossier"))
        fail(403, "FORBIDDEN", "Création non autorisée.");
      return idempotent(
        tx,
        actor,
        input.operationId,
        { action: "company.propose", input },
        async () => {
          const rows = await tx.query(
            "SELECT content FROM cabinet_company_candidates WHERE id=$1 AND actor_id=$2 AND expires_at>$3",
            [input.candidateId, actor.id, now()],
          );
          if (!rows[0])
            fail(409, "SEARCH_EXPIRED", "Relancer la recherche publique.");
          const value = rows[0].content as {
            values: CompanyValues;
            origin: FieldOrigin;
          };
          return observeCompany(
            tx,
            actor,
            "public:" + value.values.siren,
            value.origin,
            value.values,
            false,
            now(),
          );
        },
      );
    });
  });
  app.post("/api/v1/administration/detections/simulate", async (req, reply) => {
    const input = DetectionSimulationSchema.parse(req.body);
    const d = await db.transaction(async (tx) => {
      const actor = await user(tx, req);
      requireGlobal(actor, "manage_users");
      return idempotent(
        tx,
        actor,
        input.operationId,
        { action: "detection.simulate", input },
        () =>
          observeCompany(
            tx,
            actor,
            "simulation:" + input.sourceId,
            {
              kind: "simulated",
              reference: input.sourceId,
              version: input.sourceVersion,
              at: now().toISOString(),
            },
            input.values,
            input.automatic,
            now(),
          ),
      );
    });
    reply.code(201);
    return d;
  });
  app.get("/api/v1/administration/detections", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req),
        query = z
          .object({
            hidden: z.enum(["true", "false"]).default("false"),
            offset: z.coerce.number().int().min(0).default(0),
          })
          .strict()
          .parse(req.query);
      const params: unknown[] = [
        query.hidden,
        actor.id,
        hasPermission(actor, "manage_users", "*"),
      ];
      const parameter = (value: unknown) => {
        params.push(value);
        return "$" + params.length;
      };
      const predicate = authorizedPredicate(actor, "read", parameter);
      const access = (field: string) =>
        `(d.content->>'${field}' IS NULL OR EXISTS(SELECT 1 FROM cabinet_records r WHERE r.id=(d.content->>'${field}')::uuid AND ${predicate}))`;
      const where = `d.content->>'hidden'=$1 AND ((d.content->>'actorId')::uuid=$2 OR $3::boolean OR d.content->>'scopeDossierId' IS NOT NULL) AND ${access("scopeDossierId")} AND ${access("dossierId")}`;
      const count = await tx.query(
        `SELECT count(*) AS n FROM cabinet_detections d WHERE ${where}`,
        params,
      );
      params.push(query.offset);
      const rows = await tx.query(
        `SELECT d.content FROM cabinet_detections d WHERE ${where} ORDER BY d.id OFFSET $${params.length} LIMIT 200`,
        params,
      );
      return DetectionListSchema.parse({
        items: rows.map((r) => r.content),
        total: Number(count[0]!.n),
        offset: query.offset,
      });
    }),
  );
  app.get("/api/v1/administration/detections/:id/preview", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req),
        id = z.object({ id: z.uuid() }).parse(req.params).id;
      const query = z
        .object({ targetId: z.uuid().optional() })
        .strict()
        .parse(req.query);
      return preview(tx, actor, await load(tx, actor, id), query.targetId);
    }),
  );
  app.post("/api/v1/administration/detections/:id/decide", async (req) => {
    const input = DetectionDecisionSchema.parse(req.body),
      id = z.object({ id: z.uuid() }).parse(req.params).id;
    return db.transaction(async (tx) => {
      const actor = await user(tx, req),
        d = await load(tx, actor, id);
      if (d.dossierId)
        await requireAccess(
          tx,
          actor,
          "update",
          await loadRecord(tx, d.dossierId),
        );
      else if (input.decision === "merge" && input.targetId)
        await requireAccess(
          tx,
          actor,
          "update",
          await loadRecord(tx, input.targetId),
        );
      else if (!hasPermission(actor, "create", "dossier"))
        fail(403, "FORBIDDEN", "Décision non autorisée.");
      return idempotent(
        tx,
        actor,
        input.operationId,
        { action: "detection.decide", id, input },
        async () => {
          if (d.version !== input.expectedVersion)
            fail(409, "VERSION_CONFLICT", "La proposition a changé.");
          const result =
            input.decision === "hide" || input.decision === "restore"
              ? await persist(tx, {
                  ...d,
                  version: d.version + 1,
                  hidden: input.decision === "hide",
                })
              : await reconcile(tx, actor, d, input, now());
          await tx.query(
            "INSERT INTO cabinet_identity_events(id,actor_id,event) VALUES($1,$2,$3::jsonb)",
            [
              input.operationId,
              actor.id,
              JSON.stringify({
                action: "detection.decided",
                detectionId: d.id,
                decision: input.decision,
                version: result.version,
                at: now().toISOString(),
              }),
            ],
          );
          return result;
        },
      );
    });
  });
}
