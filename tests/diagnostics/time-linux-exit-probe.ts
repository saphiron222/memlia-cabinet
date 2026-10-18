// Independent diagnostic replay of the populated C1 fixture, not a test gate.
// The original test runs separately with its unchanged assertions and 30s limit.
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import type { TimeEntity } from "@memlia/contracts";
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
installObserver(selected.targets);
const { createApplication } = await import("../../apps/server/src/app.js");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const schema = "diag_time_" + randomUUID().replaceAll("-", "");
const dataDirectory = await mkdtemp(
  join(tmpdir(), "memlia-time-exit-diagnostic-"),
);
const origin = "http://localhost:3000";
const period = { from: "2026-10-01", to: "2026-10-31" };
let app: Awaited<ReturnType<typeof createApplication>> | undefined;
let created = false;
try {
  const client = await pool.connect();
  try {
    const state = async () =>
      (
        await client.query(
          "SELECT current_setting('jit') AS jit, pg_backend_pid() AS backend, pg_jit_available() AS compiler_available",
        )
      ).rows[0];
    const before = await state(),
      resets = [];
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
  app = await phase("fixture.application", () =>
    createApplication({
      dataDirectory,
      publicOrigin: origin,
      allowEmbeddedDatabase: true,
      databaseUrl: url.toString(),
      clock: () => new Date("2026-10-17T10:00:00Z"),
    }),
  );
  let cookie = "";
  const request = (
    method: "GET" | "POST",
    path: string,
    payload?: Record<string, unknown>,
  ) =>
    phase(`${method} ${path}`, async () => {
      const response = await app!.inject({
        method,
        url: `/api/v1${path}`,
        headers: { origin, cookie },
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
  const setup = await phase("setup", () =>
    request("POST", "/setup", {
      email: "admin@example.test",
      name: "Admin fictif",
      password: "UnMotDePasseFictif123!",
    }),
  );
  assert.equal(setup.statusCode, 201, setup.body);
  cookie = String(setup.headers["set-cookie"]).split(";")[0]!;
  const admin = setup.json().user;
  const parent = (
    await request("POST", "/records", {
      operationId: randomUUID(),
      record: {
        kind: "dossier",
        title: "Dossier fictif",
        data: { siren: "001234567" },
      },
    })
  ).json();
  const t = (
    await request("POST", "/records", {
      operationId: randomUUID(),
      record: {
        kind: "tache",
        title: "Bilan fictif",
        dossierId: parent.id,
        data: {
          dueDate: "2026-10-31",
          checklist: [
            {
              id: randomUUID(),
              label: "Vérifier les pièces fictives",
              done: false,
            },
          ],
        },
      },
    })
  ).json();
  const role = (
    await request("POST", "/administration/roles", {
      operationId: randomUUID(),
      order: 0,
      name: "Comptabilité",
      permissions: [],
    })
  ).json();
  const save = async (
    data: Record<string, unknown>,
    old?: { id: string; version: number },
  ): Promise<TimeEntity> => {
    const response = await request("POST", "/time/entities", {
      id: old?.id ?? randomUUID(),
      expectedVersion: old?.version ?? 0,
      operationId: randomUUID(),
      data,
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  const all: TimeEntity[] = [];
  const nature = await save({
    kind: "nature",
    name: "Révision v1",
    active: true,
  });
  all.push(nature);
  all.push(await save({ ...nature.data, name: "Révision v2" }, nature));
  for (const data of [
    {
      kind: "rate",
      userId: null,
      ...period,
      hourlyAmount: "99.99",
      currency: "EUR",
    },
    {
      kind: "capacity",
      userId: admin.id,
      ...period,
      dailyMinutes: [420, 420, 420, 420, 420, 0, 0],
    },
    {
      kind: "plan",
      level: "occurrence",
      targetId: t.id,
      minutes: 45,
      component: "variable",
    },
    {
      kind: "forfait",
      dossierId: parent.id,
      roleId: role.id,
      ...period,
      activityStart: "2026-10-10",
      monthlyMinutes: 310,
      amount: "100.00",
      currency: "EUR",
      prorating: "calendar_days",
      policyVersion: 1,
    },
    {
      kind: "assignment",
      dossierId: parent.id,
      roleId: role.id,
      userId: admin.id,
      ...period,
      weight: 2,
      policyVersion: 1,
    },
    {
      kind: "allocation",
      target: { kind: "record", id: t.id },
      ...period,
      weights: [{ userId: admin.id, weight: 1 }],
      policyVersion: 1,
    },
    {
      kind: "period",
      from: "2026-09-01",
      to: "2026-09-30",
      closed: true,
      reason: "Période antérieure clôturée",
    },
  ])
    all.push(await save(data));
  const modelResponse = await request("POST", "/production/models", {
    operationId: randomUUID(),
    id: randomUUID(),
    expectedVersion: 0,
    model: {
      kind: "process",
      name: "Lien Production",
      target: "dossier",
      columns: [],
    },
  });
  assert.equal(modelResponse.statusCode, 200, modelResponse.body);
  const model = modelResponse.json();
  const productionResponse = await request(
    "POST",
    `/production/models/${model.id}/rows`,
    {
      operationId: randomUUID(),
      expectedVersion: 1,
      target: { kind: "dossier", id: parent.id, label: parent.title },
      period: "2026",
    },
  );
  assert.equal(productionResponse.statusCode, 200, productionResponse.body);
  const prod = productionResponse.json();
  for (const link of [
    { kind: "free", label: "Interne" },
    { kind: "record", id: t.id },
    { kind: "production", id: prod.id },
  ])
    all.push(
      await save({
        kind: "entry",
        userId: admin.id,
        date: "2026-10-17",
        natureId: nature.id,
        link,
        seconds: 1234,
        source: "manual",
        timerId: null,
        rate: null,
      }),
    );
  const timer = await request("POST", "/time/timers/start", {
    operationId: randomUUID(),
    date: "2026-10-17",
    natureId: nature.id,
    link: { kind: "record", id: t.id },
  });
  assert.equal(timer.statusCode, 200, timer.body);
  all.push(timer.json());
  // Identical bounded polling policy to the original helper: 250 x 20ms.
  const awaitJob = async (path: string) =>
    phase(`awaitJob ${path}`, async () => {
      let response;
      for (let i = 0; i < 250; i++) {
        response = await request("GET", path);
        if (
          response.statusCode !== 200 ||
          ["completed", "failed"].includes(response.json().job?.state)
        )
          return response;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error("Job incomplete: " + response?.body);
    });
  const csv = await request("POST", "/time/exports", {
    operationId: randomUUID(),
    query: { ...period, dossierId: parent.id },
  });
  assert.equal(csv.statusCode, 202, csv.body);
  assert.equal(
    (await awaitJob("/time/exports/" + csv.json().id)).json().job.state,
    "completed",
  );
  const csvText = await request(
    "GET",
    `/time/exports/${csv.json().id}/parts/1`,
  );
  assert.equal(csvText.statusCode, 200, csvText.body);
  const result = await phase("completeExit", async () => {
    const response = await request("POST", "/administration/exports", {
      operationId: randomUUID(),
    });
    assert.equal(response.statusCode, 202, response.body);
    const status = await awaitJob(
      "/administration/exports/" + response.json().id,
    );
    assert.equal(status.json().job.state, "completed", status.body);
    const manifest = await request(
      "GET",
      `/administration/exports/${response.json().id}/download`,
    );
    assert.equal(manifest.statusCode, 200, manifest.body);
    const time = [];
    for (const part of manifest.json().parts) {
      const response = await request(
        "GET",
        part.downloadUrl.replace("/api/v1", ""),
      );
      assert.equal(response.statusCode, 200, response.body);
      time.push(...response.json().time);
    }
    return { id: response.json().id, time };
  });
  const latest = new Map(all.map((entry) => [entry.id, entry]));
  const byId = (a: { id: string }, b: { id: string }) =>
    a.id.localeCompare(b.id);
  const byVersion = (a: TimeEntity, b: TimeEntity) =>
    byId(a, b) || a.version - b.version;
  assert.deepEqual(
    result.time
      .filter((entry) => entry.entity === "current")
      .map((entry) => entry.data)
      .sort(byId),
    [...latest.values()].sort(byId),
  );
  assert.deepEqual(
    result.time
      .filter((entry) => entry.entity === "history")
      .map((entry) => entry.data)
      .sort(byVersion),
    all.sort(byVersion),
  );
  const meta = result.time.find((entry) => entry.entity === "csv");
  assert.ok(meta);
  assert.equal(meta.data.actorId, admin.id);
  assert.equal(meta.data.jobId, csv.json().id);
  assert.equal(meta.data.query.from, period.from);
  assert.equal(meta.data.query.to, period.to);
  assert.equal(meta.data.query.dossierId, parent.id);
  const rows = result.time.filter((entry) => entry.entity === "csv_row");
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.data.exportId, meta.data.id);
    assert.equal(row.data.part, 1);
    assert.deepEqual(row.data.entry, latest.get(row.data.entry.id));
    assert.ok(csvText.body.includes(row.data.entry.id));
    assert.equal(row.data.entry.data.rate.hourlyAmount, "99.99");
    assert.equal(row.data.entry.data.rate.version, 1);
  }
  assert.equal(
    result.time.find(
      (entry) =>
        entry.entity === "current" && entry.data.id === timer.json().id,
    )?.data.data.stoppedAt,
    null,
  );
  assert.equal(
    probeWasMeasured(),
    true,
    "Selected C1 baseline query occurrence was never reached",
  );
  event("probe.complete", {
    assertions:
      "populated C1 HTTP sequence and exact current/history/timer/configuration/links/CSV assertions; independent diagnostic only",
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
