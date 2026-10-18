// Independent measurement, not a Vitest acceptance test. Mirrors only the first
// existing review I2 case, with unchanged HTTP commands and fictitious values.
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import {
  artifact,
  event,
  phase,
  installObserver,
  probeWasMeasured,
  errorDetails,
} from "./time-linux-observer.js";

const selected = JSON.parse(
  await readFile(
    join(process.env.TIME_DIAGNOSTIC_DIRECTORY!, "target.json"),
    "utf8",
  ),
);
installObserver(selected);
const { createApplication } = await import("../../apps/server/src/app.js");
const { openDatabase } =
  await import("../../apps/server/src/storage/database.js");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const schema = "diag_time_" + randomUUID().replaceAll("-", "");
const dataDirectory = await mkdtemp(join(tmpdir(), "memlia-time-diagnostic-"));
const origin = "http://localhost:3000";
const credentials = {
  email: "admin@example.test",
  name: "Admin fictif",
  password: "UnMotDePasseFictif123!",
};
let app: Awaited<ReturnType<typeof createApplication>> | undefined;
let created = false;
try {
  // Explicitly exercise COMMIT, ROLLBACK and reuse on the same physical client.
  const client = await pool.connect();
  try {
    const state = async () =>
      (
        await client.query(
          "SELECT current_setting('jit') AS jit, pg_backend_pid() AS backend, pg_jit_available() AS compiler_available",
        )
      ).rows[0];
    const before = await state();
    const resets = [];
    for (const end of ["COMMIT", "ROLLBACK"]) {
      await client.query("BEGIN");
      await client.query("SET LOCAL jit = off");
      const inside = await state();
      await client.query(end);
      const after = await state();
      assert.equal(inside.jit, "off");
      assert.deepEqual(after, before);
      resets.push({ end, inside, after });
    }
    artifact("transaction-reset", { before, resets });
  } finally {
    client.release();
  }
  await phase("fixture.schema", async () => {
    await pool.query(`CREATE SCHEMA ${schema}`);
    created = true;
  });
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("options", `-csearch_path=${schema}`);
  const options = {
    dataDirectory,
    publicOrigin: origin,
    allowEmbeddedDatabase: true,
    databaseUrl: url.toString(),
  };
  app = await phase("fixture.application", () => createApplication(options));
  let cookie = "";
  const request = async (
    method: "GET" | "POST",
    path: string,
    payload?: Record<string, unknown>,
    token = cookie,
  ) =>
    phase(`${method} ${path}`, async () => {
      const response = await app!.inject({
        method,
        url: `/api/v1${path}`,
        headers: { origin, cookie: token },
        payload,
      });
      event("http.result", {
        method,
        path,
        status: response.statusCode,
        ...(response.statusCode >= 400 ? { errorBody: response.body } : {}),
      });
      return response;
    });
  const setup = await request("POST", "/setup", credentials);
  assert.equal(setup.statusCode, 201);
  cookie = String(setup.headers["set-cookie"]).split(";")[0]!;
  const admin = setup.json().user;
  const save = async (data: Record<string, unknown>) => {
    const r = await request("POST", "/time/entities", {
      id: randomUUID(),
      expectedVersion: 0,
      operationId: randomUUID(),
      data,
    });
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  const nature = await save({ kind: "nature", name: "Révision", active: true });
  const entry = await save({
    kind: "entry",
    userId: admin.id,
    date: "2026-10-17",
    natureId: nature.id,
    link: { kind: "free", label: "Contrôle" },
    seconds: 3600,
    source: "manual",
    timerId: null,
    rate: null,
  });
  const email = randomUUID() + "@example.test";
  const person = await request("POST", "/users", {
    operationId: randomUUID(),
    email,
    name: "Collègue fictif",
    password: credentials.password,
    permissions: ["read", "time_read"].map((action) => ({
      action,
      kind: "*",
      dossierId: null,
    })),
  });
  assert.equal(person.statusCode, 201, person.body);
  const login = await request(
    "POST",
    "/login",
    { email, password: credentials.password },
    "",
  );
  assert.equal(login.statusCode, 200, login.body);
  const reader = {
    ...person.json(),
    cookie: String(login.headers["set-cookie"]).split(";")[0]!,
  };
  const command = {
    id: entry.id,
    expectedVersion: entry.version,
    operationId: randomUUID(),
    data: { ...entry.data, userId: reader.id, seconds: 60 },
  };
  assert.equal(
    (await request("POST", "/time/entities", command, reader.cookie))
      .statusCode,
    403,
  );
  const own = await save({ ...entry.data, userId: reader.id });
  const transfer = {
    id: own.id,
    expectedVersion: own.version,
    operationId: randomUUID(),
    data: { ...own.data, userId: admin.id },
  };
  assert.equal(
    (await request("POST", "/time/entities", transfer)).statusCode,
    200,
  );
  await phase("maintenance", async () => {
    await app!.close();
    app = undefined;
    const db = await openDatabase(options);
    try {
      await db.transaction(async (tx) => {
        await tx.query(
          "UPDATE cabinet_users SET permissions=(SELECT jsonb_agg(p) FROM jsonb_array_elements(permissions) p WHERE NOT (p->>'action'=ANY($2::text[]))) WHERE id=$1",
          [admin.id, ["time_manage"]],
        );
      });
    } finally {
      await db.close();
      app = await createApplication(options);
    }
  });
  assert.equal(
    (await request("POST", "/time/entities", transfer)).statusCode,
    403,
  );
  assert.equal(
    probeWasMeasured(),
    true,
    "Selected baseline query was never reached",
  );
  event("probe.complete", {
    assertions: "first review I2 command sequence only; not an acceptance gate",
  });
} catch (error) {
  event("probe.error", { error: errorDetails(error) });
  process.exitCode = 1;
} finally {
  await phase("cleanup", async () => {
    await app?.close();
    if (created) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
    await rm(dataDirectory, { recursive: true, force: true });
  });
}
