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
  if (version > 5)
    throw new Error(
      "Schéma plus récent que cette application ; mise à jour requise.",
    );
  if (version === 0)
    for (const statement of migration
      .split(";")
      .map((sql) => sql.trim())
      .filter(Boolean))
      await connection.query(statement);
  if (version < 2)
    for (const statement of documentMigration
      .split(";")
      .map((sql) => sql.trim())
      .filter(Boolean))
      await connection.query(statement);
  if (version < 3) await migrateDocumentSearch(connection);
  if (version < 4)
    for (const statement of jobMigration
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await connection.query(statement);
  if (version < 5)
    for (const statement of administrationMigration
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await connection.query(statement);
}

// Additive migration: the published first migration above remains unchanged.
const documentMigration = `
CREATE TABLE cabinet_documents (id uuid PRIMARY KEY, dossier_id uuid NOT NULL REFERENCES cabinet_records(id), logical_id uuid NOT NULL, previous_id uuid UNIQUE REFERENCES cabinet_documents(id), version integer NOT NULL, content jsonb NOT NULL, extracted_text text NOT NULL, UNIQUE(logical_id,version));
CREATE INDEX cabinet_documents_dossier ON cabinet_documents(dossier_id);
INSERT INTO schema_migrations(version) VALUES (2);
`;

// Version 3 upgrades published schema 2 without changing either prior migration.
async function migrateDocumentSearch(connection: Connection) {
  // Extensions belong to the database, not a disposable installation/test schema.
  // Keep the shared opclass in public so dropping one schema cannot remove another
  // installation's index. An existing differently placed extension is not moved.
  await connection.query(
    "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public VERSION '1.6'",
  );
  const extensions = await connection.query(
    "SELECT n.nspname,e.extversion FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_trgm'",
  );
  if (
    extensions[0]?.nspname !== "public" ||
    extensions[0]?.extversion !== "1.6"
  )
    throw new Error(
      "La GED exige pg_trgm 1.6 dans le schéma public. Faire vérifier cette extension partagée par l’administrateur avant la migration.",
    );
  await connection.query(
    "ALTER TABLE cabinet_documents ADD COLUMN search_text text",
  );
  // One bounded original at a time, preserving the previous JavaScript French
  // lowercase semantics even for Unicode expansions (e.g. dotted capital I).
  let after: string | null = null;
  while (true) {
    const rows: { id: string; filename: string; extracted_text: string }[] =
      await connection.query(
        "SELECT id, content->>'filename' AS filename, extracted_text FROM cabinet_documents WHERE ($1::uuid IS NULL OR id>$1::uuid) ORDER BY id LIMIT 1",
        [after],
      );
    const row = rows[0];
    if (!row) break;
    await connection.query(
      "UPDATE cabinet_documents SET search_text=$1 WHERE id=$2",
      [
        `${row.filename}\n${row.extracted_text}`.toLocaleLowerCase("fr"),
        row.id,
      ],
    );
    after = row.id;
  }
  await connection.query(
    "ALTER TABLE cabinet_documents ALTER COLUMN search_text SET NOT NULL",
  );
  await connection.query(
    "CREATE INDEX cabinet_documents_search ON cabinet_documents USING gin(search_text public.gin_trgm_ops)",
  );
  await connection.query("INSERT INTO schema_migrations(version) VALUES (3)");
}

// Shared queue, separate from the global command identity journal.
const jobMigration = `
CREATE TABLE cabinet_job_gate (id integer PRIMARY KEY CHECK(id=1), paused boolean NOT NULL);
INSERT INTO cabinet_job_gate VALUES(1,false);
CREATE TABLE cabinet_jobs (id uuid PRIMARY KEY, kind text NOT NULL, actor_id uuid NOT NULL REFERENCES cabinet_users(id), dossier_id uuid NOT NULL REFERENCES cabinet_records(id), resource_key text NOT NULL, input jsonb NOT NULL, checkpoint jsonb NOT NULL, result jsonb, state text NOT NULL CHECK(state IN ('queued','running','completed','failed')), attempts integer NOT NULL DEFAULT 0, owner uuid, lease_until timestamptz, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, error text);
CREATE INDEX cabinet_jobs_pending ON cabinet_jobs(state,created_at);
CREATE TABLE cabinet_job_events (job_id uuid NOT NULL REFERENCES cabinet_jobs(id), sequence integer NOT NULL, event jsonb NOT NULL, PRIMARY KEY(job_id,sequence));
CREATE TABLE cabinet_collection_observations (identity text PRIMARY KEY, dossier_id uuid NOT NULL REFERENCES cabinet_records(id), content jsonb NOT NULL);
CREATE TABLE cabinet_collection_links (job_id uuid NOT NULL REFERENCES cabinet_jobs(id), identity text NOT NULL REFERENCES cabinet_collection_observations(identity), PRIMARY KEY(job_id,identity));
CREATE TABLE cabinet_collection_snapshots (job_id uuid NOT NULL REFERENCES cabinet_jobs(id), page integer NOT NULL, content jsonb NOT NULL, PRIMARY KEY(job_id,page));
INSERT INTO schema_migrations(version) VALUES (4);
`;

const administrationMigration = `
CREATE TABLE cabinet_roles (id uuid PRIMARY KEY, content jsonb NOT NULL);
CREATE TABLE cabinet_groups (id uuid PRIMARY KEY, content jsonb NOT NULL);
CREATE TABLE cabinet_memberships (group_id uuid NOT NULL REFERENCES cabinet_groups(id), user_id uuid NOT NULL REFERENCES cabinet_users(id), PRIMARY KEY(group_id,user_id));
CREATE INDEX cabinet_memberships_user ON cabinet_memberships(user_id,group_id);
CREATE TABLE cabinet_user_roles (user_id uuid NOT NULL REFERENCES cabinet_users(id), role_id uuid NOT NULL REFERENCES cabinet_roles(id), PRIMARY KEY(user_id,role_id));
CREATE TABLE cabinet_assignments (dossier_id uuid NOT NULL REFERENCES cabinet_records(id), subject_kind text NOT NULL CHECK(subject_kind IN ('user','team','site')), subject_id uuid NOT NULL, role_id uuid NOT NULL REFERENCES cabinet_roles(id), PRIMARY KEY(dossier_id,subject_kind,subject_id));
CREATE INDEX cabinet_assignments_subject ON cabinet_assignments(subject_kind,subject_id,dossier_id);
CREATE TABLE cabinet_assignment_versions (dossier_id uuid PRIMARY KEY REFERENCES cabinet_records(id), version integer NOT NULL);
INSERT INTO schema_migrations(version) VALUES (5);
`;
