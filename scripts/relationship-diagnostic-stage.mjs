import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  EvidenceLimit,
  EvidenceStore,
} from "./relationship-diagnostic-evidence.mjs";
export const scrub = (value) =>
  value.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[database URL redacted]");
function requireOwnedControl(control) {
  if (typeof control?.queryWithin !== "function")
    throw new Error("A cancellable owned diagnostic control is required");
}
export function readEvents(directory, stage, allowIncompleteTail = false) {
  try {
    const text = readFileSync(join(directory, `${stage}-events.jsonl`), "utf8");
    const lines = text.split("\n");
    // A killed writer can leave only its final write incomplete. Its SQL has
    // not run yet; earlier observed CREATE records still drive owned cleanup.
    if (allowIncompleteTail && !text.endsWith("\n")) lines.pop();
    return lines.filter(Boolean).map(JSON.parse);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
export async function cleanOwned(
  control,
  applicationName,
  directory,
  stage,
  deadline,
) {
  requireOwnedControl(control);
  if (!/^memlia-relationship-diag-[a-f0-9-]{36}$/.test(applicationName))
    throw new Error("Invalid owned application identity");
  const remaining = () => {
    const ms = Math.floor(deadline - performance.now());
    if (ms <= 0) throw new Error("Owned cleanup exceeded the stage deadline");
    return ms;
  };
  const query = (text, values = []) => {
    remaining();
    return control.queryWithin({ text, values }, deadline);
  };
  const schemas = [
    ...new Set(
      readEvents(directory, stage, true).flatMap((e) =>
        e.ownedSchema ? [e.ownedSchema] : [],
      ),
    ),
  ];
  if (schemas.length > 16)
    throw new Error("Owned schema receipt bound exceeded");
  for (const schema of schemas) {
    if (!/^(test_|diag_relationship_)[a-f0-9]{32}$/.test(schema))
      throw new Error("Invalid owned schema");
  }
  const namespaces = (
    await query(
      "SELECT oid::text,nspname FROM pg_namespace WHERE nspname=ANY($1::text[])",
      [schemas],
    )
  ).rows;
  const live = () =>
    query(
      "SELECT pid,backend_start::text FROM pg_stat_activity WHERE application_name=$1 AND datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid() LIMIT 33",
      [applicationName],
    );
  const observed = (await live()).rows;
  if (observed.length > 32)
    throw new Error("Owned backend receipt bound exceeded");
  const terminated = [];
  for (const backend of observed) {
    const result = await query(
      "SELECT pid,backend_start::text,pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE application_name=$1 AND datname=current_database() AND pid=$2 AND backend_start=$3::timestamptz AND pid<>pg_backend_pid()",
      [applicationName, backend.pid, backend.backend_start],
    );
    terminated.push(...result.rows);
  }
  // pg_terminate_backend acknowledges signal delivery, not completion. LLVM
  // compilation can defer its handling while the backend still owns locks.
  // Wait within this stage's original deadline before attempting any DROP.
  while (true) {
    const pending = (await live()).rows;
    if (!pending.length) break;
    if (
      pending.some(
        (b) =>
          !observed.some(
            (o) => o.pid === b.pid && o.backend_start === b.backend_start,
          ),
      )
    )
      throw new Error("Owned backend identity changed during cleanup");
    await delay(Math.min(25, remaining()));
  }
  for (const namespace of namespaces) {
    const current = (
      await query("SELECT oid::text FROM pg_namespace WHERE nspname=$1", [
        namespace.nspname,
      ])
    ).rows[0];
    if (!current) continue;
    if (current.oid !== namespace.oid)
      throw new Error("Owned schema identity changed during cleanup");
    await query(`DROP SCHEMA IF EXISTS ${namespace.nspname} CASCADE`);
  }
  return { terminated, schemas, backendsAcknowledged: true };
}
export async function runStage({
  directory,
  stage,
  args,
  env,
  control,
  applicationName,
  boundMs,
  killGraceMs = 10000,
}) {
  requireOwnedControl(control);
  const store = new EvidenceStore(directory, stage),
    startedAt = new Date().toISOString(),
    started = performance.now();
  let limited = false,
    timedOut = false,
    killTimer,
    monitorPromise = null,
    stopping = false,
    closed = false;
  const child = spawn(process.execPath, args, {
    env: { ...env, RELATIONSHIP_DIAGNOSTIC_STAGE: stage },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const signal = (name) => {
    try {
      process.kill(-child.pid, name);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const stop = () => {
    if (stopping || closed || !child.pid) return;
    stopping = true;
    signal("SIGTERM");
    killTimer = setTimeout(
      () => signal("SIGKILL"),
      Math.max(0, Math.min(killGraceMs, started + boundMs - performance.now())),
    );
  };
  const limit = (error) => {
    if (!(error instanceof EvidenceLimit))
      store.failureReceipt(scrub(String(error)));
    limited = true;
    stop();
  };
  const streams = {};
  for (const name of ["stdout", "stderr"]) {
    const state = (streams[name] = {
      bytes: 0,
      incomplete: "",
      decoder: new StringDecoder("utf8"),
    });
    child[name].on("data", (data) => {
      if (limited) return;
      try {
        state.bytes += data.length;
        if (state.bytes > store.limits.streamBytes)
          store.fail("stream-bytes", {
            stream: name,
            maximum: store.limits.streamBytes,
          });
        state.incomplete += state.decoder.write(data);
        let end;
        while ((end = state.incomplete.indexOf("\n")) >= 0) {
          const line = state.incomplete.slice(0, end + 1);
          if (Buffer.byteLength(line) > store.limits.lineBytes)
            store.fail("line-bytes", {
              stream: name,
              maximum: store.limits.lineBytes,
            });
          store.append(`${stage}.log`, scrub(line));
          state.incomplete = state.incomplete.slice(end + 1);
        }
        if (Buffer.byteLength(state.incomplete) > store.limits.lineBytes)
          store.fail("incomplete-line", {
            stream: name,
            maximum: store.limits.lineBytes,
          });
      } catch (error) {
        state.incomplete = "";
        limit(error);
      }
    });
  }
  const watchdog = setTimeout(() => {
    timedOut = true;
    if (!closed && child.pid) signal("SIGKILL");
  }, boundMs);
  const limitWatch = setInterval(() => {
    if (store.limitsReached()) {
      limited = true;
      stop();
    }
  }, 25);
  const monitor = setInterval(() => {
    if (monitorPromise || limited) return;
    monitorPromise = (async () => {
      try {
        const remainingMs = Math.floor(started + boundMs - performance.now());
        if (remainingMs <= 0) return;
        const result = await control.queryWithin(
          {
            text: "SELECT pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers,extract(epoch FROM clock_timestamp()-query_start)*1000 AS query_ms,query FROM pg_stat_activity WHERE application_name=$1",
            values: [applicationName],
          },
          started + boundMs,
        );
        const rows = result.rows.map(({ query, ...row }) => ({
          ...row,
          sqlSha256: createHash("sha256").update(query).digest("hex"),
        }));
        store.append(
          `${stage}-activity.jsonl`,
          store.json({ at: new Date().toISOString(), rows }),
        );
      } catch (error) {
        if (error instanceof EvidenceLimit) limit(error);
        else
          try {
            store.append(
              `${stage}-activity.jsonl`,
              store.json({ error: scrub(error.message) }),
            );
          } catch (writeError) {
            limit(writeError);
          }
      }
    })().finally(() => {
      monitorPromise = null;
    });
  }, 1000);
  let status, cleanup;
  try {
    status = await new Promise((done, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => {
        closed = true;
        done({ code, signal });
      });
    });
  } finally {
    clearInterval(limitWatch);
    clearInterval(monitor);
    clearTimeout(killTimer);
    if (monitorPromise) await monitorPromise;
    limited ||= store.limitsReached();
    if (!limited)
      for (const state of Object.values(streams)) {
        try {
          const tail = state.incomplete + state.decoder.end();
          if (tail) store.append(`${stage}.log`, scrub(tail));
        } catch (error) {
          limit(error);
        }
      }
    // Emergency receipt writes use reserved space even when normal evidence is full.
    try {
      cleanup = await cleanOwned(
        control,
        applicationName,
        directory,
        stage,
        started + boundMs,
      );
    } catch (error) {
      cleanup = { error: scrub(error.message).slice(0, 1000) };
    }
    clearTimeout(watchdog);
    store.stageReceipt({
      startedAt,
      elapsedMs: performance.now() - started,
      boundMs,
      timedOut,
      limited,
      ...status,
      cleanup,
    });
  }
  const receipt = JSON.parse(
    readFileSync(join(directory, `${stage}-result.json`), "utf8"),
  );
  if (limited) throw new EvidenceLimit("stage-stopped");
  if (cleanup.error)
    throw new Error("Owned cleanup failed; inspect reserved receipt");
  return receipt;
}
