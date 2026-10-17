import { csvCell } from "../records/csv.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ProductionQuerySchema,
  ProductionModelSchema,
  ProductionRowSchema,
  type SessionUser,
  type ProductionModel,
  type ProductionRow,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { JobRunner } from "../jobs/runner.js";
import {
  loadProductionModel,
  modelAccess,
  authorizeRow,
  loadProductionRow,
} from "./service.js";
import { productionRows } from "./query.js";
import { idempotent } from "../storage/operations.js";
import { fail } from "../errors.js";
export const GridExportCommandSchema = z
  .object({
    operationId: z.uuid(),
    modelId: z.uuid(),
    query: ProductionQuerySchema,
  })
  .strict();
const input = z.object({
  exportId: z.uuid(),
  model: ProductionModelSchema,
  query: ProductionQuerySchema,
});
export class ProductionGridExport {
  private enqueue;
  constructor(
    private jobs: JobRunner,
    private now: () => Date,
  ) {
    this.enqueue = jobs.register({
      kind: "production-grid-export",
      input,
      checkpoint: z.object({
        after: z.uuid().nullable(),
        count: z.number().int().nonnegative(),
        part: z.number().int().nonnegative(),
        complete: z.boolean(),
      }),
      initial: { after: null, count: 0, part: 0, complete: false },
      result: z.object({ parts: z.number().int().nonnegative() }),
      scope: (i) => ({
        dossierId: null,
        resourceKey: "production-export:" + i.exportId,
      }),
      authorize: async (tx, actor, i) => {
        await modelAccess(tx, actor, i.model);
        await modelAccess(tx, actor, await loadProductionModel(tx, i.model.id));
      },
      execute: async (i, ctx) => {
        while (!ctx.checkpoint.complete) {
          const prior = ctx.checkpoint;
          await ctx.commit(
            (result: typeof prior) => result,
            null,
            "",
            async (tx, actor) => {
              const page = await productionRows(
                tx,
                actor,
                i.model.id,
                {
                  ...i.query,
                  offset: 0,
                  sort: "id",
                  direction: "asc",
                  after: prior.after ?? undefined,
                },
                "export",
              );
              let part = prior.part,
                bytes = 0;
              for (const row of page.items) {
                const size = Math.max(
                  Buffer.byteLength(JSON.stringify(row)),
                  Buffer.byteLength(csv(i.model, [row])),
                );
                if (size > 8 * 1024 * 1024)
                  fail(
                    413,
                    "EXPORT_ROW_LIMIT",
                    "Une ligne dépasse la taille maximale d’une partie CSV.",
                  );
                if (bytes === 0 || bytes + size > 1024 * 1024) {
                  part++;
                  bytes = 0;
                }
                bytes += size;
                await tx.query(
                  "INSERT INTO cabinet_production_export_rows(export_id,id,part,content) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(export_id,id) DO NOTHING",
                  [i.exportId, row.id, part, JSON.stringify(row)],
                );
              }
              if (prior.count + page.items.length > 100000)
                fail(
                  413,
                  "EXPORT_LIMIT",
                  "Divisez la grille au-delà de 100 000 lignes.",
                );
              return {
                after: page.items.at(-1)?.id ?? prior.after,
                count: prior.count + page.items.length,
                part,
                complete: !page.hasMore,
              };
            },
          );
        }
        return { parts: ctx.checkpoint.part };
      },
    }).enqueue;
  }
  async start(
    tx: Connection,
    actor: SessionUser,
    i: z.infer<typeof GridExportCommandSchema>,
  ) {
    const model = await loadProductionModel(tx, i.modelId);
    await modelAccess(tx, actor, model);
    if (model.model.kind === "stage_type")
      fail(400, "TEMPLATE_REQUIRED", "Grille requise.");
    const result = await idempotent(
      tx,
      actor,
      i.operationId,
      { productionExport: i },
      async () => {
        const exportId = randomUUID();
        await tx.query(
          "INSERT INTO cabinet_production_exports(id,actor_id,content) VALUES($1,$2,$3::jsonb)",
          [
            exportId,
            actor.id,
            JSON.stringify({
              model,
              query: i.query,
              createdAt: this.now().toISOString(),
            }),
          ],
        );
        const jobId = await this.enqueue(tx, actor, randomUUID(), {
          exportId,
          model,
          query: i.query,
        });
        await tx.query(
          "UPDATE cabinet_production_exports SET job_id=$2 WHERE id=$1",
          [exportId, jobId],
        );
        return { jobId };
      },
    );
    await this.get(tx, actor, result.jobId);
    return result;
  }
  async get(tx: Connection, actor: SessionUser, id: string) {
    const job = await this.jobs.get(tx, id);
    if (job.actorId !== actor.id || job.job.kind !== "production-grid-export")
      fail(404, "NOT_FOUND", "Export inaccessible.");
    const i = input.parse(job.input);
    await modelAccess(tx, actor, i.model);
    await modelAccess(tx, actor, await loadProductionModel(tx, i.model.id));
    return {
      job: job.job,
      parts: (job.result as { parts?: number } | null)?.parts ?? 0,
    };
  }
  async part(tx: Connection, actor: SessionUser, id: string, part: number) {
    const result = await this.get(tx, actor, id);
    if (result.job.state !== "completed" || part > result.parts)
      fail(409, "EXPORT_NOT_READY", "Export non disponible.");
    const job = await this.jobs.get(tx, id),
      i = input.parse(job.input);
    const rows = await tx.query(
      "SELECT content FROM cabinet_production_export_rows WHERE export_id=$1 AND part=$2 ORDER BY id",
      [i.exportId, part],
    );
    const items = rows.map((r) => ProductionRowSchema.parse(r.content));
    for (const row of items) {
      await authorizeRow(tx, actor, row, "export");
      await loadProductionRow(tx, actor, row.id, "export");
    }
    return csv(i.model, items);
  }
}
function csv(model: ProductionModel, rows: ProductionRow[]) {
  const quote = csvCell;
  const lines = [
    [
      "ligne_id",
      "cible_type",
      "cible_id",
      "cible",
      "période",
      "échéance",
      "réalisation",
      "modèle_id",
      "version_modèle",
      "colonne_id",
      "colonne",
      "type",
      "fréquence",
      "responsable_étape",
      "date_prévue_étape",
      "minutes_prévues_étape",
      "période_cellule",
      "valeur",
      "approbation_locale",
      "acteur",
      "date_saisie",
      "observation",
      "pièces",
      "dépôt_des_comptes",
    ]
      .map(quote)
      .join(";"),
  ];
  for (const row of rows) {
    const cells = row.cells.length ? row.cells : [null];
    for (const cell of cells) {
      const column =
        model.model.kind === "stage_type"
          ? null
          : model.model.columns.find((c) => c.id === cell?.columnId);
      lines.push(
        [
          row.id,
          row.target.kind,
          row.target.id,
          row.target.label,
          row.period,
          row.dueDate,
          row.state,
          row.modelId,
          row.modelVersion,
          cell?.columnId,
          column?.name,
          column?.type,
          column?.frequency,
          column?.assigneeId,
          column?.plannedDate,
          column?.plannedMinutes,
          cell?.period,
          cell?.value,
          cell?.approved,
          cell?.actorId,
          cell?.at,
          cell?.note,
          JSON.stringify(cell?.documentIds ?? row.documentIds),
          JSON.stringify(row.deposit),
        ]
          .map(quote)
          .join(";"),
      );
    }
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
