import { RecordListQuerySchema } from "./records.js";
import { RecordKindSchema, CustomValueSchema } from "./records.js";
import { z } from "zod";
import { PermissionSchema, SessionUserSchema } from "./identity.js";
const command = {
  operationId: z.uuid(),
  expectedVersion: z.number().int().positive().optional(),
};
const roleFields = {
  name: z.string().trim().min(1).max(100),
  order: z.number().int().min(0).max(10000),
  permissions: z
    .array(
      PermissionSchema.refine(
        (p) => p.dossierId === null,
        "Le périmètre vient de l’affectation.",
      ),
    )
    .max(100),
};
export const RoleSchema = z
  .object({ id: z.uuid(), version: z.number().int().positive(), ...roleFields })
  .strict();
export type Role = z.infer<typeof RoleSchema>;
export const RoleCommandSchema = z
  .object({ ...command, ...roleFields })
  .strict();
export const RoleListSchema = z.object({ items: z.array(RoleSchema) });
const groupFields = {
  kind: z.enum(["team", "site"]),
  name: z.string().trim().min(1).max(100),
  memberIds: z
    .array(z.uuid())
    .max(1000)
    .refine((a) => new Set(a).size === a.length, "Membres uniques"),
};
export const GroupSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    ...groupFields,
  })
  .strict();
export type Group = z.infer<typeof GroupSchema>;
export const GroupCommandSchema = z
  .object({ ...command, ...groupFields })
  .strict();
export const GroupListSchema = z.object({ items: z.array(GroupSchema) });
export const AdministrationUserSchema = SessionUserSchema.extend({
  roleIds: z.array(z.uuid()),
  directPermissions: z.array(PermissionSchema),
});
export const AdministrationUserListSchema = z.object({
  items: z.array(AdministrationUserSchema),
});
export const AdministrationUserCommandSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    name: z.string().trim().min(1).max(200),
    active: z.boolean(),
    permissions: z.array(PermissionSchema).max(100),
    roleIds: z
      .array(z.uuid())
      .max(100)
      .refine((a) => new Set(a).size === a.length),
  })
  .strict();
export const AssignmentSubjectSchema = z
  .object({ kind: z.enum(["user", "team", "site"]), id: z.uuid() })
  .strict();
export const AssignmentRowSchema = z
  .object({
    dossierId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    subject: AssignmentSubjectSchema,
    roleId: z.uuid(),
    remove: z.boolean(),
  })
  .strict();
export const AssignmentCommandSchema = z
  .object({
    operationId: z.uuid(),
    rows: z
      .array(AssignmentRowSchema)
      .min(1)
      .max(200)
      .refine(
        (rows) => new Set(rows.map((r) => r.dossierId)).size === rows.length,
        "Une commande par dossier",
      ),
  })
  .strict();
export const AssignmentResultSchema = z.object({
  items: z.array(
    z.object({
      dossierId: z.uuid(),
      status: z.enum(["assigned", "removed", "refused", "conflict", "invalid"]),
      version: z.number().int().positive().optional(),
    }),
  ),
});
export const AssignmentListSchema = z.object({
  version: z.number().int().positive(),
  items: z.array(
    z.object({ subject: AssignmentSubjectSchema, roleId: z.uuid() }),
  ),
});

export const CustomFieldInputSchema = z
  .object({
    kind: RecordKindSchema,
    name: z.string().trim().min(1).max(100),
    type: z.enum(["text", "long_text", "number", "date", "boolean", "choice"]),
    placement: z.enum(["header", "information", "parameters"]),
    choices: z
      .array(z.string().trim().min(1).max(100))
      .max(100)
      .refine((a) => new Set(a).size === a.length),
  })
  .strict();
export const CustomFieldSchema = CustomFieldInputSchema.extend({
  id: z.uuid(),
  version: z.number().int().positive(),
});
export type CustomField = z.infer<typeof CustomFieldSchema>;
export const CustomFieldCommandSchema = CustomFieldInputSchema.extend({
  operationId: z.uuid(),
  expectedVersion: z.number().int().positive().optional(),
  migration: z
    .array(
      z
        .object({
          recordId: z.uuid(),
          expectedVersion: z.number().int().positive(),
          value: CustomValueSchema,
        })
        .strict(),
    )
    .max(10000)
    .refine((a) => new Set(a.map((x) => x.recordId)).size === a.length)
    .optional(),
});
export const CustomFieldListSchema = z.object({
  items: z.array(CustomFieldSchema),
});

export const CustomFieldValuesSchema = z.object({
  offset: z.number().int().nonnegative().default(0),
  items: z
    .array(
      z.object({
        recordId: z.uuid(),
        title: z.string(),
        expectedVersion: z.number().int().positive(),
        value: CustomValueSchema,
      }),
    )
    .max(200),
  total: z.number().int().nonnegative(),
});

export const SavedViewSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(100),
  query: RecordListQuerySchema,
});
export type SavedView = z.infer<typeof SavedViewSchema>;
export const SavedViewCommandSchema = SavedViewSchema.omit({
  id: true,
  version: true,
})
  .extend({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();
export const SavedViewListSchema = z.object({
  items: z.array(SavedViewSchema).max(100),
});
export const RecordScopesSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.uuid(),
        title: z.string(),
        kind: z.enum(["dossier", "team", "site"]),
      }),
    )
    .max(100),
  offset: z.number().int(),
  total: z.number().int(),
});
