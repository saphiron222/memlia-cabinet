import { z } from "zod";
import {
  CabinetRecordSchema,
  ProductionRowSchema,
  WorkloadSchema,
  WorkloadRowSchema,
  type TimeEntity,
  type TimeQuery,
  type SessionUser,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import {
  entities,
  effectivePlan,
  period,
  readsOthers,
  scopeCte,
} from "./service.js";
import { fail } from "../errors.js";
type Row = z.infer<typeof WorkloadRowSchema>;
export function dates(from: string, to: string) {
  const result: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86400000)
    result.push(new Date(t).toISOString().slice(0, 10));
  return result;
}
const weekday = (date: string) =>
  (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;
const applies = (d: { from: string; to: string | null }, date: string) =>
  d.from <= date && (!d.to || d.to >= date);
function split(total: number, weights: { userId: string; weight: number }[]) {
  if (!weights.length) return [{ userId: null, minutes: total }];
  const sum = weights.reduce((s, w) => s + w.weight, 0);
  const ordered = [...weights].sort((a, b) => a.userId.localeCompare(b.userId));
  const result = ordered.map((w) => ({
    userId: w.userId,
    minutes: Math.floor((total * w.weight) / sum),
    remainder: (total * w.weight) % sum,
  }));
  let left = total - result.reduce((s, w) => s + w.minutes, 0);
  for (const r of [...result].sort(
    (a, b) => b.remainder - a.remainder || a.userId.localeCompare(b.userId),
  )) {
    if (left-- > 0) r.minutes++;
  }
  return result;
}
export async function calculateWorkload(
  tx: Connection,
  actor: SessionUser,
  q: TimeQuery & { roleId?: string },
  override?: TimeEntity,
) {
  period(q);
  if (q.userId && q.userId !== actor.id && !readsOthers(actor))
    fail(404, "NOT_FOUND", "Utilisateur inaccessible.");
  const calculationActor: SessionUser = readsOthers(actor)
    ? actor
    : {
        ...actor,
        permissions: [
          ...actor.permissions,
          { action: "time_read", kind: "*", dossierId: null },
        ],
      };
  const baseConfig = await entities(tx, calculationActor);
  const config = (
    override
      ? baseConfig.map((e) => (e.id === override.id ? override : e))
      : baseConfig
  ).filter((e) => e.data.kind !== "entry" && e.data.kind !== "timer");
  const days = dates(q.from, q.to),
    params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return "$" + params.length;
  };
  const cte = scopeCte(actor, p);
  const scopeRecords = await tx.query(
    `${cte} SELECT r.content FROM cabinet_records r WHERE r.id IN(SELECT id FROM time_readable_records) AND r.kind IN('tache','obligation') AND r.content->'data'->>'dueDate'>=${p(q.from)} AND r.content->'data'->>'dueDate'<=${p(q.to)} ORDER BY r.id LIMIT 10001`,
    params,
  );
  if (scopeRecords.length > 10000)
    fail(422, "PERIOD_TOO_LARGE", "Réduisez la période de charge.");
  const prodParams: unknown[] = [],
    pp = (v: unknown) => {
      prodParams.push(v);
      return "$" + prodParams.length;
    };
  const prod = await tx.query(
    `${scopeCte(actor, pp)} SELECT p.content FROM cabinet_production_rows p WHERE p.id IN(SELECT id FROM time_readable_production) AND p.content->>'dueDate'>=${pp(q.from)} AND p.content->>'dueDate'<=${pp(q.to)} ORDER BY p.id LIMIT 10001`,
    prodParams,
  );
  if (prod.length > 10000)
    fail(422, "PERIOD_TOO_LARGE", "Réduisez la période de charge.");
  const rows: Row[] = [];
  const allocation = (
    target: { kind: "record" | "production"; id: string },
    date: string,
  ) =>
    config.find(
      (e) =>
        e.data.kind === "allocation" &&
        e.data.target.kind === target.kind &&
        e.data.target.id === target.id &&
        applies(e.data, date),
    );
  for (const source of scopeRecords) {
    const r = CabinetRecordSchema.parse(source.content);
    if (
      prod.some((x) => ProductionRowSchema.parse(x.content).recordId === r.id)
    )
      continue;
    if (
      (q.recordId && q.recordId !== r.id) ||
      (q.dossierId && q.dossierId !== r.dossierId)
    )
      continue;
    const plan = await effectivePlan(tx, actor, r.id, config),
      date =
        r.kind === "tache" || r.kind === "obligation" ? r.data.dueDate : null;
    if (!date) continue;
    const target = { kind: "record" as const, id: r.id },
      a = allocation(target, date);
    const weights =
      a?.data.kind === "allocation"
        ? a.data.weights
        : r.kind === "tache" && r.data.assigneeIds.length === 1
          ? [{ userId: r.data.assigneeIds[0]!, weight: 1 }]
          : [];
    const distributed = split(
      plan.component === "fixed" ? 0 : (plan.minutes ?? 0),
      weights,
    );
    for (const part of distributed)
      rows.push({
        key: `record:${r.id}:${part.userId}`,
        target,
        label: r.title,
        dossierId: r.dossierId,
        userId: part.userId,
        roleId: null,
        component: plan.component,
        plannedMinutes: plan.minutes === null ? null : part.minutes,
        realizedSeconds: 0,
        provenance:
          plan.explanation +
          (plan.component === "fixed"
            ? " Incluse dans le forfait, sans seconde addition."
            : "") +
          (a
            ? " Poids explicites, version " + a.version
            : weights.length
              ? " Responsable canonique unique."
              : " Non affectée : poids explicites requis."),
        sourceVersions: {
          [r.id]: r.version,
          ...(plan.sourceId ? { [plan.sourceId]: plan.version! } : {}),
          ...(a ? { [a.id]: a.version } : {}),
        },
        from: date,
        to: date,
      });
  }
  for (const source of prod) {
    const r = ProductionRowSchema.parse(source.content);
    const dossierId =
      r.target.kind === "dossier"
        ? r.target.id
        : r.scope?.kind === "dossier"
          ? r.scope.id
          : null;
    if (
      (q.dossierId && q.dossierId !== dossierId) ||
      (q.recordId && r.recordId !== q.recordId)
    )
      continue;
    const plan =
      config.find(
        (e) =>
          e.data.kind === "plan" &&
          e.data.level === "production" &&
          e.data.targetId === r.id &&
          e.data.minutes !== null,
      ) ??
      config.find(
        (e) =>
          e.data.kind === "plan" &&
          e.data.level === "dossier" &&
          e.data.targetId === dossierId &&
          e.data.minutes !== null,
      ) ??
      config.find(
        (e) =>
          e.data.kind === "plan" &&
          e.data.level === "cabinet" &&
          e.data.minutes !== null,
      );
    const target = { kind: "production" as const, id: r.id },
      a = allocation(target, r.dueDate!);
    const frozen = await tx.query(
      "SELECT content FROM cabinet_production_model_versions WHERE id=$1 AND version=$2",
      [r.modelId, r.modelVersion],
    );
    const model = frozen[0]?.content as
      | { model?: { columns?: { plannedMinutes: number | null }[] } }
      | undefined;
    const values =
      model?.model?.columns
        ?.map((c) => c.plannedMinutes)
        .filter((n): n is number => n !== null && n !== undefined) ?? [];
    const planned =
      plan?.data.kind === "plan"
        ? plan.data.minutes
        : values.length
          ? values.reduce((s, n) => s + n, 0)
          : null;
    const component =
      plan?.data.kind === "plan" ? plan.data.component : "variable";
    const weights =
      a?.data.kind === "allocation"
        ? a.data.weights
        : r.assigneeId
          ? [{ userId: r.assigneeId, weight: 1 }]
          : [];
    for (const part of split(
      component === "fixed" ? 0 : (planned ?? 0),
      weights,
    ))
      rows.push({
        key: `production:${r.id}:${part.userId}`,
        target,
        label: r.target.label,
        dossierId,
        userId: part.userId,
        roleId: null,
        component,
        plannedMinutes: planned === null ? null : part.minutes,
        realizedSeconds: 0,
        provenance: plan
          ? `Prévision ${plan.id}, version ${plan.version}`
          : `Configuration de production gelée, version ${r.modelVersion}`,
        sourceVersions: {
          [r.id]: r.version,
          ...(plan ? { [plan.id]: plan.version } : {}),
          ...(a ? { [a.id]: a.version } : {}),
        },
        from: r.dueDate!,
        to: r.dueDate!,
      });
  }
  if (!q.recordId)
    for (const f of config) {
      if (
        f.data.kind !== "forfait" ||
        (q.dossierId && q.dossierId !== f.data.dossierId)
      )
        continue;
      const d = f.data;
      // Policy is explicit: days in each civil month, late activity clipped; each daily contribution allocated once.
      const byMonth = new Map<string, string[]>();
      for (const day of days.filter(
        (day) =>
          applies(d, day) &&
          day >= d.activityStart &&
          (d.prorating === "calendar_days" || weekday(day) < 5),
      )) {
        const key = day.slice(0, 7);
        byMonth.set(key, [...(byMonth.get(key) ?? []), day]);
      }
      for (const [month, eligible] of byMonth) {
        const end = new Date(
          Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
        )
          .toISOString()
          .slice(0, 10);
        const denominator = dates(month + "-01", end).filter(
          (day) => d.prorating === "calendar_days" || weekday(day) < 5,
        ).length;
        // Aggregate rational shares before rounding; daily allocation changes remain historical inputs.
        const shares = new Map<string, { n: bigint; d: bigint }>(),
          versions: Record<string, number> = { [f.id]: f.version };
        const add = (key: string, n: bigint, den: bigint) => {
          const old = shares.get(key) ?? { n: 0n, d: 1n };
          const gcd = (a: bigint, b: bigint): bigint => (b ? gcd(b, a % b) : a);
          const num = old.n * den + n * old.d,
            div = old.d * den,
            g = gcd(num, div);
          shares.set(key, { n: num / g, d: div / g });
        };
        for (const day of eligible) {
          const assignments = config.filter(
            (e) =>
              e.data.kind === "assignment" &&
              e.data.dossierId === d.dossierId &&
              e.data.roleId === d.roleId &&
              applies(e.data, day),
          );
          const weights = assignments.flatMap((e) =>
              e.data.kind === "assignment"
                ? [{ userId: e.data.userId, weight: e.data.weight }]
                : [],
            ),
            sum = weights.reduce((s, w) => s + w.weight, 0);
          for (const a of assignments)
            if (
              readsOthers(actor) ||
              (a.data.kind === "assignment" && a.data.userId === actor.id)
            )
              versions[a.id] = a.version;
          if (!sum) add("", BigInt(d.monthlyMinutes), BigInt(denominator));
          else
            for (const w of weights)
              add(
                w.userId,
                BigInt(d.monthlyMinutes * w.weight),
                BigInt(denominator * sum),
              );
        }
        const total = Math.round(
            (d.monthlyMinutes * eligible.length) / denominator,
          ),
          parts = [...shares].map(([userId, s]) => ({
            userId,
            minutes: Number(s.n / s.d),
            n: s.n % s.d,
            d: s.d,
          }));
        let left = total - parts.reduce((s, w) => s + w.minutes, 0);
        for (const part of [...parts].sort((a, b) =>
          a.n * b.d === b.n * a.d
            ? a.userId.localeCompare(b.userId)
            : a.n * b.d > b.n * a.d
              ? -1
              : 1,
        ))
          if (left-- > 0) part.minutes++;
        for (const part of parts)
          rows.push({
            key: `forfait:${f.id}:${month}:${part.userId}`,
            target: null,
            label: "Forfait " + month,
            dossierId: d.dossierId,
            userId: part.userId || null,
            roleId: d.roleId,
            component: "fixed",
            plannedMinutes: part.minutes,
            realizedSeconds: 0,
            provenance: `${eligible.length}/${denominator} ${d.prorating === "calendar_days" ? "jours calendaires" : "jours lundi–vendredi"} ; règle v${d.policyVersion}, forfait v${f.version}, poids datés, arrondi au plus fort reste.`,
            sourceVersions: versions,
            from: eligible[0]!,
            to: eligible.at(-1)!,
          });
      }
    }
  // Actual attribution is the author of the entry, never rewritten by a new allocation.
  const actual = await entities(tx, actor, "entry", "read", q);
  for (const e of actual) {
    if (e.data.kind !== "entry" || e.data.date < q.from || e.data.date > q.to)
      continue;
    const d = e.data;
    if (q.recordId && (d.link.kind !== "record" || d.link.id !== q.recordId))
      continue;
    let dossierId: string | null = null,
      label = d.link.kind === "free" ? d.link.label : "Temps réalisé";
    if (d.link.kind === "record") {
      const rr = await tx.query(
        "SELECT content FROM cabinet_records WHERE id=$1",
        [d.link.id],
      );
      const r = CabinetRecordSchema.parse(rr[0]?.content);
      dossierId = r.kind === "dossier" ? r.id : r.dossierId;
      label = r.title;
    }
    if (d.link.kind === "production") {
      const rr = await tx.query(
        "SELECT content FROM cabinet_production_rows WHERE id=$1",
        [d.link.id],
      );
      const r = ProductionRowSchema.parse(rr[0]?.content);
      dossierId = r.target.kind === "dossier" ? r.target.id : null;
      label = r.target.label;
    }
    if (q.dossierId && q.dossierId !== dossierId) continue;
    const target = d.link,
      matching = rows.find(
        (r) =>
          r.target?.kind === target.kind &&
          target.kind !== "free" &&
          r.target.kind !== "free" &&
          r.target.id === target.id &&
          r.userId === d.userId,
      );
    if (matching) matching.realizedSeconds += d.seconds;
    else
      rows.push({
        key: "actual:" + e.id,
        target,
        label,
        dossierId,
        userId: d.userId,
        roleId: null,
        component: "variable",
        plannedMinutes: 0,
        realizedSeconds: d.seconds,
        provenance: "Saisie " + d.source + " ; auteur historique conservé.",
        sourceVersions: { [e.id]: e.version },
        from: d.date,
        to: d.date,
      });
  }
  const userParams: unknown[] = readsOthers(actor) ? [] : [actor.id];
  const userFilters = ["active=true", readsOthers(actor) ? "TRUE" : "id=$1"];
  if (q.groupId) {
    userParams.push(q.groupId);
    userFilters.push(
      `EXISTS(SELECT 1 FROM cabinet_memberships m WHERE m.user_id=cabinet_users.id AND m.group_id=$${userParams.length}::uuid)`,
    );
  }
  const users = await tx.query(
    `SELECT id,name FROM cabinet_users WHERE ${userFilters.join(" AND ")} ORDER BY name LIMIT 201`,
    userParams,
  );
  if (users.length > 200)
    fail(
      422,
      "PERIOD_TOO_LARGE",
      "Filtrez par équipe ou site (200 personnes maximum).",
    );
  const ids = new Set(users.map((u) => String(u.id)));
  const visible = rows.filter(
    (r) =>
      (readsOthers(actor)
        ? !r.userId || ids.has(r.userId)
        : r.userId === actor.id) &&
      (!q.userId || r.userId === q.userId) &&
      (!q.roleId || r.roleId === q.roleId),
  );
  const people = users
    .filter((u) => !q.userId || u.id === q.userId)
    .map((u) => {
      let capacity = 0,
        unknown = false,
        individual = false;
      for (const day of days) {
        const candidates = config.filter(
          (e) =>
            e.data.kind === "capacity" &&
            (e.data.userId === null || e.data.userId === u.id) &&
            applies(e.data, day),
        );
        const selected =
          candidates.find(
            (e) => e.data.kind === "capacity" && e.data.userId === u.id,
          ) ?? candidates[0];
        if (!selected || selected.data.kind !== "capacity") {
          unknown = true;
          continue;
        }
        capacity += selected.data.dailyMinutes[weekday(day)]!;
        individual ||= selected.data.userId !== null;
      }
      const own = visible.filter((r) => r.userId === u.id),
        planned = own.reduce((s, r) => s + (r.plannedMinutes ?? 0), 0);
      return {
        id: u.id,
        name: u.name,
        capacityMinutes: unknown ? null : capacity,
        capacitySource: unknown
          ? "unknown"
          : individual
            ? "individual"
            : "cabinet",
        plannedMinutes: planned,
        realizedSeconds: own.reduce((s, r) => s + r.realizedSeconds, 0),
        overloadMinutes: unknown ? null : Math.max(0, planned - capacity),
      };
    });
  return WorkloadSchema.parse({
    from: q.from,
    to: q.to,
    rows: visible,
    people,
    unknownPlans: visible.filter((r) => r.plannedMinutes === null).length,
  });
}
