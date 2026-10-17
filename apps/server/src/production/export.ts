import { CabinetRecordSchema } from "@memlia/contracts";
import { requireAccess } from "../records/permissions.js";
import {
  ProductionGenerationResultSchema,
  ProductionGridSnapshotSchema,
  ProductionGridSnapshotRowSchema,
  ProductionExportSchema,
  ProductionModelSchema,
  ProductionRowSchema,
  ProductionImportPreviewSchema,
  type SessionUser,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import {
  loadProductionModel,
  loadProductionRow,
  modelAccess,
  authorizeRow,
} from "./service.js";
import { hasPermission, requireGlobal } from "../records/permissions.js";
import { fail } from "../errors.js";
import { z } from "zod";
export async function assertProductionExport(
  tx: Connection,
  actor: SessionUser,
  e: z.infer<typeof ProductionExportSchema>,
) {
  if (e.entity === "model" || e.entity === "model_version") {
    const m = ProductionModelSchema.parse(e.data);
    await modelAccess(tx, actor, m);
    await modelAccess(tx, actor, await loadProductionModel(tx, m.id));
  } else if (e.entity === "row" || e.entity === "row_version") {
    const r = ProductionRowSchema.parse(e.data);
    await authorizeRow(tx, actor, r, "export");
    await loadProductionRow(tx, actor, r.id, "export");
  } else if (e.entity === "generation_result") {
    const r = ProductionGenerationResultSchema.parse(e.data);
    if (r.rowId) await loadProductionRow(tx, actor, r.rowId, "export");
    else {
      const rows = await tx.query(
        "SELECT content FROM cabinet_records WHERE id=$1",
        [r.targetId],
      );
      if (!rows[0]) fail(404, "NOT_FOUND", "Résultat inaccessible.");
      await requireAccess(
        tx,
        actor,
        "export",
        CabinetRecordSchema.parse(rows[0].content),
      );
    }
    await modelAccess(tx, actor, await loadProductionModel(tx, r.modelId));
  } else if (e.entity === "grid_export") {
    const g = ProductionGridSnapshotSchema.parse(e.data);
    if (g.actorId !== actor.id) fail(404, "NOT_FOUND", "Export inaccessible.");
    await modelAccess(tx, actor, g.model);
    await modelAccess(tx, actor, await loadProductionModel(tx, g.model.id));
  } else if (e.entity === "grid_export_row") {
    const g = ProductionGridSnapshotRowSchema.parse(e.data);
    await authorizeRow(tx, actor, g.row, "export");
    await loadProductionRow(tx, actor, g.row.id, "export");
  } else {
    const p = ProductionImportPreviewSchema.parse(e.data);
    if (p.actorId !== actor.id) fail(404, "NOT_FOUND", "Reprise inaccessible.");
    requireGlobal(actor, "export");
  }
}
export async function productionExportPage(
  tx: Connection,
  exportId: string,
  actor: SessionUser,
  after: string | null,
) {
  const modelScope = (s: string) =>
    `(${s}->'model'->>'kind'='stage_type' OR (${s}->'model'->>'target'='utilisateur' AND ${hasPermission(actor, "export", "*") ? "TRUE" : "FALSE"}) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(${s}->'model'->'population','[]'::jsonb)) pop(id) WHERE NOT EXISTS(SELECT 1 FROM cabinet_export_rows e WHERE e.export_id=$1 AND e.kind='record' AND e.id=pop.id::uuid)))`;
  const rowScope = (s: string) =>
    `(CASE WHEN ${s}->'target'->>'kind' IN ('libre','utilisateur') THEN ${hasPermission(actor, "export", "*") ? "TRUE" : "FALSE"} ELSE EXISTS(SELECT 1 FROM cabinet_export_rows e WHERE e.export_id=$1 AND e.kind='record' AND e.id=(${s}->'target'->>'id')::uuid) END)`;
  const sql = `WITH entries AS (
 SELECT overlay(overlay(md5('production-model:'||m.id::text) placing '4' from 13 for 1) placing 'a' from 17 for 1)::uuid id,'model' entity,m.content data FROM cabinet_production_models m WHERE ${modelScope("m.content")}
 UNION ALL SELECT overlay(overlay(md5('production-model-version:'||m.id::text||':'||m.version) placing '4' from 13 for 1) placing 'a' from 17 for 1)::uuid,'model_version',m.content FROM cabinet_production_model_versions m JOIN cabinet_production_models c ON c.id=m.id WHERE ${modelScope("m.content")} AND ${modelScope("c.content")}
 UNION ALL SELECT overlay(overlay(md5('production-row:'||p.id::text) placing '4' from 13 for 1) placing 'a' from 17 for 1)::uuid,'row',p.content FROM cabinet_production_rows p WHERE ${rowScope("p.content")}
 UNION ALL SELECT overlay(overlay(md5('production-row-version:'||p.id::text||':'||p.version) placing '4' from 13 for 1) placing 'a' from 17 for 1)::uuid,'row_version',p.content FROM cabinet_production_row_versions p JOIN cabinet_production_rows c ON c.id=p.id WHERE ${rowScope("p.content")} AND ${rowScope("c.content")}
 UNION ALL SELECT overlay(overlay(md5('production-import:'||i.id::text) placing '4' from 13 for 1) placing 'a' from 17 for 1)::uuid,'stage_import',i.content FROM cabinet_production_imports i WHERE i.actor_id=$3
 UNION ALL SELECT overlay(overlay(md5('production-result:'||g.run_id::text||':'||g.ordinal) placing '4' from 13 for 1) placing 'a' from 17 for 1)::uuid,'generation_result',g.content||jsonb_build_object('runId',g.run_id,'modelId',j.input->>'modelId','modelVersion',j.input->'model'->'version') FROM cabinet_production_generation_results g JOIN cabinet_jobs j ON j.id=g.run_id WHERE EXISTS(SELECT 1 FROM cabinet_export_rows e WHERE e.export_id=$1 AND e.kind='record' AND e.id=g.target_id) AND ${modelScope("j.input->'model'")}
 UNION ALL SELECT overlay(overlay(md5('production-grid:'||g.id::text) placing '4' from 13 for 1) placing 'a' from 17 for 1)::uuid,'grid_export',g.content||jsonb_build_object('exportId',g.id,'actorId',g.actor_id,'jobId',g.job_id) FROM cabinet_production_exports g WHERE g.actor_id=$3 AND ${modelScope("g.content->'model'")}
 UNION ALL SELECT overlay(overlay(md5('production-grid-row:'||g.export_id::text||':'||g.id::text) placing '4' from 13 for 1) placing 'a' from 17 for 1)::uuid,'grid_export_row',jsonb_build_object('exportId',g.export_id,'part',g.part,'row',g.content) FROM cabinet_production_export_rows g JOIN cabinet_production_exports h ON h.id=g.export_id WHERE h.actor_id=$3 AND ${rowScope("g.content")}
 ), page AS(SELECT jsonb_build_object('id',id,'entity',entity,'data',data) content,id FROM entries WHERE ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT 100), bounded AS(SELECT *,sum(octet_length(content::text)) OVER(ORDER BY id) bytes,row_number() OVER(ORDER BY id) ordinal FROM page) SELECT content FROM bounded WHERE bytes<=2097152 OR ordinal=1 ORDER BY id`;
  // Use the same deterministic UUID for ordering and the external identity.
  const rows = await tx.query(sql, [exportId, after, actor.id]);
  const items = rows.map((r) => ProductionExportSchema.parse(r.content));
  for (const item of items) await assertProductionExport(tx, actor, item);
  return items;
}
