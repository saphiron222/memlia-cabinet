import { z } from "zod";
import { InstallationCommandSchema, type SessionUser } from "@memlia/contracts";
import { requireGlobal } from "../records/permissions.js";
import { idempotent } from "../storage/operations.js";
import { randomUUID } from "node:crypto";
import {
  InstallationSchema,
  ModuleIdSchema,
  PreferencesSchema,
  type ModuleId,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { fail } from "../errors.js";
export async function installation(tx: Connection) {
  const rows = await tx.query(
    "SELECT content FROM cabinet_installation WHERE id=1",
  );
  if (!rows[0]) throw Error("Installation non initialisée.");
  return InstallationSchema.parse(rows[0].content);
}
export async function initializeInstallation(tx: Connection, now: Date) {
  await tx.query(
    "INSERT INTO cabinet_installation(id,content) VALUES(1,$1::jsonb) ON CONFLICT(id) DO NOTHING",
    [
      JSON.stringify(
        InstallationSchema.parse({
          id: randomUUID(),
          version: 1,
          name: "Cabinet local",
          createdAt: now.toISOString(),
          enabledModules: ModuleIdSchema.options,
        }),
      ),
    ],
  );
}
export async function requireModule(tx: Connection, module: ModuleId) {
  if (!(await installation(tx)).enabledModules.includes(module))
    fail(
      409,
      "MODULE_DISABLED",
      "Cette capacité est désactivée dans le cabinet. Les données conservées restent consultables.",
    );
}
export async function preferences(tx: Connection, userId: string) {
  const rows = await tx.query(
    "SELECT content FROM cabinet_preferences WHERE user_id=$1",
    [userId],
  );
  return PreferencesSchema.parse(
    rows[0]?.content ?? {
      version: 1,
      theme: "system",
      density: "normal",
      sidebarCollapsed: false,
      widgetOrder: ["counts", "tasks", "obligations"],
    },
  );
}

export async function updateInstallation(
  tx: Connection,
  actor: SessionUser,
  input: z.infer<typeof InstallationCommandSchema>,
  now: Date,
) {
  requireGlobal(actor, "manage_users");
  return idempotent(
    tx,
    actor,
    input.operationId,
    { action: "installation.update", input },
    async () => {
      const p = await installation(tx);
      if (p.version !== input.expectedVersion)
        fail(409, "VERSION_CONFLICT", "Les capacités du cabinet ont changé.");
      const next = {
        ...p,
        name: input.name,
        enabledModules: input.enabledModules,
        version: p.version + 1,
      };
      await tx.query(
        "UPDATE cabinet_installation SET content=$1::jsonb WHERE id=1",
        [JSON.stringify(next)],
      );
      await tx.query(
        "INSERT INTO cabinet_identity_events(id,actor_id,event) VALUES($1,$2,$3::jsonb)",
        [
          input.operationId,
          actor.id,
          JSON.stringify({
            action: "installation.updated",
            before: p,
            after: next,
            at: now.toISOString(),
          }),
        ],
      );
      return next;
    },
  );
}
