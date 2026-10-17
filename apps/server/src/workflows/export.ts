import {
  WorkflowExportSchema,
  type WorkflowExport,
  type SessionUser,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { requireAccess } from "../records/permissions.js";
import { loadRecord } from "../records/service.js";
import { loadModel, workTarget, readWork } from "./service.js";
import { fail } from "../errors.js";
// Every relation is selected through the already authorized complete-exit record set.
export async function workflowExportPage(
  tx: Connection,
  exportId: string,
  actor: SessionUser,
  after: string | null,
) {
  const modelScope = (c: string) =>
    `(${c}->'model'->>'kind' IN ('checklist','task_type') OR (${c}->'model'->>'kind'='recurrence' AND EXISTS(SELECT 1 FROM cabinet_export_rows s WHERE s.export_id=$1 AND s.kind='record' AND s.id=(${c}->'model'->>'dossierId')::uuid)) OR (${c}->'model'->>'kind'='reminder' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(${c}->'model'->'targetIds') t(id) WHERE NOT EXISTS(SELECT 1 FROM cabinet_export_rows s WHERE s.export_id=$1 AND s.kind='record' AND s.id=t.id::uuid))))`;
  const target = (id: string) =>
    `EXISTS(SELECT 1 FROM cabinet_export_rows s WHERE s.export_id=$1 AND s.kind='record' AND s.id=${id})`;
  const sql = `WITH entries AS (
 SELECT overlay(overlay(md5('model:'||m.id::text) placing '4' from 13 for 1) placing 'a' from 17 for 1)::uuid id,jsonb_build_object('entity','model','data',m.content) payload FROM cabinet_workflow_models m WHERE ${modelScope("m.content")}
 UNION ALL SELECT overlay(overlay(md5('model_version:'||m.id::text||':'||m.version) placing '4' from 13 for 1) placing 'a' from 17 for 1)::uuid,jsonb_build_object('entity','model_version','data',m.content) FROM cabinet_workflow_model_versions m JOIN cabinet_workflow_models current ON current.id=m.id WHERE ${modelScope("m.content")} AND ${modelScope("current.content")}
 UNION ALL SELECT overlay(overlay(md5('work:'||w.id::text) placing '4' from 13 for 1) placing 'a' from 17 for 1)::uuid,jsonb_build_object('entity','work','data',w.content) FROM cabinet_work w WHERE ${target("w.id")}
 UNION ALL SELECT w.id,jsonb_build_object('entity','work_event','data',w.content,'actorId',w.actor_id,'operationId',w.operation_id) FROM cabinet_work_events w WHERE ${target("w.target_id")}
 UNION ALL SELECT n.id,jsonb_build_object('entity','notification','data',n.content) FROM cabinet_notifications n WHERE n.recipient_id=$3 AND ${target("n.target_id")}
 UNION ALL SELECT overlay(overlay(md5('notification_preferences:'||p.user_id::text) placing '4' from 13 for 1) placing 'a' from 17 for 1)::uuid,jsonb_build_object('entity','notification_preferences','userId',p.user_id,'data',p.content) FROM cabinet_notification_preferences p WHERE p.user_id=$3
 UNION ALL SELECT i.id,jsonb_build_object('entity','checklist_import','data',i.content) FROM cabinet_workflow_imports i WHERE i.actor_id=$3
 ), page AS (SELECT id,payload||jsonb_build_object('id',id) content FROM entries WHERE ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 200), bounded AS (SELECT *,sum(octet_length(content::text)) OVER(ORDER BY id) bytes,row_number() OVER(ORDER BY id) ordinal FROM page) SELECT content FROM bounded WHERE bytes<=2097152 OR ordinal=1 ORDER BY id`;
  const rows = await tx.query(sql, [exportId, after, actor.id]);
  const entries = rows.map((r) => WorkflowExportSchema.parse(r.content));
  for (const entry of entries) await assertWorkflowExport(tx, actor, entry);
  return entries;
}
export async function assertWorkflowExport(
  tx: Connection,
  actor: SessionUser,
  e: WorkflowExport,
) {
  if (e.entity === "work" || e.entity === "work_event") {
    await workTarget(tx, actor, e.data.id, "export");
    await requireAccess(tx, actor, "export", e.data.target);
    await readWork(tx, actor, e.data.id);
  }
  if (e.entity === "model" || e.entity === "model_version")
    for (const model of [e.data, await loadModel(tx, e.data.id)]) {
      const m = model.model;
      if (m.kind === "recurrence")
        await requireAccess(
          tx,
          actor,
          "export",
          await loadRecord(tx, m.dossierId),
        );
      if (m.kind === "reminder")
        for (const id of m.targetIds) await workTarget(tx, actor, id, "export");
    }
  if (e.entity === "notification") {
    if (e.data.recipientId !== actor.id)
      fail(403, "FORBIDDEN", "Sortie inaccessible.");
    await workTarget(tx, actor, e.data.targetId, "export");
    await readWork(tx, actor, e.data.targetId);
  }
  if (
    (e.entity === "notification_preferences" && e.userId !== actor.id) ||
    (e.entity === "checklist_import" && e.data.actorId !== actor.id)
  )
    fail(403, "FORBIDDEN", "Sortie inaccessible.");
}
