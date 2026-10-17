import { productionDocumentIdsSql } from "../production/document-scope.js";
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
  followContact = true,
): string {
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
  const documents = ` AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text((COALESCE(r.content->'data'->'fiscal'->'documentIds','[]'::jsonb)||COALESCE(r.content->'data'->'documentIds','[]'::jsonb))) AS fiscal_piece(id) LEFT JOIN cabinet_documents fiscal_document ON fiscal_document.id=fiscal_piece.id::uuid WHERE fiscal_document.id IS NULL OR ((fiscal_document.content->>'confidential')::boolean AND (${grant("confidential", "dossier", "fiscal_document.dossier_id")}) IS NOT TRUE))`;
  const fiscalLinks = (alias: string) =>
    `(COALESCE(${alias}.content->'data'->'fiscal'->'relatedRecordIds','[]'::jsonb) || CASE WHEN ${alias}.content->'data'->'fiscal'->>'contactId' IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(${alias}.content->'data'->'fiscal'->>'contactId') END || CASE WHEN ${alias}.kind='tache' AND ${alias}.content->'data'->>'prospectId' IS NOT NULL THEN jsonb_build_array(${alias}.content->'data'->>'prospectId') ELSE '[]'::jsonb END)`;
  const related = followContact
    ? ` AND NOT EXISTS(WITH RECURSIVE fiscal_reachable(id) AS (SELECT value::uuid FROM jsonb_array_elements_text(${fiscalLinks("r")}) UNION SELECT link.value::uuid FROM fiscal_reachable reached JOIN cabinet_records linked ON linked.id=reached.id CROSS JOIN LATERAL jsonb_array_elements_text(${fiscalLinks("linked")}) link(value)) SELECT 1 FROM fiscal_reachable reached LEFT JOIN cabinet_records fiscal_related ON fiscal_related.id=reached.id WHERE fiscal_related.id IS NULL OR (${authorizedPredicate(actor, "read", parameter, false).replaceAll(/\br\./g, "fiscal_related.")}) IS NOT TRUE)`
    : "";
  const productionDocuments = `NOT EXISTS(SELECT 1 FROM (${productionDocumentIdsSql("r.id")}) piece LEFT JOIN cabinet_documents d ON d.id=piece.id::uuid WHERE d.id IS NULL OR d.dossier_id IS DISTINCT FROM (r.content->>'dossierId')::uuid OR ((d.content->>'confidential')::boolean AND (${grant("confidential", "dossier", "d.dossier_id")}) IS NOT TRUE))`;
  return `((${own}) AND ${productionDocuments} AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(${links}) AS link(id) LEFT JOIN cabinet_records parent ON parent.id=link.id::uuid AND parent.kind='dossier' WHERE parent.id IS NULL OR (${parent}) IS NOT TRUE) AND CASE WHEN r.kind='tache' OR (r.kind='obligation' AND jsonb_typeof(r.content->'data'->'fiscal')='object') THEN (TRUE ${related}${documents}) ELSE TRUE END)`;
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
  if (query.own === "true") {
    const userId = parameter(actor.id);
    where.push(
      `EXISTS(SELECT 1 FROM cabinet_assignments own_assignment WHERE own_assignment.dossier_id=CASE WHEN r.kind='dossier' THEN r.id ELSE (r.content->>'dossierId')::uuid END AND ((own_assignment.subject_kind='user' AND own_assignment.subject_id=${userId}::uuid) OR (own_assignment.subject_kind IN ('team','site') AND EXISTS(SELECT 1 FROM cabinet_memberships membership WHERE membership.group_id=own_assignment.subject_id AND membership.user_id=${userId}::uuid))))`,
    );
  }
  if (query.dossierQuery) {
    const pattern =
      "%" +
      query.dossierQuery.toLocaleLowerCase("fr").replace(/[\\%_]/g, "\\$&") +
      "%";
    where.push(
      `EXISTS(SELECT 1 FROM cabinet_records d WHERE d.id=(r.content->>'dossierId')::uuid AND d.search_title LIKE ${parameter(pattern)})`,
    );
  }
  if (query.regime)
    where.push(
      `r.content->'data'->'fiscal'->>'regime'=${parameter(query.regime)}`,
    );
  if (query.lateBefore)
    where.push(
      `r.content->'data'->>'dueDate'<${parameter(query.lateBefore)} AND r.content->'data'->>'validation'<>'validee_localement'`,
    );
  if (query.from && query.to && query.from > query.to)
    fail(400, "INVALID_PERIOD", "La fin précède le début.");
  for (const [key, path] of Object.entries({
    nature: "r.content->'data'->>'nature'",
    campaign: "r.content->'data'->'fiscal'->'period'->>'campaign'",
    contactId: "r.content->'data'->'fiscal'->>'contactId'",
    classification: "r.content->'data'->'fiscal'->>'classification'",
  })) {
    const value = query[key as keyof RecordListQuery];
    if (value) where.push(`${path}=${parameter(value)}`);
  }
  if (query.taskTypeId)
    where.push(
      `r.kind='tache' AND r.content->'data'->>'typeId'=${parameter(query.taskTypeId)}`,
    );
  if (query.natures !== undefined || query.includeTasks !== undefined) {
    const natures = (query.natures ?? "").split(",").filter(Boolean);
    where.push(
      `((r.kind='tache' AND ${parameter(query.includeTasks !== "false")}::boolean) OR (r.kind='obligation' AND r.content->'data'->>'nature'=ANY(${parameter(natures)}::text[])))`,
    );
  }
  if (query.fiscalOnly === "true")
    where.push(
      "r.kind='obligation' AND r.content->'data'->'fiscal' IS NOT NULL AND r.content->'data'->'fiscal' <> 'null'::jsonb",
    );
  if ((!query.fiscalDateReference && query.year) || query.property) {
    const notice = currentNoticePredicate(query, parameter);
    const period = query.year
      ? `substring(r.content->'data'->'fiscal'->'period'->>'start',1,4)=${parameter(query.year)}`
      : "TRUE";
    where.push(
      `CASE WHEN r.content->'data'->>'nature' IN ('CFE_IFER','TF') THEN EXISTS(SELECT 1 FROM cabinet_fiscal_events e WHERE e.obligation_id=r.id AND e.version<=(r.content->>'version')::integer AND ${notice} AND ${latestNoticePredicate("(r.content->>'version')::integer")}) ELSE (${period} AND ${query.property ? "FALSE" : "TRUE"}) END`,
    );
  }
  if (query.month && !query.fiscalDateReference)
    where.push(
      `substring(r.content->'data'->'fiscal'->'period'->>'start',6,2)=${parameter(query.month)}`,
    );
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
      `((r.kind='tache' AND (r.content->'data'->'assigneeIds') ? ${parameter(query.assigneeId)}) OR (r.kind='obligation' AND (r.content->'data'->'fiscal'->'responsibleIds') ? ${parameter(query.assigneeId)}))`,
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
    query.fiscalDateReference === "period_end"
      ? "r.content->'data'->'fiscal'->'period'->>'end'"
      : query.fiscalDateReference === "closing"
        ? "r.content->'data'->'fiscal'->>'financialYearEnd'"
        : query.fiscalDateReference === "due"
          ? "r.content->'data'->>'dueDate'"
          : "COALESCE(r.content->'data'->>'dueDate',r.content->'data'->>'startedOn',r.content->'data'->>'createdOn',r.content->'data'->>'birthDate')";
  if (query.fiscalDateReference && query.year)
    where.push(`substring(${date},1,4)=${parameter(query.year)}`);
  if (query.fiscalDateReference && query.month)
    where.push(`substring(${date},6,2)=${parameter(query.month)}`);
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

export function fiscalDocumentPredicate(
  actor: SessionUser,
  parameter: (v: unknown) => string,
  documentId: string,
) {
  return `NOT EXISTS(SELECT 1 FROM cabinet_records fiscal_owner WHERE ((fiscal_owner.kind='obligation' AND (fiscal_owner.content->'data'->'fiscal'->'documentIds') ? (${documentId})::text) OR (fiscal_owner.kind='tache' AND (fiscal_owner.content->'data'->'documentIds') ? (${documentId})::text)) AND (${authorizedPredicate(actor, "read", parameter).replaceAll(/\br\./g, "fiscal_owner.")}) IS NOT TRUE)`;
}

// Grid and original archives use the same current notice and coupled year/property semantics.
export function currentNoticePredicate(
  query: Pick<RecordListQuery, "year" | "property">,
  parameter: (v: unknown) => string,
): string {
  const filters = ["e.content->'event'->>'kind'='notice'"];
  if (query.year)
    filters.push(
      `(e.content->'event'->>'year')::integer=${parameter(Number(query.year))}::integer`,
    );
  if (query.property)
    filters.push(
      `(e.content->'event'->'properties') ? ${parameter(query.property)}`,
    );
  return filters.join(" AND ");
}
export function latestNoticePredicate(version: string): string {
  return `NOT EXISTS(SELECT 1 FROM cabinet_fiscal_events newer WHERE newer.obligation_id=e.obligation_id AND newer.content->'event'->>'kind'='notice' AND newer.content->'event'->>'id'=e.content->'event'->>'id' AND newer.version>e.version AND newer.version<=${version})`;
}
