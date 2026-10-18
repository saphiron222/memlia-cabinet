// Manual diagnostic on a disposable/fictitious loopback database. No normal CI
// command, production setting, test fixture, assertion or timeout is changed.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { platform, arch, cpus, totalmem } from "node:os";
import { Pool } from "pg";

const local = process.argv.includes("--local-harness-check");
assert(
  process.argv.includes("--fictitious"),
  "Explicit --fictitious flag required",
);
assert(
  process.argv
    .slice(2)
    .every((a) => ["--fictitious", "--local-harness-check"].includes(a)),
  "Unknown diagnostic argument",
);
const image =
  "postgres:17-bookworm@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826";
const directory = resolve(
  process.env.TIME_DIAGNOSTIC_DIRECTORY ?? "var/task5/linux-diagnostic",
);
mkdirSync(directory, { recursive: true, mode: 0o700 });
assert.equal(
  readdirSync(directory).length,
  0,
  "Use a new evidence directory; prior failures are never overwritten",
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const scrub = (value) =>
  value.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[database URL redacted]");
const save = (name, value) =>
  writeFileSync(join(directory, name), JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
const head = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
if (!local) {
  assert.equal(
    platform(),
    "linux",
    "Use --local-harness-check for non-Linux development receipts",
  );
  assert.match(process.env.EXPECTED_HEAD ?? "", /^[a-f0-9]{40}$/);
  assert.equal(
    head,
    process.env.EXPECTED_HEAD,
    "Diagnostic checkout differs from reviewed commit",
  );
  assert.equal(
    execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
      encoding: "utf8",
    }),
    "",
    "Reviewed tracked checkout must be clean",
  );
}
let url;
try {
  url = new URL(process.env.DATABASE_URL ?? "");
} catch {
  throw new Error("A valid protected DATABASE_URL is required");
}
assert(
  ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
  "Only the dedicated loopback PostgreSQL service is allowed",
);
const applicationName = "memlia-time-diag-" + randomUUID();
url.searchParams.set("application_name", applicationName);
const childEnv = {
  ...process.env,
  DATABASE_URL: url.toString(),
  TIME_DIAGNOSTIC_DIRECTORY: directory,
  FORCE_COLOR: "0",
};
delete childEnv.NO_COLOR;
const control = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
  statement_timeout: 5000,
});
const sourcePaths = [
  ".github/workflows/ci.yml",
  ".github/workflows/time-linux-diagnostic.yml",
  "vitest.config.ts",
  "package-lock.json",
  "apps/server/test/time-review.test.ts",
  "apps/server/test/time.test.ts",
  "apps/server/test/time-scope.test.ts",
  "apps/server/test/time-export-batch.test.ts",
  "apps/server/test/production-round1.test.ts",
  "apps/server/test/helpers.ts",
  "apps/server/src/time/service.ts",
  "apps/server/src/time/export.ts",
  "apps/server/src/time/catalog.ts",
  "apps/server/src/time/workload.ts",
  "apps/server/src/time/scope-references.ts",
  "apps/server/src/time/authorize-batch.ts",
  "apps/server/src/time/csv.ts",
  "apps/server/src/time/routes.ts",
  "apps/server/src/administration/export.ts",
  "apps/server/src/production/export.ts",
  "apps/server/src/jobs/runner.ts",
  "apps/server/src/documents/store.ts",
  "apps/server/src/production/query.ts",
  "apps/server/src/records/query.ts",
  "apps/server/src/storage/database.ts",
  "scripts/time-linux-diagnostic.mjs",
  ...readdirSync("tests/diagnostics")
    .filter((p) => p.startsWith("time-linux"))
    .map((p) => "tests/diagnostics/" + p),
];
const sources = sourcePaths.map((path) => {
  const bytes = readFileSync(path);
  return { path, bytes: bytes.length, sha256: hash(bytes) };
});
const readEvents = (stage) => {
  try {
    return readFileSync(join(directory, `${stage}-events.jsonl`), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};
async function cleanOwned(stage) {
  // Only connections carrying this invocation's random application name and
  // schemas whose CREATE was observed in this invocation can be removed.
  const terminated = await control.query(
    "SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE application_name=$1 AND pid<>pg_backend_pid()",
    [applicationName],
  );
  const schemas = [
    ...new Set(
      readEvents(stage).flatMap((e) => (e.ownedSchema ? [e.ownedSchema] : [])),
    ),
  ];
  for (const schema of schemas) {
    assert.match(schema, /^(test_|diag_time_)[a-z0-9]+$/);
    await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  return { terminated: terminated.rows, schemas };
}
async function run(stage, args, boundMs) {
  const startedAt = new Date().toISOString(),
    started = performance.now();
  const child = spawn(process.execPath, args, {
    env: { ...childEnv, TIME_DIAGNOSTIC_STAGE: stage },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let timedOut = false,
    killTimer,
    monitoring = false;
  const chunks = { stdout: "", stderr: "" };
  // Redact complete lines, including connection strings spanning stream chunks.
  for (const name of ["stdout", "stderr"])
    child[name].on("data", (data) => {
      chunks[name] += data.toString();
      const end = chunks[name].lastIndexOf("\n");
      if (end >= 0) {
        appendFileSync(
          join(directory, `${stage}.log`),
          scrub(chunks[name].slice(0, end + 1)),
          { mode: 0o600 },
        );
        chunks[name] = chunks[name].slice(end + 1);
      }
    });
  const signal = (name) => {
    try {
      process.kill(-child.pid, name);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const watchdog = setTimeout(() => {
    timedOut = true;
    signal("SIGTERM");
    killTimer = setTimeout(() => signal("SIGKILL"), 10000);
  }, boundMs);
  const monitor = setInterval(async () => {
    if (monitoring) return;
    monitoring = true;
    try {
      const result = await control.query(
        "SELECT pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers,extract(epoch FROM clock_timestamp()-query_start)*1000 AS query_ms,query FROM pg_stat_activity WHERE application_name=$1",
        [applicationName],
      );
      const rows = result.rows.map(({ query, ...row }) => ({
        ...row,
        sqlSha256: hash(query),
      }));
      appendFileSync(
        join(directory, `${stage}-activity.jsonl`),
        JSON.stringify({ at: new Date().toISOString(), rows }) + "\n",
        { mode: 0o600 },
      );
    } catch (error) {
      appendFileSync(
        join(directory, `${stage}-activity.jsonl`),
        JSON.stringify({
          at: new Date().toISOString(),
          error: scrub(error.message),
        }) + "\n",
      );
    } finally {
      monitoring = false;
    }
  }, 1000);
  let status;
  try {
    status = await new Promise((done, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => done({ code, signal }));
    });
  } finally {
    clearInterval(monitor);
    clearTimeout(watchdog);
    clearTimeout(killTimer);
    for (const name of ["stdout", "stderr"])
      if (chunks[name])
        appendFileSync(join(directory, `${stage}.log`), scrub(chunks[name]), {
          mode: 0o600,
        });
  }
  const cleanup = await cleanOwned(stage);
  const receipt = {
    startedAt,
    elapsedMs: performance.now() - started,
    boundMs,
    timedOut,
    ...status,
    cleanup,
  };
  save(`${stage}-result.json`, receipt);
  return receipt;
}

try {
  const environment = (
    await control.query(
      "SELECT version() AS version,current_setting('server_version_num') AS server_version_num,current_setting('jit') AS jit,pg_jit_available() AS compiler_available,current_setting('jit_above_cost') AS jit_above_cost,current_setting('jit_inline_above_cost') AS jit_inline_above_cost,current_setting('jit_optimize_above_cost') AS jit_optimize_above_cost,current_setting('statement_timeout') AS statement_timeout,current_setting('lock_timeout') AS lock_timeout",
    )
  ).rows[0];
  assert.equal(Math.floor(Number(environment.server_version_num) / 10000), 17);
  assert.equal(environment.jit, "on", "Reference default JIT must remain on");
  let container = null;
  if (!local) {
    assert(
      process.env.POSTGRES_SERVICE_ID,
      "Service identity is required on Linux",
    );
    const service = JSON.parse(
      execFileSync("docker", ["inspect", process.env.POSTGRES_SERVICE_ID], {
        encoding: "utf8",
      }),
    )[0];
    assert.equal(service.Config.Image, image);
    const actual = JSON.parse(
      execFileSync("docker", ["image", "inspect", service.Image], {
        encoding: "utf8",
      }),
    )[0];
    container = {
      requestedImage: service.Config.Image,
      imageId: service.Image,
      repoDigests: actual.RepoDigests,
      os: actual.Os,
      architecture: actual.Architecture,
      state: service.State.Status,
      nanoCpus: service.HostConfig.NanoCpus,
      memory: service.HostConfig.Memory,
      cpusetCpus: service.HostConfig.CpusetCpus,
    };
  }
  save("environment.json", {
    at: new Date().toISOString(),
    mode: local
      ? "local harness check; not Linux/compiler acceptance"
      : "manual Linux diagnostic; not full CI acceptance",
    head,
    runner: {
      platform: platform(),
      arch: arch(),
      node: process.version,
      cpuCount: cpus().length,
      cpuModel: cpus()[0]?.model,
      totalMemory: totalmem(),
    },
    environment,
    container,
    sources,
    gates: {
      ordinaryTestMs: 30000,
      ordinaryI4Ms: 120000,
      baselineProcessMs: 110000,
      probeProcessMs: 480000,
      probeStatementMs: 90000,
      capturedQueriesPerStage: 8192,
      capturedSqlBytesPerQuery: 1048576,
      capturedSqlAndParametersBytesPerStage: 67108864,
    },
  });
  const testName =
    "^review C1 populated interoperable HTTP exit includes exact current history active timer configurations links and prepared CSV$";
  const baseline = await run(
    "baseline",
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "tests/diagnostics/time-linux.config.ts",
      "apps/server/test/time-review.test.ts",
      "-t",
      testName,
      "--reporter=verbose",
      "--reporter=json",
      `--outputFile.json=${join(directory, "baseline-vitest.json")}`,
    ],
    110000,
  );
  // Measure the current C1 trace, without assuming that its cause is Time SQL
  // or JIT. An unfinished read ranks first; otherwise rank by observed duration.
  // Keep two distinct SQL shapes, and require the same hash/occurrence in the
  // independent fixture. The on/off pair shares its own live params/snapshot.
  const events = readEvents("baseline");
  const sql = events
    .filter((e) => e.type === "sql.start")
    .map((start) => {
      const end = events.find(
        (e) => ["sql.end", "sql.error"].includes(e.type) && e.id === start.id,
      );
      return {
        ...start,
        elapsedMs: end?.elapsedMs ?? null,
        outcome: end?.type ?? "pending",
        error: end?.error,
      };
    });
  const ranked = sql
    .filter((s) => s.planEligible)
    .sort((a, b) => (b.elapsedMs ?? Infinity) - (a.elapsedMs ?? Infinity));
  const seen = new Set();
  const selected = ranked
    .filter((s) => {
      if (seen.has(s.sqlSha256)) return false;
      seen.add(s.sqlSha256);
      return true;
    })
    .slice(0, 2)
    .map((s) => ({
      baselineId: s.id,
      sqlSha256: s.sqlSha256,
      sqlOccurrence: s.sqlOccurrence,
      phase: s.phase,
      phaseId: s.phaseId,
      timeOrdinal: s.timeOrdinal,
      referenceOrdinal: s.referenceOrdinal,
      baselineElapsedMs: s.elapsedMs,
      baselineOutcome: s.outcome,
    }));
  const groups = new Map();
  for (const s of sql) {
    const group = groups.get(s.sqlSha256) ?? {
      sqlSha256: s.sqlSha256,
      count: 0,
      elapsedMs: 0,
      pending: 0,
      errors: 0,
      firstId: s.id,
    };
    group.count++;
    group.elapsedMs += s.elapsedMs ?? 0;
    group.pending += Number(s.outcome === "pending");
    group.errors += Number(s.outcome === "sql.error");
    groups.set(s.sqlSha256, group);
  }
  save("baseline-analysis.json", {
    testName,
    sqlCount: sql.length,
    phases: events.filter((e) => ["phase.end", "phase.error"].includes(e.type)),
    unfinishedPhases: events.filter(
      (e) =>
        e.type === "phase.start" &&
        !events.some(
          (v) =>
            ["phase.end", "phase.error"].includes(v.type) &&
            v.phaseId === e.phaseId,
        ),
    ),
    slowestSql: [...sql]
      .sort((a, b) => (b.elapsedMs ?? Infinity) - (a.elapsedMs ?? Infinity))
      .slice(0, 30),
    groupedSql: [...groups.values()].sort((a, b) => b.elapsedMs - a.elapsedMs),
    selected,
  });
  let probe = null;
  if (selected.length) {
    save("target.json", {
      targets: selected,
      selection:
        "two distinct eligible read SQL shapes from exact C1, pending first then greatest observed duration; same SQL hash/occurrence required in independent C1 replay, new fictitious IDs; each on/off pair uses identical params and live snapshot; no inference from I2",
    });
    probe = await run(
      "probe",
      ["--import", "tsx", "tests/diagnostics/time-linux-exit-probe.ts"],
      480000,
    );
  }
  const plans = selected.flatMap((target) =>
    ["on", "off"].map((jit) =>
      join(directory, `probe-plan-${target.baselineId}-${jit}.json`),
    ),
  );
  const planReceipts = plans.map((path) => {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return null;
    }
  });
  const complete =
    selected.length === 2 &&
    probe?.code === 0 &&
    !probe.timedOut &&
    planReceipts.every(Boolean);
  const after = (
    await control.query(
      "SELECT current_setting('jit') AS jit,pg_jit_available() AS compiler_available",
    )
  ).rows[0];
  assert.equal(after.jit, environment.jit);
  save("summary.json", {
    head,
    baseline,
    probe,
    plansComplete: complete,
    serverDefaultAfter: after,
    qualification:
      "Exact populated C1 original test result and 30s timeout are retained, including failure. The independent C1 SQL probe is diagnostic only. All 27 Time cases, 18 affected Production cases, whole native CI and downstream gates remain pending on the final candidate.",
    testName,
  });
  console.log(
    JSON.stringify({
      directory,
      head,
      baseline,
      probe,
      plansComplete: complete,
      compilerAvailable: environment.compiler_available,
    }),
  );
  process.exitCode =
    baseline.code === 0 && !baseline.timedOut && complete ? 0 : 1;
} catch (error) {
  save("diagnostic-error.json", {
    message: scrub(error.message),
    stack: scrub(error.stack ?? ""),
  });
  console.error(scrub(error.message));
  process.exitCode = 1;
} finally {
  await control.end();
  const manifest = readdirSync(directory).map((path) => {
    const bytes = readFileSync(join(directory, path));
    return { path, bytes: bytes.length, sha256: hash(bytes) };
  });
  save("manifest.json", manifest);
}
