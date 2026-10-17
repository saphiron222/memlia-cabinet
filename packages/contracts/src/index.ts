import { z } from "zod";
export * from "./records.js";
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
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
export const CatalogueSchema = z.object({
  resources: z.array(
    z.object({
      kind: z.enum(["dossier", "contact", "tache", "obligation"]),
      label: z.string(),
      actions: z.array(ActionSchema),
      inputSchema: z.json(),
    }),
  ),
});

export const UserListSchema = z.object({ items: z.array(SessionUserSchema) });
export type UserList = z.infer<typeof UserListSchema>;
