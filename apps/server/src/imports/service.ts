import { requireModule } from "../administration/settings.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ImportPreviewSchema,
  ImportLineSchema,
  ImportCommitSchema,
  ImportSelectionSchema,
  ImportUploadSchema,
  ImportRemapSchema,
  type ImportPreview,
  type ImportLine,
  type ImportTable,
  type SessionUser,
} from "@memlia/contracts";
import type { Connection, Database } from "../storage/database.js";
import { JobRunner } from "../jobs/runner.js";
import { idempotent } from "../storage/operations.js";
import { ApiFault, fail } from "../errors.js";
import { availablePermissions } from "../administration/access.js";
import { applyAssignments } from "../administration/assignments.js";
import { loadRecord, saveRecord } from "../records/service.js";
import { canAccess, requireAccess } from "../records/permissions.js";
import {
  normalize,
  duplicateKey,
  mergeLine,
  fieldValue,
  same,
  hash,
} from "./normalization.js";
const jobInput = z.object({
  previewId: z.uuid(),
  sourceHash: ImportPreviewSchema.shape.sourceHash,
});
function permit(actor: SessionUser, kind: ImportPreview["kind"]) {
  if (
    !availablePermissions(actor).some((p) =>
      kind === "assignment"
        ? p.action === "assign"
        : (p.kind === kind || p.kind === "*") &&
          ["create", "update"].includes(p.action),
    )
  )
    fail(403, "FORBIDDEN", "Reprise non autorisée.");
}
async function persist(tx: Connection, p: ImportPreview) {
  await tx.query(
    "UPDATE cabinet_import_previews SET content=$2::jsonb WHERE id=$1",
    [p.id, JSON.stringify(p)],
  );
  return p;
}
export class Imports {
  private enqueue: ReturnType<JobRunner["register"]>["enqueue"];
  constructor(
    private db: Database,
    private jobs: JobRunner,
    private now: () => Date,
  ) {
    const worker = jobs.register({
      kind: "import",
      input: jobInput,
      checkpoint: z.object({ after: z.number().int().nonnegative() }),
      result: z.object({ previewId: z.uuid(), processed: z.number().int() }),
      initial: { after: 0 },
      scope: (i) => ({ dossierId: null, resourceKey: "import:" + i.previewId }),
      authorize: async (tx, actor, i) => {
        await requireModule(tx, "imports");
        const p = await this.load(tx, actor, i.previewId);
        const rows = await tx.query(
          "SELECT source_bytes FROM cabinet_import_previews WHERE id=$1",
          [p.id],
        );
        if (
          hash(Buffer.from(rows[0]!.source_bytes as Uint8Array)) !==
            i.sourceHash ||
          p.sourceHash !== i.sourceHash
        )
          fail(409, "SOURCE_CHANGED", "La source de l’aperçu a changé.");
      },
      execute: async (i, ctx) => {
        let done = false;
        while (!done) {
          ctx.signal.throwIfAborted();
          const rows = await this.db.transaction((tx) =>
            tx.query(
              "SELECT ordinal,content,commit_selected FROM cabinet_import_rows WHERE preview_id=$1 AND ordinal>$2 ORDER BY ordinal LIMIT 100",
              [i.previewId, ctx.checkpoint.after],
            ),
          );
          if (!rows.length) break;
          const after = Number(rows.at(-1)!.ordinal);
          await ctx.commit(
            { after },
            "import.batch",
            "Lot de lignes traité.",
            async (tx, actor) => {
              await requireModule(tx, "imports");
              const p = await this.load(tx, actor, i.previewId);
              for (const raw of rows) {
                let line = ImportLineSchema.parse(raw.content);
                if (line.status !== "pending") continue;
                if (!raw.commit_selected) {
                  line = {
                    ...line,
                    status: "refused",
                    errors: [...line.errors, "Ligne non retenue."],
                  };
                } else {
                  await tx.query("SAVEPOINT import_line");
                  try {
                    line = await this.commitLine(tx, actor, p, line);
                    await tx.query("RELEASE SAVEPOINT import_line");
                  } catch (e) {
                    await tx.query("ROLLBACK TO SAVEPOINT import_line");
                    await tx.query("RELEASE SAVEPOINT import_line");
                    if (!(e instanceof ApiFault) && !(e instanceof z.ZodError))
                      throw e;
                    line = {
                      ...line,
                      status: "refused",
                      errors: [
                        e instanceof ApiFault
                          ? `${e.code} : ${e.message}`
                          : "Valeurs métier invalides.",
                      ],
                    };
                  }
                }
                await tx.query(
                  "UPDATE cabinet_import_rows SET content=$3::jsonb WHERE preview_id=$1 AND line_id=$2",
                  [p.id, line.lineId, JSON.stringify(line)],
                );
              }
              done = after >= p.total;
              await persist(tx, {
                ...p,
                state: done ? "completed" : "running",
                processed: after,
              });
            },
          );
        }
        return { previewId: i.previewId, processed: ctx.checkpoint.after };
      },
    });
    this.enqueue = worker.enqueue as typeof this.enqueue;
  }
  async load(tx: Connection, actor: SessionUser, id: string) {
    const rows = await tx.query(
      "SELECT content FROM cabinet_import_previews WHERE id=$1 AND actor_id=$2",
      [id, actor.id],
    );
    if (!rows[0]) fail(404, "NOT_FOUND", "Aperçu inaccessible.");
    const p = ImportPreviewSchema.parse(rows[0].content);
    permit(actor, p.kind);
    return p;
  }
  async get(tx: Connection, actor: SessionUser, id: string) {
    let p = await this.load(tx, actor, id);
    if (p.jobId) {
      const job = (await this.jobs.get(tx, p.jobId)).job;
      if (job.state === "failed")
        p = { ...p, state: "failed", error: job.error };
    }
    return p;
  }
  async list(tx: Connection, actor: SessionUser) {
    const rows = await tx.query(
      "SELECT content FROM cabinet_import_previews WHERE actor_id=$1 ORDER BY content->>'createdAt' DESC LIMIT 10",
      [actor.id],
    );
    return rows
      .map((r) => ImportPreviewSchema.parse(r.content))
      .filter((p) => {
        try {
          permit(actor, p.kind);
          return true;
        } catch {
          return false;
        }
      });
  }
  async preview(
    tx: Connection,
    actor: SessionUser,
    input: z.infer<typeof ImportUploadSchema>,
    bytes: Buffer,
    table: ImportTable,
  ) {
    await requireModule(tx, "imports");
    permit(actor, input.kind);
    return idempotent(
      tx,
      actor,
      input.operationId,
      { action: "import.preview", ...input, bytes: hash(bytes) },
      async () => {
        const prior = await tx.query(
          "SELECT id FROM cabinet_import_previews WHERE actor_id=$1",
          [actor.id],
        );
        if (prior.length >= 10)
          fail(
            409,
            "PREVIEW_LIMIT",
            "Supprimer un aperçu terminé avant une nouvelle reprise (10 maximum).",
          );
        const p = ImportPreviewSchema.parse({
          id: randomUUID(),
          actorId: actor.id,
          version: 1,
          filename: input.filename,
          kind: input.kind,
          sourceHash: hash(bytes),
          sourceInstallationId: input.sourceInstallationId,
          createdAt: this.now().toISOString(),
          format: input.format,
          delimiter: input.delimiter,
          sheet: table.sheet,
          sheets: table.sheets,
          headers: table.headers,
          total: table.rows.length,
          mapping: input.mapping,
          state: "preview",
          jobId: null,
          processed: 0,
          error: null,
        });
        await tx.query(
          "INSERT INTO cabinet_import_previews(id,actor_id,content,source_bytes) VALUES($1,$2,$3::jsonb,$4)",
          [p.id, actor.id, JSON.stringify(p), bytes],
        );
        await this.populate(tx, actor, p, table.rows);
        return p;
      },
    );
  }
  private async populate(
    tx: Connection,
    actor: SessionUser,
    p: ImportPreview,
    raw: ImportTable["rows"],
  ) {
    const keys = new Map<string, ImportLine[]>(),
      lines: ImportLine[] = [];
    for (const row of raw) {
      const line = await normalize(tx, actor, p, row);
      lines.push(line);
      const key = duplicateKey(line);
      if (key) {
        const group = keys.get(key) ?? [];
        group.push(line);
        keys.set(key, group);
      }
    }
    for (const group of keys.values())
      if (group.length > 1) for (const line of group) line.duplicate = true;
    for (let i = 0; i < lines.length; i++)
      await tx.query(
        "INSERT INTO cabinet_import_rows(preview_id,line_id,ordinal,content) VALUES($1,$2,$3,$4::jsonb)",
        [p.id, lines[i]!.lineId, i + 1, JSON.stringify(lines[i])],
      );
  }
  async rows(tx: Connection, actor: SessionUser, id: string, offset: number) {
    const p = await this.load(tx, actor, id),
      rows = await tx.query(
        "SELECT content FROM cabinet_import_rows WHERE preview_id=$1 ORDER BY ordinal OFFSET $2 LIMIT 100",
        [id, offset],
      );
    const items = [];
    for (const row of rows) {
      let line = ImportLineSchema.parse(row.content);
      const candidates = [];
      for (const c of line.candidates) {
        const r = await loadRecord(tx, c.id);
        if (
          (await canAccess(tx, actor, "read", r)) &&
          (await canAccess(tx, actor, "update", r))
        )
          candidates.push(c);
      }
      if (line.targetId && !candidates.some((c) => c.id === line.targetId))
        line = {
          ...line,
          targetId: null,
          expectedRecordVersion: null,
          changes: [],
          errors: ["Ressource inaccessible."],
          resultId: null,
        };
      if (line.resultId) {
        try {
          await requireAccess(
            tx,
            actor,
            "read",
            await loadRecord(tx, line.resultId),
          );
        } catch {
          line = { ...line, resultId: null };
        }
      }
      items.push({ ...line, candidates });
    }
    return { items, total: p.total, offset };
  }
  async remap(
    tx: Connection,
    actor: SessionUser,
    id: string,
    input: z.infer<typeof ImportRemapSchema>,
  ) {
    const p = await this.load(tx, actor, id);
    return idempotent(
      tx,
      actor,
      input.operationId,
      { action: "import.remap", id, input },
      async () => {
        this.editable(p, input.expectedVersion);
        const raw = (
          await tx.query(
            "SELECT content FROM cabinet_import_rows WHERE preview_id=$1 ORDER BY ordinal",
            [id],
          )
        ).map((r) => {
          const line = ImportLineSchema.parse(r.content);
          return { number: line.number, cells: line.cells };
        });
        const next = { ...p, version: p.version + 1, mapping: input.mapping };
        await tx.query("DELETE FROM cabinet_import_rows WHERE preview_id=$1", [
          id,
        ]);
        await this.populate(tx, actor, next, raw);
        return persist(tx, next);
      },
    );
  }
  private editable(p: ImportPreview, version: number) {
    if (p.state !== "preview")
      fail(409, "IMPORT_FROZEN", "Cet aperçu est déjà engagé.");
    if (p.version !== version)
      fail(409, "VERSION_CONFLICT", "L’aperçu a changé. Rechargez-le.");
  }
  async select(
    tx: Connection,
    actor: SessionUser,
    id: string,
    input: z.infer<typeof ImportSelectionSchema>,
  ) {
    const p = await this.load(tx, actor, id);
    return idempotent(
      tx,
      actor,
      input.operationId,
      { action: "import.select", id, input },
      async () => {
        this.editable(p, input.expectedVersion);
        for (const choice of input.rows) {
          const rows = await tx.query(
            "SELECT content FROM cabinet_import_rows WHERE preview_id=$1 AND line_id=$2",
            [id, choice.lineId],
          );
          if (!rows[0]) fail(400, "INVALID_LINE", "Ligne hors aperçu.");
          let line = ImportLineSchema.parse(rows[0].content);
          if (choice.accepted && line.errors.length)
            fail(
              409,
              "INVALID_LINE",
              "Corriger les erreurs avant de retenir la ligne.",
            );
          if (choice.targetId) {
            const target = await loadRecord(tx, choice.targetId);
            await requireAccess(tx, actor, "read", target);
            await requireAccess(tx, actor, "update", target);
            if (target.kind !== p.kind)
              fail(400, "INVALID_KIND", "Cible incompatible.");
            if (choice.expectedRecordVersion !== target.version)
              fail(409, "VERSION_CONFLICT", "La cible a changé.");
            line = {
              ...line,
              targetId: target.id,
              expectedRecordVersion: target.version,
              candidates: [
                { id: target.id, title: target.title, version: target.version },
              ],
              changes: line.fields
                .filter(
                  (k) =>
                    !same(fieldValue(target, k), fieldValue(line.record!, k)),
                )
                .map((field) => ({
                  field,
                  before: fieldValue(target, field) ?? null,
                  after: fieldValue(line.record!, field) ?? null,
                })),
            };
          }
          if (choice.targetId === null && line.candidates.length)
            fail(
              409,
              "MATCH_REQUIRED",
              "Un doublon existant exige un rapprochement explicite.",
            );
          if (choice.accepted && line.candidates.length > 1 && !line.targetId)
            fail(409, "MATCH_REQUIRED", "Choisir un rapprochement.");
          line = {
            ...line,
            accepted: choice.accepted,
            overwriteFields: choice.overwriteFields,
          };
          if (
            choice.accepted &&
            line.changes.some((c) => !choice.overwriteFields.includes(c.field))
          )
            fail(
              409,
              "SOURCE_CONFLICT",
              "Confirmer chaque différence avec les valeurs actuelles.",
            );
          await tx.query(
            "UPDATE cabinet_import_rows SET content=$3::jsonb WHERE preview_id=$1 AND line_id=$2",
            [id, line.lineId, JSON.stringify(line)],
          );
        }
        return persist(tx, { ...p, version: p.version + 1 });
      },
    );
  }
  async commit(
    tx: Connection,
    actor: SessionUser,
    id: string,
    input: z.infer<typeof ImportCommitSchema>,
  ) {
    await requireModule(tx, "imports");
    const p = await this.load(tx, actor, id);
    return idempotent(
      tx,
      actor,
      input.operationId,
      { action: "import.commit", id, input },
      async () => {
        this.editable(p, input.expectedVersion);
        const source = await tx.query(
          "SELECT source_bytes FROM cabinet_import_previews WHERE id=$1",
          [id],
        );
        if (
          hash(Buffer.from(source[0]!.source_bytes as Uint8Array)) !==
            input.sourceHash ||
          p.sourceHash !== input.sourceHash
        )
          fail(409, "SOURCE_CHANGED", "Empreinte source différente.");
        const chosen = await tx.query(
          "SELECT content FROM cabinet_import_rows WHERE preview_id=$1 AND line_id=ANY($2::text[])",
          [id, input.lineIds],
        );
        if (chosen.length !== input.lineIds.length)
          fail(400, "INVALID_LINE", "Ligne hors aperçu.");
        const keys = new Set<string>();
        for (const row of chosen) {
          const line = ImportLineSchema.parse(row.content);
          if (!line.accepted || line.errors.length)
            fail(409, "LINE_NOT_ACCEPTED", "Une ligne n’est pas validée.");
          const key = duplicateKey(line);
          if (key && keys.has(key))
            fail(
              409,
              "DUPLICATE_LINES",
              "Choisir une seule ligne par identité source.",
            );
          if (key) keys.add(key);
        }
        await tx.query(
          "UPDATE cabinet_import_rows SET commit_selected=true WHERE preview_id=$1 AND line_id=ANY($2::text[])",
          [id, input.lineIds],
        );
        const jobId = await this.enqueue(tx, actor, randomUUID(), {
          previewId: id,
          sourceHash: p.sourceHash,
        });
        return persist(tx, {
          ...p,
          state: "queued",
          jobId,
          version: p.version + 1,
        });
      },
    );
  }
  private async commitLine(
    tx: Connection,
    actor: SessionUser,
    p: ImportPreview,
    line: ImportLine,
  ): Promise<ImportLine> {
    if (line.assignment) {
      // The preview version is immutable. Only this import's committed mutations
      // advance its expectation; an external mutation still causes a conflict.
      // Row statuses and the assignment write share the batch transaction/checkpoint.
      const completed = await tx.query(
        "SELECT count(*) AS n FROM cabinet_import_rows WHERE preview_id=$1 AND content->'assignment'->>'dossierId'=$2 AND content->>'status' IN ('assigned','removed')",
        [p.id, line.assignment.dossierId],
      );
      const expectedVersion =
        line.assignment.expectedVersion + Number(completed[0]!.n);
      const result = await applyAssignments(
        tx,
        actor,
        {
          operationId: randomUUID(),
          rows: [{ ...line.assignment, expectedVersion }],
        },
        this.now(),
      );
      const status = result.items[0]!.status;
      if (status !== "assigned" && status !== "removed")
        fail(409, status.toUpperCase(), "Affectation refusée.");
      return { ...line, status, resultId: line.assignment.dossierId };
    }
    if (!line.record) fail(400, "INVALID_LINE", "Ligne invalide.");
    let record = line.record;
    if (line.targetId) {
      const target = await loadRecord(tx, line.targetId);
      await requireAccess(tx, actor, "read", target);
      await requireAccess(tx, actor, "update", target);
      if (target.version !== line.expectedRecordVersion)
        fail(409, "VERSION_CONFLICT", "La cible a changé depuis l’aperçu.");
      record = mergeLine(target, line);
    } else {
      const check = await normalize(tx, actor, p, {
        number: line.number,
        cells: line.cells,
      });
      if (check.candidates.length || check.errors.length)
        fail(
          409,
          "MATCH_CHANGED",
          "Les correspondances ont changé depuis l’aperçu.",
        );
    }
    const saved = await saveRecord(
      tx,
      actor,
      {
        operationId: randomUUID(),
        ...(line.targetId
          ? { expectedVersion: line.expectedRecordVersion! }
          : {}),
        record,
      },
      this.now(),
      line.targetId ?? undefined,
      undefined,
      undefined,
      {
        kind: "import",
        reference: p.filename + ":" + line.number,
        version: p.sourceHash,
        at: this.now().toISOString(),
      },
    );
    return {
      ...line,
      status: line.targetId ? "updated" : "created",
      resultId: saved.id,
    };
  }
  async remove(tx: Connection, actor: SessionUser, id: string) {
    const p = await this.get(tx, actor, id);
    if (["queued", "running"].includes(p.state))
      fail(409, "IMPORT_RUNNING", "Attendre la fin du traitement.");
    await tx.query("DELETE FROM cabinet_import_rows WHERE preview_id=$1", [id]);
    await tx.query("DELETE FROM cabinet_import_previews WHERE id=$1", [id]);
    return { removed: true };
  }
}
