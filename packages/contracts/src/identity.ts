import { RecordKindSchema } from "./records.js";
import { z } from "zod";
export const ActionSchema = z.enum([
  "read",
  "create",
  "update",
  "transition",
  "assign",
  "approve",
  "export",
  "audit",
  "confidential",
  "manage_users",
]);
export type Action = z.infer<typeof ActionSchema>;
export const PermissionSchema = z
  .object({
    action: ActionSchema,
    kind: z.enum(["*", "dossier", "contact", "tache", "obligation"]),
    dossierId: z.uuid().nullable().default(null),
  })
  .strict();
export const SessionUserSchema = z.object({
  version: z.number().int().positive(),
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  active: z.boolean(),
  permissions: z.array(PermissionSchema),
  scopedPermissions: z.array(PermissionSchema).default([]),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;
export const SetupStatusSchema = z.object({
  needsSetup: z.boolean(),
  requiresToken: z.boolean(),
});
export const SetupInputSchema = z
  .object({
    email: z.email(),
    name: z.string().trim().min(1).max(200),
    password: z.string().min(12).max(128),
  })
  .strict();
export type SetupInput = z.infer<typeof SetupInputSchema>;
export const LoginInputSchema = z
  .object({ email: z.email(), password: z.string().min(1).max(128) })
  .strict();
export const SessionSchema = z.object({ user: SessionUserSchema.nullable() });
export const CreateUserInputSchema = SetupInputSchema.extend({
  operationId: z.uuid(),
  permissions: z.array(PermissionSchema).max(100),
});
export const UpdateUserInputSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    operationId: z.uuid(),
    active: z.boolean(),
    permissions: z.array(PermissionSchema).max(100),
  })
  .strict();

export const CapabilitiesSchema = z.object({
  items: z
    .array(z.object({ id: z.uuid(), actions: z.array(ActionSchema) }))
    .max(200),
});
export const CreationCapabilitiesSchema = z.object({
  actions: z.array(ActionSchema),
});
export const CapabilitiesQuerySchema = z
  .object({
    ids: z
      .string()
      .max(7400)
      .transform((v) => v.split(","))
      .pipe(z.array(z.uuid()).min(1).max(200)),
  })
  .strict();
export const CreationCapabilitiesQuerySchema = z
  .object({
    kind: RecordKindSchema,
    id: z.uuid().optional(),
    dossierId: z.uuid().optional(),
    confidential: z.enum(["true", "false"]).default("false"),
  })
  .strict();
