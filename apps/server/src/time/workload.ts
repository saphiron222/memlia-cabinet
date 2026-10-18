import { workloadPeople } from "./workload-users.js";
import { productionStages } from "./production-plan.js";
import { z } from "zod";
import {
  CabinetRecordSchema,
  ProductionRowSchema,
  ProductionModelSchema,
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
  report,
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
  q: TimeQuery & { roleId?: string; userIds?: string[] },
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
  const userParams: unknown[] = readsOthers(actor) ? [] : [actor.id];
  const userFilters = [readsOthers(actor) ? "TRUE" : "id=$1"];
  if (q.userId) {
    userParams.push(q.userId);
    userFilters.push(`id=$${userParams.length}::uuid`);
  }
  if (q.userIds) {
    userParams.push(q.userIds);
    userFilters.push(`id=ANY($${userParams.length}::uuid[])`);
  }
  if (q.groupId) {
    userParams.push(q.groupId);
    userFilters.push(
      `EXISTS(SELECT 1 FROM cabinet_memberships m WHERE m.user_id=cabinet_users.id AND m.group_id=$${userParams.length}::uuid)`,
    );
  }
  if (!q.userId && !q.userIds && (q.dossierId || q.recordId || q.roleId))
    userFilters.push(
      workloadPeople(q, (v) => {
        userParams.push(v);
        return "$" + userParams.length;
      }),
    );
  const users = await tx.query(
    `SELECT id,name,active FROM cabinet_users WHERE ${userFilters.join(" AND ")} ORDER BY name LIMIT 201`,
    userParams,
  );
  if (users.length > 200)
    fail(
      422,
      "PERIOD_TOO_LARGE",
      "Filtrez par équipe ou site (200 personnes maximum).",
    );
  const selectedUsers = users.map((u) => String(u.id));
  const narrowedUsers =
    !!q.userId || !!q.userIds || !!q.groupId || !readsOthers(actor);
  const days = dates(q.from, q.to),
    params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return "$" + params.length;
  };
  const cte = scopeCte(actor, p);
  const objectUsers = (
    alias: string,
    param: (v: unknown) => string,
    canonical: string,
  ) =>
    `(${!narrowedUsers} OR ${canonical} OR EXISTS(SELECT 1 FROM cabinet_time a WHERE a.kind='allocation' AND a.content->'data'->'target'->>'id'=${alias}.id::text AND a.content->'data'->>'from'<=${param(q.to)} AND COALESCE(a.content->'data'->>'to','9999-12-31')>=${param(q.from)} AND EXISTS(SELECT 1 FROM jsonb_array_elements(a.content->'data'->'weights') w WHERE w->>'userId'=ANY(${param(selectedUsers)}::text[]))))`;
  const recordFilters = [
    q.recordId ? `r.id=${p(q.recordId)}::uuid` : "TRUE",
    q.dossierId ? `r.content->>'dossierId'=${p(q.dossierId)}` : "TRUE",
    q.roleId ? "FALSE" : "TRUE",
    objectUsers(
      "r",
      p,
      `COALESCE(r.content->'data'->'assigneeIds','[]'::jsonb) ?| ${p(selectedUsers)}::text[]`,
    ),
  ];
  const scopeRecords = await tx.query(
    `${cte} SELECT r.content FROM cabinet_records r WHERE r.id IN(SELECT id FROM time_readable_records) AND r.kind IN('tache','obligation') AND NOT EXISTS(SELECT 1 FROM cabinet_production_rows represented WHERE represented.record_id=r.id) AND ${recordFilters.join(" AND ")} AND r.content->'data'->>'dueDate'>=${p(q.from)} AND r.content->'data'->>'dueDate'<=${p(q.to)} ORDER BY r.id LIMIT 10001`,
    params,
  );
  if (scopeRecords.length > 10000)
    fail(422, "PERIOD_TOO_LARGE", "Réduisez la période de charge.");
  const prodParams: unknown[] = [],
    pp = (v: unknown) => {
      prodParams.push(v);
      return "$" + prodParams.length;
    };
  const productionFilters = [
    q.recordId ? `p.record_id=${pp(q.recordId)}::uuid` : "TRUE",
    q.dossierId
      ? `(p.content->'scope'->>'id'=${pp(q.dossierId)} OR p.content->'scope'->>'dossierId'=${pp(q.dossierId)})`
      : "TRUE",
    q.roleId
      ? `EXISTS(SELECT 1 FROM cabinet_production_model_versions mv CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_array_length(mv.content->'model'->'columns')=0 THEN '[{}]'::jsonb ELSE mv.content->'model'->'columns' END) c WHERE mv.id=p.model_id AND mv.version=(p.content->>'modelVersion')::int AND c->>'requiredRoleId'=${pp(q.roleId)})`
      : "TRUE",
    objectUsers(
      "p",
      pp,
      `EXISTS(SELECT 1 FROM cabinet_production_model_versions mv CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_array_length(mv.content->'model'->'columns')=0 THEN '[{}]'::jsonb ELSE mv.content->'model'->'columns' END) c WHERE mv.id=p.model_id AND mv.version=(p.content->>'modelVersion')::int AND COALESCE(c->>'assigneeId',mv.content->'model'->>'assigneeId',(SELECT v.content->>'assigneeId' FROM cabinet_production_row_versions v WHERE v.id=p.id AND v.version=1))=ANY(${pp(selectedUsers)}::text[]))`,
    ),
  ];
  const prod = await tx.query(
    `${scopeCte(actor, pp)} SELECT p.content FROM cabinet_production_rows p WHERE p.id IN(SELECT id FROM time_readable_production) AND ${productionFilters.join(" AND ")} AND EXISTS(SELECT 1 FROM cabinet_production_model_versions mv WHERE mv.id=p.model_id AND mv.version=(p.content->>'modelVersion')::int AND (EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_array_length(mv.content->'model'->'columns')=0 THEN '[{}]'::jsonb ELSE mv.content->'model'->'columns' END) c WHERE (mv.content->'model'->>'kind'<>'custom' AND c->>'plannedDate'>=${pp(q.from)} AND c->>'plannedDate'<=${pp(q.to)}) OR (mv.content->'model'->>'kind'<>'custom' AND c->>'frequency'<>'once' AND substring(p.content->>'period',1,4) BETWEEN substring(${pp(q.from)}::text,1,4) AND substring(${pp(q.to)}::text,1,4))) OR EXISTS(SELECT 1 FROM cabinet_production_row_versions first WHERE first.id=p.id AND first.version=1 AND first.content->>'dueDate'>=${pp(q.from)} AND first.content->>'dueDate'<=${pp(q.to)}))) ORDER BY p.id LIMIT 10001`,
    prodParams,
  );
  if (prod.length > 10000)
    fail(422, "PERIOD_TOO_LARGE", "Réduisez la période de charge.");
  const objectIds = [...scopeRecords, ...prod].map((x) =>
    String((x.content as { id: string }).id),
  );
  const dossierIds = [
    ...scopeRecords.map((x) => CabinetRecordSchema.parse(x.content).dossierId),
    ...prod.map((x) => ProductionRowSchema.parse(x.content).scope?.id),
  ].filter(Boolean);
  const baseConfig = await entities(
    tx,
    calculationActor,
    undefined,
    "read",
    undefined,
    {
      where: (p) => {
        const data = "t.content->'data'",
          within = `(${data}->>'from' IS NULL OR (${data}->>'from'<=${p(q.to)} AND COALESCE(${data}->>'to','9999-12-31')>=${p(q.from)}))`;
        const fixedScope = [
          q.recordId ? "FALSE" : "TRUE",
          q.dossierId ? `${data}->>'dossierId'=${p(q.dossierId)}` : "TRUE",
          q.roleId ? `${data}->>'roleId'=${p(q.roleId)}` : "TRUE",
          narrowedUsers
            ? `EXISTS(SELECT 1 FROM cabinet_time ass WHERE ass.kind='assignment' AND ass.content->'data'->>'dossierId'=${data}->>'dossierId' AND ass.content->'data'->>'roleId'=${data}->>'roleId' AND ass.content->'data'->>'userId'=ANY(${p(selectedUsers)}::text[]) AND ass.content->'data'->>'from'<=${p(q.to)} AND COALESCE(ass.content->'data'->>'to','9999-12-31')>=${p(q.from)})`
            : "TRUE",
        ].join(" AND ");
        return `${within} AND (CASE t.kind WHEN 'plan' THEN (${data}->>'level'='cabinet' OR ${data}->>'targetId'=ANY(${p([...objectIds, ...dossierIds])}::text[])) WHEN 'allocation' THEN ${data}->'target'->>'id'=ANY(${p(objectIds)}::text[]) WHEN 'capacity' THEN (${data}->>'userId' IS NULL OR ${data}->>'userId'=ANY(${p(selectedUsers)}::text[])) WHEN 'forfait' THEN (${fixedScope}) WHEN 'assignment' THEN (${fixedScope}) ELSE FALSE END)`;
      },
    },
  );
  const config = override
    ? baseConfig.map((e) => (e.id === override.id ? override : e))
    : baseConfig;
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
    const plans = config.filter(
      (e) => e.data.kind === "plan" && e.data.minutes !== null,
    );
    const overridePlan = plans.find(
      (e) =>
        e.data.kind === "plan" &&
        e.data.level === "production" &&
        e.data.targetId === r.id,
    );
    const inherited =
      plans.find(
        (e) =>
          e.data.kind === "plan" &&
          e.data.level === "dossier" &&
          e.data.targetId === dossierId,
      ) ??
      plans.find((e) => e.data.kind === "plan" && e.data.level === "cabinet");
    const frozen = await tx.query(
      "SELECT content FROM cabinet_production_model_versions WHERE id=$1 AND version=$2",
      [r.modelId, r.modelVersion],
    );
    const model = ProductionModelSchema.parse(frozen[0]?.content).model;
    if (model.kind === "stage_type") continue;
    const first = await tx.query(
      "SELECT content FROM cabinet_production_row_versions WHERE id=$1 ORDER BY version LIMIT 1",
      [r.id],
    );
    const stages = productionStages(
      r,
      ProductionRowSchema.parse(first[0]?.content),
      model,
    );
    // A line override is a total, apportioned over all frozen stage periods, then date-filtered.
    const overrideShares =
      overridePlan?.data.kind === "plan"
        ? split(
            overridePlan.data.minutes!,
            stages.map((s) => ({
              userId: s.key,
              weight: Math.max(1, s.minutes ?? 0),
            })),
          )
        : [];
    for (const stage of stages) {
      if (stage.date < q.from || stage.date > q.to) continue;
      const plan =
        overridePlan ?? (stage.minutes === null ? inherited : undefined);
      const planned = overridePlan
        ? (overrideShares.find((s) => s.userId === stage.key)?.minutes ?? 0)
        : (stage.minutes ??
          (inherited?.data.kind === "plan" ? inherited.data.minutes : null));
      const component =
        plan?.data.kind === "plan" ? plan.data.component : "variable";
      const target = { kind: "production" as const, id: r.id },
        a = allocation(target, stage.date);
      const weights =
        a?.data.kind === "allocation"
          ? a.data.weights
          : stage.userId
            ? [{ userId: stage.userId, weight: 1 }]
            : [];
      for (const part of split(
        component === "fixed" ? 0 : (planned ?? 0),
        weights,
      ))
        rows.push({
          key: `production:${r.id}:${stage.key}:${part.userId}`,
          target,
          label:
            r.target.label + (stage.column ? " · " + stage.column.name : ""),
          dossierId,
          userId: part.userId,
          roleId: stage.column?.requiredRoleId ?? null,
          component,
          plannedMinutes: planned === null ? null : part.minutes,
          realizedSeconds: 0,
          provenance:
            (overridePlan
              ? "Surcharge de ligne répartie proportionnellement entre étapes et périodes gelées."
              : stage.minutes !== null
                ? "Prévision explicite de l’étape gelée."
                : plan
                  ? "Prévision héritée."
                  : "Prévision inconnue.") +
            (a
              ? " Répartition explicite datée."
              : " Porteur de l’étape gelée."),
          sourceVersions: {
            [r.id]: r.version,
            [r.modelId]: r.modelVersion,
            ...(plan ? { [plan.id]: plan.version } : {}),
            ...(a ? { [a.id]: a.version } : {}),
          },
          from: stage.date,
          to: stage.date,
        });
    }
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
  const actual: TimeEntity[] = [];
  for (const actualQuery of q.roleId
    ? []
    : q.userIds
      ? q.userIds.map((userId) => ({ ...q, userId }))
      : [q])
    for (let offset = 0; ; offset += 100) {
      const page = await report(tx, actor, {
        ...actualQuery,
        offset,
        limit: 100,
      });
      actual.push(...page.entries);
      if (!page.hasMore) break;
      if (actual.length >= 20000)
        fail(
          422,
          "PERIOD_TOO_LARGE",
          "Réduisez le périmètre des temps réalisés.",
        );
    }
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
          target.kind === "record" &&
          r.target.kind !== "free" &&
          r.target.id === target.id &&
          r.userId === d.userId,
      );
    if (matching) {
      matching.realizedSeconds += d.seconds;
      matching.sourceVersions[e.id] = e.version;
    } else
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
        active: u.active,
        unknownPlans: own.filter((r) => r.plannedMinutes === null).length,
        capacityMinutes: unknown ? null : capacity,
        capacitySource: unknown
          ? "unknown"
          : individual
            ? "individual"
            : "cabinet",
        plannedMinutes: planned,
        realizedSeconds: own.reduce((s, r) => s + r.realizedSeconds, 0),
        overloadMinutes:
          unknown || own.some((r) => r.plannedMinutes === null)
            ? null
            : Math.max(0, planned - capacity),
      };
    });
  return WorkloadSchema.parse({
    from: q.from,
    to: q.to,
    rows: visible,
    people,
    sourceVersions: Object.fromEntries(
      config
        .filter(
          (e) =>
            readsOthers(actor) ||
            ((!("userId" in e.data) ||
              !e.data.userId ||
              e.data.userId === actor.id) &&
              (e.data.kind !== "allocation" ||
                e.data.weights.every((w) => w.userId === actor.id))),
        )
        .map((e) => [e.id, e.version]),
    ),
    unknownPlans: visible.filter((r) => r.plannedMinutes === null).length,
  });
}
