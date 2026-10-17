import { idempotent } from "../storage/operations.js";
import { commandFiscal } from "../fiscal/service.js";
import { stableId } from "./generation.js";
import { RecordContentSchema } from "@memlia/contracts";
import {
  type CabinetRecord,
  type SessionUser,
  TaskMoveSchema,
  WorkStateSchema,
} from "@memlia/contracts";
import { z } from "zod";
import type { Connection } from "../storage/database.js";
import { loadModel, workTarget } from "./service.js";
import { loadRecord, saveRecord } from "../records/service.js";
import { requireAccess } from "../records/permissions.js";
import { fail } from "../errors.js";
export async function validateTask(
  tx: Connection,
  actor: SessionUser,
  record: Extract<CabinetRecord, { kind: "tache" }>,
  previous: CabinetRecord | null,
  action: string,
) {
  if (record.data.typeId) {
    const model = await loadModel(tx, record.data.typeId);
    if (model.model.kind !== "task_type")
      fail(400, "INVALID_TYPE", "Type de tâche requis.");
    const step = model.model.steps.find((s) => s.id === record.data.stepId);
    if (!step) fail(400, "INVALID_STEP", "Étape du type requise.");
    if (
      (step.final && record.data.state !== "terminee") ||
      (!step.final && record.data.state === "terminee")
    )
      fail(400, "INVALID_STATE", "État et étape incohérents.");
  } else if (record.data.stepId)
    fail(400, "INVALID_STEP", "Type requis pour cette étape.");
  if (
    previous?.kind === "tache" &&
    previous.data.typeId === record.data.typeId &&
    previous.data.stepId !== record.data.stepId &&
    action !== "transitioned"
  )
    fail(400, "TRANSITION_REQUIRED", "Utiliser Déplacer pour changer l’étape.");
  if (previous?.kind === "tache" && previous.data.typeId !== record.data.typeId)
    await requireAccess(tx, actor, "transition", previous);
  const rows = await tx.query("SELECT content FROM cabinet_work WHERE id=$1", [
    record.id,
  ]);
  const work = rows[0] ? WorkStateSchema.parse(rows[0].content) : null;
  if (
    record.data.state === "terminee" &&
    (work?.checklist?.items ?? record.data.checklist).some((x) => !x.done)
  )
    fail(
      409,
      "CHECKLIST_INCOMPLETE",
      "Terminez la checklist avant de clôturer.",
    );
  if (
    work &&
    previous?.kind === "tache" &&
    JSON.stringify(record.data.checklist) !==
      JSON.stringify(previous.data.checklist)
  )
    fail(
      409,
      "SHARED_CHECKLIST_REQUIRED",
      "Utilisez la checklist de la fiche.",
    );
  if (
    previous?.kind === "tache" &&
    JSON.stringify(record.data.recurrence) !==
      JSON.stringify(previous.data.recurrence)
  )
    fail(
      400,
      "IMMUTABLE_OCCURRENCE",
      "La provenance de récurrence est conservée.",
    );
  if (record.data.prospectId) {
    const contact = await loadRecord(tx, record.data.prospectId);
    if (contact.kind !== "contact")
      fail(400, "INVALID_PROSPECT", "Contact prospect requis.");
    await requireAccess(tx, actor, "read", contact);
  }
  for (const id of record.data.documentIds) {
    const docs = await tx.query(
      "SELECT dossier_id,content FROM cabinet_documents WHERE id=$1",
      [id],
    );
    if (!docs[0] || docs[0].dossier_id !== record.dossierId)
      fail(404, "NOT_FOUND", "Pièce inaccessible.");
    const d = docs[0].content as { confidential: boolean };
    const parent = await loadRecord(tx, record.dossierId!);
    await requireAccess(
      tx,
      actor,
      d.confidential ? "confidential" : "read",
      parent,
    );
  }
}
export async function moveTask(
  tx: Connection,
  actor: SessionUser,
  id: string,
  input: z.infer<typeof TaskMoveSchema>,
  now: Date,
) {
  const r = await workTarget(tx, actor, id, "transition");
  if (r.kind !== "tache" || !r.data.typeId)
    fail(400, "INVALID_TYPE", "Tâche typée requise.");
  const m = await loadModel(tx, r.data.typeId);
  if (m.model.kind !== "task_type")
    fail(400, "INVALID_TYPE", "Type de tâche requis.");
  const step = m.model.steps.find((s) => s.id === input.stepId);
  if (!step) fail(400, "INVALID_STEP", "Étape inconnue.");
  const { id: _, version: __, createdAt: ___, updatedAt: ____, ...content } = r;
  return saveRecord(
    tx,
    actor,
    {
      operationId: input.operationId,
      expectedVersion: input.expectedVersion,
      record: {
        ...content,
        data: {
          ...content.data,
          stepId: step.id,
          state: step.final
            ? "terminee"
            : step.id === m.model.steps[0]!.id
              ? "a_faire"
              : "en_cours",
        },
      },
    },
    now,
    id,
    "transitioned",
    { taskMove: id, input },
  );
}

export async function ensureFiscalTask(
  tx: Connection,
  actor: SessionUser,
  id: string,
  operationId: string,
  now: Date,
) {
  const target = await workTarget(tx, actor, id, "update");
  if (target.kind !== "obligation" || !target.data.fiscal)
    fail(400, "INVALID_TARGET", "Obligation fiscale requise.");
  const result = await idempotent(
    tx,
    actor,
    operationId,
    { ensureFiscalTask: id },
    async () => {
      for (const related of target.data.fiscal!.relatedRecordIds) {
        const record = await loadRecord(tx, related);
        await requireAccess(tx, actor, "read", record);
        if (record.kind === "tache") return record;
      }
      const task = await saveRecord(
        tx,
        actor,
        {
          operationId: stableId(operationId + ":task"),
          record: RecordContentSchema.parse({
            kind: "tache",
            title: target.title,
            dossierId: target.dossierId,
            confidential: target.confidential,
            data: { dueDate: target.data.dueDate },
          }),
        },
        now,
      );
      await commandFiscal(
        tx,
        actor,
        id,
        {
          operationId: stableId(operationId + ":link"),
          expectedVersion: target.version,
          event: {
            kind: "link_task",
            taskId: task.id,
            reason: "Création du travail lié à cette obligation.",
          },
        },
        now,
      );
      return task;
    },
  );
  await requireAccess(tx, actor, "read", result);
  await requireAccess(tx, actor, "read", await loadRecord(tx, result.id));
  return result;
}
