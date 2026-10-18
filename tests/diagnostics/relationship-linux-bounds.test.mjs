import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import {
  EvidenceStore,
  EvidenceLimit,
} from "../../scripts/relationship-diagnostic-evidence.mjs";
import { runStage } from "../../scripts/relationship-diagnostic-stage.mjs";
const root = resolve(
  process.env.RELATIONSHIP_BOUNDS_TEST_DIRECTORY ??
    `var/task6/bounds-${Date.now()}`,
);
mkdirSync(root, { recursive: true, mode: 0o700 });
const uri = new URL(process.env.DATABASE_URL);
assert(["localhost", "127.0.0.1", "[::1]"].includes(uri.hostname));
const moduleUrl = pathToFileURL(
  resolve("scripts/relationship-diagnostic-evidence.mjs"),
).href;
const reporterUrl = pathToFileURL(
  resolve("tests/diagnostics/relationship-linux-reporter.mjs"),
).href;
const control = new Pool({
  connectionString: uri.toString(),
  max: 1,
  query_timeout: 5000,
});
const otherName = "diag-unrelated-" + randomUUID(),
  otherUri = new URL(uri);
otherUri.searchParams.set("application_name", otherName);
const unrelated = new Client({ connectionString: otherUri.toString() });
const sentinel = "diag_relationship_" + randomUUID().replaceAll("-", "");
let serial = 0;
async function exercise(
  label,
  { overrides = {}, source, expected, prepare, args, monitorRows } = {},
) {
  const stage = "synthetic" + ++serial,
    directory = join(root, stage);
  mkdirSync(directory, { mode: 0o700 });
  const store = EvidenceStore.create(directory, overrides),
    stageStore = new EvidenceStore(directory, stage);
  const applicationName = "memlia-relationship-diag-" + randomUUID(),
    ownedUri = new URL(uri);
  ownedUri.searchParams.set("application_name", applicationName);
  const owned = new Client({ connectionString: ownedUri.toString() });
  owned.on("error", () => {});
  await owned.connect();
  const schema = "test_" + randomUUID().replaceAll("-", "");
  stageStore.append(
    `${stage}-events.jsonl`,
    JSON.stringify({ ownedSchema: schema }) + "\n",
  );
  await owned.query(`CREATE SCHEMA ${schema}`);
  if (prepare) prepare(store);
  const childSource = `import {EvidenceStore} from ${JSON.stringify(moduleUrl)};const store=new EvidenceStore(process.env.RELATIONSHIP_DIAGNOSTIC_DIRECTORY,process.env.RELATIONSHIP_DIAGNOSTIC_STAGE,'observer');${source ?? ""}`;
  const observedControl = monitorRows
    ? {
        query: (sql, params) =>
          (typeof sql === "string" ? sql : sql.text).startsWith(
            "SELECT pid,state",
          )
            ? Promise.resolve({ rows: monitorRows })
            : control.query(sql, params),
      }
    : control;
  let failure;
  try {
    await runStage({
      directory,
      stage,
      args: args?.(directory) ?? ["--input-type=module", "-e", childSource],
      env: { ...process.env, RELATIONSHIP_DIAGNOSTIC_DIRECTORY: directory },
      control: observedControl,
      applicationName,
      boundMs: 5000,
      killGraceMs: 100,
    });
  } catch (error) {
    failure = error;
  }
  await owned.end();
  const result = JSON.parse(
    readFileSync(join(directory, `${stage}-result.json`)),
  );
  const receipts = readdirSync(directory)
    .filter((n) => n.startsWith("limit-"))
    .map((n) => JSON.parse(readFileSync(join(directory, n))));
  if (expected) {
    assert(failure instanceof EvidenceLimit);
    assert.equal(result.limited, true);
    assert(
      receipts.some((r) => r.reason === expected),
      JSON.stringify(receipts),
    );
  } else {
    assert.equal(failure, undefined);
    assert.equal(result.code, 0);
  }
  for (const name of readdirSync(directory).filter((n) =>
    n.startsWith("limit-"),
  ))
    assert(statSync(join(directory, name)).size <= 4096);
  assert(statSync(join(directory, `${stage}-result.json`)).size <= 16384);
  if (
    ["unterminated", "stream", "file", "monitor", "concurrent"].includes(label)
  )
    assert(["SIGTERM", "SIGKILL"].includes(result.signal));
  assert.equal(result.timedOut, false);
  assert.deepEqual(result.cleanup.schemas, [schema]);
  assert(result.cleanup.terminated.some((x) => x.terminated === true));
  assert.equal(
    (
      await control.query(
        "SELECT count(*)::int n FROM pg_namespace WHERE nspname=$1",
        [schema],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await control.query(
        "SELECT count(*)::int n FROM pg_namespace WHERE nspname=$1",
        [sentinel],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await control.query(
        "SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=$1",
        [otherName],
      )
    ).rows[0].n,
    1,
  );
  assert.equal((await unrelated.query("SELECT 1 ok")).rows[0].ok, 1);
  assert(store.retainedBytes() <= store.limits.totalBytes);
  const ledger = JSON.parse(
    readFileSync(join(directory, ".evidence-ledger.json")),
  );
  assert(ledger.bytes <= store.limits.totalBytes - store.limits.reserveBytes);
  const resultSummary = {
    label,
    stage,
    expected: expected ?? "success",
    retainedBytes: store.retainedBytes(),
    totalBound: store.limits.totalBytes,
    ledgerBytes: ledger.bytes,
    receipt: result,
    limits: receipts,
    unrelatedPreserved: true,
  };
  writeFileSync(
    join(root, stage + "-verification.json"),
    JSON.stringify(resultSummary, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      label,
      retainedBytes: resultSummary.retainedBytes,
      limit: expected ?? null,
      ownedCleaned: true,
      unrelatedPreserved: true,
    }),
  );
  return { directory, stage };
}
test("bounded diagnostic writers stop only their stage and preserve owned cleanup receipts", async (t) => {
  await unrelated.connect();
  await unrelated.query(`CREATE SCHEMA ${sentinel}`);
  try {
    await t.test("unterminated output", () =>
      exercise("unterminated", {
        overrides: { lineBytes: 4096 },
        source:
          'process.stdout.write("x".repeat(2*1024*1024));setInterval(()=>{},1000);',
        expected: "incomplete-line",
      }),
    );
    await t.test("newline output stream total", () =>
      exercise("stream", {
        overrides: { streamBytes: 16384, fileBytes: 65536 },
        source:
          'process.stderr.write("x\\n".repeat(1024*1024));setInterval(()=>{},1000);',
        expected: "stream-bytes",
      }),
    );
    await t.test("newline output file total", () =>
      exercise("file", {
        overrides: { fileBytes: 8192 },
        source:
          'process.stdout.write("x\\n".repeat(1024*1024));setInterval(()=>{},1000);',
        expected: "file-bytes",
      }),
    );
    await t.test("cross-process aggregate including parent saves", () =>
      exercise("aggregate", {
        overrides: { totalBytes: 1048576 + 65536 },
        prepare: (s) => s.save("analysis.json", { http: "x".repeat(30000) }),
        source:
          'store.save("observer-plan.json",{plan:"x".repeat(20000)});store.save("observer-more.json",{plan:"x".repeat(20000)});',
        expected: "aggregate-bytes",
      }),
    );
    await t.test("observer artifact", () =>
      exercise("artifact", {
        overrides: { fileBytes: 8192 },
        source: 'store.save("observer-plan.json",{plan:"x".repeat(65536)});',
        expected: "json-artifact",
      }),
    );
    await t.test("actual custom reporter rejects oversized JSON", () =>
      exercise("reporter", {
        overrides: { fileBytes: 8192 },
        source: `const {default:Reporter}=await import(${JSON.stringify(reporterUrl)});new Reporter().onTestRunEnd([{task:{filepath:'fictitious',tasks:[{name:'fictitious',result:{state:'fail',errors:[{message:'x'.repeat(65536)}]}}]}}]);`,
        expected: "json-artifact",
      }),
    );
    await t.test("monitor writes share the budget", () =>
      exercise("monitor", {
        overrides: { fileBytes: 8192 },
        source: "setInterval(()=>{},1000);",
        monitorRows: [{ query: "SELECT 1", state: "x".repeat(65536) }],
        expected: "json-artifact",
      }),
    );
    await t.test("runner analysis bounded JSON", async () => {
      const directory = join(root, "parent");
      mkdirSync(directory);
      const store = EvidenceStore.create(directory, { fileBytes: 8192 });
      assert.throws(
        () => store.save("analysis.json", { http: "x".repeat(65536) }),
        EvidenceLimit,
      );
      store.failureReceipt("bounded synthetic parent failure");
      assert(store.retainedBytes() < store.limits.totalBytes);
      assert.equal(
        JSON.parse(readFileSync(join(directory, "limit-runner-runner.json")))
          .reason,
        "json-artifact",
      );
    });
    await t.test("concurrent writers cannot overbook aggregate", () =>
      exercise("concurrent", {
        overrides: { totalBytes: 1048576 + 65536 },
        source: `const {spawn}=await import('node:child_process');const code=${JSON.stringify(`import {EvidenceStore} from ${JSON.stringify(moduleUrl)};const s=new EvidenceStore(process.env.RELATIONSHIP_DIAGNOSTIC_DIRECTORY,process.env.RELATIONSHIP_DIAGNOSTIC_STAGE,'reporter');for(let i=0;i<8;i++)s.save(process.pid+'-'+i+'.json',{v:'x'.repeat(10000)});`)};for(let n=0;n<3;n++)spawn(process.execPath,['--input-type=module','-e',code],{env:process.env,stdio:'inherit'});setInterval(()=>{},1000);`,
        expected: "aggregate-bytes",
      }),
    );
    await t.test(
      "real Vitest custom reporter integration on a synthetic pass",
      async () => {
        const fixtureDir = join(root, "vitest");
        mkdirSync(fixtureDir);
        const fixture = join(fixtureDir, "one.test.ts"),
          config = join(fixtureDir, "config.mjs");
        writeFileSync(
          fixture,
          "import {test,expect} from 'vitest';test('synthetic reporter pass',()=>expect(1).toBe(1));",
        );
        writeFileSync(
          config,
          "export default " +
            JSON.stringify({
              test: {
                include: [fixture],
                fileParallelism: false,
                testTimeout: 1000,
              },
            }),
        );
        const r = await exercise("vitest", {
          args: () => [
            "node_modules/vitest/vitest.mjs",
            "run",
            "--config",
            config,
            "--reporter=./tests/diagnostics/relationship-linux-reporter.mjs",
          ],
        });
        const report = JSON.parse(
          readFileSync(join(r.directory, `${r.stage}-vitest.json`)),
        );
        assert.equal(report.numPassedTests, 1);
        assert.equal(report.numFailedTests, 0);
      },
    );
  } finally {
    await unrelated.query(`DROP SCHEMA IF EXISTS ${sentinel} CASCADE`);
    await unrelated.end();
    await control.end();
  }
});
