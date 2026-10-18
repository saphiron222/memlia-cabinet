import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  PipelineImportSchema,
  PipelineImportPreviewSchema,
  PipelineSchema,
  StageStatusSchema,
} from "@memlia/contracts";
import type { RouteContext } from "../context.js";
import type { ImportParser } from "../imports/parser.js";
import { requireGlobal } from "../records/permissions.js";
import { requireModule } from "../administration/settings.js";
import { idempotent } from "../storage/operations.js";
import { fail } from "../errors.js";
import { stableId } from "../workflows/generation.js";
import { save, load, persist } from "./service.js";
export function registerPipelineImports(
  app: FastifyInstance,
  { db, user, now }: RouteContext,
  parser: ImportParser,
) {
  app.post(
    "/api/v1/relationship/imports/preview",
    { bodyLimit: 9 * 1024 * 1024 },
    async (req, reply) => {
      const i = PipelineImportSchema.parse(req.body);
      await db.transaction(async (tx) => {
        requireGlobal(await user(tx, req), "manage_users");
        await requireModule(tx, "imports");
      });
      const bytes = Buffer.from(i.base64, "base64");
      if (bytes.toString("base64") !== i.base64)
        fail(400, "INVALID_FILE", "Base64 invalide.");
      const format = i.filename.endsWith(".csv")
        ? "csv"
        : i.filename.endsWith(".xlsx")
          ? "xlsx"
          : null;
      if (!format) fail(400, "INVALID_FILE", "CSV ou XLSX annoncé requis.");
      const table = await parser.parse(bytes, { format, delimiter: ";" }),
        sha256 = createHash("sha256").update(bytes).digest("hex"),
        stages: z.infer<typeof StageStatusSchema>[] = [],
        unmapped: { line: number; reason: string }[] = [],
        correspondences: { line: number; label: string; stageId: string }[] =
          [];
      let conversionStageId: string | null = null,
        quoteStageId: string | null = null,
        letterStageId: string | null = null;
      for (const header of table.headers)
        if (!Object.values(i.mapping).includes(header))
          unmapped.push({ line: 1, reason: "Colonne non reprise : " + header });
      for (const row of table.rows) {
        try {
          const v = (k: keyof typeof i.mapping) =>
            String(row.cells[table.headers.indexOf(i.mapping[k])]?.value ?? "");
          if (
            !["conversion", "quote", "letter"].every((k) =>
              ["true", "false"].includes(v(k as keyof typeof i.mapping)),
            )
          )
            throw Error();
          const s = StageStatusSchema.parse({
            id: stableId(sha256 + ":" + row.number),
            name: v("stage"),
            color: v("color"),
            icon: v("icon"),
            final: v("conversion") === "true",
          });
          if (
            stages.length >= 30 ||
            stages.some((x) => x.name === s.name) ||
            (v("conversion") === "true" && conversionStageId) ||
            (v("quote") === "true" && quoteStageId) ||
            (v("letter") === "true" && letterStageId)
          )
            throw Error();
          stages.push(s);
          correspondences.push({
            line: row.number,
            label: v("stage"),
            stageId: s.id,
          });
          if (v("conversion") === "true") conversionStageId = s.id;
          if (v("quote") === "true") quoteStageId = s.id;
          if (v("letter") === "true") letterStageId = s.id;
        } catch {
          unmapped.push({
            line: row.number,
            reason: "Étape, couleur, icône ou déclencheur invalide/dupliqué.",
          });
        }
      }
      if (!stages.length) fail(400, "EMPTY_MODEL", "Aucune étape valide.");
      if (unmapped.length > 2000)
        fail(
          413,
          "REPORT_LIMIT",
          "Divisez le fichier pour conserver les erreurs.",
        );
      const model = PipelineSchema.parse({
        kind: "pipeline",
        name: i.name,
        stages,
        conversionStageId,
        triggers: { quoteStageId, letterStageId },
      });
      const result = await db.transaction(async (tx) => {
        const a = await user(tx, req);
        requireGlobal(a, "manage_users");
        await requireModule(tx, "imports");
        const preview = PipelineImportPreviewSchema.parse({
          id: randomUUID(),
          actorId: a.id,
          source: { filename: i.filename, sha256 },
          model,
          correspondences,
          unmapped,
          committed: false,
        });
        if (Buffer.byteLength(JSON.stringify(preview)) > 400 * 1024)
          fail(413, "PREVIEW_LIMIT", "Divisez le fichier.");
        await tx.query(
          "INSERT INTO cabinet_relationship_imports(id,actor_id,content) VALUES($1,$2,$3::jsonb)",
          [preview.id, a.id, JSON.stringify(preview)],
        );
        return preview;
      });
      return reply.code(201).send(result);
    },
  );
  app.post("/api/v1/relationship/imports/:id/commit", (req) =>
    db.transaction(async (tx) => {
      const a = await user(tx, req);
      requireGlobal(a, "manage_users");
      await requireModule(tx, "imports");
      const id = z.object({ id: z.uuid() }).parse(req.params).id,
        i = z
          .object({ operationId: z.uuid(), validated: z.literal(true) })
          .strict()
          .parse(req.body);
      const rows = await tx.query(
        "SELECT content FROM cabinet_relationship_imports WHERE id=$1 AND actor_id=$2",
        [id, a.id],
      );
      if (!rows[0]) fail(404, "NOT_FOUND", "Aperçu inaccessible.");
      const preview = PipelineImportPreviewSchema.parse(rows[0].content),
        modelId = stableId(
          "pipeline-import:" + preview.source.sha256 + ":" + preview.model.name,
        );
      if (
        (
          await tx.query("SELECT id FROM cabinet_relationship WHERE id=$1", [
            modelId,
          ])
        ).length
      )
        await load(tx, a, modelId, "update");
      const result = await idempotent(
        tx,
        a,
        i.operationId,
        { pipelineImport: id, input: i },
        async () => {
          let model;
          if (
            (
              await tx.query(
                "SELECT id FROM cabinet_relationship WHERE id=$1",
                [modelId],
              )
            ).length
          )
            model = await load(tx, a, modelId);
          else {
            model = await save(
              tx,
              a,
              {
                id: modelId,
                operationId: stableId(i.operationId + ":model"),
                expectedVersion: 0,
                data: preview.model,
              },
              now(),
            );
            model.origin = {
              kind: "import",
              reference: preview.source.filename + ":" + preview.source.sha256,
              version: "1",
              at: now().toISOString(),
            };
            await tx.query(
              "UPDATE cabinet_relationship SET content=$2::jsonb WHERE id=$1",
              [model.id, JSON.stringify(model)],
            );
            await tx.query(
              "UPDATE cabinet_relationship_history SET content=$2::jsonb WHERE id=$1 AND version=1",
              [model.id, JSON.stringify(model)],
            );
          }
          preview.committed = true;
          await tx.query(
            "UPDATE cabinet_relationship_imports SET content=$2::jsonb WHERE id=$1",
            [id, JSON.stringify(preview)],
          );
          return { model, report: preview };
        },
      );
      await load(tx, a, result.model.id);
      return result;
    }),
  );
}
