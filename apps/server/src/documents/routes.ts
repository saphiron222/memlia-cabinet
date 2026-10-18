import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  DocumentInputSchema,
  DocumentSchema,
  DocumentListSchema,
  DocumentQuerySchema,
  DocumentCatalogueSchema,
  DOCUMENT_MAX_BYTES,
  type DocumentInput,
} from "@memlia/contracts";
import type { RouteContext } from "../context.js";
import { fail } from "../errors.js";
import { DocumentStore, type PreparedDocument } from "./store.js";
export function registerDocumentRoutes(
  app: FastifyInstance,
  { db, now, user }: RouteContext,
  store: DocumentStore,
) {
  app.get("/api/v1/documents/catalogue", async (req) => {
    await db.transaction((tx) => user(tx, req));
    return DocumentCatalogueSchema.parse({
      maxBytes: DOCUMENT_MAX_BYTES,
      formats: [
        {
          mediaType: "application/pdf",
          label: "PDF (non protégé)",
          extraction: true,
        },
        { mediaType: "text/plain", label: "Texte UTF-8", extraction: true },
        {
          mediaType: "application/octet-stream",
          label: "Original binaire (sans extraction)",
          extraction: false,
        },
      ],
    });
  });
  app.post("/api/v1/documents", async (req, reply) => {
    await db.transaction((tx) => user(tx, req));
    let input: DocumentInput | undefined;
    let prepared: PreparedDocument | undefined;
    try {
      for await (const part of req.parts()) {
        if (part.type === "field") {
          if (
            part.fieldname !== "metadata" ||
            input ||
            prepared ||
            part.valueTruncated
          )
            fail(
              400,
              "INVALID_MULTIPART",
              "Métadonnées uniques attendues avant la pièce.",
            );
          let value: unknown;
          try {
            value = JSON.parse(String(part.value));
          } catch {
            fail(400, "INVALID_MULTIPART", "Métadonnées JSON invalides.");
          }
          input = DocumentInputSchema.parse(value);
          await db.transaction(async (tx) =>
            store.authorize(tx, await user(tx, req), input!),
          );
        } else {
          if (part.fieldname !== "file" || !input || prepared)
            fail(
              400,
              "INVALID_MULTIPART",
              "Une pièce unique et ses métadonnées sont requises.",
            );
          if (
            part.filename !== input.filename ||
            part.mimetype !== input.mediaType
          )
            fail(
              400,
              "INVALID_MULTIPART",
              "Nom ou type différent des métadonnées.",
            );
          const stream = async function* () {
            for await (const bytes of part.file) yield bytes;
            if (part.file.truncated)
              fail(
                413,
                "PAYLOAD_TOO_LARGE",
                "La pièce dépasse la limite de 10 Mio.",
              );
          };
          prepared = await store.prepare(input, stream());
          if (part.file.truncated)
            fail(
              413,
              "PAYLOAD_TOO_LARGE",
              "La pièce dépasse la limite de 10 Mio.",
            );
        }
      }
      if (!prepared) fail(400, "INVALID_MULTIPART", "La pièce est requise.");
      const document = await db.transaction(async (tx) => {
        const actor = await user(tx, req);
        const ref = await store.commit(tx, actor, prepared!, now());
        return store.get(tx, actor, ref.id);
      });
      return reply.code(201).send(DocumentSchema.parse(document));
    } finally {
      if (prepared) await store.discard(prepared);
    }
  });
  app.get("/api/v1/documents", async (req) =>
    db.transaction(async (tx) =>
      DocumentListSchema.parse(
        await store.list(
          tx,
          await user(tx, req),
          DocumentQuerySchema.parse(req.query),
        ),
      ),
    ),
  );
  app.get("/api/v1/documents/:id", async (req) =>
    db.transaction(async (tx) =>
      DocumentSchema.parse(
        await store.get(
          tx,
          await user(tx, req),
          z.object({ id: z.uuid() }).parse(req.params).id,
        ),
      ),
    ),
  );
  app.get("/api/v1/documents/:id/download", async (req, reply) => {
    const result = await db.transaction(async (tx) =>
      store.download(
        tx,
        await user(tx, req),
        z.object({ id: z.uuid() }).parse(req.params).id,
      ),
    );
    reply
      .header(
        "content-disposition",
        `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(result.document.filename).replaceAll("'", "%27")}`,
      )
      .header("x-content-type-options", "nosniff");
    return reply.type(result.document.mediaType).send(result.bytes);
  });
}
