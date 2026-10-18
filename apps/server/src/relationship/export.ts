import { visibleLab } from "./notifications.js";
import { z } from "zod";
import { RelationshipExportSchema, type SessionUser } from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { load, authorize } from "./service.js";
import { requireGlobal } from "../records/permissions.js";
import { ApiFault, fail } from "../errors.js";
async function assertEntry(
  tx: Connection,
  a: SessionUser,
  e: z.infer<typeof RelationshipExportSchema>,
) {
  if (e.entity === "notification") {
    if (e.data.recipientId !== a.id || !(await visibleLab(tx, a, e.data)))
      fail(404, "NOT_FOUND", "Notification inaccessible.");
    await load(tx, a, e.data.relationshipId!, "export");
    return;
  }
  if (e.entity === "import") {
    requireGlobal(a, "manage_users");
    requireGlobal(a, "export");
    if (e.data.actorId !== a.id)
      fail(404, "NOT_FOUND", "Reprise inaccessible.");
    return;
  }
  if (e.entity === "event") {
    await load(tx, a, e.data.entityId, "export");
    return;
  }
  await load(tx, a, e.data.id, "export");
  await authorize(tx, a, e.data, "export");
}
export async function assertRelationshipExport(
  tx: Connection,
  a: SessionUser,
  e: z.infer<typeof RelationshipExportSchema>,
) {
  try {
    await assertEntry(tx, a, e);
  } catch (error) {
    if (error instanceof ApiFault && error.status === 403)
      fail(404, "NOT_FOUND", "Sortie inaccessible.");
    throw error;
  }
}
export async function relationshipExportPage(
  tx: Connection,
  a: SessionUser,
  after: string | null,
) {
  const output: z.infer<typeof RelationshipExportSchema>[] = [];
  let cursor = after,
    bytes = 0;
  const key = (s: string) =>
    `overlay(overlay(md5(${s}) placing '4' from 13 for 1) placing 'a' from 17 for 1)::uuid`;
  while (output.length < 100) {
    const rows: Record<string, unknown>[] = await tx.query(
      `WITH entries AS(
 SELECT ${key("'relationship-current:'||id::text")} id,'current' entity,content data FROM cabinet_relationship
 UNION ALL SELECT ${key("'relationship-history:'||id::text||':'||version")},'history',content FROM cabinet_relationship_history
 UNION ALL SELECT id,'event',content FROM cabinet_relationship_events
 UNION ALL SELECT id,'notification',content FROM cabinet_notifications WHERE recipient_id=$2 AND content->>'source'='lab'
 UNION ALL SELECT id,'import',content FROM cabinet_relationship_imports WHERE actor_id=$2
 ) SELECT id,jsonb_build_object('id',id,'entity',entity,'data',data) content FROM entries WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 100`,
      [cursor, a.id],
    );
    if (!rows.length) break;
    for (const row of rows) {
      const entry = RelationshipExportSchema.parse(row.content);
      try {
        await assertRelationshipExport(tx, a, entry);
      } catch (error) {
        if (error instanceof ApiFault && [403, 404].includes(error.status)) {
          cursor = String(row.id);
          continue;
        }
        throw error;
      }
      const size = Buffer.byteLength(JSON.stringify(entry));
      if (
        output.length &&
        (bytes + size > 2 * 1024 * 1024 || output.length >= 100)
      )
        return output;
      output.push(entry);
      bytes += size;
      cursor = String(row.id);
    }
  }
  return output;
}
