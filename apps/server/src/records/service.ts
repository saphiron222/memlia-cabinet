import { queryRecords } from "./query.js";
import { RecordListQuerySchema } from "@memlia/contracts";
import { validateReferentialContent } from "./validation.js";
import { randomUUID } from "node:crypto";
import {
  CabinetRecordSchema,
  HistoryEventSchema,
  type CabinetRecord,
  type SessionUser,
  type CreateRecordInput,
  type UpdateRecordInput,
  type FieldOrigin,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { fail } from "../errors.js";
import { idempotent } from "../storage/operations.js";
import { scopedPermission, requireAccess } from "./permissions.js";
export async function loadRecord(
  tx: Connection,
  id: string,
): Promise<CabinetRecord> {
  const rows = await tx.query(
    "SELECT content FROM cabinet_records WHERE id=$1",
    [id],
  );
  if (!rows[0]) fail(404, "NOT_FOUND", "Ressource inaccessible.");
  return CabinetRecordSchema.parse(rows[0].content);
}
export async function listRecords(
  tx: Connection,
  user: SessionUser,
  action: "read" | "export" = "read",
) {
  return (
    await queryRecords(tx, user, RecordListQuerySchema.parse({}), action, false)
  ).items;
}

type ObligationRecord = Extract<CabinetRecord, { kind: "obligation" }>;
function obligationApprovalContent(record: ObligationRecord) {
  const { validation, archived, ...data } = record.data;
  return { title: record.title, dossierId: record.dossierId, data };
}
export async function saveRecord(
  tx: Connection,
  user: SessionUser,
  input: CreateRecordInput | UpdateRecordInput,
  now: Date,
  id?: string,
  action: "created" | "updated" | "transitioned" = id ? "updated" : "created",
  command?: unknown,
  origin?: FieldOrigin,
) {
  const previous = id ? await loadRecord(tx, id) : null;
  if (previous)
    await requireAccess(
      tx,
      user,
      action === "transitioned" ? "transition" : "update",
      previous,
    );
  else if (
    !(await scopedPermission(
      tx,
      user,
      "create",
      input.record.kind,
      input.record.dossierId ?? null,
    ))
  )
    fail(403, "FORBIDDEN", "Création non autorisée.");
  const result = await idempotent(
    tx,
    user,
    input.operationId,
    command ?? { id: id ?? null, action, input },
    async () => {
      const record = CabinetRecordSchema.parse({
        ...input.record,
        id: id ?? randomUUID(),
        version: (previous?.version ?? 0) + 1,
        createdAt: previous?.createdAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
      });
      record.data.fieldOrigins = { ...(previous?.data.fieldOrigins ?? {}) };
      const changed: Record<string, unknown> = {
        title: record.title,
        ...record.data,
      };
      const oldValues: Record<string, unknown> = previous
        ? { title: previous.title, ...previous.data }
        : {};
      for (const key of Object.keys(changed))
        if (
          key !== "fieldOrigins" &&
          JSON.stringify(changed[key]) !== JSON.stringify(oldValues[key])
        )
          record.data.fieldOrigins[key] = origin ?? {
            kind: "manual",
            reference: user.id,
            version: String(record.version),
            at: now.toISOString(),
          };
      await validateReferentialContent(tx, user, record);
      if (previous && previous.kind !== record.kind)
        fail(
          400,
          "IMMUTABLE_KIND",
          "Le type de ressource ne peut pas changer.",
        );
      await requireAccess(
        tx,
        user,
        previous
          ? action === "transitioned"
            ? "transition"
            : "update"
          : "create",
        record,
      );
      // Approval belongs to the reviewed content. A substantive edit always
      // invalidates it, including edits submitted by an approver; reapproval
      // requires a separate command on the resulting version.
      const approvalInvalidated =
        previous?.kind === "obligation" &&
        record.kind === "obligation" &&
        previous.data.validation === "validee_localement" &&
        JSON.stringify(obligationApprovalContent(previous)) !==
          JSON.stringify(obligationApprovalContent(record));
      if (approvalInvalidated && record.kind === "obligation")
        record.data.validation = "non_validee";
      if (
        record.kind === "obligation" &&
        !approvalInvalidated &&
        (previous?.kind === "obligation"
          ? record.data.validation !== previous.data.validation
          : record.data.validation === "validee_localement")
      )
        await requireAccess(tx, user, "approve", record);
      if (record.kind === "tache") {
        const previousAssignees =
          previous?.kind === "tache" ? previous.data.assigneeIds : [];
        if (
          JSON.stringify([...previousAssignees].sort()) !==
          JSON.stringify([...record.data.assigneeIds].sort())
        )
          await requireAccess(tx, user, "assign", record);
      }
      if (record.kind === "tache" && record.data.assigneeIds.length) {
        const assigned = await tx.query(
          "SELECT id FROM cabinet_users WHERE active=true AND id=ANY($1::uuid[])",
          [record.data.assigneeIds],
        );
        if (assigned.length !== new Set(record.data.assigneeIds).size)
          fail(400, "INVALID_ASSIGNEE", "Responsable inconnu ou inactif.");
      }
      if (
        previous?.kind === "tache" &&
        record.kind === "tache" &&
        previous.data.state !== record.data.state &&
        action !== "transitioned"
      )
        fail(
          400,
          "TRANSITION_REQUIRED",
          "Utiliser la commande de transition pour changer l’étape.",
        );
      if (
        record.kind === "tache" &&
        record.data.state === "terminee" &&
        record.data.checklist.some((item) => !item.done)
      )
        fail(
          409,
          "CHECKLIST_INCOMPLETE",
          "Terminer la checklist avant de clôturer la tâche.",
        );
      if (
        previous?.kind === "tache" &&
        record.kind === "tache" &&
        action === "transitioned" &&
        previous.data.state === record.data.state
      )
        fail(409, "STATE_UNCHANGED", "La tâche est déjà dans cette étape.");
      if (
        previous &&
        "expectedVersion" in input &&
        previous.version !== input.expectedVersion
      )
        fail(
          409,
          "VERSION_CONFLICT",
          "Cette ressource a changé. Rechargez-la avant de modifier.",
        );
      await tx.query(
        "INSERT INTO cabinet_records(id,kind,content,search_title) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(id) DO UPDATE SET content=EXCLUDED.content,search_title=EXCLUDED.search_title",
        [
          record.id,
          record.kind,
          JSON.stringify(record),
          record.title.toLocaleLowerCase("fr"),
        ],
      );
      const event = HistoryEventSchema.parse({
        id: randomUUID(),
        recordId: record.id,
        operationId: input.operationId,
        actorId: user.id,
        action,
        version: record.version,
        at: now.toISOString(),
        snapshot: record,
      });
      await tx.query(
        "INSERT INTO cabinet_history(id,record_id,actor_id,operation_id,event) VALUES($1,$2,$3,$4,$5::jsonb)",
        [
          event.id,
          record.id,
          user.id,
          input.operationId,
          JSON.stringify(event),
        ],
      );
      return record;
    },
  );
  await requireAccess(tx, user, "read", await loadRecord(tx, result.id));
  await requireAccess(tx, user, "read", result);
  return CabinetRecordSchema.parse(result);
}
