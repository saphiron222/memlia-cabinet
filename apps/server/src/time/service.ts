import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  TimeEntitySchema,
  TimeSaveSchema,
  TimePlanSchema,
  type TimeEntity,
  type TimeData,
  type TimeQuery,
  type SessionUser,
  CabinetRecordSchema,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import {
  hasPermission,
  requireGlobal,
  requireAccess,
} from "../records/permissions.js";
import { recordAccessScope } from "../records/access-scope.js";
import { productionScopePredicate } from "../production/query.js";
import { loadProductionRow } from "../production/service.js";
import { loadRecord } from "../records/service.js";
import { idempotent } from "../storage/operations.js";
import { fail } from "../errors.js";
import { scopeReferences, type ScopeSelection } from "./scope-references.js";
export const manages = (a: SessionUser) => hasPermission(a, "time_manage", "*");
export const readsOthers = (a: SessionUser) =>
  hasPermission(a, "time_read", "*");
export async function scopeCte(
  tx: Connection,
  actor: SessionUser,
  p: (v: unknown) => string,
  selection: ScopeSelection,
  action: "read" | "export" = "read",
) {
  // Recomputed within the caller's serialized transaction, without a rights
  // cache. Empty or small dependency sets must not plan every cabinet object.
  const refs = await scopeReferences(tx, selection);
  const access = await recordAccessScope(tx, actor, action, p, refs);
  const production = refs.production.length
    ? `p.id=ANY(${p(refs.production)}::uuid[]) AND ${productionScopePredicate(actor, action, p, "p.content", access)}`
    : "FALSE";
  return `WITH ${access.ctes}, time_readable_records AS MATERIALIZED (SELECT (identity #>> '{}')::uuid id FROM access_allowed WHERE category='record'), time_readable_production AS MATERIALIZED (SELECT p.id FROM cabinet_production_rows p WHERE ${production})`;
}
export function scope(
  actor: SessionUser,
  p: (v: unknown) => string,
  s = "t.content",
  action: "read" | "export" = "read",
) {
  const d = `${s}->'data'`;
  // This set already proves existence and canonical access. Direct membership
  // lets SQL hash it once instead of rescanning it for each current/history row.
  const rec = (id: string) =>
    `COALESCE((${id})::uuid IN (SELECT id FROM time_readable_records),FALSE)`;
  const prod = (id: string) =>
    `EXISTS(SELECT 1 FROM cabinet_production_rows p WHERE p.id=(${id})::uuid AND p.id IN (SELECT id FROM time_readable_production))`;
  const link = (v: string) =>
    `CASE ${v}->>'kind' WHEN 'record' THEN ${rec(`${v}->>'id'`)} WHEN 'production' THEN ${prod(`${v}->>'id'`)} ELSE TRUE END`;
  return `((${d}->>'userId' IS NULL OR ${d}->>'userId'=${p(actor.id)} OR ${readsOthers(actor)}) AND (${readsOthers(actor)} OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(${d}->'weights','[]'::jsonb)) w WHERE w->>'userId'<>${p(actor.id)})) AND (${d}->>'dossierId' IS NULL OR ${rec(`${d}->>'dossierId'`)}) AND ${link(`${d}->'link'`)} AND ${link(`${d}->'target'`)} AND CASE WHEN ${d}->>'kind'='plan' AND ${d}->>'level'<>'cabinet' THEN CASE WHEN ${d}->>'level'='production' THEN ${prod(`${d}->>'targetId'`)} ELSE ${rec(`${d}->>'targetId'`)} END ELSE TRUE END)`;
}
export function fullScope(
  actor: SessionUser,
  p: (v: unknown) => string,
  s = "t.content",
  action: "read" | "export" = "read",
) {
  return `(${scope(actor, p, s, action)} AND NOT EXISTS(SELECT 1 FROM cabinet_time_history h WHERE h.id=(${s}->>'id')::uuid AND NOT ${scope(actor, p, "h.content", action)}))`;
}
async function entityRows(
  tx: Connection,
  actor: SessionUser,
  kind?: string,
  action: "read" | "export" = "read",
  dates?: { from: string; to: string },
  selection?: {
    active?: "true" | "false";
    userId?: string;
    referenceId?: string;
    where?: (p: (v: unknown) => string) => string;
    offset?: number;
    limit?: number;
    count?: boolean;
  },
) {
  const params: unknown[] = [],
    p = (v: unknown) => {
      params.push(v);
      return "$" + params.length;
    };
  const selected = selection
    ? [
        selection.where ? selection.where(p) : "TRUE",
        selection.active
          ? `t.kind='timer' AND (t.content->'data'->>'stoppedAt' IS NULL)=${p(selection.active === "true")}`
          : "TRUE",
        selection.userId
          ? `t.content->'data'->>'userId'=${p(selection.userId)}`
          : "TRUE",
        selection.referenceId
          ? `(t.content->'data'->'target'->>'id'=${p(selection.referenceId)} OR t.content->'data'->>'dossierId'=${p(selection.referenceId)})`
          : "TRUE",
      ].join(" AND ")
    : "TRUE";
  const candidates = `${selected}${kind ? ` AND t.kind=${p(kind)}` : " AND t.kind NOT IN('entry','timer')"}${dates ? ` AND t.content->'data'->>'date'>=${p(dates.from)} AND t.content->'data'->>'date'<=${p(dates.to)}` : ""}`;
  const cte = await scopeCte(
    tx,
    actor,
    p,
    {
      kind: "time",
      sql: `SELECT t.content FROM cabinet_time t WHERE ${candidates}`,
      params: [...params],
    },
    action,
  );
  const filter = fullScope(actor, p, "t.content", action);
  const rows = await tx.query(
    `${cte} SELECT t.content${selection?.count ? ", count(*) OVER() AS total" : ""} FROM cabinet_time t WHERE ${filter} AND ${candidates} ORDER BY t.id LIMIT ${p(selection?.limit ?? 20001)} OFFSET ${p(selection?.offset ?? 0)}`,
    params,
  );
  if (rows.length > 20000)
    fail(422, "PERIOD_TOO_LARGE", "Réduisez le périmètre de configuration.");
  return rows;
}
export async function entities(...args: Parameters<typeof entityRows>) {
  return (await entityRows(...args)).map((r) =>
    TimeEntitySchema.parse(r.content),
  );
}
export async function entityPage(
  tx: Connection,
  actor: SessionUser,
  kind: string | undefined,
  selection: NonNullable<Parameters<typeof entityRows>[5]>,
) {
  const offset = selection.offset ?? 0;
  const rows = await entityRows(tx, actor, kind, "read", undefined, {
    ...selection,
    limit: 100,
    count: true,
  });
  const first =
    rows[0] ??
    (offset > 0
      ? (
          await entityRows(tx, actor, kind, "read", undefined, {
            ...selection,
            offset: 0,
            limit: 1,
            count: true,
          })
        )[0]
      : undefined);
  const total = Number(first?.total ?? 0);
  return {
    items: rows.map((r) => TimeEntitySchema.parse(r.content)),
    total,
    offset,
    hasMore: offset + rows.length < total,
  };
}
export async function load(tx: Connection, actor: SessionUser, id: string) {
  const params: unknown[] = [id],
    p = (v: unknown) => {
      params.push(v);
      return "$" + params.length;
    };
  const cte = await scopeCte(tx, actor, p, {
    kind: "time",
    sql: "SELECT content FROM cabinet_time WHERE id=$1",
    params: [id],
  });
  const rows = await tx.query(
    `${cte} SELECT t.content FROM cabinet_time t WHERE t.id=$1 AND ${fullScope(actor, p)}`,
    params,
  );
  if (!rows[0]) fail(404, "NOT_FOUND", "Temps inaccessible.");
  return TimeEntitySchema.parse(rows[0].content);
}
export async function authorize(
  tx: Connection,
  actor: SessionUser,
  e: TimeEntity,
  action: "read" | "export" = "read",
) {
  const params: unknown[] = [JSON.stringify(e)],
    p = (v: unknown) => {
      params.push(v);
      return "$" + params.length;
    };
  const cte = await scopeCte(
    tx,
    actor,
    p,
    {
      kind: "time",
      sql: "SELECT $1::jsonb content",
      params: [...params],
    },
    action,
  );
  const r = await tx.query(
    `${cte} SELECT ${scope(actor, p, "$1::jsonb", action)} allowed`,
    params,
  );
  if (r[0]?.allowed !== true) fail(404, "NOT_FOUND", "Temps inaccessible.");
}
export async function store(tx: Connection, e: TimeEntity) {
  await tx.query(
    "INSERT INTO cabinet_time(id,kind,content) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO UPDATE SET content=excluded.content",
    [e.id, e.data.kind, JSON.stringify(e)],
  );
  await tx.query(
    "INSERT INTO cabinet_time_history(id,version,content) VALUES($1,$2,$3::jsonb)",
    [e.id, e.version, JSON.stringify(e)],
  );
  return e;
}
function range(d: TimeData) {
  return "date" in d
    ? { from: d.date, to: d.date }
    : "from" in d
      ? { from: d.from, to: d.to ?? "9999-12-31" }
      : null;
}
export async function openPeriod(tx: Connection, d: TimeData) {
  const r = range(d);
  if (!r) return;
  const rows = await tx.query(
    "SELECT id FROM cabinet_time WHERE kind='period' AND content->'data'->>'closed'='true' AND content->'data'->>'from'<=$2 AND content->'data'->>'to'>=$1 LIMIT 1",
    [r.from, r.to],
  );
  if (rows.length)
    fail(
      409,
      "PERIOD_CLOSED",
      "Période verrouillée. Une réouverture autorisée est nécessaire.",
    );
}
export async function activeNature(
  tx: Connection,
  actor: SessionUser,
  id: string,
) {
  const n = await load(tx, actor, id);
  if (n.data.kind !== "nature" || !n.data.active)
    fail(409, "INACTIVE_NATURE", "Choisissez une nature active.");
}
async function validate(tx: Connection, actor: SessionUser, d: TimeData) {
  if ("from" in d && d.to && d.from > d.to)
    fail(400, "INVALID_PERIOD", "La fin précède le début.");
  if (d.kind === "plan" && (d.level === "cabinet") !== (d.targetId === null))
    fail(400, "INVALID_SCOPE", "Portée de prévision invalide.");
  for (const userId of new Set([
    ...("userId" in d && d.userId ? [d.userId] : []),
    ...(d.kind === "allocation" ? d.weights.map((w) => w.userId) : []),
  ])) {
    if (
      !(
        await tx.query(
          "SELECT id FROM cabinet_users WHERE id=$1 AND active=true",
          [userId],
        )
      ).length
    )
      fail(404, "NOT_FOUND", "Utilisateur inaccessible.");
  }
  if (d.kind === "assignment" || d.kind === "forfait") {
    if (
      !(await tx.query("SELECT id FROM cabinet_roles WHERE id=$1", [d.roleId]))
        .length
    )
      fail(404, "NOT_FOUND", "Rôle inaccessible.");
    const dossier = await loadRecord(tx, d.dossierId);
    if (dossier.kind !== "dossier")
      fail(400, "INVALID_SCOPE", "Dossier attendu.");
  }
  if (
    d.kind === "allocation" &&
    new Set(d.weights.map((w) => w.userId)).size !== d.weights.length
  )
    fail(400, "DUPLICATE_USER", "Un seul poids par utilisateur.");
  if (d.kind === "entry" || d.kind === "timer") {
    await activeNature(tx, actor, d.natureId);
    if (d.link.kind === "record")
      await requireAccess(tx, actor, "read", await loadRecord(tx, d.link.id));
    if (d.link.kind === "production")
      await loadProductionRow(tx, actor, d.link.id);
  }
}
export async function save(
  tx: Connection,
  actor: SessionUser,
  i: z.infer<typeof TimeSaveSchema>,
  now: Date,
) {
  const raw = await tx.query("SELECT content FROM cabinet_time WHERE id=$1", [
    i.id,
  ]);
  const old = raw[0] ? await load(tx, actor, i.id) : null;
  if (
    i.data.kind === "timer" ||
    (i.data.kind === "entry" && i.data.source === "timer")
  )
    fail(
      400,
      "TIMER_COMMAND_REQUIRED",
      "Utilisez les commandes du chronomètre.",
    );
  if (old?.data.kind === "entry" && old.data.source === "timer")
    fail(
      409,
      "TIMER_IMMUTABLE",
      "Une saisie issue du chronomètre conserve sa mesure originale.",
    );
  if (i.data.kind === "period") requireGlobal(actor, "time_lock");
  else if (i.data.kind !== "entry") requireGlobal(actor, "time_manage");
  else if (i.data.userId !== actor.id) requireGlobal(actor, "time_manage");
  const prior = i.expectedVersion
    ? (
        await tx.query(
          "SELECT content FROM cabinet_time_history WHERE id=$1 AND version=$2",
          [i.id, i.expectedVersion],
        )
      )[0]?.content
    : null;
  for (const owner of [old, prior ? TimeEntitySchema.parse(prior) : null])
    if (owner?.data.kind === "entry" && owner.data.userId !== actor.id)
      requireGlobal(actor, "time_manage");
  const candidate = TimeEntitySchema.parse({
    id: i.id,
    version: i.expectedVersion + 1,
    actorId: actor.id,
    updatedAt: now.toISOString(),
    data: i.data,
  });
  await authorize(tx, actor, candidate);
  const result = await idempotent(
    tx,
    actor,
    i.operationId,
    { time: i },
    async () => {
      if ((old?.version ?? 0) !== i.expectedVersion)
        fail(409, "VERSION_CONFLICT", "La valeur a changé. Rechargez.");
      if (old && old.data.kind !== i.data.kind)
        fail(409, "IMMUTABLE_KIND", "Nature de configuration immuable.");
      await validate(tx, actor, i.data);
      if (i.data.kind !== "period") {
        await openPeriod(tx, i.data);
        if (old) await openPeriod(tx, old.data);
      }
      if (i.data.kind === "period" && i.data.closed) {
        const running = await tx.query(
          "SELECT id FROM cabinet_time WHERE kind='timer' AND content->'data'->>'stoppedAt' IS NULL AND content->'data'->>'date'>=$1 AND content->'data'->>'date'<=$2 LIMIT 1",
          [i.data.from, i.data.to],
        );
        if (running.length)
          fail(
            409,
            "ACTIVE_TIMER",
            "Arrêtez les chronomètres avant la clôture.",
          );
      }
      if (i.data.kind === "entry") {
        candidate.data = {
          ...i.data,
          rate: await rateAt(tx, actor, i.data.userId, i.data.date),
          timerId: null,
        };
      }
      const d = i.data;
      if (
        [
          "plan",
          "capacity",
          "rate",
          "forfait",
          "assignment",
          "allocation",
        ].includes(d.kind)
      ) {
        const identity =
          d.kind === "plan"
            ? { level: d.level, targetId: d.targetId }
            : d.kind === "rate" || d.kind === "capacity"
              ? { userId: d.userId }
              : d.kind === "forfait"
                ? { dossierId: d.dossierId, roleId: d.roleId }
                : d.kind === "assignment"
                  ? {
                      dossierId: d.dossierId,
                      roleId: d.roleId,
                      userId: d.userId,
                    }
                  : d.kind === "allocation"
                    ? { target: d.target }
                    : {};
        const same = (
          await entities(tx, actor, d.kind, "read", undefined, {
            where: (p) =>
              `t.id<>${p(i.id)}::uuid AND t.content->'data' @> ${p(JSON.stringify(identity))}::jsonb${range(d) ? ` AND t.content->'data'->>'from'<=${p(range(d)!.to)} AND COALESCE(t.content->'data'->>'to','9999-12-31')>=${p(range(d)!.from)}` : ""}`,
            limit: 1,
          })
        )
          .filter((e) => e.id !== i.id)
          .filter((e) => {
            const a = e.data;
            if (a.kind !== d.kind) return false;
            if (a.kind === "plan" && d.kind === "plan")
              return a.level === d.level && a.targetId === d.targetId;
            if (
              (a.kind === "capacity" || a.kind === "rate") &&
              (d.kind === "capacity" || d.kind === "rate")
            )
              return a.userId === d.userId;
            if (a.kind === "forfait" && d.kind === "forfait")
              return a.dossierId === d.dossierId && a.roleId === d.roleId;
            if (a.kind === "assignment" && d.kind === "assignment")
              return (
                a.dossierId === d.dossierId &&
                a.roleId === d.roleId &&
                a.userId === d.userId
              );
            if (a.kind === "allocation" && d.kind === "allocation")
              return (
                a.target.kind === d.target.kind && a.target.id === d.target.id
              );
            return false;
          });
        if (
          same.some((e) => {
            const a = range(e.data),
              b = range(d);
            return !a || !b || (a.from <= b.to && b.from <= a.to);
          })
        )
          fail(
            409,
            "OVERLAPPING_CONFIGURATION",
            "Une configuration de même portée existe sur cette période.",
          );
      }
      return store(tx, candidate);
    },
  );
  await authorize(tx, actor, result);
  await load(tx, actor, result.id);
  return result;
}
export async function rateAt(
  tx: Connection,
  actor: SessionUser,
  userId: string,
  date: string,
) {
  const rates = (
    await entities(tx, actor, "rate", "read", undefined, {
      where: (p) =>
        `(t.content->'data'->>'userId' IS NULL OR t.content->'data'->>'userId'=${p(userId)}) AND t.content->'data'->>'from'<=${p(date)} AND (t.content->'data'->>'to' IS NULL OR t.content->'data'->>'to'>=${p(date)})`,
    })
  ).filter(
    (e) =>
      e.data.kind === "rate" &&
      (e.data.userId === null || e.data.userId === userId) &&
      e.data.from <= date &&
      (!e.data.to || e.data.to >= date),
  );
  rates.sort(
    (a, b) =>
      Number((b.data as { userId: string | null }).userId !== null) -
      Number((a.data as { userId: string | null }).userId !== null),
  );
  const r = rates[0];
  return r && r.data.kind === "rate"
    ? {
        id: r.id,
        version: r.version,
        hourlyAmount: r.data.hourlyAmount,
        currency: r.data.currency,
      }
    : null;
}
export async function effectivePlan(
  tx: Connection,
  actor: SessionUser,
  recordId: string,
  plansInput?: TimeEntity[],
) {
  const r = await loadRecord(tx, recordId);
  await requireAccess(tx, actor, "read", r);
  const plans =
    plansInput ??
    (await entities(tx, actor, "plan", "read", undefined, {
      where: (p) =>
        `(t.content->'data'->>'level'='cabinet' OR t.content->'data'->>'targetId'=ANY(${p([r.id, r.kind === "dossier" ? r.id : r.dossierId].filter(Boolean))}::text[]))`,
    }));
  const explicit = (level: string, targetId: string | null) =>
    plans.find(
      (e) =>
        e.data.kind === "plan" &&
        e.data.level === level &&
        e.data.targetId === targetId &&
        e.data.minutes !== null,
    );
  const e = explicit("occurrence", r.id);
  if (!e && r.kind === "tache" && r.data.plannedMinutes !== null)
    return TimePlanSchema.parse({
      minutes: r.data.plannedMinutes,
      source: "task",
      sourceId: r.id,
      version: r.version,
      override: true,
      component: "variable",
      explanation: "Prévision explicite de la tâche canonique.",
    });
  const chosen =
    e ??
    explicit("dossier", r.kind === "dossier" ? r.id : r.dossierId) ??
    explicit("cabinet", null);
  if (!chosen || chosen.data.kind !== "plan")
    return TimePlanSchema.parse({
      minutes: null,
      source: "unknown",
      sourceId: null,
      version: null,
      override: false,
      component: "variable",
      explanation: "Aucune prévision renseignée.",
    });
  return TimePlanSchema.parse({
    minutes: chosen.data.minutes,
    source: chosen.data.level,
    sourceId: chosen.id,
    version: chosen.version,
    override: !!e,
    component: chosen.data.component,
    explanation: `${e ? "Surcharge explicite" : "Héritage actuel"} : ${chosen.data.level}, version ${chosen.version}.`,
  });
}
export function period(q: TimeQuery) {
  if (q.from > q.to || Date.parse(q.to) - Date.parse(q.from) > 366 * 86400000)
    fail(400, "INVALID_PERIOD", "Choisissez une période de 367 jours maximum.");
}
// A stored query must remain authorized even when it has no prepared rows.
// Callers that only revalidate an exit need these checks, not a new report of
// unrelated current totals. Retain the record plan's read checks and bounds.
export async function authorizeTimeQuery(
  tx: Connection,
  actor: SessionUser,
  q: TimeQuery,
  action: "read" | "export" = "read",
) {
  period(q);
  if (q.userId && q.userId !== actor.id && !readsOthers(actor))
    fail(404, "NOT_FOUND", "Utilisateur inaccessible.");
  if (action === "export") requireGlobal(actor, "export");
  if (q.recordId)
    await requireAccess(tx, actor, action, await loadRecord(tx, q.recordId));
  if (q.dossierId)
    await requireAccess(tx, actor, action, await loadRecord(tx, q.dossierId));
  return q.recordId ? effectivePlan(tx, actor, q.recordId) : null;
}
export async function report(
  tx: Connection,
  actor: SessionUser,
  q: TimeQuery,
  action: "read" | "export" = "read",
) {
  const planned = await authorizeTimeQuery(tx, actor, q, action);
  const params: unknown[] = [q.from, q.to],
    p = (v: unknown) => {
      params.push(v);
      return "$" + params.length;
    };
  const filters = [
    "t.kind='entry'",
    "t.content->'data'->>'date'>=$1",
    "t.content->'data'->>'date'<=$2",
  ];
  if (q.userId) filters.push(`t.content->'data'->>'userId'=${p(q.userId)}`);
  if (q.natureId)
    filters.push(`t.content->'data'->>'natureId'=${p(q.natureId)}`);
  if (q.recordId) {
    filters.push(
      `t.content->'data'->'link'->>'kind'='record' AND t.content->'data'->'link'->>'id'=${p(q.recordId)}`,
    );
  }
  if (q.dossierId) {
    const dossier = p(q.dossierId);
    filters.push(
      `(CASE t.content->'data'->'link'->>'kind' WHEN 'record' THEN EXISTS(SELECT 1 FROM cabinet_records r WHERE r.id=(t.content->'data'->'link'->>'id')::uuid AND (r.id=${dossier}::uuid OR r.content->>'dossierId'=${dossier}::text)) WHEN 'production' THEN EXISTS(SELECT 1 FROM cabinet_production_rows pr LEFT JOIN cabinet_records related ON related.id=pr.record_id WHERE pr.id=(t.content->'data'->'link'->>'id')::uuid AND ((pr.content->'target'->>'kind'='dossier' AND pr.content->'target'->>'id'=${dossier}::text) OR related.content->>'dossierId'=${dossier}::text OR pr.content->'scope'->>'id'=${dossier}::text)) ELSE FALSE END)`,
    );
  }
  if (q.groupId)
    filters.push(
      `EXISTS(SELECT 1 FROM cabinet_memberships m WHERE m.group_id=${p(q.groupId)}::uuid AND m.user_id=(t.content->'data'->>'userId')::uuid)`,
    );
  const candidates = filters.join(" AND ");
  const cte = await scopeCte(
    tx,
    actor,
    p,
    {
      kind: "time",
      sql: `SELECT t.content FROM cabinet_time t WHERE ${candidates}`,
      params: [...params],
    },
    action,
  );
  const where = `${candidates} AND ${fullScope(actor, p, "t.content", action)}`;
  const totals = (
    await tx.query(
      `${cte} SELECT count(*) total,COALESCE(sum((t.content->'data'->>'seconds')::bigint),0) seconds,COALESCE(sum(CASE WHEN t.content->'data'->'rate'->>'hourlyAmount' IS NULL THEN (t.content->'data'->>'seconds')::bigint ELSE 0 END),0) unrated,round(sum((t.content->'data'->>'seconds')::numeric*(t.content->'data'->'rate'->>'hourlyAmount')::numeric/3600),2)::text amount FROM cabinet_time t WHERE ${where}`,
      params,
    )
  )[0]!;
  const rows = await tx.query(
    `${cte} SELECT t.content,r.kind record_kind,r.content->>'title' record_label,pr.content->'target'->>'label' production_label FROM cabinet_time t LEFT JOIN cabinet_records r ON t.content->'data'->'link'->>'kind'='record' AND r.id=(t.content->'data'->'link'->>'id')::uuid LEFT JOIN cabinet_production_rows pr ON t.content->'data'->'link'->>'kind'='production' AND pr.id=(t.content->'data'->'link'->>'id')::uuid WHERE ${where} ORDER BY t.content->'data'->>'date',t.id LIMIT ${p(q.limit)} OFFSET ${p(q.offset)}`,
    params,
  );
  return {
    from: q.from,
    to: q.to,
    realizedSeconds: Number(totals.seconds),
    unratedSeconds: Number(totals.unrated),
    amount: Number(totals.unrated) > 0 ? null : (totals.amount ?? "0.00"),
    planned,
    entries: rows.map((r) => TimeEntitySchema.parse(r.content)),
    relations: rows.flatMap((r) => {
      const e = TimeEntitySchema.parse(r.content);
      if (e.data.kind !== "entry" || e.data.link.kind === "free") return [];
      const link = e.data.link;
      return [
        {
          id: link.id,
          label: String(
            link.kind === "production" ? r.production_label : r.record_label,
          ),
          href:
            link.kind === "production"
              ? "#production?id=" + link.id
              : "#" +
                r.record_kind +
                "?id=" +
                link.id +
                (r.record_kind === "tache" ? "&section=time" : ""),
        },
      ];
    }),
    total: Number(totals.total),
    hasMore: q.offset + rows.length < Number(totals.total),
  };
}
export async function targets(
  tx: Connection,
  actor: SessionUser,
  kind: string,
  q: string,
  offset: number,
) {
  const params: unknown[] = [],
    p = (v: unknown) => {
      params.push(v);
      return "$" + params.length;
    };
  const pattern = p("%" + q.replace(/[\\%_]/g, "\\$&") + "%");
  const source = kind === "production" ? "production" : "record";
  const candidates =
    kind === "production"
      ? `p.content->'target'->>'label' ILIKE ${pattern}`
      : `r.kind=${p(kind)} AND r.content->>'title' ILIKE ${pattern}`;
  const cte = await scopeCte(tx, actor, p, {
    kind: source,
    sql:
      kind === "production"
        ? `SELECT p.content FROM cabinet_production_rows p WHERE ${candidates}`
        : `SELECT r.content FROM cabinet_records r WHERE ${candidates}`,
    params: [...params],
  });
  const rows =
    kind === "production"
      ? await tx.query(
          `${cte} SELECT p.id,p.content->'target'->>'label' label FROM cabinet_production_rows p WHERE p.id IN(SELECT id FROM time_readable_production) AND ${candidates} ORDER BY p.id LIMIT 101 OFFSET ${p(offset)}`,
          params,
        )
      : await tx.query(
          `${cte} SELECT r.id,r.content->>'title' label FROM cabinet_records r WHERE r.id IN(SELECT id FROM time_readable_records) AND ${candidates} ORDER BY r.id LIMIT 101 OFFSET ${p(offset)}`,
          params,
        );
  return {
    items: rows.slice(0, 100).map((r) => ({
      id: r.id,
      kind: kind === "production" ? "production" : "record",
      label: r.label,
    })),
    hasMore: rows.length > 100,
  };
}
