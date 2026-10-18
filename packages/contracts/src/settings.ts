import { z } from "zod";
import { SessionUserSchema } from "./identity.js";
export const ModuleIdSchema = z.enum([
  "fiscal",
  "ged",
  "collectes",
  "imports",
  "recherche_publique",
]);
export type ModuleId = z.infer<typeof ModuleIdSchema>;
export const InstallationSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(150),
    enabledModules: z
      .array(ModuleIdSchema)
      .refine((a) => new Set(a).size === a.length),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type Installation = z.infer<typeof InstallationSchema>;
export const InstallationCommandSchema = InstallationSchema.pick({
  name: true,
  enabledModules: true,
})
  .extend({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export const InstallationInfoSchema = InstallationSchema.extend({
  delivery: z.literal("local"),
  applicationVersion: z.string(),
  cabinetTimeZone: z.string(),
  usage: z
    .object({
      records: z.number().int(),
      documents: z.number().int(),
      documentBytes: z.number().int(),
      users: z.number().int(),
      pendingJobs: z.number().int(),
    })
    .nullable(),
  commercialDocuments: z.array(
    z.object({ title: z.string(), origin: z.string(), url: z.string() }),
  ),
  modules: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      availability: z.enum(["available", "future"]),
      enabled: z.boolean(),
      connection: z.enum(["not_required", "simulation_only", "not_connected"]),
      usable: z.boolean(),
      impact: z.string(),
    }),
  ),
});
export const WidgetIdSchema = z.enum(["counts", "tasks", "obligations"]);
export const PreferencesInputSchema = z
  .object({
    theme: z.enum(["system", "light", "dark"]),
    density: z.enum(["normal", "compact"]),
    sidebarCollapsed: z.boolean(),
    widgetOrder: z
      .array(WidgetIdSchema)
      .max(3)
      .refine((a) => new Set(a).size === a.length),
  })
  .strict();
export const PreferencesSchema = PreferencesInputSchema.extend({
  version: z.number().int().positive(),
});
export type Preferences = z.infer<typeof PreferencesSchema>;
export const AccountSchema = z.object({
  profile: SessionUserSchema,
  preferences: PreferencesSchema,
});
export const AccountCommandSchema = PreferencesInputSchema.extend({
  name: z.string().trim().min(1).max(200),
  operationId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  expectedUserVersion: z.number().int().positive(),
}).strict();
