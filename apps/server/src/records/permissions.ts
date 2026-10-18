import { hasPermission } from "./grants.js";
export { hasPermission } from "./grants.js";
import { relationshipDocumentPredicate } from "../relationship/document-scope.js";
import { productionDocumentIdsSql } from "../production/document-scope.js";
import { assignmentScope } from "../administration/access.js";
import type {
  Action,
  CabinetRecord,
  RecordKind,
  SessionUser,
} from "@memlia/contracts";
import { fail } from "../errors.js";
import type { Connection } from "../storage/database.js";
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
  async function visibleLabDocument(id: string) {
    const args: unknown[] = [id];
    const predicate = relationshipDocumentPredicate(
      user,
      (v) => {
        args.push(v);
        return "$" + args.length;
      },
      "$1::uuid",
    );
    return (
      (await tx.query(`SELECT ${predicate} allowed`, args))[0]?.allowed === true
    );
  }
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
        !(await visibleLabDocument(id)) ||
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
  if (record.kind === "tache") {
    if (record.data.prospectId) {
      const rows = await tx.query(
        "SELECT content FROM cabinet_records WHERE id=$1",
        [record.data.prospectId],
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
    for (const id of record.data.documentIds) {
      const rows = await tx.query(
        "SELECT dossier_id,content->>'confidential' AS confidential FROM cabinet_documents WHERE id=$1",
        [id],
      );
      if (
        !rows[0] ||
        rows[0].dossier_id !== record.dossierId ||
        !(await visibleLabDocument(id)) ||
        (rows[0].confidential === "true" &&
          !(await scopedPermission(
            tx,
            user,
            "confidential",
            "dossier",
            record.dossierId,
          )))
      )
        return false;
    }
  }
  if (record.kind === "obligation" && !record.data.fiscal) {
    const pieces = await tx.query(
      `SELECT d.id,d.dossier_id,d.content FROM (${productionDocumentIdsSql("$1")}) piece LEFT JOIN cabinet_documents d ON d.id=piece.id::uuid`,
      [record.id],
    );
    for (const d of pieces)
      if (
        !d.content ||
        d.dossier_id !== record.dossierId ||
        !(await visibleLabDocument(String(d.id))) ||
        ((d.content as { confidential: boolean }).confidential &&
          !(await scopedPermission(
            tx,
            user,
            "confidential",
            "dossier",
            record.dossierId,
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
