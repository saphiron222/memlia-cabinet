import {
  relationshipExportPage,
  assertRelationshipExport,
} from "../relationship/export.js";
import { RelationshipExportSchema } from "@memlia/contracts";
import { timeExportPage, assertTimeExports } from "../time/export.js";
import { TimeExportSchema } from "@memlia/contracts";
import {
  ProductionGridExport,
  GridExportCommandSchema,
} from "../production/grid-export.js";
import {
  productionExportPage,
  assertProductionExport,
} from "../production/export.js";
import { ProductionExportSchema } from "@memlia/contracts";
import {
  workflowExportPage,
  assertWorkflowExport,
} from "../workflows/export.js";
import { WorkflowExportSchema } from "@memlia/contracts";
import {
  currentNoticePredicate,
  latestNoticePredicate,
} from "../records/query.js";
import { Readable } from "node:stream";
import { tarFile, originalPath } from "../fiscal/tar.js";
import { csvHeader, csvRow } from "../records/csv.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  FiscalTimelineEntrySchema,
  CabinetExportSchema,
  RecordListQuerySchema,
  ExportManifestSchema,
  DocumentSchema,
  CabinetRecordSchema,
  CustomFieldSchema,
  ExportRunSchema,
  ExportListSchema,
  ExportCommandSchema,
  type SessionUser,
} from "@memlia/contracts";
import type { RouteContext } from "../context.js";
import type { Connection, Database } from "../storage/database.js";
import { idempotent } from "../storage/operations.js";
import { DocumentStore } from "../documents/store.js";
import { JobRunner } from "../jobs/runner.js";
import { authorizedPredicate, recordFilter } from "../records/query.js";
import { effectiveUser } from "../identity/service.js";
import { availablePermissions } from "./access.js";
import { installation, requireModule } from "./settings.js";
import { ApiFault, fail } from "../errors.js";
const checkpointSchema = z.object({
  phase: z.enum([
    "planning",
    "records",
    "fiscal",
    "workflows",
    "production",
    "time",
    "relationship",
    "documents",
    "complete",
  ]),
  after: z.uuid().nullable(),
  bytes: z.number().int().nonnegative(),
  records: z.number().int().nonnegative(),
  documents: z.number().int().nonnegative(),
  relationship: z.number().int().nonnegative().default(0),
  time: z.number().int().nonnegative().default(0),
  production: z.number().int().nonnegative().default(0),
  workflows: z.number().int().nonnegative().default(0),
  fiscal: z.number().int().nonnegative().default(0),
  part: z.number().int().positive(),
  partBytes: z.number().int().nonnegative(),
});
const headerSchema = CabinetExportSchema.omit({
  relationship: true,
  time: true,
  production: true,
  workflows: true,
  fiscalEvents: true,
  records: true,
  documents: true,
  customFields: true,
  errors: true,
});
export class Exports {
  readonly productionGrid: ProductionGridExport;
  private streams = new Set<Readable>();
  stop() {
    for (const stream of this.streams)
      stream.destroy(new Error("Arrêt du cabinet"));
  }

