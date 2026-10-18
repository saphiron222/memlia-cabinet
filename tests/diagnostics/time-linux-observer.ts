// Manual, fictitious diagnostics only. Never imported by the product or normal tests.
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { Client, type QueryResult } from "pg";
import {
  JobRunner,
  type JobDefinition,
} from "../../apps/server/src/jobs/runner.js";

const directory = process.env.TIME_DIAGNOSTIC_DIRECTORY!;
const stage = process.env.TIME_DIAGNOSTIC_STAGE!;
const context = new AsyncLocalStorage<{ phaseId: number; phase: string }>();
let phaseSerial = 0;
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function scrub(value: string) {
  return value.replace(
    /postgres(?:ql)?:\/\/[^\s"']+/gi,
    "[database URL redacted]",
  );
}
export function errorDetails(error: unknown) {
  const e = error as Error & { code?: string };
  return {
    name: e?.name,
    code: e?.code,
    message: scrub(e?.message ?? String(error)),
    stack: scrub(e?.stack ?? ""),
  };
}
export function event(type: string, details: Record<string, unknown> = {}) {
  appendFileSync(
    join(directory, `${stage}-events.jsonl`),
    JSON.stringify({
      at: new Date().toISOString(),
      type,
      ...context.getStore(),
      ...details,
    }) + "\n",
    { mode: 0o600 },
  );
}
export function artifact(name: string, value: unknown) {
  const text = JSON.stringify(value, null, 2) + "\n";
  writeFileSync(join(directory, `${stage}-${name}.json`), text, {
    mode: 0o600,
    flag: "wx",
  });
  return {
    file: `${stage}-${name}.json`,
    sha256: hash(text),
    bytes: Buffer.byteLength(text),
  };
}
export async function phase<T>(
  name: string,
  run: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  const phaseId = ++phaseSerial,
    parentPhaseId = context.getStore()?.phaseId;
  return context.run({ phaseId, phase: name }, async () => {
    event("phase.start", { name, parentPhaseId });
    try {
      const result = await run();
      event("phase.end", { name, elapsedMs: performance.now() - started });
      return result;
    } catch (error) {
      event("phase.error", {
        name,
        elapsedMs: performance.now() - started,
        error: errorDetails(error),
      });
      throw error;
    }
  });
}

type RawQuery = (this: Client, ...args: unknown[]) => unknown;
const original = Client.prototype.query as RawQuery;
const direct = (client: Client, sql: string, params?: unknown[]) =>
  original.call(client, sql, params) as Promise<QueryResult>;
let serial = 0;
let timeOrdinal = 0;
let referenceOrdinal = 0;
type Target = { baselineId: number; sqlOccurrence: number; sqlSha256: string };
let targets: Target[] = [];
const measured = new Set<number>();
export const probeWasMeasured = () =>
  targets.length > 0 && targets.every((t) => measured.has(t.baselineId));
const occurrences = new Map<string, number>();
const transactions = new WeakSet<Client>();
const jitOverrides = new WeakMap<Client, string>();
let captureBytes = 0;

async function plans(
  client: Client,
  sql: string,
  params: unknown[],
  target: Target,
  probeId: number,
) {
  if (hash(sql) !== target.sqlSha256)
    throw new Error("Probe SQL differs from the selected baseline SQL");
  const ordinal = target.baselineId;
  measured.add(ordinal);
  const identity = {
    baselineId: ordinal,
    probeId,
    sqlOccurrence: target.sqlOccurrence,
    sqlSha256: hash(sql),
    paramsSha256: hash(JSON.stringify(params)),
  };
  const counts = `SELECT current_setting('jit') AS jit, current_setting('statement_timeout') AS statement_timeout,
    pg_backend_pid() AS backend, txid_current_snapshot()::text AS snapshot,
    (SELECT count(*) FROM cabinet_time) AS time_current,
    (SELECT count(*) FROM cabinet_time_history) AS time_history,
    (SELECT count(*) FROM cabinet_records) AS records,
    (SELECT count(*) FROM cabinet_history) AS record_history,
    (SELECT count(*) FROM cabinet_production_rows) AS production_current,
    (SELECT count(*) FROM cabinet_production_row_versions) AS production_history,
    (SELECT count(*) FROM cabinet_time_csv) AS csv,
    (SELECT count(*) FROM cabinet_time_csv_rows) AS csv_rows,
    (SELECT count(*) FROM cabinet_export_rows) AS exit_rows`;
  const before = (await direct(client, counts)).rows;
  artifact(`selected-query-${ordinal}`, { ...identity, sql, params, before });
  // Same live transaction, unchanged fictitious rows and parameters. Savepoints
  // restore each experimental SET LOCAL even when EXPLAIN is cancelled.
  for (const jit of ["on", "off"] as const) {
    await direct(client, "SAVEPOINT time_diagnostic_plan");
    const started = performance.now();
    try {
      await direct(client, "SET LOCAL statement_timeout = '90s'");
      await direct(client, `SET LOCAL jit = ${jit}`);
      const state = (await direct(client, counts)).rows;
      event("plan.start", { ...identity, jit, state });
      const result = await direct(
        client,
        `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, FORMAT JSON) ${sql}`,
        params,
      );
      const receipt = artifact(`plan-${ordinal}-${jit}`, {
        ...identity,
        jit,
        state,
        elapsedMs: performance.now() - started,
        plan: result.rows[0]?.["QUERY PLAN"],
      });
      event("plan.end", {
        ...identity,
        jit,
        elapsedMs: performance.now() - started,
        ...receipt,
      });
    } catch (error) {
      event("plan.error", {
        ...identity,
        jit,
        elapsedMs: performance.now() - started,
        error: errorDetails(error),
      });
    } finally {
      await direct(client, "ROLLBACK TO SAVEPOINT time_diagnostic_plan");
      await direct(client, "RELEASE SAVEPOINT time_diagnostic_plan");
    }
  }
  const after = (await direct(client, counts)).rows;
  artifact(`plan-reset-${ordinal}`, {
    before,
    after,
    same: JSON.stringify(before) === JSON.stringify(after),
  });
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error(
      "Diagnostic changed transaction settings, snapshot or cardinalities",
    );
}

export function installObserver(selected: Target[] = []) {
  if (!directory || !stage || !process.env.DATABASE_URL)
    throw new Error("Manual native diagnostic environment required");
  if (selected.length > 2) throw new Error("At most two diagnostic plan pairs");
  targets = selected;
  const register = JobRunner.prototype.register;
  JobRunner.prototype.register = function (
    this: JobRunner,
    definition: JobDefinition<unknown, unknown, unknown>,
  ) {
    const wrapped: typeof definition = {
      ...definition,
      authorize: (...args) =>
        phase(`job.${definition.kind}.authorize`, () =>
          definition.authorize(...args),
        ),
      execute: (input, job) =>
        phase(`job.${definition.kind}.execute`, async () => {
          const commit = job.commit.bind(job);
          job.commit = (...args) =>
            phase(`job.${definition.kind}.commit`, async () => {
              event("job.checkpoint.before", {
                jobId: job.id,
                checkpoint: job.checkpoint,
              });
              const result = await commit(...args);
              event("job.checkpoint.after", {
                jobId: job.id,
                checkpoint: job.checkpoint,
              });
              return result;
            });
          return definition.execute(input, job);
        }),
    };
    return register.call(this, wrapped);
  } as JobRunner["register"];
  // Observe the driver rather than replacing the canonical Database provider.
  // Preserve both promise and callback forms used by pg.Pool and pg.Client.
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
    const id = ++serial;
    const started = performance.now();
    const isTime =
      sql.startsWith("WITH ") &&
      sql.includes("time_readable_records AS MATERIALIZED");
    const isReference = sql.startsWith("WITH selected AS MATERIALIZED");
    const ordinal = isTime ? ++timeOrdinal : undefined;
    const references = isReference ? ++referenceOrdinal : undefined;
    const sqlSha256 = hash(sql);
    const sqlOccurrence = (occurrences.get(sqlSha256) ?? 0) + 1;
    occurrences.set(sqlSha256, sqlOccurrence);
    const selectedTarget = targets.find(
      (t) => t.sqlSha256 === sqlSha256 && t.sqlOccurrence === sqlOccurrence,
    );
    const inTransaction = transactions.has(this);
    const planEligible =
      inTransaction &&
      /^\s*(SELECT|WITH)\b/i.test(sql) &&
      /\bcabinet_(time|records|history|production)/.test(sql) &&
      !/\b(INSERT|UPDATE|DELETE|MERGE|nextval|setval|pg_advisory[a-z_]*)\b/i.test(
        sql,
      );
    const details = {
      id,
      sqlSha256,
      sqlOccurrence,
      inTransaction,
      transactionJitOverride: jitOverrides.get(this) ?? null,
      planEligible,
      command: sql.trim().split(/\s+/, 2).join(" "),
      backend: (this as Client & { processID?: number }).processID,
      timeOrdinal: ordinal,
      referenceOrdinal: references,
    };
    const capture = {
      ...details,
      sql,
      params,
      paramsSha256: hash(JSON.stringify(params)),
    };
    captureBytes += Buffer.byteLength(JSON.stringify(capture));
    if (
      id > 8192 ||
      Buffer.byteLength(sql) > 1024 * 1024 ||
      captureBytes > 64 * 1024 * 1024
    ) {
      event("capture.bound", {
        ...details,
        captureBytes,
        sqlBytes: Buffer.byteLength(sql),
      });
      throw new Error(
        "Diagnostic SQL capture bound exceeded (8192 queries / 1 MiB SQL / 64 MiB total)",
      );
    }
    artifact(`sql-${id}`, capture);
    const schema = /^CREATE SCHEMA (test_[a-z0-9]+|diag_time_[a-z0-9]+)$/.exec(
      sql,
    )?.[1];
    event("sql.start", {
      ...details,
      ...(schema ? { ownedSchema: schema } : {}),
    });
    const end = (error?: unknown) => {
      if (!error && /^BEGIN\b/i.test(sql)) transactions.add(this);
      if (!error && /^SET LOCAL jit = (on|off)$/i.test(sql))
        jitOverrides.set(this, sql.split(" ").at(-1)!.toLowerCase());
      if (/^(COMMIT|ROLLBACK)\s*$/i.test(sql)) {
        transactions.delete(this);
        jitOverrides.delete(this);
      }
      event(error ? "sql.error" : "sql.end", {
        ...details,
        elapsedMs: performance.now() - started,
        ...(error ? { error: errorDetails(error) } : {}),
      });
    };
    const callback =
      typeof args.at(-1) === "function"
        ? (args.at(-1) as (...values: unknown[]) => void)
        : undefined;
    if (callback) {
      if (selectedTarget)
        throw new Error("Selected Time query unexpectedly uses callback mode");
      args[args.length - 1] = (...values: unknown[]) => {
        end(values[0]);
        callback(...values);
      };
      try {
        return original.apply(this, args);
      } catch (error) {
        end(error);
        throw error;
      }
    }
    return (async () => {
      try {
        if (selectedTarget) {
          if (!planEligible)
            throw new Error(
              "Selected SQL is not an eligible read in a live transaction",
            );
          await plans(this, sql, params, selectedTarget, id);
        }
        const result = await original.apply(this, args);
        end();
        return result;
      } catch (error) {
        end(error);
        throw error;
      }
    })();
  } as Client["query"];
}
