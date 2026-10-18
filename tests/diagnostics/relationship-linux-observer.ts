// Explicit diagnostic only: original requests, assertions and deadlines are unchanged.
import { readFileSync } from "node:fs";
import { EvidenceStore } from "../../scripts/relationship-diagnostic-evidence.mjs";
import { createHash } from "node:crypto";
import { Client, type QueryResult } from "pg";
const directory = process.env.RELATIONSHIP_DIAGNOSTIC_DIRECTORY!;
const stage = process.env.RELATIONSHIP_DIAGNOSTIC_STAGE!;
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const scrub = (s: string) =>
  s.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[database URL redacted]");
const evidence = new EvidenceStore(directory, stage, "observer");
export function event(type: string, detail: Record<string, unknown>) {
  evidence.append(
    stage + "-events.jsonl",
    evidence.json({ at: new Date().toISOString(), type, ...detail }),
  );
}
function artifact(name: string, value: unknown) {
  evidence.save(stage + "-" + name + ".json", value);
}
export function installObserver() {
  if (!directory || !stage || !process.env.DATABASE_URL)
    throw new Error("Explicit diagnostic environment required");
  const target = process.env.RELATIONSHIP_DIAGNOSTIC_TARGET
    ? (JSON.parse(
        readFileSync(process.env.RELATIONSHIP_DIAGNOSTIC_TARGET, "utf8"),
      ) as { hash: string; occurrence: number })
    : null;
  let serial = 0,
    planned = false;
  const occurrences = new Map<string, number>();
  const transactions = new WeakSet<Client>();
  const original = Client.prototype.query as (
    this: Client,
    ...args: unknown[]
  ) => unknown;
  const direct = (client: Client, sql: string, params: unknown[] = []) =>
    original.call(client, sql, params) as Promise<QueryResult>;
  Client.prototype.query = function (this: Client, ...args: unknown[]) {
    const input = args[0] as string | { text?: string; values?: unknown[] };
    const sql = typeof input === "string" ? input : input?.text;
    if (!sql) return original.apply(this, args);
    const params = (
      typeof input === "string"
        ? Array.isArray(args[1])
          ? args[1]
          : []
        : (input.values ?? [])
    ) as unknown[];
    const id = ++serial,
      at = performance.now(),
      fingerprint = hash(sql);
    if (serial > 16384 || Buffer.byteLength(sql) > 1024 * 1024)
      evidence.fail("sql-count-or-size");
    const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
    occurrences.set(fingerprint, occurrence);
    const eligible =
      transactions.has(this) &&
      /^\s*(SELECT|WITH)\b/i.test(sql) &&
      /cabinet_relationship_document_allowed_v(?:12|13)/.test(sql) &&
      !/\b(INSERT|UPDATE|DELETE|MERGE|nextval|setval|pg_advisory\w*)\b/i.test(
        sql,
      );
    const details = {
      id,
      hash: fingerprint,
      occurrence,
      eligible,
      bytes: Buffer.byteLength(sql),
      command: sql.trim().split(/\s+/).slice(0, 2).join(" "),
    };
    const ownedSchema = /^CREATE SCHEMA (test_[a-z0-9]+)$/.exec(sql)?.[1];
    event("sql.start", { ...details, ...(ownedSchema ? { ownedSchema } : {}) });
    const end = (error?: unknown, result?: QueryResult) => {
      if (!error && /^BEGIN\b/.test(sql)) transactions.add(this);
      if (/^(COMMIT|ROLLBACK)\s*$/.test(sql)) transactions.delete(this);
      event(error ? "sql.error" : "sql.end", {
        ...details,
        ms: performance.now() - at,
        ...(error ? { error: scrub(String(error)) } : {}),
      });
      if (result?.rows?.[0]?.["QUERY PLAN"])
        artifact("original-explain-" + id, {
          ...details,
          sql,
          result: result.rows,
        });
    };
    const callback =
      typeof args.at(-1) === "function"
        ? (args.at(-1) as (...args: unknown[]) => void)
        : null;
    if (callback) {
      args[args.length - 1] = (...values: unknown[]) => {
        end(values[0], values[1] as QueryResult);
        callback(...values);
      };
      return original.apply(this, args);
    }
    return (async () => {
      try {
        if (
          target &&
          !planned &&
          target.hash === fingerprint &&
          target.occurrence === occurrence
        ) {
          if (!eligible)
            throw new Error(
              "Selected query is not a pure policy read in a transaction",
            );
          planned = true;
          const stateSql =
            "SELECT current_setting('jit') jit,pg_jit_available() compiler_available,current_setting('statement_timeout') statement_timeout,current_setting('lock_timeout') lock_timeout,pg_backend_pid() backend,txid_current_snapshot()::text snapshot,(SELECT count(*) FROM cabinet_records) records,(SELECT count(*) FROM cabinet_documents) documents,(SELECT count(*) FROM cabinet_relationship_history) relationship_history,(SELECT count(*) FROM cabinet_production_row_versions) production_history";
          const before = (await direct(this, stateSql)).rows;
          artifact("selected-query", {
            ...details,
            sql,
            paramsSha256: hash(JSON.stringify(params)),
            before,
          });
          event("plan.start", details);
          const planStarted = performance.now();
          const plan = (
            await direct(
              this,
              "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql,
              params,
            )
          ).rows;
          const after = (await direct(this, stateSql)).rows;
          artifact("plan", {
            ...details,
            ms: performance.now() - planStarted,
            before,
            after,
            sameState: JSON.stringify(before) === JSON.stringify(after),
            plan,
          });
          if (JSON.stringify(before) !== JSON.stringify(after))
            throw new Error("Probe changed settings/snapshot/cardinalities");
          event("plan.end", details);
        }
        const result = (await original.apply(this, args)) as QueryResult;
        end(undefined, result);
        return result;
      } catch (error) {
        end(error);
        throw error;
      }
    })();
  } as Client["query"];
}
