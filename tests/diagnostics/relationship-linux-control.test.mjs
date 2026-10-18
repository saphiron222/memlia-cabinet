import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtempSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { createDiagnosticControl } from "../../scripts/relationship-diagnostic-control.mjs";
import { EvidenceStore } from "../../scripts/relationship-diagnostic-evidence.mjs";
import {
  cleanOwned,
  runStage,
} from "../../scripts/relationship-diagnostic-stage.mjs";

const applicationName =
  "memlia-relationship-diag-00000000-0000-4000-8000-000000000000";
const createControl = createDiagnosticControl;

async function silentEndpoint() {
  const sockets = new Set();
  let accepted = 0;
  const server = net.createServer((socket) => {
    accepted++;
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.resume();
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return {
    sockets,
    accepted: () => accepted,
    config: {
      host: "127.0.0.1",
      port: server.address().port,
      user: "fictitious",
      database: "fictitious",
      password: "fictitious",
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((done) => server.close(done));
    },
  };
}

async function disconnected(endpoint) {
  for (let i = 0; i < 20 && endpoint.sockets.size; i++) await delay(5);
  assert.equal(endpoint.sockets.size, 0, "owned TCP transports are closed");
}

test("cold control startup consumes the cleanup deadline and closes its TCP transport", async () => {
  const endpoint = await silentEndpoint();
  const control = createControl(endpoint.config);
  try {
    const started = performance.now();
    await assert.rejects(
      cleanOwned(
        control,
        applicationName,
        "/nonexistent-task6-fix5-control-witness",
        "synthetic1",
        started + 200,
      ),
    );
    const elapsedMs = performance.now() - started;
    assert(elapsedMs < 600, `200ms budget used ${elapsedMs}ms`);
    await disconnected(endpoint);
    assert.equal(endpoint.accepted(), 1);
    console.log(
      JSON.stringify({
        witness: "simulated silent TCP startup, real pg client",
        boundMs: 200,
        elapsedMs,
        accepted: endpoint.accepted(),
        openSockets: endpoint.sockets.size,
      }),
    );
  } finally {
    await control.end();
    await endpoint.close();
  }
});

test("cold monitor acquisition and final cleanup share the stage deadline", async () => {
  const endpoint = await silentEndpoint();
  const control = createControl(endpoint.config);
  const directory = mkdtempSync(resolve("var/task6/control-monitor-"));
  EvidenceStore.create(directory);
  try {
    await assert.rejects(
      runStage({
        directory,
        stage: "synthetic1",
        args: ["-e", "setTimeout(() => {}, 1010)"],
        env: process.env,
        control,
        applicationName,
        boundMs: 1100,
      }),
      /Owned cleanup failed/,
    );
    const receipt = JSON.parse(
      readFileSync(join(directory, "synthetic1-result.json")),
    );
    assert(receipt.elapsedMs < 1500, JSON.stringify(receipt));
    assert.match(receipt.cleanup.error, /deadline/);
    await disconnected(endpoint);
    assert.equal(endpoint.accepted(), 1, "no post-deadline cleanup connection");
    console.log(
      JSON.stringify({
        witness: "simulated silent monitor startup",
        directory,
        receipt,
        openSockets: endpoint.sockets.size,
      }),
    );
  } finally {
    await control.end();
    await endpoint.close();
  }
});

test("expired and overlapping controls start no queued or late connection", async () => {
  const endpoint = await silentEndpoint();
  const control = createControl(endpoint.config);
  try {
    await assert.rejects(
      control.queryWithin("SELECT 1", performance.now() - 1),
      /deadline/,
    );
    assert.equal(endpoint.accepted(), 0);
    const first = control.queryWithin("SELECT 1", performance.now() + 150);
    const firstResult = assert.rejects(first, /deadline|timeout/);
    await assert.rejects(
      control.queryWithin("SELECT 2", performance.now() + 5000),
      /already in use/,
    );
    await firstResult;
    await disconnected(endpoint);
    await delay(200);
    assert.equal(endpoint.accepted(), 1, "rejected work is never queued");
    await control.end();
    await assert.rejects(control.queryWithin("SELECT 3"), /closed/);
    assert.equal(endpoint.accepted(), 1);
  } finally {
    await control.end();
    await endpoint.close();
  }
});

test("the five second control cap includes startup even with a longer stage deadline", async () => {
  const endpoint = await silentEndpoint();
  const control = createControl(endpoint.config);
  try {
    const started = performance.now();
    await assert.rejects(
      control.queryWithin("SELECT 1", started + 90000),
      /deadline|timeout/,
    );
    const elapsedMs = performance.now() - started;
    assert(elapsedMs >= 4900 && elapsedMs < 5500, `${elapsedMs}ms`);
    await disconnected(endpoint);
    assert.equal(endpoint.accepted(), 1);
    console.log(
      JSON.stringify({
        witness: "simulated startup, original 5s control cap",
        stageBudgetMs: 90000,
        controlBudgetMs: 5000,
        elapsedMs,
        openSockets: endpoint.sockets.size,
      }),
    );
  } finally {
    await control.end();
    await endpoint.close();
  }
});

test("explicit control shutdown closes pending startup before returning", async () => {
  const endpoint = await silentEndpoint();
  const control = createControl(endpoint.config);
  try {
    const pending = assert.rejects(control.queryWithin("SELECT 1"), /closed/);
    for (let i = 0; i < 20 && !endpoint.accepted(); i++) await delay(5);
    assert.equal(endpoint.accepted(), 1);
    const started = performance.now();
    await control.end();
    await pending;
    assert(performance.now() - started < 200);
    await disconnected(endpoint);
    await assert.rejects(control.queryWithin("SELECT 2"), /closed/);
  } finally {
    await control.end();
    await endpoint.close();
  }
});

// A deliberately small protocol fixture: these are simulated startup/results,
// not PostgreSQL/LLVM receipts. The driver, TCP socket and cancellation are real.
const message = (type, body) => {
  const header = Buffer.alloc(5);
  header.write(type);
  header.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([header, body]);
};
const ready = Buffer.concat([
  message("R", Buffer.alloc(4)),
  message("Z", Buffer.from("I")),
]);

for (const phase of ["late-startup", "close"]) {
  test(`owned transport closes during ${phase} without deferred SQL`, async () => {
    const sockets = new Set();
    const timers = new Set();
    let queries = 0,
      startupSent = false;
    const server = net.createServer(
      { allowHalfOpen: phase === "close" },
      (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        socket.on("error", () => {});
        let startup = true,
          buffered = Buffer.alloc(0);
        socket.on("data", (data) => {
          buffered = Buffer.concat([buffered, data]);
          if (startup) {
            if (buffered.length < 4 || buffered.length < buffered.readInt32BE())
              return;
            buffered = buffered.subarray(buffered.readInt32BE());
            startup = false;
            if (phase === "late-startup") {
              const timer = setTimeout(() => {
                startupSent = socket.write(ready);
                timers.delete(timer);
              }, 250);
              timers.add(timer);
            } else socket.write(ready);
          }
          while (
            buffered.length >= 5 &&
            buffered.length >= buffered.readInt32BE(1) + 1
          ) {
            if (buffered[0] === "Q".charCodeAt(0)) {
              queries++;
              socket.write(
                Buffer.concat([
                  message("C", Buffer.from("SELECT 0\0")),
                  message("Z", Buffer.from("I")),
                ]),
              );
            }
            buffered = buffered.subarray(buffered.readInt32BE(1) + 1);
          }
        });
      },
    );
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const control = createControl({
      host: "127.0.0.1",
      port: server.address().port,
      user: "fictitious",
      database: "fictitious",
      password: "fictitious",
    });
    try {
      const started = performance.now();
      await assert.rejects(
        control.queryWithin("SELECT 1", started + 150),
        /deadline|timeout/,
      );
      const elapsedMs = performance.now() - started;
      assert(elapsedMs < 500, `${phase}: ${elapsedMs}ms`);
      await delay(200);
      assert.equal(queries, phase === "close" ? 1 : 0);
      if (phase === "late-startup") {
        assert.equal(
          startupSent,
          false,
          "late ready cannot revive a closed client",
        );
        assert.equal(sockets.size, 0);
      }
      console.log(
        JSON.stringify({
          witness: `simulated ${phase}`,
          boundMs: 150,
          elapsedMs,
          queries,
          startupSent,
        }),
      );
    } finally {
      await control.end();
      for (const timer of timers) clearTimeout(timer);
      for (const socket of sockets) socket.destroy();
      await new Promise((done) => server.close(done));
    }
  });
}

const nativeUri = new URL(process.env.DATABASE_URL);
assert(["localhost", "127.0.0.1", "[::1]"].includes(nativeUri.hostname));

async function nativeRelay({
  startupDelayMs = 0,
  silentAfter = Infinity,
} = {}) {
  const sockets = new Set(),
    timers = new Set();
  let accepted = 0;
  const server = net.createServer((front) => {
    sockets.add(front);
    front.on("error", () => {});
    front.on("close", () => sockets.delete(front));
    if (++accepted > silentAfter) return front.resume();
    const back = net.connect({
      host: nativeUri.hostname,
      port: Number(nativeUri.port || 5432),
    });
    sockets.add(back);
    back.on("error", () => front.destroy());
    back.on("close", () => {
      sockets.delete(back);
      front.destroy();
    });
    front.on("close", () => back.destroy());
    front.pipe(back);
    if (startupDelayMs) {
      back.pause();
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!front.destroyed) back.pipe(front);
      }, startupDelayMs);
      timers.add(timer);
    } else back.pipe(front);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const url = new URL(nativeUri);
  url.hostname = "127.0.0.1";
  url.port = String(server.address().port);
  return {
    sockets,
    accepted: () => accepted,
    config: { connectionString: url.toString() },
    async close() {
      for (const timer of timers) clearTimeout(timer);
      for (const socket of sockets) socket.destroy();
      await new Promise((done) => server.close(done));
    },
  };
}

test("a successful native control followed by blocked reconnect consumes only the remainder", async () => {
  const relay = await nativeRelay({ silentAfter: 1 });
  const control = createControl(relay.config);
  try {
    assert.equal((await control.queryWithin("SELECT 7 ok")).rows[0].ok, 7);
    await disconnected(relay);
    const started = performance.now();
    await assert.rejects(
      control.queryWithin("SELECT 8 ok", started + 200),
      /deadline|timeout/,
    );
    assert(performance.now() - started < 600);
    await disconnected(relay);
    assert.equal(relay.accepted(), 2);
    await delay(200);
    assert.equal(relay.accepted(), 2);
  } finally {
    await control.end();
    await relay.close();
  }
});

test("native query allowance is recalculated after delayed acquisition", async () => {
  const relay = await nativeRelay({ startupDelayMs: 200 });
  const control = createControl(relay.config);
  try {
    const started = performance.now();
    await assert.rejects(
      control.queryWithin("SELECT pg_sleep(0.2)", started + 300),
      /deadline|timeout/,
    );
    const elapsedMs = performance.now() - started;
    assert(elapsedMs >= 250 && elapsedMs < 500, `${elapsedMs}ms`);
    await disconnected(relay);
    assert.equal(relay.accepted(), 1);
    console.log(
      JSON.stringify({
        witness:
          "real PostgreSQL through a loopback relay delaying acquisition 200ms",
        boundMs: 300,
        elapsedMs,
        openSockets: relay.sockets.size,
      }),
    );
  } finally {
    await control.end();
    await relay.close();
  }
});

test("a held foreign Pool borrower is neither queued behind nor cancelled by diagnostic controls", async () => {
  const pool = new Pool({
    connectionString: nativeUri.toString(),
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  const options = { ...pool.options };
  const borrower = await pool.connect();
  const control = createControl({ connectionString: nativeUri.toString() });
  let otherQuery;
  try {
    const pid = (await borrower.query("SELECT pg_backend_pid() pid")).rows[0]
      .pid;
    otherQuery = borrower.query("SELECT pg_sleep(0.5), 9 ok");
    await assert.rejects(
      cleanOwned(
        pool,
        applicationName,
        "/nonexistent-task6-fix5-held-pool",
        "synthetic1",
        performance.now() + 100,
      ),
      /cancellable owned diagnostic control/,
    );
    const live = (
      await control.queryWithin({
        text: "SELECT state,wait_event FROM pg_stat_activity WHERE pid=$1",
        values: [pid],
      })
    ).rows[0];
    assert.equal(live.state, "active");
    await assert.rejects(
      control.queryWithin("SELECT pg_sleep(1)", performance.now() + 100),
      /deadline|timeout/,
    );
    assert.equal(pool.totalCount, 1);
    assert.equal(pool.waitingCount, 0);
    assert.equal(pool.ending, false);
    assert.deepEqual(pool.options, options);
    assert.equal((await otherQuery).rows[0].ok, 9);
    assert.equal(
      (await borrower.query("SELECT pg_backend_pid() pid")).rows[0].pid,
      pid,
    );
    assert.equal((await control.queryWithin("SELECT 10 ok")).rows[0].ok, 10);
  } finally {
    if (otherQuery) await otherQuery;
    borrower.release();
    await control.end();
    await pool.end();
  }
});
