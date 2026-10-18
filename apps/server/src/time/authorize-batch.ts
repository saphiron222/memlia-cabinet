import {
  TimeEntitySchema,
  type SessionUser,
  type TimeEntity,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { fail } from "../errors.js";
import { scopeCte, scope, fullScope } from "./service.js";

// Prepared exits already page at 100. Reauthorize every supplied snapshot and
// its current entity in this transaction; no verdict survives this call.
export async function authorizeTimeBatch(
  tx: Connection,
  actor: SessionUser,
  snapshots: TimeEntity[],
) {
  if (!snapshots.length) return new Map<string, TimeEntity>();
  const params: unknown[] = [JSON.stringify(snapshots)];
  const p = (value: unknown) => {
    params.push(value);
    return "$" + params.length;
  };
  const source =
    "SELECT content FROM jsonb_array_elements($1::jsonb) snapshots(content)";
  const exported = await scopeCte(
    tx,
    actor,
    p,
    {
      kind: "time",
      sql: source,
      params: [...params],
    },
    "export",
  );
  const denied = await tx.query(
    `${exported} SELECT 1 FROM jsonb_array_elements($1::jsonb) snapshots(content) WHERE (${scope(actor, p, "snapshots.content", "export")}) IS NOT TRUE LIMIT 1`,
    params,
  );
  if (denied.length) fail(404, "NOT_FOUND", "Temps inaccessible.");

  // A saved snapshot can still be exportable while the current entity has a
  // different target. Preserve the separate current READ + all-history check.
  const ids = [...new Set(snapshots.map((entry) => entry.id))];
  const currentParams: unknown[] = [ids];
  const currentParameter = (value: unknown) => {
    currentParams.push(value);
    return "$" + currentParams.length;
  };
  const readable = await scopeCte(tx, actor, currentParameter, {
    kind: "time",
    sql: "SELECT content FROM cabinet_time WHERE id=ANY($1::uuid[])",
    params: [ids],
  });
  const rows = await tx.query(
    `${readable} SELECT t.content FROM cabinet_time t WHERE t.id=ANY($1::uuid[]) AND ${fullScope(actor, currentParameter)}`,
    currentParams,
  );
  const current = new Map(
    rows.map((row) => {
      const entry = TimeEntitySchema.parse(row.content);
      return [entry.id, entry] as const;
    }),
  );
  if (ids.some((id) => !current.has(id)))
    fail(404, "NOT_FOUND", "Temps inaccessible.");
  return current;
}
