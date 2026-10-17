import { assignmentScope } from "../administration/access.js";
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
  visited = new Set<string>(),
): Promise<boolean> {
  const key = record.id + "/" + record.version;
  if (visited.has(key)) return true;
  visited.add(key);
  const scope = record.kind === "dossier" ? record.id : record.dossierId;
  if (!(await scopedPermission(tx, user, action, record.kind, scope)))
    return false;
  if (
    record.confidential &&
    !(await scopedPermission(tx, user, "confidential", record.kind, scope))
  )
    return false;
  for (const parentId of new Set(
    [
      record.dossierId,
      ...(record.kind === "contact" ? record.data.relatedDossierIds : []),
    ].filter((id): id is string => id !== null),
  )) {
    const rows = await tx.query(
      "SELECT content FROM cabinet_records WHERE id=$1 AND kind=$2",
      [parentId, "dossier"],
    );
    if (!rows[0]) return false;
    const parent = rows[0].content as CabinetRecord;
    if (
      !(await scopedPermission(tx, user, "read", "dossier", parent.id)) ||
      (parent.confidential &&
        !(await scopedPermission(
          tx,
          user,
          "confidential",
          "dossier",
          parent.id,
        )))
    )
      return false;
  }
  if (record.kind === "obligation" && record.data.fiscal?.contactId) {
    const rows = await tx.query(
      "SELECT content FROM cabinet_records WHERE id=$1 AND kind='contact'",
      [record.data.fiscal.contactId],
    );
    if (
      !rows[0] ||
      !(await canAccess(
        tx,
        user,
        "read",
        rows[0].content as CabinetRecord,
        visited,
      ))
    )
      return false;
  }
  if (record.kind === "obligation" && record.data.fiscal)
    for (const id of record.data.fiscal.relatedRecordIds) {
      const rows = await tx.query(
        "SELECT content FROM cabinet_records WHERE id=$1",
        [id],
      );
      if (!rows[0]) return false;
      const related = rows[0].content as CabinetRecord;
      if (!(await canAccess(tx, user, "read", related, visited))) return false;
    }
  if (record.kind === "obligation" && record.data.fiscal)
    for (const id of record.data.fiscal.documentIds) {
      const rows = await tx.query(
        "SELECT dossier_id,content->>'confidential' AS confidential FROM cabinet_documents WHERE id=$1",
        [id],
      );
      if (
        !rows[0] ||
        rows[0].dossier_id !== record.dossierId ||
        (rows[0].confidential === "true" &&
          !(await scopedPermission(
            tx,
            user,
            "confidential",
            "dossier",
            String(rows[0].dossier_id),
          )))
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

export async function scopedPermission(
  tx: Connection,
  user: SessionUser,
  action: Action,
  kind: RecordKind,
  dossierId: string | null,
) {
  if (hasPermission(user, action, kind, dossierId)) return true;
  if (!dossierId) return false;
  const params: unknown[] = [dossierId];
  const predicate = assignmentScope(
    user.id,
    action,
    kind,
    "$1::uuid",
    (value) => {
      params.push(value);
      return "$" + params.length;
    },
  );
  const rows = await tx.query(`SELECT ${predicate} AS allowed`, params);
  return rows[0]?.allowed === true;
}
