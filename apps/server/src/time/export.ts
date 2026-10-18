import { assertTimeCsvRows } from "./csv.js";
import { z } from "zod";
import { TimeExportSchema, type SessionUser } from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { fail } from "../errors.js";
import {
  scopeCte,
  fullScope,
  scope,
  authorize,
  load,
  report,
} from "./service.js";
export async function assertTimeExport(
  tx: Connection,
  actor: SessionUser,
  e: z.infer<typeof TimeExportSchema>,
) {
  if (e.entity === "csv") {
    if (e.data.actorId !== actor.id)
      fail(404, "NOT_FOUND", "Sortie inaccessible.");
    await report(tx, actor, { ...e.data.query, limit: 1 }, "export");
    await assertTimeCsvRows(tx, actor, e.data.id);
  } else {
    const entry = e.entity === "csv_row" ? e.data.entry : e.data;
    await authorize(tx, actor, entry, "export");
    await load(tx, actor, entry.id);
  }
}
export async function timeExportPage(
  tx: Connection,
  actor: SessionUser,
  after: string | null,
) {
  const params: unknown[] = [after],
    p = (v: unknown) => {
      params.push(v);
      return "$" + params.length;
    };
  const cte = await scopeCte(
    tx,
    actor,
    p,
    {
      kind: "time",
      // Prepared CSV rows keep their own targets even after the current entry is
      // retargeted. Both snapshots must pass authorization on every exit page.
      sql: "SELECT content FROM cabinet_time UNION ALL SELECT content FROM cabinet_time_csv_rows",
      params: [],
    },
    "export",
  );
  const sql = `${cte}, entries AS(SELECT overlay(overlay(md5('time-current:'||t.id::text) placing '4' from 13 for 1) placing 'a' from 17 for 1)::uuid id,'current' entity,t.content data FROM cabinet_time t WHERE ${fullScope(actor, p, "t.content", "export")} UNION ALL SELECT overlay(overlay(md5('time-history:'||h.id::text||':'||h.version) placing '4' from 13 for 1) placing 'a' from 17 for 1)::uuid,'history',h.content FROM cabinet_time_history h JOIN cabinet_time t ON t.id=h.id WHERE ${fullScope(actor, p, "t.content", "export")} AND ${scope(actor, p, "h.content", "export")} UNION ALL SELECT overlay(overlay(md5('time-csv:'||c.id::text) placing '4' from 13 for 1) placing 'a' from 17 for 1)::uuid,'csv',jsonb_build_object('id',c.id,'actorId',c.actor_id,'jobId',c.job_id,'query',c.query) FROM cabinet_time_csv c WHERE c.actor_id=${p(actor.id)}::uuid UNION ALL SELECT overlay(overlay(md5('time-csv-row:'||c.export_id::text||':'||c.id::text) placing '4' from 13 for 1) placing 'a' from 17 for 1)::uuid,'csv_row',jsonb_build_object('exportId',c.export_id,'part',c.part,'entry',c.content) FROM cabinet_time_csv_rows c JOIN cabinet_time_csv parent ON parent.id=c.export_id JOIN cabinet_time t ON t.id=c.id WHERE parent.actor_id=${p(actor.id)}::uuid AND ${fullScope(actor, p, "t.content", "export")} AND ${scope(actor, p, "c.content", "export")}), page AS(SELECT id,jsonb_build_object('id',id,'entity',entity,'data',data) content FROM entries WHERE ($1::uuid IS NULL OR id>$1::uuid) ORDER BY id LIMIT 100),bounded AS(SELECT *,sum(octet_length(content::text)) OVER(ORDER BY id) bytes,row_number() OVER(ORDER BY id) ordinal FROM page) SELECT content FROM bounded WHERE bytes<=2097152 OR ordinal=1 ORDER BY id`;
  const page = (await tx.query(sql, params)).map((r) =>
    TimeExportSchema.parse(r.content),
  );
  // A denied stored query makes this exit incomplete; fail explicitly before publishing it.
  for (const e of page)
    if (e.entity === "csv") await assertTimeExport(tx, actor, e);
  return page;
}