  private enqueue: ReturnType<JobRunner["register"]>["enqueue"];
  constructor(
    private db: Database,
    private jobs: JobRunner,
    private documents: DocumentStore,
    private now: () => Date,
    private partLimit = 8 * 1024 * 1024,
    private civilDate: (instant: Date) => string = (instant) =>
      instant.toISOString().slice(0, 10),
  ) {
    if (
      !Number.isInteger(partLimit) ||
      partLimit < 4096 ||
      partLimit > 8 * 1024 * 1024
    )
      throw new Error("Taille de partie invalide.");
    this.productionGrid = new ProductionGridExport(jobs, now);
    const worker = jobs.register({
      kind: "export",
      input: z.object({
        exportId: z.uuid(),
        query: RecordListQuerySchema.optional(),
        originals: z.boolean().default(false),
      }),
      checkpoint: checkpointSchema,
      result: z.object({ exportId: z.uuid() }),
      initial: {
        phase: "planning" as const,
        after: null,
        bytes: 1024,
        records: 0,
        documents: 0,
        fiscal: 0,
        workflows: 0,
        production: 0,
        time: 0,
        relationship: 0,
        part: 1,
        partBytes: 2048,
      },
      scope: (i) => ({ dossierId: null, resourceKey: "export:" + i.exportId }),
      authorize: async (tx, actor, i) => {
        await this.readable(tx, actor, i.exportId);
        if (i.originals) {
          await requireModule(tx, "fiscal");
          await requireModule(tx, "ged");
        }
      },
      execute: async (input, ctx) => {
        const started = performance.now();
        try {
          while (ctx.checkpoint.phase !== "complete") {
            ctx.signal.throwIfAborted();
            if (performance.now() - started > 10 * 60_000)
              fail(
                408,
                "EXPORT_TIMEOUT",
                "Préparation interrompue après dix minutes ; régénérer la sortie.",
              );
            const prior = ctx.checkpoint;
            if (prior.phase === "planning") {
              await ctx.commit(
                { ...prior, phase: "records" },
                "export.planned",
                "Périmètre de préparation fixé.",
                async (tx, actor) => {
                  if (input.query) {
                    const f = recordFilter(actor, input.query, "export");
                    await tx.query(
                      `INSERT INTO cabinet_export_plan(export_id,id,version,ordinal) SELECT $${f.params.length + 1},r.id,(r.content->>'version')::integer,row_number() OVER(ORDER BY ${f.sort}) FROM cabinet_records r WHERE ${f.where} ORDER BY ${f.sort} LIMIT 400001`,
                      [...f.params, input.exportId],
                    );
                    const total = await tx.query(
                      "SELECT count(*) AS n FROM cabinet_export_plan WHERE export_id=$1",
                      [input.exportId],
                    );
                    if (Number(total[0]!.n) > 400000)
                      fail(
                        413,
                        "EXPORT_COUNT_LIMIT",
                        "Cette vue dépasse 400 000 objets ; affiner le périmètre.",
                      );
                  }
                },
              );
              continue;
            }
            const page = await this.db.transaction(
              async (tx) => {
                const rows = await tx.query(
                  "SELECT u.* FROM cabinet_users u JOIN cabinet_exports e ON e.actor_id=u.id WHERE e.id=$1 AND u.active=true",
                  [input.exportId],
                );
                if (!rows[0]) fail(403, "FORBIDDEN", "Sortie inaccessible.");
                const actor = await effectiveUser(tx, rows[0]);
                await this.readable(tx, actor, input.exportId);
                if (prior.phase === "records") {
                  if (input.query) {
                    const planned = await tx.query(
                      "SELECT r.content,p.version FROM cabinet_export_plan p LEFT JOIN cabinet_records r ON r.id=p.id WHERE p.export_id=$1 AND p.ordinal>$2 ORDER BY p.ordinal LIMIT 1000",
                      [input.exportId, prior.records],
                    );
                    return planned.map((r) => {
                      if (!r.content)
                        fail(
                          409,
                          "EXPORT_CHANGED",
                          "Une fiche a changé pendant la préparation ; régénérer.",
                        );
                      const record = CabinetRecordSchema.parse(r.content);
                      if (record.version !== Number(r.version))
                        fail(
                          409,
                          "EXPORT_CHANGED",
                          "Une fiche a changé pendant la préparation ; régénérer.",
                        );
                      return record;
                    });
                  }
                  const params: unknown[] = [prior.after];
                  const predicate = authorizedPredicate(
                    actor,
                    "export",
                    (v) => {
                      params.push(v);
                      return "$" + params.length;
                    },
                  );
                  return (
                    await tx.query(
                      `SELECT r.content FROM cabinet_records r WHERE ($1::uuid IS NULL OR r.id>$1::uuid) AND ${predicate} ORDER BY r.id LIMIT 1000`,
                      params,
                    )
                  ).map((r) => CabinetRecordSchema.parse(r.content));
                }
                if (prior.phase === "relationship")
                  return relationshipExportPage(tx, actor, prior.after);
                if (prior.phase === "time")
                  return timeExportPage(tx, actor, prior.after);
                if (prior.phase === "production")
                  return productionExportPage(
                    tx,
                    input.exportId,
                    actor,
                    prior.after,
                  );
                if (prior.phase === "workflows")
                  return workflowExportPage(
                    tx,
                    input.exportId,
                    actor,
                    prior.after,
                  );
                if (prior.phase === "fiscal" && !input.originals)
                  return (
                    await this.fiscalPage(
                      tx,
                      "SELECT e.id,e.content FROM cabinet_fiscal_events e JOIN cabinet_export_rows r ON r.export_id=$1 AND r.kind='record' AND r.id=e.obligation_id WHERE ($2::uuid IS NULL OR e.id>$2::uuid) AND e.version <= (r.content->>'version')::integer ORDER BY e.id LIMIT 1000",
                      [input.exportId, prior.after],
                    )
                  ).map((r) => FiscalTimelineEntrySchema.parse(r.content));
                if (prior.phase === "fiscal" && input.originals) {
                  const params: unknown[] = [input.exportId, prior.after];
                  const filters = currentNoticePredicate(
                    input.query ?? {},
                    (value) => {
                      params.push(value);
                      return "$" + params.length;
                    },
                  );
                  return (
                    await this.fiscalPage(
                      tx,
                      `SELECT e.id,e.content FROM cabinet_fiscal_events e JOIN cabinet_export_rows r ON r.export_id=$1 AND r.kind='record' AND r.id=e.obligation_id WHERE ($2::uuid IS NULL OR e.id>$2::uuid) AND e.version <= (r.content->>'version')::integer AND ${filters} AND ${latestNoticePredicate("(r.content->>'version')::integer")} ORDER BY e.id LIMIT 1000`,
                      params,
                    )
                  ).map((r) => FiscalTimelineEntrySchema.parse(r.content));
                }
                if (input.originals) {
                  const selected = await tx.query(
                    "SELECT d.id FROM cabinet_documents d WHERE ($2::uuid IS NULL OR d.id>$2::uuid) AND EXISTS(SELECT 1 FROM cabinet_export_rows e WHERE e.export_id=$1 AND e.kind='fiscal' AND (e.content->'event'->>'originalId'=d.id::text OR (e.content->'event'->'suiteIds') ? d.id::text)) ORDER BY d.id LIMIT 1000",
                    [input.exportId, prior.after],
                  );
                  const documents = [];
                  for (const item of selected)
                    documents.push(
                      await this.documents.get(tx, actor, String(item.id)),
                    );
                  return documents;
                }
                const dossierIds = (
                  await tx.query(
                    "SELECT id FROM cabinet_export_rows WHERE export_id=$1 AND kind='record' AND content->>'kind'='dossier' ORDER BY id",
                    [input.exportId],
                  )
                ).map((r) => String(r.id));
                return (
                  await this.documents.exportReferences(
                    tx,
                    actor,
                    dossierIds,
                    prior.after,
                  )
                ).items;
              },
              prior.phase === "production" ? { jit: false } : undefined,
            );
            const fields = await this.db.transaction(async (tx) => {
              if (input.query) return [];
              const ids = [
                ...new Set(
                  page.flatMap((r) =>
                    "data" in r && "customFields" in r.data
                      ? Object.keys(r.data.customFields)
                      : [],
                  ),
                ),
              ];
              if (!ids.length) return [];
              return tx.query(
                "SELECT f.id,f.content,p.content AS previous FROM cabinet_custom_fields f LEFT JOIN cabinet_export_rows p ON p.export_id=$1 AND p.kind='field' AND p.id=f.id WHERE f.id=ANY($2::uuid[])",
                [input.exportId, ids],
              );
            });
            const entries = page.map((value, index) => ({
              ordinal:
                (prior.phase === "records"
                  ? prior.records
                  : prior.phase === "fiscal"
                    ? prior.fiscal
                    : prior.phase === "workflows"
                      ? prior.workflows
                      : prior.phase === "production"
                        ? prior.production
                        : prior.phase === "time"
                          ? prior.time
                          : prior.phase === "relationship"
                            ? prior.relationship
                            : prior.documents) +
                index +
                1,
              id: value.id,
              kind:
                prior.phase === "records"
                  ? "record"
                  : prior.phase === "fiscal"
                    ? "fiscal"
                    : prior.phase === "workflows"
                      ? "workflow"
                      : prior.phase === "production"
                        ? "production"
                        : prior.phase === "time"
                          ? "time"
                          : prior.phase === "relationship"
                            ? "relationship"
                            : "document",
              content: value,
            }));
            for (const field of fields) {
              if (
                field.previous &&
                CustomFieldSchema.parse(field.previous).version !==
                  CustomFieldSchema.parse(field.content).version
              )
                fail(
                  409,
                  "EXPORT_DEFINITION_CHANGED",
                  "Un champ a changé pendant la sortie ; régénérer.",
                );
              if (!field.previous)
                entries.push({
                  ordinal: 0,
                  id: String(field.id),
                  kind: "field",
                  content: field.content as never,
                });
            }
            const overhead =
              input.query && !input.originals
                ? Math.max(2048, Buffer.byteLength(csvHeader(input.query)))
                : 2048;
            let part = prior.part,
              partBytes = Math.max(prior.partBytes, overhead),
              bytes = prior.bytes;
            const partitioned = entries.map((entry) => {
              // Includes JSON separators, the document URL and any availability error.
              const size = Math.max(
                Buffer.byteLength(JSON.stringify(entry.content)) +
                  (entry.kind === "document" ? 512 : 2),
                input.query && !input.originals
                  ? Buffer.byteLength(
                      csvRow(
                        CabinetRecordSchema.parse(entry.content),
                        input.query,
                      ),
                    )
                  : 0,
              );
              if (size + overhead > this.partLimit)
                fail(
                  413,
                  "EXPORT_OBJECT_LIMIT",
                  "Un objet dépasse la taille maximale d’une partie de sortie.",
                );
              if (partBytes + size > this.partLimit) {
                part++;
                partBytes = overhead;
              }
              partBytes += size;
              bytes += size;
              return { ...entry, part, size };
            });
            if (
              prior.records +
                prior.documents +
                prior.fiscal +
                prior.workflows +
                prior.production +
                prior.time +
                prior.relationship +
                page.length >
              400_000
            )
              fail(
                413,
                "EXPORT_COUNT_LIMIT",
                "Cette sortie dépasse 400 000 objets et références ; une préparation opérateur est nécessaire.",
              );
            const next = checkpointSchema.parse({
              ...prior,
              bytes,
              part,
              partBytes,
              after: page.at(-1)?.id ?? null,
              phase: page.length
                ? prior.phase
                : prior.phase === "records"
                  ? input.query && !input.originals
                    ? "complete"
                    : "fiscal"
                  : prior.phase === "fiscal"
                    ? input.originals
                      ? "documents"
                      : "workflows"
                    : prior.phase === "workflows"
                      ? "production"
                      : prior.phase === "production"
                        ? "time"
                        : prior.phase === "time"
                          ? "relationship"
                          : prior.phase === "relationship"
                            ? "documents"
                            : "complete",
              relationship:
                prior.relationship +
                (prior.phase === "relationship" ? page.length : 0),
              time: prior.time + (prior.phase === "time" ? page.length : 0),
              production:
                prior.production +
                (prior.phase === "production" ? page.length : 0),
              workflows:
                prior.workflows +
                (prior.phase === "workflows" ? page.length : 0),
              fiscal:
                prior.fiscal + (prior.phase === "fiscal" ? page.length : 0),
              records:
                prior.records + (prior.phase === "records" ? page.length : 0),
              documents:
                prior.documents +
                (prior.phase === "documents" ? page.length : 0),
            });
            // Durable pages remain small; the bounded journal records milestones,
            // including the extra production phase, rather than every 100-row page.
            const total = (c: typeof next) =>
              c.records +
              c.documents +
              c.fiscal +
              c.workflows +
              c.production +
              c.time +
              c.relationship;
            await ctx.commit(
              next,
              next.phase !== prior.phase
                ? "export.phase"
                : Math.floor(total(next) / 1000) >
                    Math.floor(total(prior) / 1000)
                  ? "export.batch"
                  : null,
              prior.phase === "records"
                ? "Lot d’objets préparé."
                : "Lot de références documentaires préparé.",
              async (tx, actor) => {
                for (const field of fields) {
                  const current = await tx.query(
                    "SELECT content FROM cabinet_custom_fields WHERE id=$1",
                    [field.id],
                  );
                  if (
                    !current[0] ||
                    CustomFieldSchema.parse(current[0].content).version !==
                      CustomFieldSchema.parse(field.content).version
                  )
                    fail(
                      409,
                      "EXPORT_DEFINITION_CHANGED",
                      "Un champ a changé pendant la sortie ; régénérer.",
                    );
                }
                if (partitioned.length)
                  await tx.query(
                    "INSERT INTO cabinet_export_rows(export_id,kind,id,content,part,size,ordinal) SELECT $1,x.kind,x.id,x.content,x.part,x.size,x.ordinal FROM jsonb_to_recordset($2::jsonb) AS x(kind text,id uuid,content jsonb,part integer,size integer,ordinal integer) ON CONFLICT(export_id,kind,id) DO NOTHING",
                    [input.exportId, JSON.stringify(partitioned)],
                  );
                await this.readable(tx, actor, input.exportId);
                if (next.phase === "complete")
                  await tx.query(
                    "UPDATE cabinet_exports SET content=jsonb_set(content,'{generatedAt}',to_jsonb($2::text)) WHERE id=$1",
                    [input.exportId, this.now().toISOString()],
                  );
              },
            );
          }
          return { exportId: input.exportId };
        } catch (e) {
          if (!ctx.signal.aborted)
            await this.db.transaction((tx) =>
              tx.query(
                "UPDATE cabinet_exports SET content=jsonb_set(content,'{failure}',to_jsonb($2::text)) WHERE id=$1",
                [
                  input.exportId,
                  e instanceof ApiFault
                    ? e.message
                    : "Préparation interrompue ; régénérer la sortie.",
                ],
              ),
            );
          throw e;
        }
      },
    });
    this.enqueue = worker.enqueue as typeof this.enqueue;
  }
  private fiscalPage(tx: Connection, sql: string, params: unknown[]) {
    return tx.query(
      `SELECT content FROM (SELECT id,content,sum(octet_length(content::text)) OVER(ORDER BY id) AS bytes,row_number() OVER(ORDER BY id) AS ordinal FROM (${sql}) page) bounded WHERE bytes<=2097152 OR ordinal=1 ORDER BY id`,
      params,
    );
  }
  private permit(actor: SessionUser) {
    if (!availablePermissions(actor).some((p) => p.action === "export"))
      fail(403, "FORBIDDEN", "Export non autorisé.");
  }
  private async readable(tx: Connection, actor: SessionUser, id: string) {
    this.permit(actor);
    const rows = await tx.query(
      "SELECT id,job_id,content,created_at FROM cabinet_exports WHERE id=$1 AND actor_id=$2",
      [id, actor.id],
    );
    if (!rows[0]) fail(404, "NOT_FOUND", "Sortie inaccessible.");
    const params: unknown[] = [id];
    const predicate = authorizedPredicate(actor, "export", (v) => {
      params.push(v);
      return "$" + params.length;
    });
    const denied = await tx.query(
      `WITH saved AS (SELECT id,content,content->>'kind' AS kind FROM cabinet_export_rows WHERE export_id=$1 AND kind='record') SELECT 1 WHERE EXISTS(SELECT 1 FROM saved r WHERE (${predicate}) IS NOT TRUE) OR EXISTS(SELECT 1 FROM saved s LEFT JOIN cabinet_records r ON r.id=s.id WHERE r.id IS NULL OR (${predicate}) IS NOT TRUE)`,
      params,
    );
    if (denied.length)
      fail(
        403,
        "EXPORT_SCOPE_CHANGED",
        "Les droits de cette sortie ont changé. Régénérer le fichier.",
      );
    let afterWorkflow: string | null = null;
    while (true) {
      const page: Record<string, unknown>[] = await tx.query(
        "SELECT id,content FROM cabinet_export_rows WHERE export_id=$1 AND kind='workflow' AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 100",
        [id, afterWorkflow],
      );
      if (!page.length) break;
      for (const row of page)
        await assertWorkflowExport(
          tx,
          actor,
          WorkflowExportSchema.parse(row.content),
        );
      afterWorkflow = String(page.at(-1)!.id);
    }
    let afterProduction: string | null = null;
    while (true) {
      const page: Record<string, unknown>[] = await tx.query(
        "SELECT id,content FROM cabinet_export_rows WHERE export_id=$1 AND kind='production' AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 100",
        [id, afterProduction],
      );
      if (!page.length) break;
      for (const row of page)
        await assertProductionExport(
          tx,
          actor,
          ProductionExportSchema.parse(row.content),
        );
      afterProduction = String(page.at(-1)!.id);
    }
    let afterTime: string | null = null;
    while (true) {
      const page: Record<string, unknown>[] = await tx.query(
        "SELECT id,content FROM cabinet_export_rows WHERE export_id=$1 AND kind='time' AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 100",
        [id, afterTime],
      );
      if (!page.length) break;
      await assertTimeExports(
        tx,
        actor,
        page.map((row) => TimeExportSchema.parse(row.content)),
      );
      afterTime = String(page.at(-1)!.id);
    }
    let afterRelationship: string | null = null;
    while (true) {
      const rows: Record<string, unknown>[] = await tx.query(
        "SELECT id,content FROM cabinet_export_rows WHERE export_id=$1 AND kind='relationship' AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 100",
        [id, afterRelationship],
      );
      if (!rows.length) break;
      for (const row of rows)
        await assertRelationshipExport(
          tx,
          actor,
          RelationshipExportSchema.parse(row.content),
        );
      afterRelationship = String(rows.at(-1)!.id);
    }
    let afterDocument: string | null = null;
    while (true) {
      const page: Record<string, unknown>[] = await tx.query(
        "SELECT id FROM cabinet_export_rows WHERE export_id=$1 AND kind='document' AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT 1000",
        [id, afterDocument],
      );
      if (!page.length) break;
      await this.documents.assertExportReferences(
        tx,
        actor,
        page.map((r) => String(r.id)),
      );
      afterDocument = String(page.at(-1)!.id);
    }
    return rows[0];
  }
  async start(
    tx: Connection,
    actor: SessionUser,
    command: z.infer<typeof ExportCommandSchema>,
  ) {
    this.permit(actor);
    if (command.originals) {
      await requireModule(tx, "fiscal");
      await requireModule(tx, "ged");
      if (
        !command.query ||
        command.query.kind !== "obligation" ||
        !["TF", "CFE_IFER"].includes(command.query.nature ?? "")
      )
        fail(
          400,
          "INVALID_ORIGINAL_SCOPE",
          "Sélection d’avis CFE/IFER ou taxe foncière requise.",
        );
    }
    const id = await idempotent(
      tx,
      actor,
      command.operationId,
      {
        action: "export.start",
        query: command.query ?? null,
        originals: command.originals,
      },
      async () => {
        await tx.query(
          "DELETE FROM cabinet_exports WHERE id IN (SELECT e.id FROM cabinet_exports e JOIN cabinet_jobs j ON j.id=e.job_id WHERE e.actor_id=$1 AND j.state IN ('completed','failed') ORDER BY e.created_at DESC OFFSET 4)",
          [actor.id],
        );
        const count = await tx.query(
          "SELECT count(*) AS n FROM cabinet_exports WHERE actor_id=$1",
          [actor.id],
        );
        if (Number(count[0]!.n) >= 5)
          fail(
            409,
            "EXPORT_LIMIT",
            "Cinq sorties sont déjà conservées ; attendre la fin d’un traitement.",
          );
        const source = await installation(tx),
          id = randomUUID();
        const header = headerSchema.parse({
          format: "memlia-cabinet-1",
          generatedAt: this.now().toISOString(),
          sourceInstallation: { id: source.id, name: source.name },
          scope:
            "objets autorisés actifs et archivés, avec leurs références documentaires",
        });
        await tx.query(
          "INSERT INTO cabinet_exports(id,actor_id,created_at,content) VALUES($1,$2,$3,$4::jsonb)",
          [
            id,
            actor.id,
            this.now(),
            JSON.stringify({
              ...header,
              query: command.query ?? null,
              originals: command.originals,
            }),
          ],
        );
        const job = await this.enqueue(tx, actor, randomUUID(), {
          exportId: id,
          query: command.query,
          originals: command.originals,
        });
        await tx.query("UPDATE cabinet_exports SET job_id=$2 WHERE id=$1", [
          id,
          job,
        ]);
        return id;
      },
    );
    return this.get(tx, actor, id);
  }
  async get(tx: Connection, actor: SessionUser, id: string) {
    const stored = await this.readable(tx, actor, id),
      job = await this.jobs.get(tx, String(stored.job_id)),
      progress = checkpointSchema.parse(job.checkpoint);
    return ExportRunSchema.parse({
      id,
      createdAt: new Date(String(stored.created_at)).toISOString(),
      job: job.job,
      records: progress.records,
      documents: progress.documents,
      error:
        (stored.content as { failure?: string }).failure ??
        (stored.content as { downloadFailure?: string }).downloadFailure ??
        null,
      encoding: (stored.content as { originals?: boolean }).originals
        ? "tar"
        : (stored.content as { query?: unknown }).query
          ? "csv"
          : "json",
      query: (stored.content as { query?: unknown }).query ?? null,
    });
  }
  async list(tx: Connection, actor: SessionUser) {
    this.permit(actor);
    const rows = await tx.query(
      "SELECT id FROM cabinet_exports WHERE actor_id=$1 ORDER BY created_at DESC LIMIT 5",
      [actor.id],
    );
    const items = [];
    for (const row of rows) {
      try {
        items.push(await this.get(tx, actor, String(row.id)));
      } catch (e) {
        if (
          !(
            e instanceof Error &&
            "code" in e &&
            e.code === "EXPORT_SCOPE_CHANGED"
          )
        )
          throw e;
      }
    }
    return { items };
  }
  async originals(tx: Connection, actor: SessionUser, id: string) {
    const stored = await this.readable(tx, actor, id);
    await requireModule(tx, "fiscal");
    await requireModule(tx, "ged");
    if (!(stored.content as { originals?: boolean }).originals)
      fail(
        400,
        "INVALID_ORIGINAL_SCOPE",
        "Cette préparation ne contient pas un lot d’originaux.",
      );
    if (
      (await this.jobs.get(tx, String(stored.job_id))).job.state !== "completed"
    )
      fail(409, "EXPORT_NOT_READY", "Préparation non terminée.");
    const owner = this;
    const current = async (connection: Connection) => {
      const users = await connection.query(
        "SELECT * FROM cabinet_users WHERE id=$1 AND active=true",
        [actor.id],
      );
      if (!users[0]) fail(403, "FORBIDDEN", "Sortie inaccessible.");
      return effectiveUser(connection, users[0]);
    };
    let stream!: Readable;
    stream = Readable.from(
      (async function* () {
        let completed = false,
          reportNumber = 0,
          downloaded = 0,
          selectedNotices = 0,
          missing = 0,
          after: string | null = null;
        try {
          // Each metadata page is bounded independently of the original byte size.
          for (const kind of ["record", "fiscal"]) {
            after = null;
            let pageNumber = 0;
            while (true) {
              const rows = await owner.db.transaction(async (connection) => {
                const user = await current(connection);
                await owner.readable(connection, user, id);
                await requireModule(connection, "fiscal");
                return connection.query(
                  "SELECT id,content FROM (SELECT id,content,sum(size) OVER(ORDER BY id) AS bytes,row_number() OVER(ORDER BY id) AS ordinal FROM cabinet_export_rows WHERE export_id=$1 AND kind=$2 AND ($3::uuid IS NULL OR id>$3::uuid) ORDER BY id LIMIT 100) bounded WHERE bytes<=2097152 OR ordinal=1 ORDER BY id",
                  [id, kind, after],
                );
              });
              if (!rows.length) break;
              yield* tarFile(
                `manifest/${kind}-${++pageNumber}.json`,
                Buffer.from(JSON.stringify(rows.map((r) => r.content))),
              );
              if (kind === "fiscal")
                for (const row of rows) {
                  const e = FiscalTimelineEntrySchema.parse(row.content);
                  if (e.event.kind !== "notice") continue;
                  selectedNotices++;
                  const notice = e.event;
                  const errors = [
                    ...(!notice.originalId ? ["MISSING_ORIGINAL"] : []),
                    ...(notice.expectedSuites > notice.suiteIds.length
                      ? ["MISSING_SUITE"]
                      : []),
                  ];
                  if (errors.length) {
                    missing += errors.length;
                    yield* tarFile(
                      `reports/${++reportNumber}.json`,
                      Buffer.from(
                        JSON.stringify({
                          noticeId: notice.id,
                          reference: notice.reference,
                          errors,
                          missingSuites:
                            notice.expectedSuites - notice.suiteIds.length,
                        }),
                      ),
                    );
                  }
                }
              after = String(rows.at(-1)!.id);
            }
          }
          after = null;
          while (true) {
            const rows = await owner.db.transaction(async (connection) => {
              const user = await current(connection);
              await owner.readable(connection, user, id);
              await requireModule(connection, "fiscal");
              await requireModule(connection, "ged");
              return connection.query(
                "SELECT id FROM cabinet_export_rows WHERE export_id=$1 AND kind='document' AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT 100",
                [id, after],
              );
            });
            if (!rows.length) break;
            for (const row of rows) {
              const result = await owner.db.transaction(async (connection) => {
                const user = await current(connection);
                await owner.readable(connection, user, id);
                await requireModule(connection, "fiscal");
                await requireModule(connection, "ged");
                try {
                  return {
                    download: await owner.documents.download(
                      connection,
                      user,
                      String(row.id),
                    ),
                    error: null,
                  };
                } catch (error) {
                  if (
                    error instanceof ApiFault &&
                    ["DOCUMENT_MISSING", "DOCUMENT_CORRUPT"].includes(
                      error.code,
                    )
                  )
                    return { download: null, error: error.code };
                  throw error;
                }
              });
              if (result.download) {
                const { document, bytes } = result.download;
                yield* tarFile(
                  originalPath(document.id, document.filename),
                  bytes,
                );
                downloaded++;
                yield* tarFile(
                  `reports/${++reportNumber}.json`,
                  Buffer.from(
                    JSON.stringify({
                      documentId: document.id,
                      version: document.version,
                      sha256: document.sha256,
                      path: originalPath(document.id, document.filename),
                      status: "downloaded",
                    }),
                  ),
                );
              } else {
                missing++;
                yield* tarFile(
                  `reports/${++reportNumber}.json`,
                  Buffer.from(
                    JSON.stringify({ documentId: row.id, error: result.error }),
                  ),
                );
              }
            }
            after = String(rows.at(-1)!.id);
          }
          await owner.db.transaction(async (connection) => {
            await owner.readable(connection, await current(connection), id);
            await requireModule(connection, "fiscal");
            await requireModule(connection, "ged");
          });
          yield* tarFile(
            "reports/final.json",
            Buffer.from(
              JSON.stringify({
                downloaded,
                missing,
                complete: missing === 0 && selectedNotices > 0,
                selectionComplete: true,
                emptySelection: selectedNotices === 0,
                generatedAt: owner.now().toISOString(),
              }),
            ),
          );
          yield Buffer.alloc(1024);
          completed = true;
          await owner.db.transaction((connection) =>
            connection.query(
              "UPDATE cabinet_exports SET content=content - 'downloadFailure' WHERE id=$1",
              [id],
            ),
          );
        } finally {
          owner.streams.delete(stream);
          if (!completed)
            await owner.db
              .transaction((connection) =>
                connection.query(
                  "UPDATE cabinet_exports SET content=jsonb_set(content,'{downloadFailure}',to_jsonb($2::text)) WHERE id=$1",
                  [
                    id,
                    "Restitution interrompue ; recommencer le téléchargement avec les droits actuels.",
                  ],
                ),
              )
              .catch(() => {});
        }
      })(),
      { highWaterMark: 65536, objectMode: false },
    );
    this.streams.add(stream);
    return stream;
  }

