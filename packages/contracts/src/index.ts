import { FiscalNatureSchema } from "./fiscal.js";
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
  fiscal: z.object({
    natures: z.array(FiscalNatureSchema),
    createSchema: z.json(),
    commandSchema: z.json(),
    realTransmission: z.literal(false),
  }),
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
export * from "./companies.js";

export * from "./imports.js";

export * from "./settings.js";

export * from "./exports.js";

export * from "./fiscal.js";

export * from "./fiscal-view.js";
export * from "./workflows.js";

export * from "./production.js";
export * from './time.js';
export * from './relationship.js';
