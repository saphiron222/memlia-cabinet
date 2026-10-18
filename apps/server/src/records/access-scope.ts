import { RecordKindSchema, type SessionUser } from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { productionSnapshotDocumentIdsSql } from "../production/document-scope.js";
import { authorizedPredicate, relatedRecordIdsSql } from "./query.js";

/** Structural identities only. A missing dependency never becomes a member. */
export interface AccessReferences {
  records: string[];
  production: string[];
}

/**
 * Internal, statement-local access to finite current references and every
 * selected Production version. SQL constructs the subjects from actual rows:
 * no photograph or trusted kind is supplied by a client or kept in memory.
 * The category and exact JSONB identity prevent a readable old photograph or
 * a document's overlaid confidentiality from authorizing the current record.
 */
export async function recordAccessScope(
  tx: Connection,
  actor: SessionUser,
  action: "read" | "export",
  p: (value: unknown) => string,
  references: AccessReferences,
) {
  const member = (category: string, identity: string) =>
    `COALESCE((${identity}) IN (SELECT identity FROM access_allowed WHERE category='${category}'),FALSE)`;
  const membership = {
    record: (id: string) => member("record", `to_jsonb((${id})::uuid)`),
    snapshot: (content: string) => member("snapshot", content),
    document: (id: string) => member("document", `to_jsonb((${id})::uuid)`),
  };
  if (!references.records.length && !references.production.length)
    return {
      ...membership,
      ctes: "access_allowed AS MATERIALIZED(SELECT NULL::text category,NULL::jsonb identity WHERE FALSE)",
    };
  const inspectParams: unknown[] = [];
  const inspect = (value: unknown) => {
    inspectParams.push(value);
    return "$" + inspectParams.length;
  };
  const inspectionCtes = subjectCtes(inspect, references);
  // The only extra application projection is two sets of four canonical kinds
  // and one structural edge-presence bit.
  // Rebuild all subjects in the consuming statement; omitted/unknown kinds are
  // denied by the SQL guards. Serialized callers do not write between these
  // reads. No snapshot, permission result or client-declared type is reused.
  const observed = await tx.query<{ subject: string; kind: string }>(
    `WITH ${inspectionCtes} SELECT DISTINCT 'root' subject,kind FROM access_subjects UNION SELECT 'edge',NULL WHERE EXISTS(SELECT 1 FROM access_subjects r WHERE (r.kind='tache' OR (r.kind='obligation' AND jsonb_typeof(r.content->'data'->'fiscal')='object')) AND jsonb_array_length(${relatedRecordIdsSql("r")})>0)`,
    inspectParams,
  );
  const kinds = RecordKindSchema.options.filter((kind) =>
    observed.some((row) => row.subject === "root" && row.kind === kind),
  );
  const hasEdges = observed.some((row) => row.subject === "edge");
  const dependencies = hasEdges
    ? await tx.query<{ kind: string }>(
        `WITH ${inspectionCtes}, ${dependencyCtes} SELECT DISTINCT kind FROM access_related_subjects`,
        inspectParams,
      )
    : [];
  const relatedKinds = RecordKindSchema.options.filter((kind) =>
    dependencies.some((row) => row.kind === kind),
  );
  const related = hasEdges
    ? "NOT ((r.category,r.identity) IN(SELECT category,identity FROM access_denied_roots))"
    : `jsonb_array_length(${relatedRecordIdsSql("r")})=0`;
  return {
    ...membership,
    ctes: `${subjectCtes(p, references)}, ${hasEdges ? `${dependencyCtes}, access_related_allowed AS MATERIALIZED(${relatedKinds.length ? relatedKinds.map((kind) => `SELECT r.id FROM access_related_subjects r WHERE r.kind='${kind}' AND ${authorizedPredicate(actor, "read", p, false, true, { kind })}`).join(" UNION ALL ") : "SELECT NULL::uuid id WHERE FALSE"}), access_denied_roots AS MATERIALIZED(SELECT DISTINCT category,identity FROM access_reachable WHERE (id IN(SELECT id FROM access_related_allowed)) IS NOT TRUE),` : ""} access_allowed AS MATERIALIZED(
      ${kinds.length ? kinds.map((kind) => `SELECT category,identity FROM access_subjects r WHERE r.kind='${kind}' AND ${authorizedPredicate(actor, action, p, true, true, { readOnlySubject: "r.category='document'", kind, relatedMembership: related })}`).join(" UNION ALL ") : "SELECT NULL::text category,NULL::jsonb identity WHERE FALSE"}
    )`,
  };
}

