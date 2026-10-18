import { afterEach, expect, test } from "vitest";
import { fixture, dossier, task, operationId } from "./helpers.js";

let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
  f = undefined!;
});

async function save(data: Record<string, unknown>) {
  const r = await f.request("POST", "/time/entities", {
    id: operationId(),
    expectedVersion: 0,
    operationId: operationId(),
    data,
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}

test("Time retains migrated Production history through archived, confidential and missing old targets", async () => {
  f = await fixture();
  const admin = await f.setup();
  let old = (
    await f.request("POST", "/records", dossier("Ancienne cible"))
  ).json();
  const current = (
    await f.request("POST", "/records", dossier("Cible actuelle"))
  ).json();
  const model = (
    await f.request("POST", "/production/models", {
      operationId: operationId(),
      id: operationId(),
      expectedVersion: 0,
      model: {
        kind: "process",
        name: "Migration historique",
        target: "dossier",
      },
    })
  ).json();
  const created = await f.request(
    "POST",
    `/production/models/${model.id}/rows`,
    {
      operationId: operationId(),
      expectedVersion: model.version,
      target: { kind: "dossier", id: old.id, label: old.title },
      period: "once",
    },
  );
  expect(created.statusCode, created.body).toBe(200);
  const row = created.json();
  expect(row.recordId).toBeNull();
  const nature = await save({
    kind: "nature",
    name: "Migration",
    active: true,
  });
  const entry = await save({
    kind: "entry",
    userId: admin.id,
    date: "2026-10-17",
    natureId: nature.id,
    link: { kind: "production", id: row.id },
    seconds: 600,
    source: "manual",
    timerId: null,
    rate: null,
  });
  const migrated = await f.request(
    "POST",
    `/production/models/${model.id}/migrate-targets`,
    {
      operationId: operationId(),
      expectedVersion: model.version,
      target: "dossier",
      reason: "Changement fictif",
      mappings: [
        {
          rowId: row.id,
          expectedVersion: row.version,
          target: { kind: "dossier", id: current.id, label: current.title },
        },
      ],
    },
  );
  expect(migrated.statusCode, migrated.body).toBe(200);
  const reader = await f.request("POST", "/users", {
    operationId: operationId(),
    email: "scope-reader@example.test",
    name: "Lecteur fictif",
    password: "UnMotDePasseFictif123!",
    permissions: ["read", "time_read"].map((action) => ({
      action,
      kind: "*",
      dossierId: null,
    })),
  });
  expect(reader.statusCode, reader.body).toBe(201);
  const login = await f.request(
    "POST",
    "/login",
    { email: "scope-reader@example.test", password: "UnMotDePasseFictif123!" },
    "",
  );
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const check = async (visible: boolean) => {
    const canonical = await f.request(
      "GET",
      `/production/models/${model.id}/rows`,
      undefined,
      cookie,
    );
    expect(canonical.statusCode, canonical.body).toBe(200);
    expect(canonical.json().items.map((r: { id: string }) => r.id)).toEqual(
      visible ? [row.id] : [],
    );
    const history = await f.request(
      "GET",
      `/time/${entry.id}/history`,
      undefined,
      cookie,
    );
    expect(history.statusCode, history.body).toBe(visible ? 200 : 404);
    const report = await f.request(
      "GET",
      "/time/report?from=2026-10-01&to=2026-10-31",
      undefined,
      cookie,
    );
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json()).toMatchObject({
      total: visible ? 1 : 0,
      realizedSeconds: visible ? 600 : 0,
    });
    const targets = await f.request(
      "GET",
      "/time/targets?kind=production",
      undefined,
      cookie,
    );
    expect(targets.statusCode, targets.body).toBe(200);
    expect(targets.json().items.map((r: { id: string }) => r.id)).toEqual(
      visible ? [row.id] : [],
    );
  };
  const editOld = async (confidential: boolean) => {
    const result = await f.request("PUT", `/records/${old.id}`, {
      operationId: operationId(),
      expectedVersion: old.version,
      record: {
        kind: "dossier",
        title: old.title,
        confidential,
        data: { ...old.data, archived: true },
      },
    });
    expect(result.statusCode, result.body).toBe(200);
    old = result.json();
  };
  await check(true);
  await editOld(false);
  await check(true);
  await editOld(true);
  await check(false);
  await editOld(false);
  await check(true);
  // A missing historic target must deny access even while the current target
  // and every frozen synthetic scope remain public and present.
  await f.maintainDatabase((db) =>
    db.transaction(async (tx) => {
      await tx.query(
        "UPDATE cabinet_production_row_versions SET content=jsonb_set(content,'{target,id}',to_jsonb($2::text)) WHERE id=$1 AND version=1",
        [row.id, operationId()],
      );
    }),
  );
  await check(false);
});

test("Time record references preserve null-parent access and deny a missing parent without losing exact empty counts", async () => {
  f = await fixture();
  await f.setup();
  const parent = (await f.request("POST", "/records", dossier())).json();
  const linked = (await f.request("POST", "/records", task(parent.id))).json();
  const input = task(parent.id);
  const independent = (
    await f.request("POST", "/records", {
      ...input,
      record: { ...input.record, dossierId: null },
    })
  ).json();
  const plans = [];
  for (const record of [linked, independent])
    plans.push(
      await save({
        kind: "plan",
        level: "occurrence",
        targetId: record.id,
        minutes: 30,
        component: "variable",
      }),
    );
  const before = await f.request("GET", "/time/entities?kind=plan");
  expect(before.statusCode, before.body).toBe(200);
  expect(before.json()).toMatchObject({ total: 2, hasMore: false });
  await f.maintainDatabase((db) =>
    db.transaction(async (tx) => {
      await tx.query(
        "UPDATE cabinet_records SET content=jsonb_set(content,'{dossierId}',to_jsonb($2::text)) WHERE id=$1",
        [linked.id, operationId()],
      );
    }),
  );
  const page = await f.request("GET", "/time/entities?kind=plan");
  expect(page.statusCode, page.body).toBe(200);
  expect(page.json()).toMatchObject({ total: 1, hasMore: false });
  expect(page.json().items.map((p: { id: string }) => p.id)).toEqual([
    plans[1].id,
  ]);
  const tail = await f.request("GET", "/time/entities?kind=plan&offset=1");
  expect(tail.statusCode, tail.body).toBe(200);
  expect(tail.json()).toEqual({
    items: [],
    total: 1,
    offset: 1,
    hasMore: false,
  });
  expect(
    (await f.request("GET", `/time/${plans[0].id}/history`)).statusCode,
  ).toBe(404);
  expect(
    (await f.request("GET", `/time/${plans[1].id}/history`)).statusCode,
  ).toBe(200);
});
