import {
  ProductionQuerySchema,
  ProductionRowSchema,
  type SessionUser,
} from "@memlia/contracts";
import { z } from "zod";
import type { Connection } from "../storage/database.js";
import { authorizedPredicate } from "../records/query.js";
import { hasPermission } from "../records/permissions.js";
import { authorizeRow, loadProductionModel, modelAccess } from "./service.js";
export function productionDocumentPredicate(
  actor: SessionUser,
  p: (value: unknown) => string,
  value: string,
) {
  const docAuth = authorizedPredicate(actor, "read", p);
  return `NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(${value}->'documentIds','[]'::jsonb) || jsonb_path_query_array(${value},'$.cells[*].documentIds[*]') || jsonb_path_query_array(${value},'$.observations[*].documentIds[*]') || jsonb_path_query_array(${value},'$.deposit.attempts[*].documentIds[*]') || jsonb_path_query_array(${value},'$.deposit.attempts[*].receiptDocumentId ? (@ != null)')) piece(id) LEFT JOIN cabinet_documents d ON d.id=piece.id::uuid WHERE d.id IS NULL OR NOT EXISTS(SELECT 1 FROM cabinet_records dossier CROSS JOIN LATERAL (SELECT dossier.id,'dossier'::text kind,jsonb_set(dossier.content,'{confidential}',to_jsonb(COALESCE((dossier.content->>'confidential')::boolean,false) OR COALESCE((d.content->>'confidential')::boolean,false))) content) r WHERE dossier.id=d.dossier_id AND ${docAuth}))`;
}
export function productionScopePredicate(
  actor: SessionUser,
  action: "read" | "export",
  p: (value: unknown) => string,
  value: string,
  recordAuth?: string,
) {
  const snapshotAuth = authorizedPredicate(actor, action, p);
  const auth = recordAuth ?? snapshotAuth;
  const scope = (value: string) =>
    `((${value}->>'recordId' IS NULL OR EXISTS(SELECT 1 FROM cabinet_records r WHERE r.id=(${value}->>'recordId')::uuid AND ${auth})) AND ${productionDocumentPredicate(actor, p, value)} AND CASE WHEN ${value}->'target'->>'kind' IN ('libre','utilisateur') THEN ${hasPermission(actor, action, "*") ? "TRUE" : "FALSE"} ELSE EXISTS(SELECT 1 FROM cabinet_records r WHERE r.id=(${value}->'target'->>'id')::uuid AND ${auth}) END AND (${value}->>'scope' IS NULL OR EXISTS(SELECT 1 FROM (SELECT (${value}->'scope'->>'id')::uuid id,${value}->'scope'->>'kind' kind,${value}->'scope' content) r WHERE ${snapshotAuth})))`;
  return `(${scope(value)} AND NOT EXISTS(SELECT 1 FROM cabinet_production_row_versions history WHERE history.id=(${value}->>'id')::uuid AND NOT ${scope("history.content")}))`;
}
export async function productionRows(
  tx: Connection,
  actor: SessionUser,
  modelId: string,
  q: z.infer<typeof ProductionQuerySchema>,
  action: "read" | "export" = "read",
) {
  await modelAccess(tx, actor, await loadProductionModel(tx, modelId));
  const params: unknown[] = [modelId],
    p = (v: unknown) => {
      params.push(v);
      return "$" + params.length;
    };
  const filters = [
    `p.model_id=$1`,
    productionScopePredicate(actor, action, p, "p.content"),
  ];
  if (q.q)
    filters.push(
      `p.content->'target'->>'label' ILIKE ${p("%" + q.q.replace(/[\\%_]/g, "\\$&") + "%")}`,
    );
  if (q.year)
    filters.push(
      `substring(COALESCE(p.content->>'dueDate',p.content->>'period'),1,4)=${p(q.year)}`,
    );
  if (q.period) filters.push(`p.content->>'period'=${p(q.period)}`);
  if (q.state) filters.push(`p.content->>'state'=${p(q.state)}`);
  if (q.tag) filters.push(`p.content->'tags' ? ${p(q.tag)}`);
  if (q.deposit === "not_applicable")
    filters.push(`p.content->'deposit'->>'applicable'='false'`);
  else if (q.deposit === "not_submitted")
    filters.push(
      `jsonb_array_length(p.content->'deposit'->'attempts')=0 AND p.content->'deposit'->>'applicable'='true'`,
    );
  else if (q.deposit)
    filters.push(
      `p.content->'deposit'->'attempts'->-1->>'state'=${p(q.deposit)}`,
    );
  if (q.after) filters.push(`p.id>${p(q.after)}::uuid`);
  const sort =
    q.sort === "title"
      ? "p.content->'target'->>'label'"
      : q.sort === "dueDate"
        ? "p.content->>'dueDate'"
        : q.sort === "assemblyDate"
          ? "p.content->'deposit'->>'assemblyDate'"
          : q.sort === "depositDate"
            ? "p.content->'deposit'->'attempts'->-1->>'date'"
            : "p.id";
  const rows = await tx.query(
    `SELECT p.content FROM cabinet_production_rows p WHERE ${filters.join(" AND ")} ORDER BY ${sort} ${q.direction === "desc" ? "DESC" : "ASC"},p.id LIMIT 101 OFFSET ${p(q.offset)}`,
    params,
  );
  const items = rows.map((r) => ProductionRowSchema.parse(r.content));
  for (const row of items) await authorizeRow(tx, actor, row, action);
  return { items: items.slice(0, 100), hasMore: items.length > 100 };
}
