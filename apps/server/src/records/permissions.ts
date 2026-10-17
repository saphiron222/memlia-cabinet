import type {
  Action,
  CabinetRecord,
  RecordKind,
  SessionUser,
} from "@memlia/contracts";
import { fail } from "../errors.js";
import type { Connection } from "../storage/database.js";
export function hasPermission(
  user: SessionUser,
  action: Action,
  kind: RecordKind | "*",
  dossierId: string | null = null,
) {
  return user.permissions.some(
    (p) =>
      p.action === action &&
      (p.kind === "*" || p.kind === kind) &&
      (p.dossierId === null || p.dossierId === dossierId),
  );
}
export function requireGlobal(user: SessionUser, action: Action) {
  if (!hasPermission(user, action, "*"))
    fail(403, "FORBIDDEN", "Droit insuffisant.");
}
export async function canAccess(
  tx: Connection,
  user: SessionUser,
  action: Action,
  record: CabinetRecord,
): Promise<boolean> {
  const scope = record.kind === "dossier" ? record.id : record.dossierId;
  if (!hasPermission(user, action, record.kind, scope)) return false;
  if (
    record.confidential &&
    !hasPermission(user, "confidential", record.kind, scope)
  )
    return false;
  if (record.dossierId) {
    const rows = await tx.query(
      "SELECT content FROM cabinet_records WHERE id=$1 AND kind=$2",
      [record.dossierId, "dossier"],
    );
    if (!rows[0]) return false;
    const parent = rows[0].content as CabinetRecord;
    if (
      !hasPermission(user, "read", "dossier", parent.id) ||
      (parent.confidential &&
        !hasPermission(user, "confidential", "dossier", parent.id))
    )
      return false;
  }
  return true;
}
export async function requireAccess(
  tx: Connection,
  user: SessionUser,
  action: Action,
  record: CabinetRecord,
) {
  if (!(await canAccess(tx, user, action, record)))
    fail(404, "NOT_FOUND", "Ressource inaccessible.");
}
