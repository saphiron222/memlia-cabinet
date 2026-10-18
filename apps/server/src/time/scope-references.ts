import type { Connection } from "../storage/database.js";

export interface ScopeSelection {
  kind: "time" | "record" | "production";
  sql: string;
  params: unknown[];
}

// This is a dependency projection, never an authorization result. The caller
// still applies the canonical predicates to every referenced current resource.
// Keep the selection before pagination and include all versions: an old target
// can deny the current entity even when it is absent from the visible page.
export async function scopeReferences(tx: Connection, source: ScopeSelection) {
  const initial =
    source.kind === "time"
      ? `SELECT ref.kind,ref.id::uuid id FROM (
          SELECT content FROM selected
          UNION ALL SELECT h.content FROM cabinet_time_history h
          WHERE h.id IN(SELECT (content->>'id')::uuid FROM selected)
        ) e CROSS JOIN LATERAL (VALUES
          ('record',e.content->'data'->>'dossierId'),
          (e.content->'data'->'link'->>'kind',e.content->'data'->'link'->>'id'),
          (e.content->'data'->'target'->>'kind',e.content->'data'->'target'->>'id'),
          (CASE WHEN e.content->'data'->>'level'='production' THEN 'production' ELSE 'record' END,
            CASE WHEN e.content->'data'->>'kind'='plan' AND e.content->'data'->>'level'<>'cabinet' THEN e.content->'data'->>'targetId' END)
        ) ref(kind,id) WHERE ref.kind IN('record','production') AND ref.id IS NOT NULL`
      : `SELECT '${source.kind}'::text kind,(content->>'id')::uuid id FROM selected`;
  const rows = await tx.query<{ records: string[]; production: string[] }>(
    `WITH selected AS MATERIALIZED (${source.sql}),
      direct_refs AS MATERIALIZED (${initial}),
      production_refs AS MATERIALIZED (SELECT id FROM direct_refs WHERE kind='production'),
      production_subjects AS (
        SELECT content FROM cabinet_production_rows WHERE id IN(SELECT id FROM production_refs)
        UNION ALL SELECT content FROM cabinet_production_row_versions WHERE id IN(SELECT id FROM production_refs)
      ), refs AS (
        SELECT kind,id FROM direct_refs
        UNION ALL SELECT 'record',ref.id::uuid FROM production_subjects e
          CROSS JOIN LATERAL (VALUES
            (e.content->>'recordId'),
            (CASE WHEN (e.content->'target'->>'kind' IN('libre','utilisateur')) IS NOT TRUE THEN e.content->'target'->>'id' END)
          ) ref(id) WHERE ref.id IS NOT NULL
      ) SELECT
        COALESCE(array_agg(DISTINCT id) FILTER(WHERE kind='record'),'{}'::uuid[]) records,
        COALESCE(array_agg(DISTINCT id) FILTER(WHERE kind='production'),'{}'::uuid[]) production
      FROM refs`,
    source.params,
  );
  return rows[0]!;
}
