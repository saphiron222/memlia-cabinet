import { randomUUID, createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ChecklistExchangeSchema,
  ChecklistRepriseSchema,
  ChecklistModelSchema,
} from "@memlia/contracts";
import type { RouteContext } from "../context.js";
import type { ImportParser } from "../imports/parser.js";
import { requireGlobal } from "../records/permissions.js";
import { requireModule } from "../administration/settings.js";
import { idempotent } from "../storage/operations.js";
import { saveModel } from "./service.js";
import { stableId } from "./generation.js";
import { fail } from "../errors.js";
export function registerChecklistImportRoutes(
  app: FastifyInstance,
  { db, user, now }: RouteContext,
  parser: ImportParser,
) {
  app.post(
    "/api/v1/workflows/imports/preview",
    { bodyLimit: 14 * 1024 * 1024 },
    async (req, reply) => {
      const i = ChecklistExchangeSchema.parse(req.body);
      await db.transaction(async (tx) => {
        requireGlobal(await user(tx, req), "manage_users");
        await requireModule(tx, "imports");
      });
      const bytes = Buffer.from(i.bytes, "base64");
      if (bytes.toString("base64") !== i.bytes)
        fail(400, "INVALID_BASE64", "Fichier invalide.");
      const table = await parser.parse(bytes, i);
      const result = await db.transaction(async (tx) => {
        const actor = await user(tx, req);
        requireGlobal(actor, "manage_users");
        await requireModule(tx, "imports");
        return idempotent(
          tx,
          actor,
          i.operationId,
          { checklistExchange: i },
          async () => {
            const unmapped = table.headers.filter(
              (_, n) =>
                ![
                  "modelId",
                  "name",
                  "targetKinds",
                  "itemId",
                  "label",
                  "order",
                ].includes(i.mapping[String(n)] ?? ""),
            );
            const groups = new Map<
                string,
                {
                  id: string;
                  expectedVersion: number;
                  model: z.infer<typeof ChecklistModelSchema>;
                  orders: number[];
                }
              >(),
              errors: { line: number; message: string }[] = [];
            for (const row of table.rows) {
              try {
                const fields: Record<string, string> = {};
                for (const [column, key] of Object.entries(i.mapping))
                  fields[key] = String(row.cells[Number(column)]?.value ?? "");
                const id = z.uuid().parse(fields.modelId),
                  itemId = z.uuid().parse(fields.itemId),
                  order = z.coerce
                    .number()
                    .int()
                    .min(1)
                    .max(100)
                    .parse(fields.order);
                let group = groups.get(id);
                const model = ChecklistModelSchema.parse({
                  kind: "checklist",
                  name: fields.name,
                  targetKinds: fields.targetKinds
                    ?.split(",")
                    .map((s) => s.trim()),
                  items: [],
                });
                if (!group) {
                  if (groups.size >= 20)
                    fail(
                      413,
                      "MODEL_LIMIT",
                      "Vingt modèles maximum par reprise.",
                    );
                  const prior = await tx.query(
                    "SELECT content FROM cabinet_workflow_models WHERE id=$1",
                    [id],
                  );
                  group = {
                    id,
                    expectedVersion: prior[0]
                      ? Number(
                          (prior[0].content as { version: number }).version,
                        )
                      : 0,
                    model,
                    orders: [],
                  };
                  groups.set(id, group);
                }
                if (
                  group.model.name !== model.name ||
                  JSON.stringify(group.model.targetKinds) !==
                    JSON.stringify(model.targetKinds) ||
                  group.orders.includes(order)
                )
                  throw Error("Configuration incohérente ou ordre en double.");
                group.model.items.push({
                  id: itemId,
                  label: fields.label ?? "",
                });
                group.orders.push(order);
                ChecklistModelSchema.parse(group.model);
              } catch {
                errors.push({
                  line: row.number,
                  message:
                    "Identité, nom, cible, ordre ou élément invalide ; corriger la ligne avant validation.",
                });
              }
            }
            const models = [...groups.values()].map(({ orders, ...g }) => ({
              ...g,
              model: {
                ...g.model,
                items: g.model.items
                  .map((item, n) => ({ item, order: orders[n]! }))
                  .sort((a, b) => a.order - b.order)
                  .map((x) => x.item),
              },
            }));
            const preview = ChecklistRepriseSchema.parse({
              id: randomUUID(),
              actorId: actor.id,
              sourceHash: createHash("sha256").update(bytes).digest("hex"),
              exchange: i.exchange,
              headers: table.headers,
              unmapped,
              errors,
              models,
              createdAt: now().toISOString(),
            });
            if (Buffer.byteLength(JSON.stringify(preview)) > 400 * 1024)
              fail(
                413,
                "PREVIEW_LIMIT",
                "Reprise trop volumineuse ; diviser le fichier.",
              );
            await tx.query(
              "INSERT INTO cabinet_workflow_imports(id,actor_id,content) VALUES($1,$2,$3::jsonb)",
              [preview.id, actor.id, JSON.stringify(preview)],
            );
            return preview;
          },
        );
      });
      return reply.code(201).send(result);
    },
  );
  app.post("/api/v1/workflows/imports/:id/commit", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req);
      requireGlobal(actor, "manage_users");
      await requireModule(tx, "imports");
      const id = z.object({ id: z.uuid() }).parse(req.params).id;
      const i = z
        .object({
          operationId: z.uuid(),
          validatedModelIds: z.array(z.uuid()).min(1).max(20),
        })
        .strict()
        .parse(req.body);
      const rows = await tx.query(
        "SELECT content FROM cabinet_workflow_imports WHERE id=$1 AND actor_id=$2",
        [id, actor.id],
      );
      if (!rows[0]) fail(404, "NOT_FOUND", "Aperçu inaccessible.");
      const preview = ChecklistRepriseSchema.parse(rows[0].content);
      if (preview.errors.length)
        fail(
          409,
          "IMPORT_ERRORS",
          "Corrigez les lignes signalées avant validation.",
        );
      return idempotent(
        tx,
        actor,
        i.operationId,
        { checklistCommit: id, input: i },
        async () => {
          const models = [];
          for (const modelId of new Set(i.validatedModelIds)) {
            const m = preview.models.find((m) => m.id === modelId);
            if (!m)
              fail(
                400,
                "INVALID_SELECTION",
                "Valider un modèle de cet aperçu.",
              );
            models.push(
              await saveModel(
                tx,
                actor,
                { ...m, operationId: stableId(i.operationId + modelId) },
                now(),
              ),
            );
          }
          return {
            models,
            unmapped: preview.unmapped,
            sourceHash: preview.sourceHash,
          };
        },
      );
    }),
  );
}
