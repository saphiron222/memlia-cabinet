import {
  RoleSchema,
  PermissionSchema,
  type SessionUser,
  type Action,
  type RecordKind,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { fail } from "../errors.js";
/** SQL predicate shared by direct checks and the GED's indexed pagination.
 * Membership alone grants nothing: it must match an explicit dossier assignment. */
export function assignmentScope(
  userId: string,
  action: Action,
  kind: RecordKind,
  dossierColumn: string,
  parameter: (value: unknown) => string,
) {
  const user = parameter(userId),
    permission = parameter(JSON.stringify([{ action, kind }])),
    wildcard = parameter(JSON.stringify([{ action, kind: "*" }]));
  return `EXISTS (SELECT 1 FROM cabinet_assignments a JOIN cabinet_roles ar ON ar.id=a.role_id WHERE a.dossier_id=${dossierColumn} AND ((a.subject_kind='user' AND a.subject_id=${user}::uuid) OR (a.subject_kind IN ('team','site') AND EXISTS(SELECT 1 FROM cabinet_memberships m WHERE m.group_id=a.subject_id AND m.user_id=${user}::uuid))) AND ((ar.content->'permissions') @> ${permission}::jsonb OR (ar.content->'permissions') @> ${wildcard}::jsonb))`;
}
export async function globalRolePermissions(tx: Connection, id: string) {
  const roles = await tx.query(
    "SELECT r.content FROM cabinet_user_roles u JOIN cabinet_roles r ON r.id=u.role_id WHERE u.user_id=$1",
    [id],
  );
  return roles.flatMap((row) => RoleSchema.parse(row.content).permissions);
}
export async function scopedRolePermissions(tx: Connection, id: string) {
  const roles = await tx.query(
    "SELECT DISTINCT r.id,r.content FROM cabinet_assignments a JOIN cabinet_roles r ON r.id=a.role_id WHERE (a.subject_kind='user' AND a.subject_id=$1) OR (a.subject_kind IN ('team','site') AND EXISTS(SELECT 1 FROM cabinet_memberships m WHERE m.group_id=a.subject_id AND m.user_id=$1))",
    [id],
  );
  return roles.flatMap((row) => RoleSchema.parse(row.content).permissions);
}
export async function requireAdministrator(tx: Connection) {
  const users = await tx.query(
    "SELECT id,permissions FROM cabinet_users WHERE active=true",
  );
  for (const user of users) {
    const grants = [
      ...PermissionSchema.array().parse(user.permissions),
      ...(await globalRolePermissions(tx, String(user.id))),
    ];
    if (
      grants.some(
        (p) =>
          p.action === "manage_users" && p.kind === "*" && p.dossierId === null,
      )
    )
      return;
  }
  fail(409, "LAST_ADMINISTRATOR", "Conserver un administrateur actif.");
}
export function availablePermissions(user: SessionUser) {
  return [...user.permissions, ...user.scopedPermissions];
}
