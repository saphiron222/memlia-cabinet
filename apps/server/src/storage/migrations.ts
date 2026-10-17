import type { Connection } from "./database.js";
export const migration = `
CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS cabinet_users (id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL, version integer NOT NULL DEFAULT 1, active boolean NOT NULL DEFAULT true, permissions jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS cabinet_sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES cabinet_users(id), expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS cabinet_records (id uuid PRIMARY KEY, kind text NOT NULL, content jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS cabinet_records_kind ON cabinet_records(kind);
CREATE TABLE IF NOT EXISTS cabinet_history (id uuid PRIMARY KEY, record_id uuid NOT NULL REFERENCES cabinet_records(id), actor_id uuid NOT NULL, operation_id uuid NOT NULL, event jsonb NOT NULL, UNIQUE(record_id, actor_id, operation_id));
CREATE TABLE IF NOT EXISTS cabinet_identity_events (id uuid NOT NULL, actor_id uuid NOT NULL, event jsonb NOT NULL, PRIMARY KEY(actor_id,id));
CREATE TABLE IF NOT EXISTS cabinet_operations (actor_id uuid NOT NULL, operation_id uuid NOT NULL, fingerprint text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(actor_id,operation_id));
INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
`;

export async function migrate(connection: Connection): Promise<void> {
  await connection.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const rows = await connection.query(
    "SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations",
  );
  const version = Number(rows[0]?.version);
  if (version > 1)
    throw new Error(
      "Schéma plus récent que cette application ; mise à jour requise.",
    );
  if (version === 0)
    for (const statement of migration
      .split(";")
      .map((sql) => sql.trim())
      .filter(Boolean))
      await connection.query(statement);
}
