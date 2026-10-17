import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  TimeQuerySchema,
  TimeEntitySchema,
  TimeCsvCommandSchema,
  type SessionUser,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { JobRunner } from "../jobs/runner.js";
import { report, authorize, load } from "./service.js";
import { requireGlobal } from "../records/permissions.js";
import { idempotent } from "../storage/operations.js";
import { fail } from "../errors.js";
import { csvCell } from "../records/csv.js";
const input = z.object({
  exportId: z.uuid(),
  query: TimeQuerySchema,
  total: z.number().int(),
});
export class TimeCsv {
  private enqueue;
  constructor(private jobs: JobRunner) {
    this.enqueue = jobs.register({
      kind: "time-csv",
      input,
      checkpoint: z.object({
        offset: z.number().int(),
        parts: z.number().int(),
        complete: z.boolean(),
      }),
      initial: { offset: 0, parts: 0, complete: false },
      result: z.object({ parts: z.number().int() }),
      scope: (i) => ({
        dossierId: null,
        resourceKey: "time-csv:" + i.exportId,
      }),
      authorize: async (tx, actor, i) => {
        requireGlobal(actor, "export");
        await report(tx, actor, { ...i.query, limit: 1 }, "export");
        await this.assertRows(tx, actor, i.exportId);
      },
      execute: async (i, ctx) => {
        while (!ctx.checkpoint.complete) {
          const prior = ctx.checkpoint;
          await ctx.commit(
            (v: typeof prior) => v,
            null,
            "",
            async (tx, actor) => {
              const page = await report(
                tx,
                actor,
                { ...i.query, offset: prior.offset, limit: 100 },
                "export",
              );
              if (page.total !== i.total)
                fail(
                  409,
                  "EXPORT_CHANGED",
                  "Les temps ont changé. Recommencez la sortie.",
                );
              if (i.total > 100000)
                fail(
                  413,
                  "EXPORT_LIMIT",
                  "Réduisez la période au-delà de 100 000 saisies.",
                );
              for (const e of page.entries)
                await tx.query(
                  "INSERT INTO cabinet_time_csv_rows(export_id,id,part,content) VALUES($1,$2,$3,$4::jsonb)",
                  [i.exportId, e.id, prior.parts + 1, JSON.stringify(e)],
                );
              return {
                offset: prior.offset + page.entries.length,
                parts: prior.parts + 1,
                complete: !page.hasMore,
              };
            },
          );
        }
        return { parts: ctx.checkpoint.parts };
      },
    }).enqueue;
  }
  async assertRows(tx: Connection, actor: SessionUser, exportId: string) {
    let after: string | null = null;
    while (true) {
      const rows: Record<string, unknown>[] = await tx.query(
        "SELECT id,content FROM cabinet_time_csv_rows WHERE export_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 100",
        [exportId, after],
      );
      if (!rows.length) break;
      for (const r of rows) {
        const e = TimeEntitySchema.parse(r.content);
        await authorize(tx, actor, e, "export");
        const current = await load(tx, actor, e.id);
        if (current.version !== e.version)
          fail(
            409,
            "EXPORT_CHANGED",
            "Une saisie de la sortie a changé. Régénérez.",
          );
      }
      after = String(rows.at(-1)!.id);
    }
  }
  async start(
    tx: Connection,
    actor: SessionUser,
    i: z.infer<typeof TimeCsvCommandSchema>,
  ) {
    requireGlobal(actor, "export");
    const r = await report(tx, actor, { ...i.query, limit: 1 }, "export");
    const result = await idempotent(
      tx,
      actor,
      i.operationId,
      { timeCsv: i },
      async () => {
        const exportId = randomUUID(),
          jobId = await this.enqueue(tx, actor, randomUUID(), {
            exportId,
            query: i.query,
            total: r.total,
          });
        await tx.query(
          "INSERT INTO cabinet_time_csv(id,actor_id,job_id,query) VALUES($1,$2,$3,$4::jsonb)",
          [exportId, actor.id, jobId, JSON.stringify(i.query)],
        );
        return { id: jobId };
      },
    );
    await this.get(tx, actor, result.id);
    return result;
  }
  async get(tx: Connection, actor: SessionUser, id: string) {
    const j = await this.jobs.get(tx, id);
    if (j.actorId !== actor.id || j.job.kind !== "time-csv")
      fail(404, "NOT_FOUND", "Sortie inaccessible.");
    requireGlobal(actor, "export");
    const i = input.parse(j.input);
    await report(tx, actor, { ...i.query, limit: 1 }, "export");
    await this.assertRows(tx, actor, i.exportId);
    return {
      id,
      job: j.job,
      parts: (j.result as { parts?: number } | null)?.parts ?? 0,
    };
  }
  async part(tx: Connection, actor: SessionUser, id: string, part: number) {
    const r = await this.get(tx, actor, id);
    if (r.job.state !== "completed" || part > r.parts)
      fail(409, "EXPORT_NOT_READY", "Sortie non disponible.");
    const i = input.parse((await this.jobs.get(tx, id)).input);
    const rows = await tx.query(
      "SELECT content FROM cabinet_time_csv_rows WHERE export_id=$1 AND part=$2 ORDER BY content->'data'->>'date',id",
      [i.exportId, part],
    );
    const lines = [
      [
        "saisie_id",
        "version",
        "date",
        "auteur_id",
        "nature_id",
        "relation",
        "objet_id",
        "libellé_libre",
        "secondes",
        "origine",
        "taux_horaire",
        "taux_version",
      ],
    ];
    for (const r of rows) {
      const e = TimeEntitySchema.parse(r.content),
        d = e.data;
      if (d.kind !== "entry") continue;
      lines.push([
        e.id,
        String(e.version),
        d.date,
        d.userId,
        d.natureId,
        d.link.kind,
        d.link.kind === "free" ? "" : d.link.id,
        d.link.kind === "free" ? d.link.label : "",
        String(d.seconds),
        d.source,
        d.rate?.hourlyAmount ?? "",
        String(d.rate?.version ?? ""),
      ]);
    }
    return (
      "\uFEFF" +
      lines.map((line) => line.map(csvCell).join(";")).join("\r\n") +
      "\r\n"
    );
  }
}
