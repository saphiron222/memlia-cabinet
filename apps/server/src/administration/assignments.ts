import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AssignmentCommandSchema,
  AssignmentRowSchema,
  AssignmentResultSchema,
  RoleSchema,
  RecordKindSchema,
  type SessionUser,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { canAccess, scopedPermission } from "../records/permissions.js";
import { loadRecord } from "../records/service.js";
import { idempotent } from "../storage/operations.js";
export async function checkAssignment(
  tx: Connection,
  actor: SessionUser,
  row: z.infer<typeof AssignmentRowSchema>,
): Promise<"ready" | "refused" | "invalid"> {
  const records = await tx.query(
    "SELECT id FROM cabinet_records WHERE id=$1 AND kind='dossier'",
    [row.dossierId],
  );
  if (!records.length) return "refused";
  const record = await loadRecord(tx, row.dossierId);
  if (
    !(await canAccess(tx, actor, "read", record)) ||
    !(await canAccess(tx, actor, "assign", record))
  )
    return "refused";
  const role = await tx.query("SELECT content FROM cabinet_roles WHERE id=$1", [
    row.roleId,
  ]);
  const subject =
    row.subject.kind === "user"
      ? await tx.query(
          "SELECT id FROM cabinet_users WHERE id=$1 AND active=true",
          [row.subject.id],
        )
      : await tx.query(
          "SELECT id FROM cabinet_groups WHERE id=$1 AND content->>'kind'=$2",
          [row.subject.id, row.subject.kind],
        );
  if (!role.length || !subject.length) {
    return "invalid";
  }
  const grants = RoleSchema.parse(role[0]!.content).permissions;
  let permitted = true;
  if (!row.remove)
    for (const grant of grants)
      for (const kind of grant.kind === "*"
        ? RecordKindSchema.options
        : [grant.kind]) {
        if (
          !(await scopedPermission(
            tx,
            actor,
            grant.action,
            kind,
            row.dossierId,
          ))
        )
          permitted = false;
      }
  if (!permitted) {
    return "refused";
  }
  return "ready";
}
export async function applyAssignments(
  tx: Connection,
  actor: SessionUser,
  input: z.infer<typeof AssignmentCommandSchema>,
  now: Date,
) {
  // Check every row before the replay cache, then hide any newly inaccessible result.
  const allowed = new Set<string>();
  for (const row of input.rows) {
    const records = await tx.query(
      "SELECT content FROM cabinet_records WHERE id=$1 AND kind='dossier'",
      [row.dossierId],
    );
    if (records[0]) {
      const record = await loadRecord(tx, row.dossierId);
      if (
        (await canAccess(tx, actor, "read", record)) &&
        (await canAccess(tx, actor, "assign", record))
      )
        allowed.add(row.dossierId);
    }
  }
  const result = await idempotent(
    tx,
    actor,
    input.operationId,
    { action: "administration.assignments", input },
    async () => {
      const items: z.infer<typeof AssignmentResultSchema>["items"] = [];
      for (const row of input.rows) {
        if (!allowed.has(row.dossierId)) {
          items.push({ dossierId: row.dossierId, status: "refused" });
          continue;
        }
        const version = Number(
          (
            await tx.query(
              "SELECT version FROM cabinet_assignment_versions WHERE dossier_id=$1",
              [row.dossierId],
            )
          )[0]?.version ?? 1,
        );
        if (version !== row.expectedVersion) {
          items.push({ dossierId: row.dossierId, status: "conflict" });
          continue;
        }
        const check = await checkAssignment(tx, actor, row);
        if (check !== "ready") {
          items.push({ dossierId: row.dossierId, status: check });
          continue;
        }
        if (row.remove)
          await tx.query(
            "DELETE FROM cabinet_assignments WHERE dossier_id=$1 AND subject_kind=$2 AND subject_id=$3",
            [row.dossierId, row.subject.kind, row.subject.id],
          );
        else
          await tx.query(
            "INSERT INTO cabinet_assignments(dossier_id,subject_kind,subject_id,role_id) VALUES($1,$2,$3,$4) ON CONFLICT(dossier_id,subject_kind,subject_id) DO UPDATE SET role_id=EXCLUDED.role_id",
            [row.dossierId, row.subject.kind, row.subject.id, row.roleId],
          );
        await tx.query(
          "INSERT INTO cabinet_assignment_versions(dossier_id,version) VALUES($1,$2) ON CONFLICT(dossier_id) DO UPDATE SET version=EXCLUDED.version",
          [row.dossierId, version + 1],
        );
        items.push({
          dossierId: row.dossierId,
          status: row.remove ? "removed" : "assigned",
          version: version + 1,
        });
      }
      await tx.query(
        "INSERT INTO cabinet_identity_events(id,actor_id,event) VALUES($1,$2,$3::jsonb)",
        [
          input.operationId,
          actor.id,
          JSON.stringify({
            action: "assignments.changed",
            rows: input.rows,
            items,
            at: now.toISOString(),
          }),
        ],
      );
      return AssignmentResultSchema.parse({ items });
    },
  );
  return AssignmentResultSchema.parse({
    items: result.items.map((item) =>
      allowed.has(item.dossierId)
        ? item
        : { dossierId: item.dossierId, status: "refused" },
    ),
  });
}
