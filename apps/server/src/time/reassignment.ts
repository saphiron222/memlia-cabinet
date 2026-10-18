import { randomUUID } from "node:crypto";
import { RecordContentSchema } from "@memlia/contracts";
import { loadRecord, saveRecord } from "../records/service.js";
import {
  loadProductionRow,
  commandProductionRow,
} from "../production/service.js";
import { requireAccess } from "../records/permissions.js";
import { z } from "zod";
import {
  TimeReassignmentSchema,
  TimeQuerySchema,
  TimeSaveSchema,
  type SessionUser,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { load, save, entities, authorize } from "./service.js";
import { calculateWorkload } from "./workload.js";
import { requireGlobal } from "../records/permissions.js";
import { fail } from "../errors.js";
import { idempotent } from "../storage/operations.js";
async function authorizeReassignment(
  tx: Connection,
  actor: SessionUser,
  current: import("@memlia/contracts").TimeEntity,
  weights: { userId: string; weight: number }[],
) {
  if (current.data.kind !== "allocation" && current.data.kind !== "assignment")
    fail(400, "INVALID_ALLOCATION", "Affectation attendue.");
  if (current.data.kind === "assignment") {
    const r = await loadRecord(tx, current.data.dossierId);
    await requireAccess(tx, actor, "assign", r);
    if (weights.length !== 1)
      fail(
        400,
        "SINGLE_ROLE_ASSIGNMENT",
        "Choisissez un porteur pour cette affectation de rôle.",
      );
  } else if (current.data.target.kind === "record") {
    const r = await loadRecord(tx, current.data.target.id);
    await requireAccess(tx, actor, "assign", r);
    await requireAccess(tx, actor, "update", r);
  } else {
    await loadProductionRow(tx, actor, current.data.target.id, "assign");
    await loadProductionRow(tx, actor, current.data.target.id, "update");
  }
}
export async function previewReassignment(
  tx: Connection,
  actor: SessionUser,
  i: z.infer<typeof TimeReassignmentSchema>,
) {
  requireGlobal(actor, "time_manage");
  const current = await load(tx, actor, i.allocationId);
  if (current.data.kind !== "allocation" && current.data.kind !== "assignment")
    fail(400, "INVALID_ALLOCATION", "Affectation de charge attendue.");
  if (current.version !== i.expectedVersion)
    fail(409, "VERSION_CONFLICT", "Affectation modifiée. Rechargez.");
  await authorizeReassignment(tx, actor, current, i.weights);
  const proposed = {
    ...current,
    version: current.version + 1,
    data:
      current.data.kind === "assignment"
        ? {
            ...current.data,
            userId: i.weights[0]!.userId,
            weight: i.weights[0]!.weight,
            policyVersion: current.data.policyVersion + 1,
          }
        : {
            ...current.data,
            weights: i.weights,
            policyVersion: current.data.policyVersion + 1,
          },
  };
  await authorize(tx, actor, proposed);
  const priorUsers =
    current.data.kind === "assignment"
      ? [current.data.userId]
      : current.data.weights.map((w) => w.userId);
  // Compare whole-period totals for the affected people, across all readable dossiers.
  const q = {
    ...TimeQuerySchema.parse({
      from: i.from,
      to: i.to,
    }),
    userIds: [...new Set([...priorUsers, ...i.weights.map((w) => w.userId)])],
  };
  const before = await calculateWorkload(tx, actor, q),
    after = await calculateWorkload(tx, actor, q, proposed);
  const sourceVersions: Record<string, number> = {
    ...before.sourceVersions,
    ...after.sourceVersions,
  };
  for (const row of before.rows)
    Object.assign(sourceVersions, row.sourceVersions);
  return { before, after, sourceVersions };
}
export async function commitReassignment(
  tx: Connection,
  actor: SessionUser,
  i: z.infer<typeof TimeReassignmentSchema>,
  now: Date,
) {
  requireGlobal(actor, "time_manage");
  if (!i.operationId || !i.sourceVersions)
    fail(400, "PREVIEW_REQUIRED", "Prévisualisation requise.");
  const current = await load(tx, actor, i.allocationId);
  if (current.data.kind !== "allocation" && current.data.kind !== "assignment")
    fail(400, "INVALID_ALLOCATION", "Affectation attendue.");
  await authorizeReassignment(tx, actor, current, i.weights);
  const result = await idempotent(
    tx,
    actor,
    i.operationId,
    { reassignment: i },
    async () => {
      const preview = await previewReassignment(tx, actor, i);
      if (
        JSON.stringify(Object.entries(preview.sourceVersions).sort()) !==
        JSON.stringify(Object.entries(i.sourceVersions!).sort())
      )
        fail(
          409,
          "VERSION_CONFLICT",
          "Les sources de charge ont changé. Refaire la prévisualisation.",
        );
      const saved = await save(
        tx,
        actor,
        TimeSaveSchema.parse({
          id: current.id,
          expectedVersion: current.version,
          operationId: randomUUID(),
          data:
            current.data.kind === "assignment"
              ? {
                  ...current.data,
                  userId: i.weights[0]!.userId,
                  weight: i.weights[0]!.weight,
                  policyVersion: current.data.policyVersion + 1,
                }
              : {
                  ...current.data,
                  weights: i.weights,
                  policyVersion:
                    current.data.kind === "allocation"
                      ? current.data.policyVersion + 1
                      : 1,
                },
        }),
        now,
      );
      if (current.data.kind === "allocation") {
        const target = current.data.target;
        if (target.kind === "record") {
          const r = await loadRecord(tx, target.id);
          if (r.kind === "tache")
            await saveRecord(
              tx,
              actor,
              {
                operationId: randomUUID(),
                expectedVersion: r.version,
                record: RecordContentSchema.parse({
                  kind: r.kind,
                  title: r.title,
                  dossierId: r.dossierId,
                  confidential: r.confidential,
                  data: {
                    ...r.data,
                    assigneeIds: i.weights.map((w) => w.userId),
                  },
                }),
              },
              now,
              r.id,
            );
        } else {
          const r = await loadProductionRow(tx, actor, target.id);
          if (i.weights.length !== 1)
            fail(
              400,
              "SINGLE_PRODUCTION_OWNER",
              "La production demande un porteur unique.",
            );
          await commandProductionRow(
            tx,
            actor,
            r.id,
            {
              operationId: randomUUID(),
              expectedVersion: r.version,
              command: {
                kind: "properties",
                dueDate: r.dueDate,
                assigneeId: i.weights[0]!.userId,
                tags: r.tags,
                state: r.state,
                documentIds: r.documentIds,
              },
            },
            now,
          );
        }
      }
      return saved;
    },
  );
  await authorize(tx, actor, result);
  await load(tx, actor, result.id);
  return result;
}
