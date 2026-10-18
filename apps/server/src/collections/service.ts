import { isDeepStrictEqual } from "node:util";
import { observeCompany } from "../administration/companies.js";
import { requireModule } from "../administration/settings.js";
import { createHash, randomUUID } from "node:crypto";
import {
  CollectionInputSchema,
  CollectionResultSchema,
  CollectionCheckpointSchema,
  CollectionObservationSchema,
  SourceSnapshotSchema,
  CollectionRunSchema,
  DocumentInputSchema,
  DocumentReferenceSchema,
  type CollectionInput,
  type CollectionResult,
  type SessionUser,
  type DocumentInput,
} from "@memlia/contracts";
import type { Database, Connection } from "../storage/database.js";
import { JobRunner, type JobContext } from "../jobs/runner.js";
import { DocumentStore, type PreparedDocument } from "../documents/store.js";
import { loadRecord } from "../records/service.js";
import { requireAccess } from "../records/permissions.js";
import { fail, ApiFault } from "../errors.js";
import {
  simulate,
  fictitiousPdf,
  type FixtureRecord,
} from "../../fixtures/collections.js";
import type { z } from "zod";
type Checkpoint = z.infer<typeof CollectionCheckpointSchema>;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const uuid = (key: string) => {
  const h = hash(key);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
async function authorize(
  tx: Connection,
  actor: SessionUser,
  input: CollectionInput,
  write = true,
) {
  if (write) await requireModule(tx, "collectes");
  const dossier = await loadRecord(tx, input.scope.dossierId);
  if (dossier.kind !== "dossier")
    fail(404, "NOT_FOUND", "Ressource inaccessible.");
  await requireAccess(tx, actor, "read", dossier);
  if (write) await requireAccess(tx, actor, "update", dossier);
  if (dossier.data.siren && dossier.data.siren !== input.scope.companyId)
    fail(
      409,
      "IDENTITY_MISMATCH",
      "L’identité demandée ne correspond pas au dossier.",
    );
}
function observationKey(input: CollectionInput, record: FixtureRecord) {
  return hash([
    input.mode,
    input.connectorId,
    input.cabinetRef,
    input.scope,
    input.period,
    record.reference,
    record.version,
  ]);
}
export class CollectionExecutor {
  constructor(
    private db: Database,
    private store: DocumentStore,
    private runner: JobRunner,
    private context: JobContext<Checkpoint>,
    private now: () => Date,
  ) {}
  async runCollection(raw: CollectionInput): Promise<CollectionResult> {
    const input = CollectionInputSchema.parse(raw);
    if (input.mode !== "simulation")
      fail(
        409,
        "REAL_MODE_DISABLED",
        "Les collecteurs réels ne sont pas activés.",
      );
    const page = simulate(input),
      context = this.context;
    const sourceReferences = page.records.map((record) => record.reference);
    const normalized = new Map<string, FixtureRecord>();
    for (const record of page.records) {
      const key = record.reference + ":" + record.version,
        previous = normalized.get(key);
      if (
        previous &&
        previous.data.kind === "message" &&
        record.data.kind === "message"
      ) {
        const { portfolios: priorPortfolios, ...priorData } = previous.data;
        const { portfolios: nextPortfolios, ...nextData } = record.data;
        if (hash(priorData) !== hash(nextData))
          fail(
            409,
            "SOURCE_VERSION_CONFLICT",
            "Identité dupliquée avec des observations contradictoires.",
          );
        previous.data.portfolios = [
          ...new Set([...priorPortfolios, ...nextPortfolios]),
        ].sort();
      } else if (previous) {
        if (hash(previous) !== hash(record))
          fail(
            409,
            "SOURCE_VERSION_CONFLICT",
            "Identité source contradictoire.",
          );
      } else normalized.set(key, structuredClone(record));
    }
    page.records = [...normalized.values()];
    const result: CollectionResult = {
      mode: "simulation",
      connectorId: input.connectorId,
      status: "complete",
      coverage: {
        requested: { scope: input.scope, period: input.period },
        observed: [],
        missing: [],
        boundaryVerified: false,
        emptyExplicit: false,
      },
      records: [],
      artifacts: [],
      events: [],
      errors: [],
      checkpoint: context.checkpoint,
    };
    const finish = async () => {
      result.events = (
        await this.db.transaction((tx) => this.runner.get(tx, context.id))
      ).job.events;
      result.checkpoint = context.checkpoint;
      return CollectionResultSchema.parse(result);
    };
    const error = (
      status: CollectionResult["status"],
      code: string,
      cause: string,
    ) => {
      result.status = status;
      result.errors.push({
        code,
        cause,
        scope: "requested-scope",
        retryable: false,
        evidenceReference: "fixture:" + input.scenario,
      });
      result.coverage.missing = ["portee-non-verifiee"];
      return finish();
    };
    if (
      input.cabinetRef !== "cabinet-fictif" ||
      input.credentialRef !== "fixture-account" ||
      JSON.stringify(page.identity) !==
        JSON.stringify({ ...page.identity, ...input.scope }) ||
      JSON.stringify(page.period) !== JSON.stringify(input.period)
    )
      return error(
        "needs-human",
        "IDENTITY_MISMATCH",
        "Compte, cotisant, dossier, établissement, service ou période inattendu.",
      );
    if (input.scenario === "challenge")
      return error(
        "needs-human",
        "CHALLENGE_REQUIRED",
        "Intervention requise : challenge de connexion simulé.",
      );
    if (input.scenario === "unavailable")
      return error(
        "not-available",
        "SOURCE_UNAVAILABLE",
        "Source absente dans ce périmètre fictif.",
      );
    if (input.scenario === "source-failure")
      return error(
        "failed",
        "SOURCE_FAILURE",
        "Échec explicite de la source fictive.",
      );
    if (context.checkpoint.page === 0) {
      const prepared: {
        handle: PreparedDocument;
        identity: string;
        input: DocumentInput;
        sha256: string;
      }[] = [];
      try {
        for (const record of page.records) {
          context.signal.throwIfAborted();
          const identity = observationKey(input, record);
          for (const filename of record.documents) {
            const documentInput = DocumentInputSchema.parse({
              operationId: uuid(identity + filename),
              dossierId: input.scope.dossierId,
              filename,
              mediaType: "application/pdf",
              source: {
                kind: "simulation:" + input.connectorId,
                reference: record.reference + ":" + filename,
                version: record.version,
              },
            });
            await context.commit(
              context.checkpoint,
              "acquiring",
              "Préparation d’un original fictif hors transaction.",
              async (tx, actor) => {
                await this.store.authorize(tx, actor, documentInput);
              },
            );
            const bytes =
              input.scenario === "html-login"
                ? Buffer.from("<html>Connexion fictive requise</html>")
                : fictitiousPdf(filename, record);
            const handle = await this.store.prepare(documentInput, bytes);
            prepared.push({
              handle,
              identity,
              input: documentInput,
              sha256: createHash("sha256").update(bytes).digest("hex"),
            });
          }
        }
        await context.commit(
          { page: 1, lastReference: page.records.at(-1)?.reference ?? null },
          "committed",
          "Identité contrôlée ; observations, pièces et point de reprise conservés ensemble.",
          async (tx, actor) => {
            const provenance = {
              mode: "simulation" as const,
              connectorId: input.connectorId,
              adapterVersion: "fixture-1" as const,
              observedAt: this.now().toISOString(),
              sourceVersion: "fixture-1",
            };
            for (const record of page.records) {
              const identity = observationKey(input, record);
              const existing = await tx.query(
                "SELECT content FROM cabinet_collection_observations WHERE identity=$1",
                [identity],
              );
              if (existing[0]) {
                const previous = CollectionObservationSchema.parse(
                  existing[0].content,
                );
                if (
                  !isDeepStrictEqual(previous.data, record.data) ||
                  previous.rawState !== record.rawState
                )
                  fail(
                    409,
                    "SOURCE_VERSION_CONFLICT",
                    "La même version source présente des valeurs différentes.",
                  );
                const originals = await tx.query(
                  "SELECT content FROM cabinet_documents WHERE id=ANY($1::uuid[])",
                  [previous.documentIds],
                );
                const references = originals.map((row) =>
                  DocumentReferenceSchema.parse(row.content),
                );
                const candidates = prepared.filter(
                  (p) => p.identity === identity,
                );
                if (
                  references.length !== candidates.length ||
                  candidates.some(
                    (item) =>
                      !references.some(
                        (doc) =>
                          doc.filename === item.input.filename &&
                          doc.sha256 === item.sha256,
                      ),
                  )
                )
                  fail(
                    409,
                    "SOURCE_VERSION_CONFLICT",
                    "Original différent sous la même version source.",
                  );
              } else {
                const documents = [];
                for (const item of prepared.filter(
                  (p) => p.identity === identity,
                ))
                  documents.push(
                    await this.store.commit(tx, actor, item.handle, this.now()),
                  );
                const observation = CollectionObservationSchema.parse({
                  id: randomUUID(),
                  reference: record.reference,
                  version: record.version,
                  scope: input.scope,
                  period: page.period,
                  rawState: record.rawState,
                  provenance: { ...provenance, sourceVersion: record.version },
                  data: record.data,
                  documentIds: documents.map((d) => d.id),
                });
                await tx.query(
                  "INSERT INTO cabinet_collection_observations VALUES($1,$2,$3::jsonb)",
                  [
                    identity,
                    input.scope.dossierId,
                    JSON.stringify(observation),
                  ],
                );
              }
              if (record.data.kind === "company" && record.data.values) {
                await observeCompany(
                  tx,
                  actor,
                  "collection:" +
                    hash([
                      input.mode,
                      input.connectorId,
                      input.cabinetRef,
                      input.scope.accountId,
                      record.data.externalCompanyId,
                    ]),
                  {
                    kind: "simulated",
                    reference: `${input.connectorId}:${record.data.externalCompanyId}`,
                    version: record.version,
                    at: this.now().toISOString(),
                  },
                  record.data.values,
                  false,
                  this.now(),
                  input.scope.dossierId,
                );
              }
              await tx.query(
                "INSERT INTO cabinet_collection_links VALUES($1,$2) ON CONFLICT DO NOTHING",
                [context.id, identity],
              );
            }
            const snapshot = SourceSnapshotSchema.parse({
              page: 1,
              identity: page.identity,
              period: page.period,
              boundary: page.boundary,
              references: sourceReferences,
              provenance,
            });
            await tx.query(
              "INSERT INTO cabinet_collection_snapshots VALUES($1,1,$2::jsonb)",
              [context.id, JSON.stringify(snapshot)],
            );
          },
        );
      } catch (e) {
        if (
          e instanceof ApiFault &&
          ["INVALID_PDF", "PASSWORD_REQUIRED"].includes(e.code)
        )
          return error(
            "needs-human",
            "INVALID_ORIGINAL",
            "L’original reçu est une page de connexion ou un PDF invalide ; aucune pièce publiée.",
          );
        throw e;
      } finally {
        for (const item of prepared) await this.store.discard(item.handle);
      }
      // A simulated crash after the atomic unit, to prove restart without another original.
      if (input.scenario === "interrupted" && context.attempt === 1)
        throw new Error("Interruption fictive après engagement.");
    }
    await context.commit(
      context.checkpoint,
      "coverage",
      "Évaluation de la couverture demandée.",
      async (tx, actor) => {
        const rows = await tx.query(
          "SELECT o.content FROM cabinet_collection_links l JOIN cabinet_collection_observations o ON o.identity=l.identity WHERE l.job_id=$1 ORDER BY o.content->>'reference'",
          [context.id],
        );
        result.records = rows.map((r) =>
          CollectionObservationSchema.parse(r.content),
        );
        for (const record of result.records)
          for (const id of record.documentIds) {
            const { availability: _availability, ...reference } =
              await this.store.get(tx, actor, id);
            result.artifacts.push(DocumentReferenceSchema.parse(reference));
          }
        const snapshots = await tx.query(
          "SELECT content FROM cabinet_collection_snapshots WHERE job_id=$1 ORDER BY page",
          [context.id],
        );
        result.coverage.observed = snapshots.map((r) =>
          SourceSnapshotSchema.parse(r.content),
        );
      },
    );
    result.coverage.missing = page.missing;
    result.coverage.boundaryVerified = page.boundary === "last-page";
    result.coverage.emptyExplicit = input.scenario === "empty";
    result.status =
      page.missing.length || !result.coverage.boundaryVerified
        ? "partial"
        : result.coverage.emptyExplicit
          ? "empty-observed"
          : "complete";
    result.errors = page.missing.map((m) => ({
      code: "INCOMPLETE_SCOPE",
      scope: m,
      cause:
        "Élément manquant ou frontière non démontrée dans le scénario fictif.",
      retryable: false,
      evidenceReference: "fixture:" + input.scenario,
    }));
    result.checkpoint = context.checkpoint;
    return finish();
  }
}
export class CollectionService {
  private queue;
  constructor(
    private db: Database,
    private runner: JobRunner,
    store: DocumentStore,
    now: () => Date,
  ) {
    this.queue = runner.register({
      kind: "collection",
      input: CollectionInputSchema,
      checkpoint: CollectionCheckpointSchema,
      result: CollectionResultSchema,
      initial: { page: 0, lastReference: null },
      scope: (input) => ({
        dossierId: input.scope.dossierId,
        resourceKey: hash([
          input.cabinetRef,
          input.connectorId.split("-")[0],
          input.scope.accountId,
        ]),
      }),
      authorize,
      execute: (input, context) =>
        new CollectionExecutor(db, store, runner, context, now).runCollection(
          input,
        ),
    });
  }
  async enqueue(tx: Connection, actor: SessionUser, raw: CollectionInput) {
    const input = CollectionInputSchema.parse(raw);
    await authorize(tx, actor, input);
    if (input.mode !== "simulation")
      fail(
        409,
        "REAL_MODE_DISABLED",
        "Les collecteurs réels ne sont pas activés.",
      );
    return this.queue.enqueue(tx, actor, input.operationId, input);
  }
  async get(tx: Connection, actor: SessionUser, id: string) {
    const stored = await this.runner.get(tx, id);
    if (stored.job.kind !== "collection")
      fail(404, "NOT_FOUND", "Ressource inaccessible.");
    const input = CollectionInputSchema.parse(stored.input);
    await authorize(tx, actor, input, false);
    const result = stored.result
      ? CollectionResultSchema.parse(stored.result)
      : null;
    if (result) result.events = stored.job.events;
    const {
      credentialRef: _credentialRef,
      operationId: _operationId,
      ...publicInput
    } = input;
    return CollectionRunSchema.parse({
      job: stored.job,
      input: publicInput,
      checkpoint: stored.checkpoint,
      result,
    });
  }
}
