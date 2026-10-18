import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { createHash } from "node:crypto";
import {
  EvidenceLimit,
  EvidenceStore,
} from "./relationship-diagnostic-evidence.mjs";
export const scrub = (value) =>
  value.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[database URL redacted]");
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
export async function cleanOwned(control, applicationName, directory, stage) {
  const terminated = await control.query(
    "SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE application_name=$1 AND pid<>pg_backend_pid()",
    [applicationName],
  );
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
    if (!/^(test_|diag_relationship_)[a-z0-9]+$/.test(schema))
      throw new Error("Invalid owned schema");
    await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  return { terminated: terminated.rows.slice(0, 32), schemas };
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
    killTimer = setTimeout(() => signal("SIGKILL"), killGraceMs);
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
    stop();
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
        const result = await control.query(
          "SELECT pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers,extract(epoch FROM clock_timestamp()-query_start)*1000 AS query_ms,query FROM pg_stat_activity WHERE application_name=$1",
          [applicationName],
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
    clearTimeout(watchdog);
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
      cleanup = await cleanOwned(control, applicationName, directory, stage);
    } catch (error) {
      cleanup = { error: scrub(error.message).slice(0, 1000) };
    }
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
