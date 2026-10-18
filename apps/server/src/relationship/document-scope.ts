import { directPermissionSql } from "../records/grants.js";
import type { SessionUser, Action } from "@memlia/contracts";
import { assignmentScope } from "../administration/access.js";
// A SQL function keeps this finite policy out of the expanded Work/Production
// predicates. It is STABLE and SECURITY INVOKER; every call receives the current
// actor/grants and reads canonical assignments and every owner snapshot.
export function relationshipDocumentPredicate(
  a: SessionUser,
  p: (v: unknown) => string,
  id: string,
) {
  return `cabinet_relationship_document_allowed_v12(${p(a.id)}::uuid,${p(JSON.stringify(a.permissions))}::jsonb,(${id})::uuid)`;
}
function policy() {
  const grant = (
    action: Action,
    kind: "dossier" | "contact",
    scope: string,
  ) => {
    const parameter = (v: unknown) =>
      v === "current_actor"
        ? "$1"
        : "'" + String(v).replaceAll("'", "''") + "'";
    return `(${directPermissionSql("$2", action, kind, scope)} OR ${assignmentScope("current_actor", action, kind, scope, parameter)})`;
  };
  const id = "$3";
  const dossier = (alias: string) =>
    `(${grant("read", "dossier", `${alias}.id`)} AND (NOT COALESCE((${alias}.content->>'confidential')::boolean,false) OR ${grant("confidential", "dossier", `${alias}.id`)}))`;
  const person = `(${grant("read", "contact", "(lab_subject.content->>'dossierId')::uuid")} AND (NOT COALESCE((lab_subject.content->>'confidential')::boolean,false) OR ${grant("confidential", "contact", "(lab_subject.content->>'dossierId')::uuid")}))`;
  const links = `(CASE WHEN lab_subject.content->>'dossierId' IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(lab_subject.content->>'dossierId') END || COALESCE(lab_subject.content->'data'->'relatedDossierIds','[]'::jsonb))`;
  const readable = `((lab_subject.kind='dossier' AND ${dossier("lab_subject")}) OR (lab_subject.kind='contact' AND ${person} AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(${links}) link(id) LEFT JOIN cabinet_records parent ON parent.id=link.id::uuid WHERE parent.id IS NULL OR (${dossier("parent")}) IS NOT TRUE OR EXISTS(SELECT 1 FROM cabinet_history ph CROSS JOIN LATERAL(SELECT (ph.event->'snapshot'->>'id')::uuid id,ph.event->'snapshot' content) parent WHERE ph.record_id=link.id::uuid AND (${dossier("parent")}) IS NOT TRUE))))`;
  const snapshots = `SELECT id,kind,content FROM cabinet_records WHERE id IN ((owner.content->'data'->>'dossierId')::uuid,(owner.content->'data'->>'personId')::uuid) UNION ALL SELECT (event->'snapshot'->>'id')::uuid,event->'snapshot'->>'kind',event->'snapshot' FROM cabinet_history WHERE record_id IN ((owner.content->'data'->>'dossierId')::uuid,(owner.content->'data'->>'personId')::uuid)`;
  return `NOT EXISTS(SELECT 1 FROM cabinet_relationship_history owner WHERE owner.content->'data'->>'kind'='lab' AND EXISTS(SELECT 1 FROM cabinet_relationship_history linked WHERE linked.id=owner.id AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(linked.content->'data'->'evidence','[]'::jsonb)) proof WHERE EXISTS(SELECT 1 FROM cabinet_documents lab_proof JOIN cabinet_documents lab_target ON lab_target.logical_id=lab_proof.logical_id WHERE lab_proof.id=(proof->>'documentId')::uuid AND lab_target.id=(${id})::uuid))) AND ((${grant("lab_read", "dossier", "(owner.content->'data'->>'dossierId')::uuid")}) IS NOT TRUE OR NOT EXISTS(SELECT 1 FROM cabinet_records lab_current WHERE lab_current.id=(owner.content->'data'->>'dossierId')::uuid) OR (owner.content->'data'->>'personId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cabinet_records lab_current WHERE lab_current.id=(owner.content->'data'->>'personId')::uuid)) OR EXISTS(SELECT 1 FROM (${snapshots}) lab_subject WHERE (${readable}) IS NOT TRUE)))`;
}

export const relationshipDocumentFunctionV12 = `CREATE OR REPLACE FUNCTION cabinet_relationship_document_allowed_v12(uuid,jsonb,uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path FROM CURRENT AS $relationship$ SELECT ${policy()} $relationship$;`;
