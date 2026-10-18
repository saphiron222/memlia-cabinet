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
  process.env.RELATIONSHIP_DIAGNOSTIC_DIRECTORY ?? "var/task6/linux-diagnostic",
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
const applicationName = "memlia-relationship-diag-" + randomUUID();
url.searchParams.set("application_name", applicationName);
const childEnv = {
  ...process.env,
  DATABASE_URL: url.toString(),
  RELATIONSHIP_DIAGNOSTIC_DIRECTORY: directory,
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
  ".github/workflows/relationship-linux-diagnostic.yml",
  "vitest.config.ts",
  "package-lock.json",
  "scripts/relationship-linux-diagnostic.mjs",
  "tests/diagnostics/relationship-linux.config.ts",
  "tests/diagnostics/relationship-linux.setup.ts",
  "tests/diagnostics/relationship-linux-observer.ts",
  "apps/server/test/helpers.ts",
  "apps/server/test/documents.test.ts",
  "apps/server/test/fiscal.test.ts",
  "apps/server/test/relationship.test.ts",
  "apps/server/src/documents/store.ts",
  "apps/server/src/records/query.ts",
  "apps/server/src/records/grants.ts",
  "apps/server/src/records/permissions.ts",
  "apps/server/src/production/document-scope.ts",
  "apps/server/src/relationship/document-scope.ts",
  "apps/server/src/relationship/service.ts",
  "apps/server/src/storage/database.ts",
  "apps/server/src/storage/migrations.ts",
  "apps/server/src/administration/export.ts",
  "apps/server/src/jobs/runner.ts",
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
    assert.match(schema, /^(test_|diag_relationship_)[a-z0-9]+$/);
    await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  return { terminated: terminated.rows, schemas };
}
async function run(stage, args, boundMs) {
  const startedAt = new Date().toISOString(),
    started = performance.now();
  const child = spawn(process.execPath, args, {
    env: { ...childEnv, RELATIONSHIP_DIAGNOSTIC_STAGE: stage },
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

const cases = [
  [
    "N1",
    "apps/server/test/documents.test.ts",
    "bounds SQL reads before pagination and searches large originals across authorized dossier scopes with a real index",
  ],
  [
    "N2",
    "apps/server/test/documents.test.ts",
    "backfills indexed search from schema two and keeps a shared extension outside disposable installation schemas",
  ],
  [
    "N3",
    "apps/server/test/fiscal.test.ts",
    "filtered TF original lot contains principal and every suite despite same filenames and reports newly missing originals",
  ],
  [
    "N4",
    "apps/server/test/fiscal.test.ts",
    "original streaming releases the database during backpressure, aborts revoked scope and permits retry after cancellation",
  ],
  [
    "N5",
    "apps/server/test/relationship.test.ts",
    "reverse Work proof owner withdraws current and historical LAB detail, history, reminders, exports and replay consistently with GED, then restores them",
  ],
  [
    "N6",
    "apps/server/test/fiscal.test.ts",
    "cabinet shutdown aborts a paused original download and preserves its durable selection for restart",
  ],
  [
    "N7",
    "apps/server/test/relationship.test.ts",
    "interoperable exit retains relationship models, versions, conversions and LAB evidence; prepared exit reauthorizes LAB rights",
  ],
];
try {
  const environment = (
    await control.query(
      "SELECT version() version,current_setting('server_version_num') server_version_num,current_setting('jit') jit,pg_jit_available() compiler_available,current_setting('jit_above_cost') jit_above_cost,current_setting('jit_inline_above_cost') jit_inline_above_cost,current_setting('jit_optimize_above_cost') jit_optimize_above_cost",
    )
  ).rows[0];
  assert.equal(Math.floor(Number(environment.server_version_num) / 10000), 17);
  assert.equal(environment.jit, "on");
  let container = null;
  if (!local) {
    assert.equal(
      environment.compiler_available,
      true,
      "Linux compiler must actually be available",
    );
    assert(process.env.POSTGRES_SERVICE_ID);
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
    };
  }
  save("environment.json", {
    at: new Date().toISOString(),
    head,
    mode: local
      ? "local harness validation, not Linux cause"
      : "Linux compilerTRUE diagnostic, not normal CI",
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
    cases,
    bounds: {
      processMs: 90000,
      originalTestMs: "N4 20000; N6 15000; others 30000 unchanged",
      selectedPlansPerCase: 1,
      queryEvents: 16384,
      eventBytes: 33554432,
      artifactBytes: 8388608,
    },
    settings:
      "No JIT or statement/test/lock timeout changes; EXPLAIN ANALYZE keeps server policy. Only control connection has 5s monitoring timeout.",
  });
  const receipts = [];
  for (const [id, file, name] of cases) {
    const command = (stage) => [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "tests/diagnostics/relationship-linux.config.ts",
      file,
      "-t",
      "^" + name + "$",
      "--reporter=verbose",
      "--reporter=json",
      `--outputFile.json=${join(directory, stage + "-vitest.json")}`,
    ];
    delete childEnv.RELATIONSHIP_DIAGNOSTIC_TARGET;
    const baseline = await run(
      id + "-baseline",
      command(id + "-baseline"),
      90000,
    );
    const events = readEvents(id + "-baseline");
    const reads = events
      .filter((e) => e.type === "sql.start" && e.eligible)
      .map((e) => {
        const end = events.find(
          (v) => ["sql.end", "sql.error"].includes(v.type) && v.id === e.id,
        );
        return { ...e, ms: end?.ms ?? null, outcome: end?.type ?? "pending" };
      })
      .sort((a, b) => (b.ms ?? Infinity) - (a.ms ?? Infinity));
    const selected = reads[0];
    save(id + "-analysis.json", {
      baseline,
      slowestPolicyReads: reads.slice(0, 20),
      http: events.filter((e) => e.type.startsWith("http.")),
      selected,
      selection:
        "Single greatest elapsed policy SELECT, pending first, exact SQL hash and occurrence replayed in original fictitious test. Fixed-order diagnostic, not p95.",
    });
    let probe = null;
    if (selected) {
      save(id + "-target.json", {
        hash: selected.hash,
        occurrence: selected.occurrence,
      });
      childEnv.RELATIONSHIP_DIAGNOSTIC_TARGET = join(
        directory,
        id + "-target.json",
      );
      probe = await run(id + "-probe", command(id + "-probe"), 90000);
    }
    const probeEvents = readEvents(id + "-probe");
    receipts.push({
      id,
      file,
      name,
      baseline,
      probe,
      planComplete: probeEvents.some((e) => e.type === "plan.end"),
    });
  }
  const after = (
    await control.query(
      "SELECT current_setting('jit') jit,pg_jit_available() compiler_available",
    )
  ).rows[0];
  assert.equal(after.jit, environment.jit);
  for (const source of sources)
    assert.equal(
      hash(readFileSync(source.path)),
      source.sha256,
      "Source changed during diagnostic",
    );
  save("summary.json", {
    head,
    receipts,
    after,
    qualification:
      "Original seven baseline results retained with original limits. Probe adds one EXPLAIN ANALYZE to the same unchanged test and can exceed its original deadline; its result is diagnostic only, never normal gate acceptance. No JIT comparison/off setting; no fixture/cardinality changes. Exact ordinary Linux CI and scoped review remain required.",
  });
  console.log(
    JSON.stringify({
      directory,
      head,
      compilerAvailable: environment.compiler_available,
      receipts,
    }),
  );
  process.exitCode = receipts.every((r) => r.planComplete) ? 0 : 1;
} catch (error) {
  save("diagnostic-error.json", {
    message: scrub(error.message),
    stack: scrub(error.stack ?? ""),
  });
  console.error(scrub(error.message));
  process.exitCode = 1;
} finally {
  await control.end();
}
