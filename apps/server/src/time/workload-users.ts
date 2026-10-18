import type { TimeQuery } from "@memlia/contracts";
// Narrow the people catalog by the requested work scope before its functional bound.
export function workloadPeople(
  q: TimeQuery & { roleId?: string },
  p: (v: unknown) => string,
) {
  const record = (r: string) =>
    [
      q.recordId ? `${r}.id::text=${p(q.recordId)}` : "TRUE",
      q.dossierId
        ? `(${r}.id::text=${p(q.dossierId)} OR ${r}.content->>'dossierId'=${p(q.dossierId)})`
        : "TRUE",
    ].join(" AND ");
  const production = (r: string) =>
    [
      q.recordId ? `${r}.record_id::text=${p(q.recordId)}` : "TRUE",
      q.dossierId
        ? `(${r}.content->'scope'->>'id'=${p(q.dossierId)} OR ${r}.content->'scope'->>'dossierId'=${p(q.dossierId)})`
        : "TRUE",
    ].join(" AND ");
  const d = "t.content->'data'",
    dated = `(${d}->>'from'<=${p(q.to)} AND COALESCE(${d}->>'to','9999-12-31')>=${p(q.from)})`;
  const link = (s: string) =>
    `((${s}->>'kind'='record' AND EXISTS(SELECT 1 FROM cabinet_records r WHERE r.id::text=${s}->>'id' AND ${record("r")})) OR (${s}->>'kind'='production' AND EXISTS(SELECT 1 FROM cabinet_production_rows pr WHERE pr.id::text=${s}->>'id' AND ${production("pr")})))`;
  return `(EXISTS(SELECT 1 FROM cabinet_records r WHERE ${!q.roleId} AND ${record("r")} AND r.content->'data'->'assigneeIds' ? cabinet_users.id::text AND r.content->'data'->>'dueDate'>=${p(q.from)} AND r.content->'data'->>'dueDate'<=${p(q.to)}) OR EXISTS(SELECT 1 FROM cabinet_production_rows pr JOIN cabinet_production_model_versions mv ON mv.id=pr.model_id AND mv.version=(pr.content->>'modelVersion')::int CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_array_length(mv.content->'model'->'columns')=0 THEN '[{}]'::jsonb ELSE mv.content->'model'->'columns' END) c WHERE ${production("pr")} AND ${q.roleId ? `c->>'requiredRoleId'=${p(q.roleId)}` : "TRUE"} AND COALESCE(c->>'assigneeId',mv.content->'model'->>'assigneeId',(SELECT v.content->>'assigneeId' FROM cabinet_production_row_versions v WHERE v.id=pr.id AND v.version=1))=cabinet_users.id::text AND (((c->>'plannedDate' IS NULL OR mv.content->'model'->>'kind'='custom') AND EXISTS(SELECT 1 FROM cabinet_production_row_versions initial WHERE initial.id=pr.id AND initial.version=1 AND initial.content->>'dueDate'>=${p(q.from)} AND initial.content->>'dueDate'<=${p(q.to)})) OR (mv.content->'model'->>'kind'<>'custom' AND c->>'plannedDate'>=${p(q.from)} AND c->>'plannedDate'<=${p(q.to)}) OR (mv.content->'model'->>'kind'<>'custom' AND c->>'frequency'<>'once' AND substring(pr.content->>'period',1,4) BETWEEN substring(${p(q.from)}::text,1,4) AND substring(${p(q.to)}::text,1,4)))) OR EXISTS(SELECT 1 FROM cabinet_time t WHERE (t.kind='assignment' AND ${!q.recordId} AND ${q.dossierId ? `${d}->>'dossierId'=${p(q.dossierId)}` : "TRUE"} AND ${q.roleId ? `${d}->>'roleId'=${p(q.roleId)}` : "TRUE"} AND ${d}->>'userId'=cabinet_users.id::text AND ${dated}) OR (t.kind='allocation' AND ${dated} AND ${link(d + "->'target'")} AND EXISTS(SELECT 1 FROM jsonb_array_elements(${d}->'weights') w WHERE w->>'userId'=cabinet_users.id::text)) OR (t.kind='entry' AND ${!q.roleId} AND ${d}->>'userId'=cabinet_users.id::text AND ${d}->>'date'>=${p(q.from)} AND ${d}->>'date'<=${p(q.to)} AND ${link(d + "->'link'")})))`;
}
