import { authorizedPredicate } from "../records/query.js";
import { valid } from "./custom-values.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  CustomFieldSchema,
  CustomFieldCommandSchema,
  CustomFieldListSchema,
  CustomFieldValuesSchema,
  CabinetRecordSchema,
  CivilDateSchema,
  type CabinetRecord,
  type CustomField,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import type { RouteContext } from "../context.js";
import {
  requireGlobal,
  requireAccess,
  canAccess,
} from "../records/permissions.js";
import { saveRecord } from "../records/service.js";
import { idempotent } from "../storage/operations.js";
import { fail } from "../errors.js";
export function registerCustomFieldRoutes(
  app: FastifyInstance,
  { db, user, now }: RouteContext,
) {
  app.get("/api/v1/administration/fields", async (req) =>
    db.transaction(async (tx) => {
      await user(tx, req);
      return CustomFieldListSchema.parse({
        items: (
          await tx.query(
            "SELECT content FROM cabinet_custom_fields ORDER BY content->>'name',id",
          )
        ).map((r) => r.content),
      });
    }),
  );
  app.get("/api/v1/administration/fields/:id/values", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req);
      requireGlobal(actor, "manage_users");
      const id = z.object({ id: z.uuid() }).parse(req.params).id;
      const { offset } = z
        .object({ offset: z.coerce.number().int().min(0).default(0) })
        .strict()
        .parse(req.query);
      const params: unknown[] = [id];
      const parameter = (v: unknown) => {
        params.push(v);
        return "$" + params.length;
      };
      const predicate = authorizedPredicate(actor, "update", parameter);
      const filter = `r.content->'data'->'customFields' ? $1 AND ${predicate}`;
      const count = await tx.query(
        `SELECT count(*) AS n FROM cabinet_records r WHERE ${filter}`,
        params,
      );
      params.push(offset);
      const rows = await tx.query(
        `SELECT r.content FROM cabinet_records r WHERE ${filter} ORDER BY r.id OFFSET $${params.length} LIMIT 200`,
        params,
      );
      return CustomFieldValuesSchema.parse({
        items: rows.map((row) => {
          const record = CabinetRecordSchema.parse(row.content);
          return {
            recordId: record.id,
            title: record.title,
            expectedVersion: record.version,
            value: record.data.customFields[id],
          };
        }),
        total: Number(count[0]!.n),
        offset,
      });
    }),
  );
  const save =
    (update: boolean) => async (req: FastifyRequest, reply: FastifyReply) => {
      const input = CustomFieldCommandSchema.parse(req.body),
        id = update
          ? z.object({ id: z.uuid() }).parse(req.params).id
          : randomUUID();
      const result = await db.transaction(async (tx) => {
        const actor = await user(tx, req);
        requireGlobal(actor, "manage_users");
        return idempotent(
          tx,
          actor,
          input.operationId,
          { action: "field.save", id: update ? id : null, input },
          async () => {
            const stored = update
              ? (
                  await tx.query(
                    "SELECT content FROM cabinet_custom_fields WHERE id=$1",
                    [id],
                  )
                )[0]
              : null;
            if (update && !stored)
              fail(404, "NOT_FOUND", "Champ inaccessible.");
            const previous = stored
              ? CustomFieldSchema.parse(stored.content)
              : null;
            if (previous && previous.version !== input.expectedVersion)
              fail(409, "VERSION_CONFLICT", "Le champ a changé. Rechargez-le.");
            if (previous && previous.kind !== input.kind)
              fail(
                409,
                "FIELD_TARGET_IMMUTABLE",
                "La cible du champ conserve son identité.",
              );
            const { operationId, expectedVersion, migration, ...fields } =
              input;
            const next = CustomFieldSchema.parse({
              ...fields,
              id,
              version: (previous?.version ?? 0) + 1,
            });
            if (next.type === "choice" && !next.choices.length)
              fail(400, "CHOICES_REQUIRED", "Ajouter au moins un choix.");
            const entries = new Map(
              migration?.map((e) => [e.recordId, e]) ?? [],
            );
            const records: CabinetRecord[] = [];
            const found = new Set<string>();
            // Scan all affected values in bounded pages; retain full records only
            // for the explicitly submitted, bounded migration.
            if (previous) {
              let after: string | null = null;
              while (true) {
                const page: Record<string, unknown>[] = await tx.query(
                  "SELECT id,content->'data'->'customFields'->$2 AS value FROM cabinet_records WHERE kind=$1 AND content->'data'->'customFields' ? $2 AND ($3::uuid IS NULL OR id>$3::uuid) ORDER BY id LIMIT 200",
                  [input.kind, id, after],
                );
                for (const row of page) {
                  const recordId = String(row.id),
                    entry = entries.get(recordId);
                  if (!valid(next, entry ? entry.value : row.value))
                    fail(
                      409,
                      "FIELD_MIGRATION_REQUIRED",
                      "Une migration explicite des valeurs incompatibles est requise.",
                    );
                  if (entry) {
                    const storedRecord = (
                      await tx.query(
                        "SELECT content FROM cabinet_records WHERE id=$1",
                        [recordId],
                      )
                    )[0]!;
                    const record = CabinetRecordSchema.parse(
                      storedRecord.content,
                    );
                    await requireAccess(tx, actor, "update", record);
                    if (entry.expectedVersion !== record.version)
                      fail(
                        409,
                        "VERSION_CONFLICT",
                        "Une ressource à migrer a changé.",
                      );
                    found.add(recordId);
                    records.push(record);
                  }
                }
                if (page.length < 200) break;
                after = String(page.at(-1)!.id);
              }
            }
            for (const entry of migration ?? [])
              if (!found.has(entry.recordId))
                fail(
                  400,
                  "INVALID_MIGRATION",
                  "La migration contient une ressource non concernée.",
                );
            await tx.query(
              "INSERT INTO cabinet_custom_fields(id,content) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET content=EXCLUDED.content",
              [id, JSON.stringify(next)],
            );
            for (const record of records) {
              const entry = entries.get(record.id);
              if (!entry) continue;
              const {
                id: recordId,
                version,
                createdAt,
                updatedAt,
                ...content
              } = record;
              content.data = {
                ...content.data,
                customFields: {
                  ...content.data.customFields,
                  [id]: entry.value,
                },
              };
              await saveRecord(
                tx,
                actor,
                {
                  operationId: randomUUID(),
                  expectedVersion: version,
                  record: content,
                },
                now(),
                recordId,
              );
            }
            await tx.query(
              "INSERT INTO cabinet_identity_events(id,actor_id,event) VALUES($1,$2,$3::jsonb)",
              [
                operationId,
                actor.id,
                JSON.stringify({
                  action: "field.saved",
                  field: next,
                  migrated: migration?.map((e) => e.recordId) ?? [],
                  at: now().toISOString(),
                }),
              ],
            );
            return next;
          },
        );
      });
      if (!update) reply.code(201);
      return result;
    };
  app.post("/api/v1/administration/fields", save(false));
  app.put(
    "/api/v1/administration/fields/:id",
    { bodyLimit: 14 * 1024 * 1024 },
    save(true),
  );
}
