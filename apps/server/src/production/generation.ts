import { z } from "zod";
import {
  ProductionGenerationSchema,
  ProductionModelSchema,
  previewOccurrences,
  type SessionUser,
} from "@memlia/contracts";
import { JobRunner } from "../jobs/runner.js";
import type { Connection } from "../storage/database.js";
import {
  loadProductionModel,
  modelAccess,
  createProductionRow,
  loadProductionRow,
  commandProductionRow,
} from "./service.js";
import { loadRecord } from "../records/service.js";
import { requireGlobal } from "../records/permissions.js";
import { stableId } from "../workflows/generation.js";
import { ApiFault, fail } from "../errors.js";
const input = ProductionGenerationSchema.omit({ operationId: true }).extend({
  model: ProductionModelSchema,
});
export class ProductionGeneration {
  private enqueue;
  constructor(
    private jobs: JobRunner,
    private now: () => Date,
  ) {
    this.enqueue = jobs.register({
      kind: "production-generation",
      input,
      checkpoint: z.object({ index: z.number().int().nonnegative() }),
      result: z.object({ count: z.number().int().nonnegative() }),
      initial: { index: 0 },
      scope: (i) => ({
        dossierId: null,
        resourceKey: "production:" + i.modelId,
      }),
      authorize: async (tx, actor, i) => {
        requireGlobal(actor, "manage_users");
        const m = await loadProductionModel(tx, i.modelId);
        if (m.model.kind === "stage_type" || m.model.paused || m.model.closed)
          fail(409, "MODEL_PAUSED", "Génération suspendue.");
      },
      execute: async (i, ctx) => {
        const model = i.model.model;
        if (model.kind === "stage_type")
          fail(400, "TEMPLATE_REQUIRED", "Modèle requis.");
        const dates =
          model.kind === "balance"
            ? [`${model.year}-12-31`]
            : model.rule
              ? previewOccurrences(model.rule, i.from, i.to)
              : [];
        const count = dates.length * model.population.length;
        if (count > 20000)
          fail(
            413,
            "GENERATION_LIMIT",
            "Réduisez la période ou la population (20 000 occurrences maximum).",
          );
        for (let index = ctx.checkpoint.index; index < count; index += 10) {
          const stop = Math.min(count, index + 10);
          await ctx.commit(
            { index: stop },
            stop % 100 === 0 || stop === count ? "production.generated" : null,
            "Lot de production enregistré.",
            async (tx, actor) => {
              for (let n = index; n < stop; n++) {
                const targetId =
                    model.population[Math.floor(n / dates.length)]!,
                  date = dates[n % dates.length]!,
                  period =
                    model.kind === "balance" ||
                    model.rule?.frequency === "yearly"
                      ? date.slice(0, 4)
                      : model.rule?.frequency === "quarterly"
                        ? `${date.slice(0, 4)}-Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`
                        : date.slice(0, 7);
                let rowId: string | null = null,
                  state = "created",
                  code: string | null = null;
                await tx.query("SAVEPOINT production_item");
                try {
                  const target = await loadRecord(tx, targetId);
                  const before = await tx.query(
                    "SELECT id FROM cabinet_production_rows WHERE model_id=$1 AND content->'target'->>'id'=$2 AND content->>'period'=$3",
                    [i.modelId, targetId, period],
                  );
                  const row = await createProductionRow(
                    tx,
                    actor,
                    i.modelId,
                    {
                      operationId: stableId(
                        `generation:${i.modelId}:${i.model.version}:${targetId}:${period}`,
                      ),
                      expectedVersion: i.model.version,
                      target: {
                        kind: "dossier",
                        id: targetId,
                        label: target.title,
                      },
                      period,
                    },
                    this.now(),
                    model.kind === "balance" ? null : date,
                    true,
                  );
                  rowId = row.id;
                  state = before.length ? "existing" : "created";
                  if (
                    before.length &&
                    model.kind === "custom" &&
                    !row.touched &&
                    row.state === "not_done" &&
                    !row.cells.length &&
                    !row.documentIds.length &&
                    row.dueDate !== date
                  ) {
                    const work = await tx.query(
                      "SELECT content FROM cabinet_work WHERE id=$1",
                      [row.id],
                    );
                    const untouched =
                      !work[0] ||
                      ((
                        work[0].content as {
                          comments: unknown[];
                          checklist: { items: { done: boolean }[] } | null;
                        }
                      ).comments.length === 0 &&
                        !(
                          work[0].content as {
                            checklist: { items: { done: boolean }[] } | null;
                          }
                        ).checklist?.items.some((x) => x.done));
                    if (untouched) {
                      await commandProductionRow(
                        tx,
                        actor,
                        row.id,
                        {
                          operationId: stableId(
                            "regenerate:" +
                              i.modelId +
                              ":" +
                              i.model.version +
                              ":" +
                              targetId +
                              ":" +
                              period,
                          ),
                          expectedVersion: row.version,
                          command: {
                            kind: "properties",
                            dueDate: date,
                            assigneeId: row.assigneeId,
                            tags: row.tags,
                            state: row.state,
                            documentIds: row.documentIds,
                          },
                        },
                        this.now(),
                        true,
                      );
                      state = "regenerated";
                    }
                  }

                  await tx.query("RELEASE SAVEPOINT production_item");
                } catch (e) {
                  await tx.query("ROLLBACK TO SAVEPOINT production_item");
                  await tx.query("RELEASE SAVEPOINT production_item");
                  if (!(e instanceof ApiFault)) throw e;
                  state = "refused";
                  code = [403, 404].includes(e.status)
                    ? "INACCESSIBLE"
                    : e.code;
                }
                await tx.query(
                  "INSERT INTO cabinet_production_generation_results(run_id,ordinal,target_id,content) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(run_id,ordinal) DO NOTHING",
                  [
                    ctx.id,
                    n,
                    targetId,
                    JSON.stringify({
                      ordinal: n,
                      targetId,
                      period,
                      state,
                      code,
                      rowId,
                    }),
                  ],
                );
              }
            },
          );
        }
        return { count };
      },
    }).enqueue;
  }
  async preview(
    tx: Connection,
    actor: SessionUser,
    i: z.infer<typeof ProductionGenerationSchema>,
  ) {
    const m = await loadProductionModel(tx, i.modelId);
    await modelAccess(tx, actor, m);
    if (m.model.kind !== "balance" && m.model.kind !== "custom")
      fail(400, "GENERATION_TARGET", "Bilan ou échéance personnalisée requis.");
    return {
      dates:
        m.model.kind === "balance"
          ? [`${m.model.year}-12-31`]
          : previewOccurrences(m.model.rule!, i.from, i.to),
      population: m.model.population.length,
      paused: m.model.paused,
      modelVersion: m.version,
    };
  }
  async generate(
    tx: Connection,
    actor: SessionUser,
    i: z.infer<typeof ProductionGenerationSchema>,
  ) {
    await this.preview(tx, actor, i);
    const model = await loadProductionModel(tx, i.modelId);
    return {
      jobId: await this.enqueue(tx, actor, i.operationId, {
        modelId: i.modelId,
        from: i.from,
        to: i.to,
        model,
      }),
    };
  }
  async get(tx: Connection, actor: SessionUser, id: string) {
    const result = await this.jobs.get(tx, id);
    if (
      result.job.kind !== "production-generation" ||
      result.actorId !== actor.id
    )
      fail(404, "NOT_FOUND", "Traitement inaccessible.");
    const i = input.parse(result.input);
    requireGlobal(actor, "manage_users");
    return result.job;
  }
  async results(
    tx: Connection,
    actor: SessionUser,
    id: string,
    offset: number,
  ) {
    await this.get(tx, actor, id);
    const rows = await tx.query(
      "SELECT content FROM cabinet_production_generation_results WHERE run_id=$1 ORDER BY ordinal OFFSET $2 LIMIT 100",
      [id, offset],
    );
    const items = [];
    for (const r of rows) {
      const c = r.content as {
        rowId: string | null;
        ordinal: number;
        targetId: string;
        period: string;
        state: string;
        code: string | null;
      };
      try {
        if (c.rowId) await loadProductionRow(tx, actor, c.rowId);
        else
          await modelAccess(
            tx,
            actor,
            ProductionModelSchema.parse({
              id,
              version: 1,
              actorId: actor.id,
              updatedAt: this.now().toISOString(),
              model: {
                kind: "process",
                name: "Résultat",
                target: "dossier",
                population: [c.targetId],
              },
            }),
          );
        items.push(c);
      } catch {
        items.push({
          ordinal: c.ordinal,
          state: "refused",
          code: "INACCESSIBLE",
        });
      }
    }
    return { items, hasMore: rows.length === 100 };
  }
}
