import { z } from "zod";
import { TimeCatalogSchema, type SessionUser } from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { readsOthers, scopeCte, fullScope } from "./service.js";
export const CatalogQuery = z
  .object({
    q: z.string().max(200).default(""),
    offset: z.coerce.number().int().min(0).default(0),
    active: z.enum(["true", "false"]).optional(),
    ids: z
      .string()
      .transform((s) => s.split(",").filter(Boolean))
      .pipe(z.array(z.uuid()).max(100))
      .optional(),
  })
  .strict();
export async function catalog(
  tx: Connection,
  actor: SessionUser,
  kind: "users" | "roles" | "groups" | "natures",
  q: z.infer<typeof CatalogQuery>,
) {
  const params: unknown[] = [],
    p = (v: unknown) => {
      params.push(v);
      return "$" + params.length;
    };
  const pattern = p("%" + q.q.replace(/[\\%_]/g, "\\$&") + "%");
  const table =
    kind === "natures"
      ? "cabinet_time"
      : kind === "users"
        ? "cabinet_users"
        : kind === "roles"
          ? "cabinet_roles"
          : "cabinet_groups";
  const name =
    kind === "users"
      ? "t.name"
      : kind === "natures"
        ? "t.content->'data'->>'name'"
        : "t.content->>'name'";
  const active =
    kind === "users"
      ? "t.active"
      : kind === "natures"
        ? "(t.content->'data'->>'active')::boolean"
        : "TRUE";
  const where = [`${name} ILIKE ${pattern}`];
  if (q.ids) where.push(`t.id=ANY(${p(q.ids)}::uuid[])`);
  else if (q.active) where.push(`${active}=${p(q.active === "true")}`);
  if (kind === "users" && !readsOthers(actor))
    where.push(`t.id=${p(actor.id)}::uuid`);
  let cte = "";
  if (kind === "natures") {
    where.push("t.kind='nature'");
    cte = await scopeCte(tx, actor, p, {
      kind: "time",
      sql: `SELECT t.content FROM cabinet_time t WHERE ${where.join(" AND ")}`,
      params: [...params],
    });
    where.push(fullScope(actor, p));
  }
  const rows = await tx.query(
    `${cte} SELECT t.id,${name} name,${active} active FROM ${table} t WHERE ${where.join(" AND ")} ORDER BY ${name},t.id LIMIT 101 OFFSET ${p(q.offset)}`,
    params,
  );
  return TimeCatalogSchema.parse({
    items: rows.slice(0, 100),
    hasMore: rows.length > 100,
    offset: q.offset,
  });
}
