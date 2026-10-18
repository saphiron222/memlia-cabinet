import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  ProductionImportSchema,
  ProductionImportPreviewSchema,
  StageStatusSchema,
  StageTypeSchema,
} from "@memlia/contracts";
import type { RouteContext } from "../context.js";
import type { ImportParser } from "../imports/parser.js";
import { requireGlobal } from "../records/permissions.js";
import { requireModule } from "../administration/settings.js";
import { fail } from "../errors.js";
import { idempotent } from "../storage/operations.js";
import { saveProductionModel } from "./service.js";
import { stableId } from "../workflows/generation.js";
export function registerStageImportRoutes(
  app: FastifyInstance,
  { db, user, now }: RouteContext,
  parser: ImportParser,
) {
  app.post(
    "/api/v1/production/imports/preview",
    { bodyLimit: 9 * 1024 * 1024 },
    async (req, reply) => {
      const i = ProductionImportSchema.parse(req.body);
      await db.transaction(async (tx) => {
        requireGlobal(await user(tx, req), "manage_users");
        await requireModule(tx, "imports");
      });
      const bytes = Buffer.from(i.base64, "base64");
      if (bytes.toString("base64") !== i.base64)
        fail(400, "INVALID_BASE64", "Fichier invalide.");
      const format = i.filename.endsWith(".xlsx")
        ? "xlsx"
        : i.filename.endsWith(".csv")
          ? "csv"
          : null;
      if (!format) fail(400, "INVALID_FILE", "CSV ou XLSX annoncé requis.");
      const table = await parser.parse(bytes, { format, delimiter: ";" });
      const sourceHash = createHash("sha256").update(bytes).digest("hex"),
        groups = new Map<string, z.infer<typeof StageTypeSchema>>(),
        unmapped: { line: number; reason: string }[] = [];
      for (const header of table.headers)
        if (!Object.values(i.mapping).includes(header))
          unmapped.push({ line: 1, reason: "Colonne non reprise : " + header });
      for (const row of table.rows) {
        try {
          const value = (key: keyof typeof i.mapping) =>
            String(
              row.cells[table.headers.indexOf(i.mapping[key])]?.value ?? "",
            );
          const modelName = z
              .string()
              .trim()
              .min(1)
              .max(200)
              .parse(value("model")),
            label = value("status");
          if (!["true", "false"].includes(value("final"))) throw Error("final");
          const status = StageStatusSchema.parse({
            id: stableId(sourceHash + modelName + label),
            name: label,
            color: value("color"),
            icon: value("icon"),
            final: value("final") === "true",
          });
          const prior = groups.get(modelName);
          const candidate = StageTypeSchema.parse({
            kind: "stage_type",
            name: modelName,
            statuses: [...(prior?.statuses ?? []), status],
          });
          if (groups.size >= 200 && !prior) throw Error("limit");
          groups.set(modelName, candidate);
        } catch {
          unmapped.push({
            line: row.number,
            reason: "Statut, couleur, icône ou état final invalide.",
          });
        }
      }
      if (unmapped.length > 2000)
        fail(
          413,
          "REPORT_LIMIT",
          "Divisez le fichier pour conserver toutes les erreurs.",
        );
      const result = await db.transaction(async (tx) => {
        const actor = await user(tx, req);
        requireGlobal(actor, "manage_users");
        await requireModule(tx, "imports");
        const preview = ProductionImportPreviewSchema.parse({
          id: randomUUID(),
          actorId: actor.id,
          source: { filename: i.filename, sha256: sourceHash },
          models: [...groups.values()],
          unmapped,
          committed: false,
        });
        if (Buffer.byteLength(JSON.stringify(preview)) > 400 * 1024)
          fail(413, "PREVIEW_LIMIT", "Divisez le fichier.");
        await tx.query(
          "INSERT INTO cabinet_production_imports(id,actor_id,content) VALUES($1,$2,$3::jsonb)",
          [preview.id, actor.id, JSON.stringify(preview)],
        );
        return preview;
      });
      return reply.code(201).send(result);
    },
  );
  app.post("/api/v1/production/imports/:id/commit", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req);
      requireGlobal(actor, "manage_users");
      await requireModule(tx, "imports");
      const id = z.object({ id: z.uuid() }).parse(req.params).id,
        i = z
          .object({
            operationId: z.uuid(),
            validatedModels: z
              .array(z.number().int().min(0).max(199))
              .min(1)
              .max(200),
          })
          .strict()
          .parse(req.body);
      const rows = await tx.query(
        "SELECT content FROM cabinet_production_imports WHERE id=$1 AND actor_id=$2",
        [id, actor.id],
      );
      if (!rows[0]) fail(404, "NOT_FOUND", "Aperçu inaccessible.");
      const preview = ProductionImportPreviewSchema.parse(rows[0].content);
      return idempotent(
        tx,
        actor,
        i.operationId,
        { stageCommit: { id, i } },
        async () => {
          const items = [];
          for (const index of new Set(i.validatedModels)) {
            const model = preview.models[index];
            if (!model)
              fail(
                400,
                "INVALID_SELECTION",
                "Sélection absente de cet aperçu.",
              );
            const modelId = stableId(
              preview.source.sha256 + ":model:" + model.name,
            );
            const prior = await tx.query(
              "SELECT content FROM cabinet_production_models WHERE id=$1",
              [modelId],
            );
            if (prior.length) {
              items.push(prior[0]!.content);
              continue;
            }
            items.push(
              await saveProductionModel(
                tx,
                actor,
                {
                  id: modelId,
                  expectedVersion: 0,
                  operationId: stableId(i.operationId + ":" + index),
                  model,
                },
                now(),
              ),
            );
          }
          preview.committed = true;
          await tx.query(
            "UPDATE cabinet_production_imports SET content=$2::jsonb WHERE id=$1",
            [id, JSON.stringify(preview)],
          );
          return { items, unmapped: preview.unmapped };
        },
      );
    }),
  );
}
