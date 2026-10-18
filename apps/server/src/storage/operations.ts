import type { SessionUser } from "@memlia/contracts";
import type { Connection } from "./database.js";
import { digest } from "../identity/security.js";
import { fail } from "../errors.js";
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export async function idempotent<T>(
  tx: Connection,
  user: SessionUser,
  operationId: string,
  command: unknown,
  run: () => Promise<T>,
): Promise<T> {
  const fingerprint = digest(canonical(command));
  const rows = await tx.query(
    "SELECT fingerprint,result FROM cabinet_operations WHERE actor_id=$1 AND operation_id=$2",
    [user.id, operationId],
  );
  if (rows[0]) {
    if (rows[0].fingerprint !== fingerprint)
      fail(
        409,
        "OPERATION_CONFLICT",
        "Identité d’opération déjà utilisée pour une autre commande.",
      );
    return rows[0].result as T;
  }
  const result = await run();
  await tx.query(
    "INSERT INTO cabinet_operations(actor_id,operation_id,fingerprint,result) VALUES($1,$2,$3,$4::jsonb)",
    [user.id, operationId, fingerprint, JSON.stringify(result)],
  );
  return result;
}
