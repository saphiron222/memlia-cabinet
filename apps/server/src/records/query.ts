import {
  CabinetRecordSchema,
  RecordKindSchema,
  RecordListQuerySchema,
  type SessionUser,
  type Action,
  type RecordKind,
  type RecordListQuery,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { hasPermission } from "./permissions.js";
import { assignmentScope } from "../administration/access.js";
import { fail } from "../errors.js";
// Exact counterpart of direct resource checks; applied before projection/count/pagination.
export function authorizedPredicate(
  actor: SessionUser,
  action: "read" | "export" | "update",
  parameter: (v: unknown) => string,
) {
  const grant = (verb: Action, kind: RecordKind, scope: string) => {
    if (hasPermission(actor, verb, kind)) return "TRUE";
    const ids = actor.permissions
      .filter(
        (p) =>
          p.action === verb &&
          (p.kind === "*" || p.kind === kind) &&
          p.dossierId,
      )
      .map((p) => p.dossierId);
    return `(${scope}=ANY(${parameter(ids)}::uuid[]) OR ${assignmentScope(actor.id, verb, kind, scope, parameter)})`;
  };
  const scope =
    "CASE WHEN r.kind='dossier' THEN r.id ELSE (r.content->>'dossierId')::uuid END";
  const own = RecordKindSchema.options
    .map(
      (kind) =>
        `(r.kind='${kind}' AND ${grant("read", kind, scope)} ${action !== "read" ? `AND ${grant(action, kind, scope)}` : ""} AND (NOT COALESCE((r.content->>'confidential')::boolean,false) OR ${grant("confidential", kind, scope)}))`,
    )
    .join(" OR ");
  const parent = `(${grant("read", "dossier", "parent.id")} AND (NOT COALESCE((parent.content->>'confidential')::boolean,false) OR ${grant("confidential", "dossier", "parent.id")}))`;
  const links = `(CASE WHEN r.content->>'dossierId' IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(r.content->>'dossierId') END || CASE WHEN r.kind='contact' THEN COALESCE(r.content->'data'->'relatedDossierIds','[]'::jsonb) ELSE '[]'::jsonb END)`;
  return `((${own}) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(${links}) AS link(id) LEFT JOIN cabinet_records parent ON parent.id=link.id::uuid AND parent.kind='dossier' WHERE parent.id IS NULL OR NOT ${parent}))`;
}
export function recordFilter(
  actor: SessionUser,
  query: RecordListQuery,
  action: "read" | "export",
) {
  const params: unknown[] = [],
    parameter = (value: unknown) => {
      params.push(value);
      return "$" + params.length;
    };
  const where = [
    authorizedPredicate(actor, action, parameter),
    `COALESCE((r.content->'data'->>'archived')::boolean,false)=${parameter(query.archived === "true")}::boolean`,
  ];
  if (query.from && query.to && query.from > query.to)
    fail(400, "INVALID_PERIOD", "La fin précède le début.");
  if (query.kind) where.push(`r.kind=${parameter(query.kind)}`);
  if (query.dossierId) {
    const id = parameter(query.dossierId);
    where.push(
      `(r.id=${id}::uuid OR r.content->>'dossierId'=${id}::text OR (r.kind='contact' AND (r.content->'data'->'relatedDossierIds') ? ${id}::text))`,
    );
  }
  if (query.q) {
    const pattern = query.q.toLocaleLowerCase("fr").replace(/[\\%_]/g, "\\$&");
    where.push(`r.search_title LIKE ${parameter("%" + pattern + "%")}`);
  }
  if (query.groupId)
    where.push(
      `EXISTS(SELECT 1 FROM cabinet_assignments scope_assignment WHERE scope_assignment.subject_kind IN ('team','site') AND scope_assignment.subject_id=${parameter(query.groupId)}::uuid AND scope_assignment.dossier_id=CASE WHEN r.kind='dossier' THEN r.id ELSE (r.content->>'dossierId')::uuid END)`,
    );
  if (query.assigneeId)
    where.push(
      `r.kind='tache' AND (r.content->'data'->'assigneeIds') ? ${parameter(query.assigneeId)}`,
    );
  if (query.state)
    where.push(
      `r.kind='tache' AND r.content->'data'->>'state'=${parameter(query.state)}`,
    );
  if (query.source)
    where.push(
      `r.kind='obligation' AND r.content->'data'->>'source'=${parameter(query.source)}`,
    );
  if (query.preparation)
    where.push(
      `r.kind='obligation' AND r.content->'data'->>'preparation'=${parameter(query.preparation)}`,
    );
  const date =
    "COALESCE(r.content->'data'->>'dueDate',r.content->'data'->>'startedOn',r.content->'data'->>'createdOn',r.content->'data'->>'birthDate')";
  if (query.from) where.push(`${date}>=${parameter(query.from)}`);
  if (query.to) where.push(`${date}<=${parameter(query.to)}`);
  const sort = {
    title: "r.search_title",
    updatedAt: "r.content->>'updatedAt'",
    dueDate: "r.content->'data'->>'dueDate'",
    state: "r.content->'data'->>'state'",
  }[query.sort];
  return {
    where: where.join(" AND "),
    params,
    sort: `${sort} ${query.direction === "desc" ? "DESC" : "ASC"} NULLS LAST,r.id ASC`,
  };
}
export async function queryRecords(
  tx: Connection,
  actor: SessionUser,
  query: RecordListQuery,
  action: "read" | "export" = "read",
  paginate = true,
) {
  const f = recordFilter(actor, query, action);
  const count = await tx.query(
    `SELECT count(*) AS total FROM cabinet_records r WHERE ${f.where}`,
    f.params,
  );
  const params = [...f.params];
  let limit = "";
  if (paginate) {
    params.push(query.offset, query.limit);
    limit = ` OFFSET $${params.length - 1} LIMIT $${params.length}`;
  }
  const rows = await tx.query(
    `SELECT r.content FROM cabinet_records r WHERE ${f.where} ORDER BY ${f.sort}${limit}`,
    params,
  );
  return {
    items: rows.map((r) => CabinetRecordSchema.parse(r.content)),
    total: Number(count[0]!.total),
    offset: query.offset,
    limit: query.limit,
  };
}
