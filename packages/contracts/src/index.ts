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
export * from "./identity.js";
import { ActionSchema, SessionUserSchema } from "./identity.js";
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
export * from "./documents.js";
export * from "./jobs.js";
export * from "./collections.js";

export const HealthSchema = z.object({ ready: z.boolean() });

export * from "./administration.js";