// UNION terminates cycles and retains missing identities. Root identity includes
// the exact photograph; dependent current records are checked once, with their
// own actual kinds and READ action, just like the canonical recursive branch.
const dependencyCtes = `access_reachable AS MATERIALIZED(
  WITH RECURSIVE reached(category,identity,id) AS (
    SELECT r.category,r.identity,link.value::uuid FROM access_subjects r
      CROSS JOIN LATERAL jsonb_array_elements_text(${relatedRecordIdsSql("r")}) link(value)
      WHERE r.kind='tache' OR (r.kind='obligation' AND jsonb_typeof(r.content->'data'->'fiscal')='object')
    UNION SELECT reached.category,reached.identity,link.value::uuid FROM reached
      JOIN cabinet_records linked ON linked.id=reached.id
      CROSS JOIN LATERAL jsonb_array_elements_text(${relatedRecordIdsSql("linked")}) link(value)
  ) SELECT * FROM reached
), access_related_subjects AS MATERIALIZED(
  SELECT r.id,r.kind,r.content FROM cabinet_records r WHERE r.id IN(SELECT id FROM access_reachable)
)`;

function subjectCtes(
  p: (value: unknown) => string,
  references: AccessReferences,
) {
  const productionIds = p(references.production);
  const recordIds = p(references.records);
  return `access_production AS MATERIALIZED(
      SELECT content FROM cabinet_production_rows WHERE id=ANY(${productionIds}::uuid[])
      UNION SELECT content FROM cabinet_production_row_versions WHERE id=ANY(${productionIds}::uuid[])
    ), access_record_ids AS MATERIALIZED(
      SELECT unnest(${recordIds}::uuid[]) id
      UNION SELECT ref.id::uuid FROM access_production e CROSS JOIN LATERAL(VALUES
        (e.content->>'recordId'),
        (CASE WHEN (e.content->'target'->>'kind' IN('libre','utilisateur')) IS NOT TRUE THEN e.content->'target'->>'id' END)
      ) ref(id) WHERE ref.id IS NOT NULL
    ), access_subjects AS MATERIALIZED(
      SELECT 'record'::text category,to_jsonb(r.id) identity,r.id,r.kind,r.content
        FROM cabinet_records r WHERE r.id IN(SELECT id FROM access_record_ids)
      UNION SELECT 'snapshot',e.content->'scope',(e.content->'scope'->>'id')::uuid,e.content->'scope'->>'kind',e.content->'scope'
        FROM access_production e WHERE e.content->>'scope' IS NOT NULL
      UNION SELECT 'document',to_jsonb(d.id),dossier.id,'dossier',
        jsonb_set(dossier.content,'{confidential}',to_jsonb(COALESCE((dossier.content->>'confidential')::boolean,false) OR COALESCE((d.content->>'confidential')::boolean,false)))
        FROM access_production e CROSS JOIN LATERAL ${productionSnapshotDocumentIdsSql("e.content")} piece(id)
        JOIN cabinet_documents d ON d.id=piece.id::uuid JOIN cabinet_records dossier ON dossier.id=d.dossier_id
    )`;
}

export type RecordAccessScope = Awaited<ReturnType<typeof recordAccessScope>>;
