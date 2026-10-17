import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CreateUserInputSchema,
  UpdateUserInputSchema,
  SessionUserSchema,
  UserListSchema,
} from "@memlia/contracts";
import { createUser, asUser } from "./service.js";
import type { RouteContext } from "../context.js";
import { requireGlobal } from "../records/permissions.js";
import { idempotent } from "../storage/operations.js";
import { fail } from "../errors.js";
import { slowSecretFingerprint } from "./security.js";
export function registerUserRoutes(
  app: FastifyInstance,
  { db, user, now }: RouteContext,
) {
  app.get("/api/v1/users", async (req) =>
    db.transaction(async (tx) => {
      const actor = await user(tx, req);
      requireGlobal(actor, "manage_users");
      return UserListSchema.parse({
        items: (
          await tx.query("SELECT * FROM cabinet_users ORDER BY email")
        ).map(asUser),
      });
    }),
  );
  app.post("/api/v1/users", async (req, reply) => {
    const input = CreateUserInputSchema.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const actor = await user(tx, req);
      requireGlobal(actor, "manage_users");
      return idempotent(
        tx,
        actor,
        input.operationId,
        {
          action: "user.create",
          input: {
            ...input,
            password: await slowSecretFingerprint(
              input.password,
              input.operationId,
            ),
          },
        },
        async () => {
          if (
            (
              await tx.query("SELECT id FROM cabinet_users WHERE email=$1", [
                input.email.toLowerCase(),
              ])
            ).length
          )
            fail(409, "EMAIL_CONFLICT", "Adresse déjà utilisée.");
          const created = await createUser(tx, input, input.permissions);
          await tx.query(
            "INSERT INTO cabinet_identity_events(id,actor_id,event) VALUES($1,$2,$3::jsonb)",
            [
              input.operationId,
              actor.id,
              JSON.stringify({
                action: "user.created",
                userId: created.id,
                permissions: created.permissions,
                at: now().toISOString(),
              }),
            ],
          );
          return created;
        },
      );
    });
    reply.code(201);
    return SessionUserSchema.parse(result);
  });
  app.put("/api/v1/users/:id", async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const input = UpdateUserInputSchema.parse(req.body);
    return db.transaction(async (tx) => {
      const actor = await user(tx, req);
      requireGlobal(actor, "manage_users");
      return SessionUserSchema.parse(
        await idempotent(
          tx,
          actor,
          input.operationId,
          { action: "user.update", id, input },
          async () => {
            const existing = await tx.query(
              "SELECT * FROM cabinet_users WHERE id=$1",
              [id],
            );
            if (!existing[0])
              fail(404, "NOT_FOUND", "Utilisateur inaccessible.");
            if (existing[0].version !== input.expectedVersion)
              fail(
                409,
                "VERSION_CONFLICT",
                "Cet utilisateur a changé. Rechargez-le avant de modifier.",
              );
            const manager = (permissions: unknown) =>
              SessionUserSchema.shape.permissions
                .parse(permissions)
                .some(
                  (p) =>
                    p.action === "manage_users" &&
                    p.kind === "*" &&
                    p.dossierId === null,
                );
            if (
              existing[0].active &&
              manager(existing[0].permissions) &&
              (!input.active || !manager(input.permissions))
            ) {
              const others = await tx.query(
                "SELECT * FROM cabinet_users WHERE id<>$1 AND active=true",
                [id],
              );
              if (!others.some((row) => manager(row.permissions)))
                fail(
                  409,
                  "LAST_ADMINISTRATOR",
                  "Conserver un administrateur actif.",
                );
            }
            const rows = await tx.query(
              "UPDATE cabinet_users SET active=$2,permissions=$3::jsonb,version=version+1 WHERE id=$1 RETURNING *",
              [id, input.active, JSON.stringify(input.permissions)],
            );
            if (!input.active)
              await tx.query("DELETE FROM cabinet_sessions WHERE user_id=$1", [
                id,
              ]);
            await tx.query(
              "INSERT INTO cabinet_identity_events(id,actor_id,event) VALUES($1,$2,$3::jsonb)",
              [
                input.operationId,
                actor.id,
                JSON.stringify({
                  action: "user.updated",
                  userId: id,
                  active: input.active,
                  permissions: input.permissions,
                  at: now().toISOString(),
                }),
              ],
            );
            return asUser(rows[0]!);
          },
        ),
      );
    });
  });
}
