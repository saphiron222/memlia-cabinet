import type { DocumentReference, SessionUser } from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { fiscalDocumentPredicate } from "../records/query.js";

export type DocumentOwnerRow = {
  id: string;
  content: DocumentReference;
  dossier_id: string;
  allowed: boolean;
};

/** Metadata and the canonical reverse-owner verdict from the same statement.
 * Callers still enforce their own parent/history and exact-proof contract.
 * Batches are bounded; no result is retained between calls or mutations.
 */
export async function documentOwnerRows(
  tx: Connection,
  actor: SessionUser,
  documentIds: string[],
) {
  const ids = [...new Set(documentIds.map((id) => id.toLowerCase()))];
  const found = new Map<string, DocumentOwnerRow>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const params: unknown[] = [ids.slice(offset, offset + 100)];
    const predicate = fiscalDocumentPredicate(
      actor,
      (value) => {
        params.push(value);
        return "$" + params.length;
      },
      "d.id",
    );
    const rows = await tx.query<DocumentOwnerRow>(
      `SELECT d.id,d.content,d.dossier_id,(${predicate}) AS allowed FROM cabinet_documents d WHERE d.id=ANY($1::uuid[])`,
      params,
    );
    for (const row of rows) found.set(row.id, row);
  }
  return found;
}
