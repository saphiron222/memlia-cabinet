import { notifyWork } from "../notifications/service.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  WorkflowModelSchema,
  WorkflowModelCommandSchema,
  WorkStateSchema,
  type WorkState,
  type WorkCommand,
  type SessionUser,
  type Action,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { loadRecord } from "../records/service.js";
import { requireAccess, requireGlobal } from "../records/permissions.js";
import { idempotent } from "../storage/operations.js";
import { fiscalDetail } from "../fiscal/service.js";
import { requireModule } from "../administration/settings.js";
import { fail } from "../errors.js";
export async function workTarget(
  tx: Connection,
  actor: SessionUser,
  id: string,
  action: Action = "read",
) {
  const record = await loadRecord(tx, id);
  if (record.kind !== "tache" && record.kind !== "obligation")
    fail(400, "INVALID_TARGET", "Tâche ou obligation requise.");
  await requireAccess(tx, actor, action, record);
  if (record.kind === "obligation" && record.data.fiscal) {
    await fiscalDetail(tx, actor, id, new Date());
    if (action !== "read" && action !== "export")
      await requireModule(tx, "fiscal");
  }
  return record;
}
export async function readWork(
  tx: Connection,
  actor: SessionUser,
  id: string,
): Promise<WorkState> {
  const target = await workTarget(tx, actor, id);
  const rows = await tx.query("SELECT content FROM cabinet_work WHERE id=$1", [
    id,
  ]);
  const work = rows[0]
    ? WorkStateSchema.parse(rows[0].content)
    : WorkStateSchema.parse({
        id,
        version: 0,
        target,
        checklist:
          target.kind === "tache" && target.data.checklist.length
            ? {
                id: target.id,
                modelId: null,
                modelVersion: null,
                knownItemIds: target.data.checklist.map((i) => i.id),
                items: target.data.checklist,
              }
            : null,
        updatedAt: target.updatedAt,
      });
  await requireAccess(tx, actor, "read", work.target);
  let after = 0;
  while (true) {
    const history = await tx.query(
      "SELECT version,content FROM cabinet_work_events WHERE target_id=$1 AND version>$2 ORDER BY version LIMIT 100",
      [id, after],
    );
    if (!history.length) break;
    for (const row of history)
      await requireAccess(
        tx,
        actor,
        "read",
        WorkStateSchema.parse(row.content).target,
      );
    after = Number(history.at(-1)!.version);
  }
  return { ...work, target };
}
export async function loadModel(tx: Connection, id: string) {
  const rows = await tx.query(
    "SELECT content FROM cabinet_workflow_models WHERE id=$1",
    [id],
  );
  if (!rows[0]) fail(404, "NOT_FOUND", "Modèle inaccessible.");
  return WorkflowModelSchema.parse(rows[0].content);
}
export async function saveModel(
  tx: Connection,
  actor: SessionUser,
  i: z.infer<typeof WorkflowModelCommandSchema>,
  now: Date,
) {
  requireGlobal(actor, "manage_users");
  if (i.model.kind === "reminder")
    for (const id of i.model.targetIds) await workTarget(tx, actor, id);
  if (i.model.kind === "recurrence") {
    await requireAccess(
      tx,
      actor,
      "read",
      await loadRecord(tx, i.model.dossierId),
    );
  }
  return idempotent(
    tx,
    actor,
    i.operationId,
    { workflowModel: i },
    async () => {
      const rows = await tx.query(
        "SELECT content FROM cabinet_workflow_models WHERE id=$1",
        [i.id],
      );
      const prior = rows[0] ? WorkflowModelSchema.parse(rows[0].content) : null;
      if ((prior?.version ?? 0) !== i.expectedVersion)
        fail(409, "VERSION_CONFLICT", "Ce modèle a changé. Rechargez-le.");
      if (prior && prior.model.kind !== i.model.kind)
        fail(400, "IMMUTABLE_KIND", "Type de modèle immuable.");
      if (prior?.model.kind === "task_type" && i.model.kind === "task_type") {
        const used = await tx.query(
          "SELECT id FROM cabinet_records WHERE kind='tache' AND content->'data'->>'typeId'=$1 LIMIT 1",
          [i.id],
        );
        if (
          used.length &&
          prior.model.steps.some(
            (step) =>
              !i.model ||
              i.model.kind !== "task_type" ||
              !i.model.steps.some(
                (s) => s.id === step.id && s.final === step.final,
              ),
          )
        )
          fail(
            409,
            "STAGE_IN_USE",
            "Les étapes utilisées conservent leur identité et leur rôle final.",
          );
      }
      const model = WorkflowModelSchema.parse({
        id: i.id,
        actorId: actor.id,
        version: i.expectedVersion + 1,
        model: i.model,
        updatedAt: now.toISOString(),
      });
      await tx.query(
        "INSERT INTO cabinet_workflow_models(id,content) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET content=EXCLUDED.content",
        [i.id, JSON.stringify(model)],
      );
      await tx.query(
        "INSERT INTO cabinet_workflow_model_versions(id,version,content) VALUES($1,$2,$3::jsonb)",
        [i.id, model.version, JSON.stringify(model)],
      );
      return model;
    },
  );
}
export async function commandWork(
  tx: Connection,
  actor: SessionUser,
  id: string,
  i: WorkCommand,
  now: Date,
) {
  await workTarget(
    tx,
    actor,
    id,
    i.command.kind === "subscribe" ? "read" : "update",
  );
  const old = await readWork(tx, actor, id);
  const result = await idempotent(
    tx,
    actor,
    i.operationId,
    { targetId: id, work: i },
    async () => {
      if (old.version !== i.expectedVersion)
        fail(
          409,
          "VERSION_CONFLICT",
          "Le travail a changé. Rechargez avant de modifier.",
        );
      if (
        !["comment", "subscribe"].includes(i.command.kind) &&
        old.target.kind === "tache" &&
        old.target.data.state === "terminee"
      )
        fail(
          409,
          "TASK_COMPLETED",
          "Rouvrez la tâche avant de changer sa checklist.",
        );
      const work = structuredClone(old);
      const c = i.command;
      if (c.kind === "subscribe") {
        work.subscriberIds = c.enabled
          ? [...new Set([...work.subscriberIds, actor.id])]
          : work.subscriberIds.filter((x) => x !== actor.id);
      } else if (c.kind === "comment") {
        work.comments.push({
          id: randomUUID(),
          authorId: actor.id,
          text: c.text,
          mentions: [...new Set(c.mentions)],
          audience: "internal",
          at: now.toISOString(),
        });
      } else if (c.kind === "checklist") {
        work.checklist ??= {
          id: randomUUID(),
          modelId: null,
          modelVersion: null,
          knownItemIds: [],
          items: [],
        };
        work.checklist.items = c.items;
        work.checklist.knownItemIds = [
          ...new Set([
            ...work.checklist.knownItemIds,
            ...c.items.map((x) => x.id),
          ]),
        ];
      } else {
        let model = await loadModel(tx, c.modelId);
        if (c.kind === "instantiate" && c.modelVersion) {
          const versions = await tx.query(
            "SELECT content FROM cabinet_workflow_model_versions WHERE id=$1 AND version=$2",
            [c.modelId, c.modelVersion],
          );
          if (!versions[0])
            fail(404, "NOT_FOUND", "Version de modèle inaccessible.");
          model = WorkflowModelSchema.parse(versions[0].content);
        }
        const kind =
          work.target.kind === "tache"
            ? "tache"
            : work.target.kind === "obligation"
              ? work.target.data.nature
              : "";
        if (model.model.kind !== "checklist")
          fail(400, "MODEL_KIND", "Modèle de checklist requis.");
        if (!model.model.targetKinds.includes(kind))
          fail(
            400,
            "INVALID_TARGET",
            "Ce modèle ne concerne pas ce type de travail.",
          );
        if (c.kind === "instantiate") {
          if (work.checklist)
            fail(
              409,
              "CHECKLIST_EXISTS",
              "Une checklist existe déjà. Utilisez la fusion explicite.",
            );
          work.checklist = {
            id: randomUUID(),
            modelId: model.id,
            modelVersion: model.version,
            knownItemIds: model.model.items.map((x) => x.id),
            items: model.model.items.map((x) => ({ ...x, done: false })),
          };
        } else {
          if (!work.checklist || work.checklist.modelId !== model.id)
            fail(
              409,
              "MODEL_MISMATCH",
              "Fusion avec le modèle d’origine requise.",
            );
          const known = new Set(work.checklist.knownItemIds);
          work.checklist.items.push(
            ...model.model.items
              .filter((x) => !known.has(x.id))
              .map((x) => ({ ...x, done: false })),
          );
          work.checklist.knownItemIds = [
            ...new Set([...known, ...model.model.items.map((x) => x.id)]),
          ];
          work.checklist.modelVersion = model.version;
        }
      }
      work.version++;
      work.updatedAt = now.toISOString();
      WorkStateSchema.parse(work);
      await tx.query(
        "INSERT INTO cabinet_work(id,content) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET content=EXCLUDED.content",
        [id, JSON.stringify(work)],
      );
      await tx.query(
        "INSERT INTO cabinet_work_events(id,target_id,version,actor_id,operation_id,content) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
        [
          randomUUID(),
          id,
          work.version,
          actor.id,
          i.operationId,
          JSON.stringify(work),
        ],
      );
      if (c.kind === "comment")
        await notifyWork(tx, work, work.comments.at(-1)!, now);
      return work;
    },
  );
  await requireAccess(tx, actor, "read", result.target);
  await readWork(tx, actor, id);
  return result;
}
