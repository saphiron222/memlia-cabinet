import { randomUUID, createHash } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { constants } from "node:fs";
import {
  DocumentInputSchema,
  DocumentReferenceSchema,
  DocumentQuerySchema,
  DOCUMENT_MAX_BYTES,
  type DocumentInput,
  type DocumentReference,
  type Document,
  type DocumentQuery,
  type SessionUser,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { asUser } from "../identity/service.js";
import {
  requireAccess,
  hasPermission,
  canAccess,
} from "../records/permissions.js";
import { loadRecord } from "../records/service.js";
import { idempotent } from "../storage/operations.js";
import { fail } from "../errors.js";
import { extract } from "./content.js";
/** Opaque handle, valid only for the DocumentStore instance that prepared it. */
export interface PreparedDocument {
  readonly id: string;
}
type Staged = {
  input: DocumentInput;
  path: string;
  sha256: string;
  searchText: string;
  size: number;
  extraction: Awaited<ReturnType<typeof extract>>;
};
export class DocumentStore {
  private staged = new WeakMap<PreparedDocument, Staged>();
  private directory: string;
  constructor(dataDirectory: string) {
    this.directory = join(dataDirectory, "documents");
  }
  async prepare(
    input: DocumentInput,
    content: Uint8Array | AsyncIterable<Uint8Array>,
  ): Promise<PreparedDocument> {
    const metadata = DocumentInputSchema.parse(input);
    await mkdir(join(this.directory, "temporary"), {
      recursive: true,
      mode: 0o700,
    });
    const prepared = Object.freeze({ id: randomUUID() }),
      path = join(this.directory, "temporary", prepared.id);
    const file = await open(path, "wx", 0o600);
    let size = 0;
    const hash = createHash("sha256");
    try {
      const source =
        content instanceof Uint8Array
          ? (async function* () {
              yield content;
            })()
          : content;
      for await (const bytes of source) {
        size += bytes.byteLength;
        if (size > DOCUMENT_MAX_BYTES)
          fail(
            413,
            "PAYLOAD_TOO_LARGE",
            "La pièce dépasse la limite de 10 Mio.",
          );
        hash.update(bytes);
        await file.writeFile(bytes);
      }
      if (!size) fail(422, "EMPTY_DOCUMENT", "Le fichier est vide.");
      await file.sync();
      await file.close();
      const extraction = await extract(path, metadata.mediaType);
      this.staged.set(prepared, {
        input: metadata,
        path,
        sha256: hash.digest("hex"),
        size,
        extraction,
        searchText:
          `${metadata.filename}\n${extraction.text}`.toLocaleLowerCase("fr"),
      });
      return prepared;
    } catch (error) {
      await file.close().catch(() => {});
      await rm(path, { force: true });
      throw error;
    }
  }
  async discard(prepared: PreparedDocument) {
    const staged = this.staged.get(prepared);
    if (staged) {
      await rm(staged.path, { force: true });
      this.staged.delete(prepared);
    }
  }
  private async actor(tx: Connection, actor: SessionUser) {
    const rows = await tx.query(
      "SELECT * FROM cabinet_users WHERE id=$1 AND active=true",
      [actor.id],
    );
    if (!rows[0])
      fail(401, "SESSION_REQUIRED", "Utilisateur inactif ou inconnu.");
    return asUser(rows[0]);
  }
  async authorize(tx: Connection, actor: SessionUser, input: DocumentInput) {
    const current = await this.actor(tx, actor),
      parent = await loadRecord(tx, input.dossierId);
    if (parent.kind !== "dossier")
      fail(400, "INVALID_RELATION", "Dossier attendu.");
    await requireAccess(tx, current, "read", parent);
    await requireAccess(tx, current, "update", parent);
    if (
      input.confidential &&
      !hasPermission(current, "confidential", "dossier", parent.id)
    )
      fail(404, "NOT_FOUND", "Ressource inaccessible.");
    if (input.previousVersionId) {
      const previous = await this.get(tx, current, input.previousVersionId);
      if (
        previous.dossierId !== input.dossierId ||
        previous.confidential !== input.confidential
      )
        fail(
          409,
          "VERSION_SCOPE_CONFLICT",
          "Une version conserve le dossier et la confidentialité de son original.",
        );
    }
    return current;
  }
  async commit(
    tx: Connection,
    actor: SessionUser,
    prepared: PreparedDocument,
    now: Date,
  ): Promise<DocumentReference> {
    const staged = this.staged.get(prepared);
    if (!staged) throw Error("Préparation inconnue ou déjà libérée.");
    const { input, sha256, size, extraction, searchText } = staged;
    const current = await this.authorize(tx, actor, input);
    const reference = await idempotent(
      tx,
      current,
      input.operationId,
      { document: input, sha256, size },
      async () => {
        const previous = input.previousVersionId
          ? await this.get(tx, current, input.previousVersionId)
          : null;
        if (
          previous &&
          (
            await tx.query(
              "SELECT id FROM cabinet_documents WHERE previous_id=$1",
              [previous.id],
            )
          ).length
        )
          fail(
            409,
            "VERSION_CONFLICT",
            "Une version plus récente existe. Rechargez la liste.",
          );
        const { operationId: ignoredOperationId, ...metadata } = input;
        const reference = DocumentReferenceSchema.parse({
          ...metadata,
          id: prepared.id,
          logicalId: previous?.logicalId ?? prepared.id,
          version: (previous?.version ?? 0) + 1,
          sha256,
          size,
          actorId: current.id,
          createdAt: now.toISOString(),
          extraction: {
            status: extraction.status,
            engine: extraction.engine,
            pages: extraction.pages,
            sourceSha256: sha256,
          },
        });
        // Local immutable original is durable before SQL can make its reference visible.
        // SQL rollback may retain a private unreferenced original, never a partial reference.
        await rename(staged.path, join(this.directory, reference.id));
        const directory = await open(this.directory, "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
        await tx.query(
          "INSERT INTO cabinet_documents(id,dossier_id,logical_id,previous_id,version,content,extracted_text,search_text) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)",
          [
            reference.id,
            reference.dossierId,
            reference.logicalId,
            reference.previousVersionId,
            reference.version,
            JSON.stringify(reference),
            extraction.text,
            searchText,
          ],
        );
        return reference;
      },
    );
    await this.get(tx, current, reference.id);
    return DocumentReferenceSchema.parse(reference);
  }
  private async visible(
    tx: Connection,
    actor: SessionUser,
    document: DocumentReference,
  ) {
    const parent = await loadRecord(tx, document.dossierId);
    return (
      (await canAccess(tx, actor, "read", parent)) &&
      (!document.confidential ||
        hasPermission(actor, "confidential", "dossier", parent.id))
    );
  }
  private async read(
    document: DocumentReference,
    includeBytes = false,
  ): Promise<{ availability: Document["availability"]; bytes?: Buffer }> {
    try {
      const file = await open(
        join(this.directory, document.id),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size !== document.size)
          return { availability: "corrupt" };
        const hash = createHash("sha256");
        const bytes = includeBytes ? await file.readFile() : undefined;
        if (bytes) hash.update(bytes);
        else
          for await (const chunk of file.createReadStream({
            autoClose: false,
            highWaterMark: 64 * 1024,
          }))
            hash.update(chunk);
        return hash.digest("hex") === document.sha256
          ? { availability: "available", bytes }
          : { availability: "corrupt" };
      } finally {
        await file.close();
      }
    } catch (error) {
      return {
        availability:
          (error as NodeJS.ErrnoException).code === "ENOENT"
            ? "missing"
            : "corrupt",
      };
    }
  }
  async get(tx: Connection, actor: SessionUser, id: string): Promise<Document> {
    const current = await this.actor(tx, actor);
    const rows = await tx.query(
      "SELECT content FROM cabinet_documents WHERE id=$1",
      [id],
    );
    if (!rows[0]) fail(404, "NOT_FOUND", "Ressource inaccessible.");
    const reference = DocumentReferenceSchema.parse(rows[0].content);
    if (!(await this.visible(tx, current, reference)))
      fail(404, "NOT_FOUND", "Ressource inaccessible.");
    return {
      ...reference,
      availability: (await this.read(reference)).availability,
    };
  }
  async list(tx: Connection, actor: SessionUser, query: DocumentQuery) {
    const current = await this.actor(tx, actor),
      filter = DocumentQuerySchema.parse(query);
    const params: unknown[] = [];
    const parameter = (value: unknown) => {
      params.push(value);
      return "$" + params.length;
    };
    const scope = (action: "read" | "confidential") => {
      if (hasPermission(current, action, "dossier")) return "TRUE";
      const dossierIds = [
        ...new Set(current.permissions.map((p) => p.dossierId)),
      ].filter(
        (id): id is string =>
          id !== null && hasPermission(current, action, "dossier", id),
      );
      return `d.dossier_id = ANY(${parameter(dossierIds)}::uuid[])`;
    };
    const where = [
      scope("read"),
      `(NOT ((d.content->>'confidential')::boolean OR (r.content->>'confidential')::boolean) OR (${scope("confidential")}))`,
    ];
    if (filter.dossierId)
      where.push(`d.dossier_id=${parameter(filter.dossierId)}::uuid`);
    if (filter.logicalId)
      where.push(`d.logical_id=${parameter(filter.logicalId)}::uuid`);
    if (filter.q) {
      const literal = filter.q
        .toLocaleLowerCase("fr")
        .replace(/[\\%_]/g, "\\$&");
      where.push(
        `d.search_text LIKE ${parameter("%" + literal + "%")} ESCAPE '\\'`,
      );
    }
    const from = `FROM cabinet_documents d JOIN cabinet_records r ON r.id=d.dossier_id AND r.kind='dossier' WHERE ${where.join(" AND ")}`;
    // Both statements enforce exactly the same current scope before count/page.
    // Extracted text is never projected or transferred to the application here.
    const totals = await tx.query(`SELECT count(*) AS total ${from}`, params);
    const limit = parameter(filter.limit),
      offset = parameter(filter.offset);
    const rows = await tx.query(
      `SELECT d.content ${from} ORDER BY d.logical_id,d.version LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const items = await Promise.all(
      rows.map(async (row) => {
        const ref = DocumentReferenceSchema.parse(row.content);
        return { ...ref, availability: (await this.read(ref)).availability };
      }),
    );
    return { items, total: Number(totals[0]!.total) };
  }

  async download(tx: Connection, actor: SessionUser, id: string) {
    const document = await this.get(tx, actor, id),
      current = await this.actor(tx, actor);
    await requireAccess(
      tx,
      current,
      "export",
      await loadRecord(tx, document.dossierId),
    );
    const result = await this.read(document, true);
    if (result.availability === "missing")
      fail(
        410,
        "DOCUMENT_MISSING",
        "Original absent du stockage local. Les métadonnées sont conservées.",
      );
    if (result.availability === "corrupt")
      fail(
        422,
        "DOCUMENT_CORRUPT",
        "L’intégrité de l’original est altérée. Téléchargement bloqué.",
      );
    return { document, bytes: result.bytes! };
  }
}
