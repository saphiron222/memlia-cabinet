import { createHash } from "node:crypto";
import { z } from "zod";
import {
  previewOccurrences,
  WorkflowGenerationSchema,
  WorkflowModelSchema,
  RecordContentSchema,
  type SessionUser,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { JobRunner } from "../jobs/runner.js";
import { loadModel, commandWork, requireModelAccess } from "./service.js";
import { loadRecord, saveRecord } from "../records/service.js";
import { requireAccess, scopedPermission } from "../records/permissions.js";
import { fail } from "../errors.js";
export function stableId(key: string) {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const inputSchema = WorkflowGenerationSchema.omit({ operationId: true }).extend(
  { model: WorkflowModelSchema, checklist: WorkflowModelSchema.nullable() },
);
export class WorkflowGeneration {
  private enqueue;
  constructor(
    private jobs: JobRunner,
    private now: () => Date,
  ) {
    this.enqueue = jobs.register({
      kind: "workflow-generation",
      input: inputSchema,
      checkpoint: z.object({ index: z.number().int().nonnegative() }),
      result: z.object({ count: z.number().int().nonnegative() }),
      initial: { index: 0 },
      scope: (i) => ({
        dossierId:
          i.model.model.kind === "recurrence" ? i.model.model.dossierId : null,
        resourceKey: "recurrence:" + i.modelId,
      }),
      authorize: async (tx, actor, i) => this.authorize(tx, actor, i.model),
      execute: async (i, ctx) => {
        const m = i.model.model;
        if (m.kind !== "recurrence")
          fail(400, "MODEL_KIND", "Récurrence requise.");
        const dates = previewOccurrences(m.rule, i.from, i.to);
        for (
          let index = ctx.checkpoint.index;
          index < dates.length;
          index += 10
        ) {
          const batch = dates.slice(index, index + 10);
          await ctx.commit(
            { index: index + batch.length },
            "workflow.generated",
            "Occurrences enregistrées.",
            async (tx, actor) => {
              for (const date of batch) {
                const period =
                  m.rule.frequency === "yearly"
                    ? date.slice(0, 4)
                    : m.rule.frequency === "quarterly"
                      ? `${date.slice(0, 4)}-Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`
                      : m.rule.frequency === "weekly"
                        ? weekPeriod(date)
                        : date.slice(0, 7);
                const key = `${i.modelId}:${m.dossierId}:${period}`;
                const existing = await tx.query(
                  "SELECT id,content FROM cabinet_records WHERE content->'data'->'recurrence'->>'key'=$1",
                  [key],
                );
                if (existing[0]) {
                  await requireAccess(
                    tx,
                    actor,
                    "read",
                    await loadRecord(tx, String(existing[0].id)),
                  );
                  continue;
                }
                const r = await saveRecord(
                  tx,
                  actor,
                  {
                    operationId: stableId(key),
                    record: RecordContentSchema.parse({
                      kind: "tache",
                      title: m.name,
                      dossierId: m.dossierId,
                      data: {
                        ...m.task,
                        dueDate: date,
                        recurrence: {
                          modelId: i.modelId,
                          modelVersion: i.model.version,
                          period,
                          key,
                        },
                      },
                    }),
                  },
                  this.now(),
                  undefined,
                  "created",
                  undefined,
                  {
                    kind: "generated",
                    reference: i.modelId,
                    version: String(i.model.version),
                    at: this.now().toISOString(),
                  },
                );
                if (i.checklist) {
                  await commandWork(
                    tx,
                    actor,
                    r.id,
                    {
                      operationId: stableId(key + ":checklist"),
                      expectedVersion: 0,
                      command: {
                        kind: "instantiate",
                        modelId: i.checklist.id,
                        modelVersion: i.checklist.version,
                      },
                    },
                    this.now(),
                  );
                }
              }
            },
          );
        }
        return { count: dates.length };
      },
    }).enqueue;
  }
  async authorize(
    tx: Connection,
    actor: SessionUser,
    model: z.infer<typeof WorkflowModelSchema>,
  ) {
    await requireModelAccess(tx, actor, model.model);
    if (model.model.kind !== "recurrence")
      fail(400, "MODEL_KIND", "Récurrence requise.");
    await requireAccess(
      tx,
      actor,
      "read",
      await loadRecord(tx, model.model.dossierId),
    );
    if (
      !(await scopedPermission(
        tx,
        actor,
        "create",
        "tache",
        model.model.dossierId,
      ))
    )
      fail(403, "FORBIDDEN", "Création non autorisée.");
    const current = await loadModel(tx, model.id);
    await requireModelAccess(tx, actor, current.model);
    if (current.model.kind === "recurrence")
      await requireAccess(
        tx,
        actor,
        "read",
        await loadRecord(tx, current.model.dossierId),
      );
  }
  async generate(
    tx: Connection,
    actor: SessionUser,
    i: z.infer<typeof WorkflowGenerationSchema>,
  ) {
    const model = await loadModel(tx, i.modelId);
    await this.authorize(tx, actor, model);
    if (model.model.kind !== "recurrence")
      fail(400, "MODEL_KIND", "Récurrence requise.");
    previewOccurrences(model.model.rule, i.from, i.to);
    const checklist = model.model.checklistModelId
      ? await loadModel(tx, model.model.checklistModelId)
      : null;
    return {
      jobId: await this.enqueue(tx, actor, i.operationId, {
        modelId: i.modelId,
        from: i.from,
        to: i.to,
        model,
        checklist,
      }),
    };
  }
  async latest(tx: Connection, actor: SessionUser, modelId: string) {
    await this.authorize(tx, actor, await loadModel(tx, modelId));
    const rows = await tx.query(
      "SELECT id FROM cabinet_jobs WHERE actor_id=$1 AND kind='workflow-generation' AND resource_key=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
      [actor.id, "recurrence:" + modelId],
    );
    return {
      job: rows[0] ? await this.get(tx, actor, String(rows[0].id)) : null,
    };
  }
  async get(tx: Connection, actor: SessionUser, id: string) {
    const result = await this.jobs.get(tx, id);
    if (
      result.actorId !== actor.id ||
      result.job.kind !== "workflow-generation"
    )
      fail(404, "NOT_FOUND", "Traitement inaccessible.");
    const input = inputSchema.parse(result.input);
    await this.authorize(tx, actor, input.model);
    return result.job;
  }
}

export function weekPeriod(date: string) {
  const monday = new Date(date + "T00:00:00Z");
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return "week:" + monday.toISOString().slice(0, 10);
}
