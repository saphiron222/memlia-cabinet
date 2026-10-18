import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ImportUploadSchema,
  ImportSelectionSchema,
  ImportCommitSchema,
  ImportRemapSchema,
  ImportPreviewSchema,
  ImportRowsSchema,
  ImportListSchema,
  ImportCatalogueSchema,
  ImportAcceptedSchema,
  IMPORT_MAX_BYTES,
} from "@memlia/contracts";
import type { RouteContext } from "../context.js";
import { ImportParser } from "./parser.js";
import { Imports } from "./service.js";
import { fields } from "./normalization.js";
import { fail } from "../errors.js";
import { availablePermissions } from "../administration/access.js";
export function registerImportRoutes(
  app: FastifyInstance,
  { db, user }: RouteContext,
  service: Imports,
  parser: ImportParser,
) {
  const id = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;
  app.get("/api/v1/imports/catalogue", async (req) => {
    await db.transaction((tx) => user(tx, req));
    return ImportCatalogueSchema.parse({
      fields: Object.fromEntries(
        Object.entries(fields).map(([kind, keys]) => [
          kind,
          keys.map((key) => ({
            key,
            label: key,
            required:
              kind === "assignment" ? key !== "remove" : key === "title",
          })),
        ]),
      ),
      maxBytes: IMPORT_MAX_BYTES,
      maxRows: 10000,
      maxColumns: 100,
    });
  });
  app.get("/api/v1/imports", async (req) =>
    db.transaction(async (tx) =>
      ImportListSchema.parse({
        items: await service.list(tx, await user(tx, req)),
      }),
    ),
  );
  app.post(
    "/api/v1/imports/preview",
    { bodyLimit: 14 * 1024 * 1024 },
    async (req, reply) => {
      const input = ImportUploadSchema.parse(req.body);
      await db.transaction(async (tx) => {
        const actor = await user(tx, req);
        if (
          !availablePermissions(actor).some((p) =>
            input.kind === "assignment"
              ? p.action === "assign"
              : (p.kind === input.kind || p.kind === "*") &&
                ["create", "update"].includes(p.action),
          )
        )
          fail(403, "FORBIDDEN", "Reprise non autorisée.");
      });
      const bytes = Buffer.from(input.bytes, "base64");
      if (bytes.toString("base64") !== input.bytes)
        fail(400, "INVALID_BASE64", "Contenu de fichier invalide.");
      const table = await parser.parse(bytes, input);
      const preview = await db.transaction(async (tx) =>
        service.preview(tx, await user(tx, req), input, bytes, table),
      );
      return reply.code(201).send(ImportPreviewSchema.parse(preview));
    },
  );
  app.get("/api/v1/imports/:id", async (req) =>
    db.transaction(async (tx) =>
      ImportPreviewSchema.parse(
        await service.get(tx, await user(tx, req), id(req.params)),
      ),
    ),
  );
  app.get("/api/v1/imports/:id/rows", async (req) => {
    const query = z
      .object({ offset: z.coerce.number().int().min(0).max(10000).default(0) })
      .strict()
      .parse(req.query);
    return db.transaction(async (tx) =>
      ImportRowsSchema.parse(
        await service.rows(
          tx,
          await user(tx, req),
          id(req.params),
          query.offset,
        ),
      ),
    );
  });
  app.get("/api/v1/imports/:id/accepted", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req),
        p = await service.load(tx, actor, id(req.params));
      const rows = await tx.query(
        "SELECT line_id FROM cabinet_import_rows WHERE preview_id=$1 AND content->>'accepted'='true' ORDER BY ordinal LIMIT 10000",
        [p.id],
      );
      return ImportAcceptedSchema.parse({
        version: p.version,
        sourceHash: p.sourceHash,
        lineIds: rows.map((r) => r.line_id),
      });
    }),
  );
  app.put("/api/v1/imports/:id/mapping", async (req) => {
    const input = ImportRemapSchema.parse(req.body);
    return db.transaction(async (tx) =>
      ImportPreviewSchema.parse(
        await service.remap(tx, await user(tx, req), id(req.params), input),
      ),
    );
  });
  app.put("/api/v1/imports/:id/selection", async (req) => {
    const input = ImportSelectionSchema.parse(req.body);
    return db.transaction(async (tx) =>
      ImportPreviewSchema.parse(
        await service.select(tx, await user(tx, req), id(req.params), input),
      ),
    );
  });
  app.post("/api/v1/imports/:id/commit", async (req, reply) => {
    const input = ImportCommitSchema.parse(req.body);
    const result = await db.transaction(async (tx) =>
      service.commit(tx, await user(tx, req), id(req.params), input),
    );
    return reply.code(202).send(ImportPreviewSchema.parse(result));
  });
  app.post("/api/v1/imports/:id/remove", async (req) =>
    db.transaction(async (tx) =>
      service.remove(tx, await user(tx, req), id(req.params)),
    ),
  );
  app.get("/api/v1/imports/:id/report.csv", async (req, reply) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req),
        preview = await service.load(tx, actor, id(req.params));
      const cell = (v: unknown) =>
        '"' +
        String(v ?? "")
          .replace(/^[=+\-@\t\r]/, "'$&")
          .replaceAll('"', '""') +
        '"';
      const lines = [
        ["source", "ligne", "état", "erreurs", "objet"].map(cell).join(";"),
      ];
      for (let offset = 0; offset < preview.total; offset += 100) {
        const rows = await service.rows(tx, actor, preview.id, offset);
        for (const line of rows.items)
          lines.push(
            [
              preview.sourceHash,
              line.number,
              line.status,
              line.errors.join(" | "),
              line.resultId,
            ]
              .map(cell)
              .join(";"),
          );
      }
      reply
        .header("content-type", "text/csv; charset=utf-8")
        .header(
          "content-disposition",
          'attachment; filename="rapport-reprise.csv"',
        );
      return "\uFEFF" + lines.join("\r\n") + "\r\n";
    }),
  );
}
