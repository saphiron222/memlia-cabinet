import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Client, Pool } from "pg";
import { EvidenceStore } from "../../scripts/relationship-diagnostic-evidence.mjs";
import { runStage } from "../../scripts/relationship-diagnostic-stage.mjs";
const uri = new URL(process.env.DATABASE_URL);
assert(["localhost", "127.0.0.1", "[::1]"].includes(uri.hostname));

for (const scenario of ["active", "delayed", "deadline", "monitor-deadline"]) {
  const monitored = scenario === "monitor-deadline",
    delayed = scenario === "delayed" || scenario === "deadline",
    expired = scenario === "deadline" || monitored;
  test(
    monitored
      ? "stage monitoring shares the original deadline with child and cleanup"
      : expired
        ? "owned cleanup reports its original deadline and retains the unfinished schema"
        : delayed
          ? "owned cleanup waits for delayed termination acknowledgement while an unrelated backend remains active"
          : "owned cleanup releases an active native query and its schema lock only",
    async () => {
      const directory = mkdtempSync(resolve("var/task6/cleanup-native-"));
      const stage = "synthetic1";
      EvidenceStore.create(directory);
      const evidence = new EvidenceStore(directory, stage);
      const applicationName = "memlia-relationship-diag-" + randomUUID();
      const schema = "test_" + randomUUID().replaceAll("-", "");
      const sentinel = "diag_relationship_" + randomUUID().replaceAll("-", "");
      const named = (name) => {
        const url = new URL(uri);
        url.searchParams.set("application_name", name);
        return new Client({ connectionString: url.toString() });
      };
      const owned = named(applicationName);
      const otherName = "diag-unrelated-" + randomUUID();
      const unrelated = named(otherName);
      const control = new Pool({
        connectionString: uri.toString(),
        max: 1,
        query_timeout: 5000,
        // Shortened only in this synthetic delayed-signal witness: old cleanup
        // attempts DROP while the real native reader still holds its lock.
        statement_timeout: delayed ? 100 : 5000,
      });
      owned.on("error", () => {});
      let signalPromise, ownedQuery, otherQuery, monitorTimeout, ownedBackend;
      try {
        await owned.connect();
        await unrelated.connect();
        await owned.query(`CREATE SCHEMA ${schema}`);
        await owned.query(`CREATE TABLE ${schema}.held(id integer)`);
        await owned.query(`INSERT INTO ${schema}.held VALUES(1)`);
        await unrelated.query(`CREATE SCHEMA ${sentinel}`);
        await unrelated.query(`CREATE TABLE ${sentinel}.held(id integer)`);
        await unrelated.query(`INSERT INTO ${sentinel}.held VALUES(1)`);
        evidence.append(
          `${stage}-events.jsonl`,
          JSON.stringify({ ownedSchema: schema }) + "\n",
        );
        ownedQuery = owned
          .query(`SELECT pg_sleep(30) FROM ${schema}.held`)
          .then(
            () => ({ completed: true }),
            (error) => ({ code: error.code }),
          );
        otherQuery = unrelated.query(
          `SELECT pg_sleep(2),id FROM ${sentinel}.held`,
        );
        for (let i = 0; i < 40; i++) {
          const active = await control.query(
            "SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=ANY($1::text[]) AND state='active' AND wait_event='PgSleep'",
            [[applicationName, otherName]],
          );
          if (active.rows[0].n === 2) break;
          await delay(10);
        }
        const activeBefore = await control.query(
          "SELECT pid,backend_start::text,application_name,state,wait_event FROM pg_stat_activity WHERE application_name=ANY($1::text[]) ORDER BY application_name",
          [[applicationName, otherName]],
        );
        assert.equal(activeBefore.rows.length, 2);
        assert(activeBefore.rows.every((row) => row.wait_event === "PgSleep"));
        ownedBackend = activeBefore.rows.find(
          (row) => row.application_name === applicationName,
        );
        const observedControl = {
          async query(input, params) {
            const sql = typeof input === "string" ? input : input.text;
            if (monitored && sql.startsWith("SELECT pid,state")) {
              monitorTimeout = input.query_timeout ?? 5000;
              // A real control query is still in flight when the child exits.
              // The stage must not add its full 5s allowance after the deadline.
              return control.query({
                text: "SELECT pg_sleep(5)",
                query_timeout: monitorTimeout,
              });
            }
            if (delayed && sql.includes("pg_terminate_backend")) {
              // A successful send is not an exit acknowledgement. Delay only
              // delivery of that signal; all locks, sessions and DROPs are PG.
              const targets = await control.query(
                "SELECT pid,backend_start::text FROM pg_stat_activity WHERE application_name=$1",
                [applicationName],
              );
              signalPromise = delay(250).then(() =>
                control.query(input, params),
              );
              return {
                rows: targets.rows.map((row) => ({ ...row, terminated: true })),
              };
            }
            return control.query(input, params);
          },
        };
        let failure;
        try {
          await runStage({
            directory,
            stage,
            args: ["-e", monitored ? "setTimeout(() => {}, 1050)" : ""],
            env: process.env,
            control: observedControl,
            applicationName,
            boundMs: monitored ? 1100 : expired ? 200 : 5000,
            killGraceMs: 100,
          });
        } catch (error) {
          failure = error;
        }
        const receipt = JSON.parse(
          readFileSync(join(directory, `${stage}-result.json`)),
        );
        if (expired) {
          assert.match(failure?.message ?? "", /Owned cleanup failed/);
          assert.match(
            receipt.cleanup.error ?? "",
            /deadline|Query read timeout/,
          );
          assert.equal(receipt.boundMs, monitored ? 1100 : 200);
          assert(receipt.elapsedMs < (monitored ? 1500 : 1000));
          if (monitored) assert(monitorTimeout <= 100);
          assert.equal(
            (
              await control.query(
                "SELECT to_regnamespace($1) IS NOT NULL present",
                [schema],
              )
            ).rows[0].present,
            true,
          );
          assert.equal(
            (
              await control.query(
                "SELECT state FROM pg_stat_activity WHERE application_name=$1",
                [otherName],
              )
            ).rows[0].state,
            "active",
          );
          return;
        }
        assert.equal(failure, undefined);
        assert.deepEqual(receipt.cleanup.schemas, [schema]);
        assert(receipt.cleanup.terminated.some((row) => row.terminated));
        assert.equal(receipt.cleanup.error, undefined);
        assert.equal(receipt.timedOut, false);
        assert(receipt.elapsedMs < 5000);
        assert.equal((await ownedQuery).code, "57P01");
        const liveOther = (
          await control.query(
            "SELECT state,wait_event FROM pg_stat_activity WHERE application_name=$1",
            [otherName],
          )
        ).rows;
        assert.deepEqual(liveOther, [
          { state: "active", wait_event: "PgSleep" },
        ]);
        assert.equal(
          (
            await control.query(
              "SELECT to_regnamespace($1) IS NOT NULL present",
              [schema],
            )
          ).rows[0].present,
          false,
        );
        assert.equal(
          (
            await control.query(
              "SELECT to_regnamespace($1) IS NOT NULL present",
              [sentinel],
            )
          ).rows[0].present,
          true,
        );
        assert.equal((await otherQuery).rows[0].id, 1);
        assert.equal((await unrelated.query("SELECT 1 ok")).rows[0].ok, 1);
        writeFileSync(
          join(directory, "native-verification.json"),
          JSON.stringify({
            delayedSignalSimulation: delayed,
            activeBefore: activeBefore.rows,
            otherStillActiveAtCleanup: liveOther,
            receipt,
          }),
          { mode: 0o600 },
        );
      } finally {
        if (signalPromise) await signalPromise;
        if (ownedBackend)
          await control.query(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name=$1 AND pid=$2 AND backend_start=$3::timestamptz",
            [applicationName, ownedBackend.pid, ownedBackend.backend_start],
          );
        await owned.end();
        if (ownedQuery) await ownedQuery;
        if (otherQuery) await otherQuery;
        await unrelated.query(`DROP SCHEMA IF EXISTS ${sentinel} CASCADE`);
        await unrelated.end();
        await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await control.end();
      }
    },
  );
}
