import { applyAssignments } from "./assignments.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  RoleSchema,
  RecordKindSchema,
  RoleCommandSchema,
  RoleListSchema,
  GroupSchema,
  GroupCommandSchema,
  GroupListSchema,
  AdministrationUserSchema,
  AdministrationUserListSchema,
  AdministrationUserCommandSchema,
  AssignmentCommandSchema,
  AssignmentResultSchema,
  AssignmentListSchema,
  type SessionUser,
} from "@memlia/contracts";
import type { RouteContext } from "../context.js";
import type { Connection } from "../storage/database.js";
import { fail } from "../errors.js";
import { idempotent } from "../storage/operations.js";
import {
  requireGlobal,
  requireAccess,
  canAccess,
  scopedPermission,
} from "../records/permissions.js";
import { loadRecord } from "../records/service.js";
import { effectiveUser } from "../identity/service.js";
import { requireAdministrator } from "./access.js";
const idFrom = (value: unknown) => z.object({ id: z.uuid() }).parse(value).id;
async function event(
  tx: Connection,
  actorId: string,
  operationId: string,
  action: string,
  data: unknown,
  now: Date,
) {
  await tx.query(
    "INSERT INTO cabinet_identity_events(id,actor_id,event) VALUES($1,$2,$3::jsonb)",
    [
      operationId,
      actorId,
      JSON.stringify({ action, data, at: now.toISOString() }),
    ],
  );
}
async function administrationUser(
  tx: Connection,
  row: Record<string, unknown>,
) {
  const roles = await tx.query(
    "SELECT role_id FROM cabinet_user_roles WHERE user_id=$1 ORDER BY role_id",
    [row.id],
  );
  return AdministrationUserSchema.parse({
    ...(await effectiveUser(tx, row)),
    roleIds: roles.map((r) => r.role_id),
    directPermissions: row.permissions,
  });
}
export function registerAdministrationRoutes(
  app: FastifyInstance,
  { db, user, now }: RouteContext,
) {
  app.get("/api/v1/administration/users", async (req) =>
    db.transaction(async (tx) => {
      requireGlobal(await user(tx, req), "manage_users");
      const rows = await tx.query("SELECT * FROM cabinet_users ORDER BY email");
      const items = [];
      for (const row of rows) items.push(await administrationUser(tx, row));
      return AdministrationUserListSchema.parse({ items });
    }),
  );
  app.put("/api/v1/administration/users/:id", async (req) => {
    const id = idFrom(req.params),
      input = AdministrationUserCommandSchema.parse(req.body);
    return db.transaction(async (tx) => {
      const actor = await user(tx, req);
      requireGlobal(actor, "manage_users");
      return idempotent(
        tx,
        actor,
        input.operationId,
        { action: "administration.user", id, input },
        async () => {
          const rows = await tx.query(
            "SELECT * FROM cabinet_users WHERE id=$1",
            [id],
          );
          if (!rows[0]) fail(404, "NOT_FOUND", "Utilisateur inaccessible.");
          if (rows[0].version !== input.expectedVersion)
            fail(
              409,
              "VERSION_CONFLICT",
              "Cet utilisateur a changé. Rechargez-le.",
            );
          const roles = await tx.query(
            "SELECT id FROM cabinet_roles WHERE id=ANY($1::uuid[])",
            [input.roleIds],
          );
          if (roles.length !== input.roleIds.length)
            fail(400, "INVALID_ROLE", "Rôle inconnu.");
          await tx.query("DELETE FROM cabinet_user_roles WHERE user_id=$1", [
            id,
          ]);
          for (const role of input.roleIds)
            await tx.query(
              "INSERT INTO cabinet_user_roles(user_id,role_id) VALUES($1,$2)",
              [id, role],
            );
          const saved = await tx.query(
            "UPDATE cabinet_users SET name=$2,active=$3,permissions=$4::jsonb,version=version+1 WHERE id=$1 RETURNING *",
            [id, input.name, input.active, JSON.stringify(input.permissions)],
          );
          await requireAdministrator(tx);
          if (!input.active)
            await tx.query("DELETE FROM cabinet_sessions WHERE user_id=$1", [
              id,
            ]);
          await event(
            tx,
            actor.id,
            input.operationId,
            "user.administration.updated",
            { id, ...input, operationId: undefined },
            now(),
          );
          return administrationUser(tx, saved[0]!);
        },
      );
    });
  });
  app.get("/api/v1/administration/roles", async (req) =>
    db.transaction(async (tx) => {
      requireGlobal(await user(tx, req), "manage_users");
      return RoleListSchema.parse({
        items: (
          await tx.query(
            "SELECT content FROM cabinet_roles ORDER BY (content->>'order')::integer,content->>'name',id",
          )
        ).map((r) => r.content),
      });
    }),
  );
  app.get("/api/v1/administration/groups", async (req) =>
    db.transaction(async (tx) => {
      requireGlobal(await user(tx, req), "manage_users");
      return GroupListSchema.parse({
        items: (
          await tx.query(
            "SELECT content FROM cabinet_groups ORDER BY content->>'kind',content->>'name',id",
          )
        ).map((r) => r.content),
      });
    }),
  );
  const saveConfiguration =
    (mode: "roles" | "groups", update: boolean) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const id = update ? idFrom(req.params) : randomUUID();
      const input =
        mode === "roles"
          ? RoleCommandSchema.parse(req.body)
          : GroupCommandSchema.parse(req.body);
      const result = await db.transaction(async (tx) => {
        const actor = await user(tx, req);
        requireGlobal(actor, "manage_users");
        return idempotent(
          tx,
          actor,
          input.operationId,
          {
            action: `administration.${mode}.${update ? "update" : "create"}`,
            id: update ? id : null,
            input,
          },
          async () => {
            const table = mode === "roles" ? "cabinet_roles" : "cabinet_groups";
            const existing = update
              ? (
                  await tx.query(`SELECT content FROM ${table} WHERE id=$1`, [
                    id,
                  ])
                )[0]
              : undefined;
            if (update && !existing)
              fail(404, "NOT_FOUND", "Ressource inaccessible.");
            const old = existing
              ? (mode === "roles" ? RoleSchema : GroupSchema).parse(
                  existing.content,
                )
              : null;
            if (old && input.expectedVersion !== old.version)
              fail(
                409,
                "VERSION_CONFLICT",
                "Cette configuration a changé. Rechargez-la.",
              );
            const { operationId, expectedVersion, ...fields } = input;
            const next = (mode === "roles" ? RoleSchema : GroupSchema).parse({
              ...fields,
              id,
              version: (old?.version ?? 0) + 1,
            });
            if ("kind" in next) {
              if (old && "kind" in old && old.kind !== next.kind)
                fail(
                  400,
                  "IMMUTABLE_KIND",
                  "Le type de groupe ne peut pas changer.",
                );
              const members = await tx.query(
                "SELECT id FROM cabinet_users WHERE id=ANY($1::uuid[])",
                [next.memberIds],
              );
              if (members.length !== next.memberIds.length)
                fail(400, "INVALID_MEMBER", "Utilisateur inconnu.");
            }
            await tx.query(
              `INSERT INTO ${table}(id,content) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET content=EXCLUDED.content`,
              [id, JSON.stringify(next)],
            );
            if ("memberIds" in next) {
              await tx.query(
                "DELETE FROM cabinet_memberships WHERE group_id=$1",
                [id],
              );
              for (const memberId of next.memberIds)
                await tx.query(
                  "INSERT INTO cabinet_memberships(group_id,user_id) VALUES($1,$2)",
                  [id, memberId],
                );
            }
            await requireAdministrator(tx);
            await event(
              tx,
              actor.id,
              operationId,
              `${mode}.${update ? "updated" : "created"}`,
              next,
              now(),
            );
            return next;
          },
        );
      });
      if (!update) reply.code(201);
      return result;
    };
  app.post("/api/v1/administration/roles", saveConfiguration("roles", false));
  app.put("/api/v1/administration/roles/:id", saveConfiguration("roles", true));
  app.post("/api/v1/administration/groups", saveConfiguration("groups", false));
  app.put(
    "/api/v1/administration/groups/:id",
    saveConfiguration("groups", true),
  );
  app.get("/api/v1/administration/assignments/:id", async (req) =>
    db.transaction(async (tx) => {
      const id = idFrom(req.params),
        actor = await user(tx, req),
        record = await loadRecord(tx, id);
      await requireAccess(tx, actor, "read", record);
      await requireAccess(tx, actor, "assign", record);
      const versions = await tx.query(
        "SELECT version FROM cabinet_assignment_versions WHERE dossier_id=$1",
        [id],
      );
      const rows = await tx.query(
        "SELECT subject_kind,subject_id,role_id FROM cabinet_assignments WHERE dossier_id=$1 ORDER BY subject_kind,subject_id",
        [id],
      );
      return AssignmentListSchema.parse({
        version: versions[0]?.version ?? 1,
        items: rows.map((r) => ({
          subject: { kind: r.subject_kind, id: r.subject_id },
          roleId: r.role_id,
        })),
      });
    }),
  );
  app.post("/api/v1/administration/assignments", async (req) => {
    const input = AssignmentCommandSchema.parse(req.body);
    return db.transaction(async (tx) => {
      const actor = await user(tx, req);
      return applyAssignments(tx, actor, input, now());
    });
  });
}
