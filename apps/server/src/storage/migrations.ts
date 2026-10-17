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
  if (version > 10)
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
  if (version < 6) {
    for (const statement of referentialMigration
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await connection.query(statement);
    let after: string | null = null;
    while (true) {
      const rows: Record<string, unknown>[] = await connection.query(
        "SELECT id,content->>'title' AS title FROM cabinet_records WHERE ($1::uuid IS NULL OR id>$1::uuid) ORDER BY id LIMIT 200",
        [after],
      );
      if (!rows.length) break;
      for (const row of rows)
        await connection.query(
          "UPDATE cabinet_records SET search_title=$1 WHERE id=$2",
          [String(row.title).toLocaleLowerCase("fr"), row.id],
        );
      after = String(rows.at(-1)!.id);
    }
  }
  if (version < 7)
    for (const statement of fiscalMigration
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await connection.query(statement);
  if (version < 8)
    for (const statement of workflowMigration
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await connection.query(statement);
  if (version < 9) {
    await connection.query(
      "CREATE TABLE cabinet_reminder_preparation(id uuid PRIMARY KEY,model_id uuid NOT NULL,model_version integer NOT NULL,actor_id uuid NOT NULL REFERENCES cabinet_users(id),content jsonb NOT NULL,UNIQUE(model_id,model_version))",
    );
    await connection.query("INSERT INTO schema_migrations(version) VALUES(9)");
  }
  if(version < 10) for(const sql of productionMigration.split(';').map(s=>s.trim()).filter(Boolean)) await connection.query(sql);
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

const referentialMigration = `
ALTER TABLE cabinet_records ADD COLUMN search_title text NOT NULL DEFAULT '';
CREATE INDEX cabinet_records_search ON cabinet_records USING gin(search_title public.gin_trgm_ops);
ALTER TABLE cabinet_jobs ALTER COLUMN dossier_id DROP NOT NULL;
CREATE TABLE cabinet_custom_fields (id uuid PRIMARY KEY, content jsonb NOT NULL);
CREATE TABLE cabinet_installation (id integer PRIMARY KEY CHECK(id=1), content jsonb NOT NULL);
CREATE TABLE cabinet_preferences (user_id uuid PRIMARY KEY REFERENCES cabinet_users(id), content jsonb NOT NULL);
CREATE TABLE cabinet_saved_views (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES cabinet_users(id), content jsonb NOT NULL);
CREATE TABLE cabinet_detections (id uuid PRIMARY KEY, source_key text NOT NULL UNIQUE, content jsonb NOT NULL);
CREATE TABLE cabinet_company_candidates (id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES cabinet_users(id), expires_at timestamptz NOT NULL, content jsonb NOT NULL);
CREATE TABLE cabinet_import_previews (id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES cabinet_users(id), content jsonb NOT NULL, source_bytes bytea NOT NULL);
CREATE TABLE cabinet_import_rows (preview_id uuid NOT NULL REFERENCES cabinet_import_previews(id), line_id text NOT NULL, ordinal integer NOT NULL, content jsonb NOT NULL, commit_selected boolean NOT NULL DEFAULT false, PRIMARY KEY(preview_id,line_id));
CREATE TABLE cabinet_exports (id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES cabinet_users(id), job_id uuid REFERENCES cabinet_jobs(id), created_at timestamptz NOT NULL, content jsonb NOT NULL);
CREATE TABLE cabinet_export_rows (export_id uuid NOT NULL REFERENCES cabinet_exports(id) ON DELETE CASCADE, kind text NOT NULL CHECK(kind IN ('record','document','field')), id uuid NOT NULL, content jsonb NOT NULL, part integer NOT NULL, size integer NOT NULL, ordinal integer NOT NULL, PRIMARY KEY(export_id,kind,id));
CREATE INDEX cabinet_export_parts ON cabinet_export_rows(export_id,part);
CREATE TABLE cabinet_export_plan (export_id uuid NOT NULL REFERENCES cabinet_exports(id) ON DELETE CASCADE,id uuid NOT NULL,version integer NOT NULL,ordinal integer NOT NULL,PRIMARY KEY(export_id,ordinal));
INSERT INTO schema_migrations(version) VALUES (6);
`;

const fiscalMigration = `
CREATE UNIQUE INDEX cabinet_fiscal_occurrence ON cabinet_records((content->'data'->'fiscal'->>'occurrenceKey')) WHERE content->'data'->'fiscal'->>'occurrenceKey' IS NOT NULL;
ALTER TABLE cabinet_export_rows DROP CONSTRAINT cabinet_export_rows_kind_check;
ALTER TABLE cabinet_export_rows ADD CONSTRAINT cabinet_export_rows_kind_check CHECK(kind IN ('record','document','field','fiscal'));
CREATE TABLE cabinet_fiscal_events (id uuid PRIMARY KEY, obligation_id uuid NOT NULL REFERENCES cabinet_records(id), version integer NOT NULL, content jsonb NOT NULL, UNIQUE(obligation_id,version));
CREATE INDEX cabinet_fiscal_events_obligation ON cabinet_fiscal_events(obligation_id,version);
INSERT INTO schema_migrations(version) VALUES (7);
`;

const workflowMigration = `
CREATE TABLE cabinet_workflow_models(id uuid PRIMARY KEY,content jsonb NOT NULL);
CREATE TABLE cabinet_workflow_model_versions(id uuid NOT NULL,version integer NOT NULL,content jsonb NOT NULL,PRIMARY KEY(id,version));
CREATE TABLE cabinet_work(id uuid PRIMARY KEY REFERENCES cabinet_records(id),content jsonb NOT NULL);
CREATE TABLE cabinet_work_events(id uuid PRIMARY KEY,target_id uuid NOT NULL REFERENCES cabinet_records(id),version integer NOT NULL,actor_id uuid NOT NULL,operation_id uuid NOT NULL,content jsonb NOT NULL,UNIQUE(target_id,version));
CREATE TABLE cabinet_notifications(id uuid PRIMARY KEY,recipient_id uuid NOT NULL REFERENCES cabinet_users(id),target_id uuid NOT NULL REFERENCES cabinet_records(id),dedupe_key text NOT NULL,content jsonb NOT NULL,UNIQUE(recipient_id,dedupe_key));
CREATE INDEX cabinet_notifications_recipient ON cabinet_notifications(recipient_id,id);
CREATE TABLE cabinet_notification_preferences(user_id uuid PRIMARY KEY REFERENCES cabinet_users(id),content jsonb NOT NULL);
CREATE UNIQUE INDEX cabinet_task_occurrence ON cabinet_records((content->'data'->'recurrence'->>'key')) WHERE content->'data'->'recurrence'->>'key' IS NOT NULL;
CREATE TABLE cabinet_workflow_imports(id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES cabinet_users(id),content jsonb NOT NULL);
ALTER TABLE cabinet_export_rows DROP CONSTRAINT cabinet_export_rows_kind_check;
ALTER TABLE cabinet_export_rows ADD CONSTRAINT cabinet_export_rows_kind_check CHECK(kind IN ('record','document','field','fiscal','workflow'));
INSERT INTO schema_migrations(version) VALUES(8);
`;

const productionMigration = `
CREATE TABLE cabinet_production_models(id uuid PRIMARY KEY,content jsonb NOT NULL);
CREATE TABLE cabinet_production_model_versions(id uuid NOT NULL,version integer NOT NULL,content jsonb NOT NULL,PRIMARY KEY(id,version));
CREATE TABLE cabinet_production_rows(id uuid PRIMARY KEY,model_id uuid NOT NULL REFERENCES cabinet_production_models(id),occurrence_key text NOT NULL UNIQUE,record_id uuid REFERENCES cabinet_records(id),content jsonb NOT NULL);
CREATE INDEX cabinet_production_rows_model ON cabinet_production_rows(model_id,id);
CREATE TABLE cabinet_production_row_versions(id uuid NOT NULL REFERENCES cabinet_production_rows(id),version integer NOT NULL,content jsonb NOT NULL,PRIMARY KEY(id,version));
CREATE TABLE cabinet_production_generation_results(run_id uuid NOT NULL REFERENCES cabinet_jobs(id),ordinal integer NOT NULL,target_id uuid NOT NULL,content jsonb NOT NULL,PRIMARY KEY(run_id,ordinal));
CREATE TABLE cabinet_production_exports(id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES cabinet_users(id),job_id uuid REFERENCES cabinet_jobs(id),content jsonb NOT NULL);
CREATE TABLE cabinet_production_export_rows(export_id uuid NOT NULL REFERENCES cabinet_production_exports(id),id uuid NOT NULL,part integer NOT NULL,content jsonb NOT NULL,PRIMARY KEY(export_id,id));
CREATE TABLE cabinet_production_imports(id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES cabinet_users(id),content jsonb NOT NULL);
ALTER TABLE cabinet_export_rows DROP CONSTRAINT cabinet_export_rows_kind_check;
ALTER TABLE cabinet_export_rows ADD CONSTRAINT cabinet_export_rows_kind_check CHECK(kind IN ('record','document','field','fiscal','workflow','production'));
INSERT INTO schema_migrations(version) VALUES(10);
`;
