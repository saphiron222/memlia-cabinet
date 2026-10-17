import {
  globalRolePermissions,
  scopedRolePermissions,
} from "../administration/access.js";
import { randomUUID } from "node:crypto";
import {
  SessionUserSchema,
  type SessionUser,
  type SetupInput,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { fail } from "../errors.js";
import {
  digest,
  normalizeEmail,
  hashPassword,
  newSession,
  verifyPassword,
} from "./security.js";
export const adminPermissions = [
  "read",
  "create",
  "update",
  "transition",
  "assign",
  "approve",
  "transmit",
  "export",
  "audit",
  "confidential",
  "manage_users",
  "time_read",
  "time_manage",
  "time_lock",
].map((action) => ({ action, kind: "*", dossierId: null }));
export function asUser(row: Record<string, unknown>): SessionUser {
  return SessionUserSchema.parse({
    id: row.id,
    version: row.version,
    email: row.email,
    name: row.name,
    active: row.active,
    permissions: row.permissions,
  });
}
export async function createUser(
  tx: Connection,
  input: SetupInput,
  permissions: unknown,
) {
  const id = randomUUID();
  const rows = await tx.query(
    "INSERT INTO cabinet_users(id,email,name,password_hash,permissions) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING *",
    [
      id,
      normalizeEmail(input.email),
      input.name,
      await hashPassword(input.password),
      JSON.stringify(permissions),
    ],
  );
  return asUser(rows[0]!);
}
export async function authenticate(
  tx: Connection,
  token: string | undefined,
  now: Date,
): Promise<SessionUser> {
  if (!token) fail(401, "SESSION_REQUIRED", "Connexion requise.");
  const rows = await tx.query(
    "SELECT u.* FROM cabinet_sessions s JOIN cabinet_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>$2 AND u.active=true",
    [digest(token), now],
  );
  if (!rows[0]) fail(401, "SESSION_REQUIRED", "Session expirée ou révoquée.");
  return effectiveUser(tx, rows[0]);
}
export async function login(tx: Connection, email: string, password: string) {
  const rows = await tx.query("SELECT * FROM cabinet_users WHERE email=$1", [
    normalizeEmail(email),
  ]);
  const row = rows[0];
  if (!row) {
    await hashPassword(password);
    fail(401, "INVALID_CREDENTIALS", "Identifiants incorrects.");
  }
  if (
    !(await verifyPassword(password, String(row.password_hash))) ||
    !row.active
  )
    fail(401, "INVALID_CREDENTIALS", "Identifiants incorrects.");
  return effectiveUser(tx, row);
}
export async function issueSession(
  tx: Connection,
  user: SessionUser,
  now: Date,
) {
  const token = newSession();
  await tx.query(
    "INSERT INTO cabinet_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
    [digest(token), user.id, new Date(now.getTime() + 8 * 60 * 60 * 1000)],
  );
  return token;
}

export async function effectiveUser(
  tx: Connection,
  row: Record<string, unknown>,
): Promise<SessionUser> {
  const direct = asUser(row);
  const unique = (grants: SessionUser["permissions"]) => [
    ...new Map(grants.map((p) => [JSON.stringify(p), p])).values(),
  ];
  return {
    ...direct,
    permissions: unique([
      ...direct.permissions,
      ...(await globalRolePermissions(tx, direct.id)),
    ]),
    scopedPermissions: unique(await scopedRolePermissions(tx, direct.id)),
  };
}