  async download(
    tx: Connection,
    actor: SessionUser,
    id: string,
    part?: number,
  ) {
    const stored = await this.readable(tx, actor, id),
      job = await this.jobs.get(tx, String(stored.job_id));
    if (job.job.state !== "completed")
      fail(409, "EXPORT_NOT_READY", "La sortie n’est pas terminée.");
    const originals = Boolean(
      (stored.content as { originals?: boolean }).originals,
    );
    const query = RecordListQuerySchema.nullable().parse(
      (stored.content as { query?: unknown }).query ?? null,
    );
    if (part === undefined) {
      const parts = await tx.query(
        "SELECT part,count(*) AS count,sum(size)+$2::integer AS bytes FROM cabinet_export_rows WHERE export_id=$1 GROUP BY part ORDER BY part",
        [
          id,
          query ? Math.max(2048, Buffer.byteLength(csvHeader(query))) : 2048,
        ],
      );
      return ExportManifestSchema.parse({
        ...headerSchema.parse(stored.content),
        format: "memlia-cabinet-manifest-1",
        encoding: originals ? "tar" : query ? "csv" : "json",
        query,
        parts: parts.map((p) => ({
          number: Number(p.part),
          count: Number(p.count),
          maximumBytes: Number(p.bytes),
          downloadUrl: `/api/v1/administration/exports/${id}/parts/${p.part}`,
        })),
        records: checkpointSchema.parse(job.checkpoint).records,
        documents: checkpointSchema.parse(job.checkpoint).documents,
      });
    }
    const rows = await tx.query(
      "SELECT kind,content FROM cabinet_export_rows WHERE export_id=$1 AND part=$2 ORDER BY ordinal,kind,id",
      [id, part],
    );
    if (!rows.length) fail(404, "NOT_FOUND", "Partie inaccessible.");
    if (query && !originals)
      return (
        csvHeader(query) +
        rows
          .map((r) =>
            csvRow(
              CabinetRecordSchema.parse(r.content),
              query,
              new Date(headerSchema.parse(stored.content).generatedAt),
              this.civilDate(
                new Date(headerSchema.parse(stored.content).generatedAt),
              ),
            ),
          )
          .join("")
      );
    const records = rows
        .filter((r) => r.kind === "record")
        .map((r) => r.content),
      customFields = rows
        .filter((r) => r.kind === "field")
        .map((r) => r.content),
      documents = rows
        .filter((r) => r.kind === "document")
        .map((r) => ({
          ...DocumentSchema.parse(r.content),
          downloadUrl: `/api/v1/documents/${(r.content as { id: string }).id}/download`,
        }));
    return CabinetExportSchema.parse({
      ...headerSchema.parse(stored.content),
      records,
      customFields,
      relationship: rows
        .filter((r) => r.kind === "relationship")
        .map((r) => r.content),
      time: rows.filter((r) => r.kind === "time").map((r) => r.content),
      production: rows
        .filter((r) => r.kind === "production")
        .map((r) => r.content),
      workflows: rows
        .filter((r) => r.kind === "workflow")
        .map((r) => r.content),
      fiscalEvents: rows
        .filter((r) => r.kind === "fiscal")
        .map((r) => r.content),
      documents,
      errors: documents
        .filter((d) => d.availability !== "available")
        .map((d) => ({
          documentId: d.id,
          code:
            d.availability === "missing"
              ? "DOCUMENT_MISSING"
              : "DOCUMENT_CORRUPT",
          message:
            d.availability === "missing"
              ? "Original absent du stockage local."
              : "Intégrité de l’original altérée.",
        })),
    });
  }
}
export function registerExportRoutes(
  app: FastifyInstance,
  { db, user }: RouteContext,
  exports: Exports,
) {
  app.post("/api/v1/production/exports", async (req, reply) =>
    reply
      .code(202)
      .send(
        await db.transaction(async (tx) =>
          exports.productionGrid.start(
            tx,
            await user(tx, req),
            GridExportCommandSchema.parse(req.body),
          ),
        ),
      ),
  );
  app.get("/api/v1/production/exports/:id", async (req) =>
    db.transaction(async (tx) =>
      exports.productionGrid.get(tx, await user(tx, req), id(req.params)),
    ),
  );
  app.get("/api/v1/production/exports/:id/parts/:part", async (req, reply) => {
    const p = z
      .object({ id: z.uuid(), part: z.coerce.number().int().positive() })
      .parse(req.params);
    const csv = await db.transaction(async (tx) =>
      exports.productionGrid.part(tx, await user(tx, req), p.id, p.part),
    );
    return reply
      .type("text/csv; charset=utf-8")
      .header(
        "content-disposition",
        'attachment; filename="memlia-production.csv"',
      )
      .send(csv);
  });
  app.addHook("preClose", async () => exports.stop());
  const id = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;
  app.post("/api/v1/administration/exports", async (req, reply) => {
    const command = ExportCommandSchema.parse(req.body);
    return reply
      .code(202)
      .send(
        await db.transaction(async (tx) =>
          exports.start(tx, await user(tx, req), command),
        ),
      );
  });
  app.get("/api/v1/administration/exports", async (req) =>
    db.transaction(async (tx) =>
      ExportListSchema.parse(await exports.list(tx, await user(tx, req))),
    ),
  );
  app.get("/api/v1/administration/exports/:id", async (req) =>
    db.transaction(async (tx) =>
      exports.get(tx, await user(tx, req), id(req.params)),
    ),
  );
  app.get(
    "/api/v1/administration/exports/:id/originals.tar",
    async (req, reply) => {
      const stream = await db.transaction(async (tx) =>
        exports.originals(tx, await user(tx, req), id(req.params)),
      );
      reply.raw.on("close", () => stream.destroy());
      return reply
        .header("content-type", "application/x-tar")
        .header(
          "content-disposition",
          'attachment; filename="memlia-avis-originaux.tar"',
        )
        .send(stream);
    },
  );
  app.get("/api/v1/administration/exports/:id/download", async (req, reply) => {
    const result = await db.transaction(async (tx) =>
      exports.download(tx, await user(tx, req), id(req.params)),
    );
    return reply
      .header("content-type", "application/json; charset=utf-8")
      .header(
        "content-disposition",
        'attachment; filename="memlia-sortie.json"',
      )
      .send(result);
  });
  app.get(
    "/api/v1/administration/exports/:id/parts/:part",
    async (req, reply) => {
      const params = z
        .object({ id: z.uuid(), part: z.coerce.number().int().positive() })
        .parse(req.params);
      const result = await db.transaction(async (tx) =>
        exports.download(tx, await user(tx, req), params.id, params.part),
      );
      return reply
        .header(
          "content-type",
          typeof result === "string"
            ? "text/csv; charset=utf-8"
            : "application/json; charset=utf-8",
        )
        .header(
          "content-disposition",
          `attachment; filename="memlia-partie-${params.part}.${typeof result === "string" ? "csv" : "json"}"`,
        )
        .send(result);
    },
  );
}
