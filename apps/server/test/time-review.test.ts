import { afterEach, expect, test } from "vitest";
import { fixture, dossier, task, operationId } from "./helpers.js";
let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
  f = undefined!;
});
const period = { from: "2026-10-01", to: "2026-10-31" };
async function save(
  data: Record<string, unknown>,
  old?: { id: string; version: number },
) {
  const r = await f.request("POST", "/time/entities", {
    id: old?.id ?? operationId(),
    expectedVersion: old?.version ?? 0,
    operationId: operationId(),
    data,
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
async function person(permissions: unknown[] = []) {
  const email = operationId() + "@example.test";
  const r = await f.request("POST", "/users", {
    operationId: operationId(),
    email,
    name: "Collègue fictif",
    password: "UnMotDePasseFictif123!",
    permissions,
  });
  expect(r.statusCode, r.body).toBe(201);
  const login = await f.request(
    "POST",
    "/login",
    { email, password: "UnMotDePasseFictif123!" },
    "",
  );
  return {
    ...r.json(),
    cookie: String(login.headers["set-cookie"]).split(";")[0]!,
  };
}
async function revoke(id: string, actions: string[]) {
  await f.maintainDatabase((db) =>
    db.transaction(async (tx) => {
      await tx.query(
        "UPDATE cabinet_users SET permissions=(SELECT jsonb_agg(p) FROM jsonb_array_elements(permissions) p WHERE NOT (p->>'action'=ANY($2::text[]))) WHERE id=$1",
        [id, actions],
      );
    }),
  );
}
test("review I2 reader cannot take another author's entry, including replay after management revocation", async () => {
  f = await fixture();
  const admin = await f.setup();
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
  const reader = await person(
    ["read", "time_read"].map((action) => ({
      action,
      kind: "*",
      dossierId: null,
    })),
  );
  const command = {
    id: entry.id,
    expectedVersion: entry.version,
    operationId: operationId(),
    data: { ...entry.data, userId: reader.id, seconds: 60 },
  };
  expect(
    (await f.request("POST", "/time/entities", command, reader.cookie))
      .statusCode,
  ).toBe(403);
  const own = await save({ ...entry.data, userId: reader.id });
  const transfer = {
    id: own.id,
    expectedVersion: own.version,
    operationId: operationId(),
    data: { ...own.data, userId: admin.id },
  };
  expect((await f.request("POST", "/time/entities", transfer)).statusCode).toBe(
    200,
  );
  await revoke(admin.id, ["time_manage"]);
  expect((await f.request("POST", "/time/entities", transfer)).statusCode).toBe(
    403,
  );
});
test("review I8 an overdue timer can be abandoned with an audited reason, then restarted and its period closed", async () => {
  let now = new Date("2026-10-01T10:00:00Z");
  f = await fixture(() => now);
  await f.setup();
  const nature = await save({ kind: "nature", name: "Révision", active: true });
  const timer = (
    await f.request("POST", "/time/timers/start", {
      operationId: operationId(),
      date: "2026-10-01",
      natureId: nature.id,
      link: { kind: "free", label: "Oubli" },
    })
  ).json();
  now = new Date("2026-10-10T10:00:00Z");
  // Renew the session after the clock jump; exercise timer lifetime, not login expiry.
  const login = await f.request(
    "POST",
    "/login",
    { email: "admin@example.test", password: "UnMotDePasseFictif123!" },
    "",
  );
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const request = f.request.bind(f);
  f.request = (method, path, payload, token = cookie) =>
    request(method, path, payload, token);
  expect(
    (
      await f.request("POST", `/time/timers/${timer.id}/stop`, {
        operationId: operationId(),
        expectedVersion: 1,
      })
    ).statusCode,
  ).toBe(409);
  const command = {
    operationId: operationId(),
    expectedVersion: 1,
    reason: "Chronomètre oublié pendant une absence",
  };
  const cancelled = await f.request(
    "POST",
    `/time/timers/${timer.id}/abandon`,
    command,
  );
  expect(cancelled.statusCode, cancelled.body).toBe(200);
  expect(cancelled.json().data).toMatchObject({
    entryId: null,
    abandonReason: command.reason,
    stoppedAt: now.toISOString(),
  });
  expect(
    (
      await f.request("POST", `/time/timers/${timer.id}/abandon`, command)
    ).json(),
  ).toEqual(cancelled.json());
  expect(
    (
      await f.request("GET", "/time/report?from=2026-10-01&to=2026-10-09")
    ).json().total,
  ).toBe(0);
  await save({
    kind: "period",
    from: "2026-10-01",
    to: "2026-10-09",
    closed: true,
    reason: "Sans temps à valider",
  });
  expect(
    (
      await f.request("POST", "/time/timers/start", {
        operationId: operationId(),
        date: "2026-10-10",
        natureId: nature.id,
        link: { kind: "free", label: "Reprise" },
      })
    ).statusCode,
  ).toBe(200);
  const history = (await f.request("GET", `/time/${timer.id}/history`)).json();
  expect(history.items).toHaveLength(2);
});
test("review I3 I9 inactive contributors remain visible and unknown plans leave individual capacity undecided", async () => {
  f = await fixture();
  const admin = await f.setup();
  const u = await person();
  const parent = (await f.request("POST", "/records", dossier())).json();
  const input = task(parent.id);
  Object.assign(input.record.data, { assigneeIds: [u.id] });
  const t = (await f.request("POST", "/records", input)).json();
  const nature = await save({ kind: "nature", name: "Révision", active: true });
  await save({
    kind: "entry",
    userId: u.id,
    date: "2026-10-17",
    natureId: nature.id,
    link: { kind: "record", id: t.id },
    seconds: 1234,
    source: "manual",
    timerId: null,
    rate: null,
  });
  await save({
    kind: "capacity",
    userId: null,
    ...period,
    dailyMinutes: [420, 420, 420, 420, 420, 0, 0],
  });
  const allocation = await save({
    kind: "allocation",
    target: { kind: "record", id: t.id },
    ...period,
    weights: [{ userId: u.id, weight: 1 }],
    policyVersion: 1,
  });
  const inputMove = {
    allocationId: allocation.id,
    expectedVersion: 1,
    ...period,
    weights: [{ userId: admin.id, weight: 1 }],
  };
  const preview = await f.request(
    "POST",
    "/time/reassignment/preview",
    inputMove,
  );
  expect(preview.statusCode, preview.body).toBe(200);
  const moved = await f.request("POST", "/time/reassignment/commit", {
    ...inputMove,
    sourceVersions: preview.json().sourceVersions,
    operationId: operationId(),
  });
  expect(moved.statusCode, moved.body).toBe(200);
  await f.maintainDatabase((db) =>
    db.transaction(async (tx) => {
      await tx.query("UPDATE cabinet_users SET active=false WHERE id=$1", [
        u.id,
      ]);
    }),
  );
  const response = await f.request(
    "GET",
    "/time/workload?from=2026-10-01&to=2026-10-31",
  );
  expect(response.statusCode, response.body).toBe(200);
  const p = response.json().people.find((p: { id: string }) => p.id === u.id);
  expect(p).toMatchObject({
    active: false,
    plannedMinutes: 0,
    unknownPlans: 0,
    overloadMinutes: 0,
    realizedSeconds: 1234,
  });
  expect(
    response.json().people.find((p: { id: string }) => p.id === admin.id),
  ).toMatchObject({
    unknownPlans: 1,
    plannedMinutes: 0,
    overloadMinutes: null,
  });
  const csv = await f.request("POST", "/time/exports", {
    operationId: operationId(),
    query: { ...period, userId: u.id },
  });
  expect(csv.statusCode, csv.body).toBe(202);
  expect(
    (await awaitJob("/time/exports/" + csv.json().id)).json().job.state,
  ).toBe("completed");
  const text = await f.request("GET", `/time/exports/${csv.json().id}/parts/1`);
  expect(text.statusCode, text.body).toBe(200);
  expect(text.body).toContain(u.id);
  expect(text.body).toContain("1234");
  expect(
    (
      await f.request(
        "GET",
        "/time/report?from=2026-10-01&to=2026-10-31&userId=" + u.id,
      )
    ).json().realizedSeconds,
  ).toBe(1234);
});
test.each(["assign", "update"])(
  "review I7 replay rechecks revoked %s permission without writing again",
  async (action) => {
    f = await fixture();
    const admin = await f.setup();
    const parent = (await f.request("POST", "/records", dossier())).json();
    const t = (await f.request("POST", "/records", task(parent.id))).json();
    const u = await person();
    const a = await save({
      kind: "allocation",
      target: { kind: "record", id: t.id },
      ...period,
      weights: [{ userId: admin.id, weight: 1 }],
      policyVersion: 1,
    });
    const input = {
      allocationId: a.id,
      expectedVersion: a.version,
      ...period,
      weights: [{ userId: u.id, weight: 1 }],
    };
    const preview = await f.request(
      "POST",
      "/time/reassignment/preview",
      input,
    );
    expect(preview.statusCode, preview.body).toBe(200);
    const command = {
      ...input,
      sourceVersions: preview.json().sourceVersions,
      operationId: operationId(),
    };
    expect(
      (await f.request("POST", "/time/reassignment/commit", command))
        .statusCode,
    ).toBe(200);
    await revoke(admin.id, [action]);
    expect(
      (await f.request("POST", "/time/reassignment/commit", command))
        .statusCode,
    ).toBe(404);
    expect(
      (await f.request("GET", `/time/${a.id}/history`)).json().items,
    ).toHaveLength(2);
  },
);
async function model(model: unknown) {
  const r = await f.request("POST", "/production/models", {
    operationId: operationId(),
    id: operationId(),
    expectedVersion: 0,
    model,
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
async function productionRow(
  m: { id: string },
  parent: { id: string; title: string },
) {
  const r = await f.request("POST", `/production/models/${m.id}/rows`, {
    operationId: operationId(),
    expectedVersion: 1,
    target: { kind: "dossier", id: parent.id, label: parent.title },
    period: "2026",
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
async function awaitJob(path: string) {
  let r;
  for (let i = 0; i < 250; i++) {
    r = await f.request("GET", path);
    if (
      r.statusCode !== 200 ||
      ["completed", "failed"].includes(r.json().job?.state)
    )
      return r;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw Error("Job incomplete: " + r?.body);
}
async function completeExit() {
  const r = await f.request("POST", "/administration/exports", {
    operationId: operationId(),
  });
  expect(r.statusCode, r.body).toBe(202);
  const status = await awaitJob("/administration/exports/" + r.json().id);
  expect(status.json().job.state, status.body).toBe("completed");
  const manifest = await f.request(
    "GET",
    `/administration/exports/${r.json().id}/download`,
  );
  expect(manifest.statusCode, manifest.body).toBe(200);
  const time = [];
  for (const p of manifest.json().parts) {
    const part = await f.request("GET", p.downloadUrl.replace("/api/v1", ""));
    expect(part.statusCode, part.body).toBe(200);
    time.push(...part.json().time);
  }
  return { id: r.json().id, time };
}
test.each(["document", "snapshot"])(
  "review I1 synthetic %s privacy matches canonical Production for process and followup across Time outputs",
  async (kind) => {
    f = await fixture();
    const admin = await f.setup();
    let parent = (await f.request("POST", "/records", dossier())).json();
    if (kind === "snapshot") {
      const r = await f.request("PUT", "/records/" + parent.id, {
        operationId: operationId(),
        expectedVersion: parent.version,
        record: {
          kind: "dossier",
          title: parent.title,
          data: parent.data,
          confidential: true,
        },
      });
      expect(r.statusCode, r.body).toBe(200);
      parent = r.json();
    }
    const nature = await save({
      kind: "nature",
      name: "Confidentiel",
      active: true,
    });
    const entries = [];
    for (const type of ["process", "followup"]) {
      const column = operationId();
      const m = await model({
        kind: type,
        name: "Secret " + type,
        target: "dossier",
        columns: [
          {
            id: column,
            name: "Étape",
            type: "boolean",
            plannedDate: "2026-10-17",
            plannedMinutes: 60,
            assigneeId: admin.id,
          },
        ],
      });
      const row = await productionRow(m, parent);
      expect(row.recordId).toBeNull();
      if (kind === "document") {
        const meta = {
          operationId: operationId(),
          dossierId: parent.id,
          filename: "confidentiel.txt",
          mediaType: "text/plain",
          confidential: true,
          source: { kind: "manual", reference: "Fictif", version: "1" },
        };
        const upload = await f.app.inject({
          method: "POST",
          url: "/api/v1/documents",
          headers: {
            origin: "http://localhost:3000",
            cookie: f.cookie,
            "content-type": "multipart/form-data; boundary=piece",
          },
          payload: Buffer.from(
            `--piece\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(meta)}\r\n--piece\r\nContent-Disposition: form-data; name="file"; filename="confidentiel.txt"\r\nContent-Type: text/plain\r\n\r\nFictif\r\n--piece--\r\n`,
          ),
        });
        expect(upload.statusCode, upload.body).toBe(201);
        const changed = await f.request(
          "POST",
          `/production/rows/${row.id}/commands`,
          {
            operationId: operationId(),
            expectedVersion: 1,
            command: {
              kind: "cell",
              columnId: column,
              period: "once",
              value: false,
              documentIds: [upload.json().id],
            },
          },
        );
        expect(changed.statusCode, changed.body).toBe(200);
      }
      const command = {
        id: operationId(),
        expectedVersion: 0,
        operationId: operationId(),
        data: {
          kind: "entry",
          userId: admin.id,
          date: "2026-10-17",
          natureId: nature.id,
          link: { kind: "production", id: row.id },
          seconds: 600,
          source: "manual",
          timerId: null,
          rate: null,
        },
      };
      const entry = await f.request("POST", "/time/entities", command);
      expect(entry.statusCode, entry.body).toBe(200);
      entries.push({ row, entry: entry.json(), command, m });
    }
    if (kind === "snapshot")
      expect(
        (
          await f.request("PUT", "/records/" + parent.id, {
            operationId: operationId(),
            expectedVersion: parent.version,
            record: {
              kind: "dossier",
              title: parent.title,
              data: parent.data,
              confidential: false,
            },
          })
        ).statusCode,
      ).toBe(200);
    await revoke(admin.id, ["confidential"]);
    for (const { row, entry, command, m } of entries) {
      expect(
        (await f.request("GET", `/production/models/${m.id}/rows`)).json()
          .items,
      ).toEqual([]);
      expect(
        (await f.request("GET", `/time/${entry.id}/history`)).statusCode,
      ).toBe(404);
      expect(
        (await f.request("POST", "/time/entities", command)).statusCode,
      ).toBe(404);
      expect(
        (await f.request("GET", "/time/targets?kind=production")).body,
      ).not.toContain(row.id);
    }
    const report = await f.request(
      "GET",
      "/time/report?from=2026-10-01&to=2026-10-31",
    );
    expect(report.json()).toMatchObject({ total: 0, realizedSeconds: 0 });
    const w = await f.request(
      "GET",
      "/time/workload?from=2026-10-01&to=2026-10-31",
    );
    expect(w.statusCode, w.body).toBe(200);
    expect(w.json().rows).toEqual([]);
    const exported = await completeExit();
    expect(
      exported.time.filter((e: any) => e.data.data?.kind === "entry"),
    ).toEqual([]);
  },
);
test("review C1 complete exit reauthorizes prepared CSV filter identities on preparation and restitution", async () => {
  f = await fixture();
  const admin = await f.setup();
  const other = await person();
  const csv = await f.request("POST", "/time/exports", {
    operationId: operationId(),
    query: { ...period, userId: other.id },
  });
  expect(csv.statusCode, csv.body).toBe(202);
  expect(
    (await awaitJob("/time/exports/" + csv.json().id)).json().job.state,
  ).toBe("completed");
  const command = { operationId: operationId() };
  const started = await f.request("POST", "/administration/exports", command);
  expect(started.statusCode, started.body).toBe(202);
  expect(
    (await awaitJob("/administration/exports/" + started.json().id)).json().job
      .state,
  ).toBe("completed");
  const first = await completeExit();
  expect(
    first.time.find((e: any) => e.entity === "csv")?.data.query.userId,
  ).toBe(other.id);
  await revoke(admin.id, ["time_read"]);
  expect(
    (await f.request("GET", `/administration/exports/${first.id}/download`))
      .statusCode,
  ).toBe(404);
  expect(
    (await f.request("POST", "/administration/exports", command)).statusCode,
  ).toBe(404);
  const second = await f.request("POST", "/administration/exports", {
    operationId: operationId(),
  });
  expect(second.statusCode, second.body).toBe(202);
  const state = await awaitJob("/administration/exports/" + second.json().id);
  expect(state.json().job.state, state.body).toBe("failed");
  expect(
    (
      await f.request(
        "GET",
        `/administration/exports/${second.json().id}/download`,
      )
    ).body,
  ).not.toContain(other.id);
});
test("review I6 frozen stage dates holders roles and monthly periods survive progression without duplicating actual time", async () => {
  f = await fixture();
  const admin = await f.setup();
  const u = await person();
  const parent = (await f.request("POST", "/records", dossier())).json();
  const role = (
    await f.request("POST", "/administration/roles", {
      operationId: operationId(),
      order: 0,
      name: "Réviseur",
      permissions: [],
    })
  ).json();
  await f.maintainDatabase((db) =>
    db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO cabinet_user_roles(user_id,role_id) VALUES($1,$2)",
        [admin.id, role.id],
      );
    }),
  );
  const columns = [
    {
      id: operationId(),
      name: "Octobre",
      type: "boolean",
      plannedDate: "2026-10-10",
      plannedMinutes: 60,
      assigneeId: admin.id,
      requiredRoleId: role.id,
    },
    {
      id: operationId(),
      name: "Novembre",
      type: "boolean",
      plannedDate: "2026-11-10",
      plannedMinutes: 120,
      assigneeId: u.id,
    },
  ];
  const m = await model({
    kind: "balance",
    year: 2026,
    family: "BIC",
    name: "Deux étapes",
    target: "dossier",
    columns,
  });
  let row = await productionRow(m, parent);
  await save({
    kind: "plan",
    level: "dossier",
    targetId: parent.id,
    minutes: 999,
    component: "variable",
  });
  const nature = await save({ kind: "nature", name: "Révision", active: true });
  await save({
    kind: "entry",
    userId: admin.id,
    date: "2026-10-17",
    natureId: nature.id,
    link: { kind: "production", id: row.id },
    seconds: 1234,
    source: "manual",
    timerId: null,
    rate: null,
  });
  async function check() {
    for (const [month, minutes, userId, roleId] of [
      ["10", 60, admin.id, role.id],
      ["11", 120, u.id, null],
    ]) {
      const w = await f.request(
        "GET",
        `/time/workload?from=2026-${month}-01&to=2026-${month}-${month === "10" ? "31" : "30"}`,
      );
      expect(w.statusCode, w.body).toBe(200);
      const rows = w.json().rows.filter((r: any) => r.target?.id === row.id);
      expect(
        rows.reduce((sum: number, r: any) => sum + (r.plannedMinutes ?? 0), 0),
      ).toBe(minutes);
      expect(rows.find((r: any) => r.plannedMinutes === minutes)).toMatchObject(
        { userId, roleId, from: `2026-${month}-10` },
      );
      expect(rows.reduce((s: number, r: any) => s + r.realizedSeconds, 0)).toBe(
        month === "10" ? 1234 : 0,
      );
    }
  }
  await check();
  for (const c of columns) {
    const r = await f.request("POST", `/production/rows/${row.id}/commands`, {
      operationId: operationId(),
      expectedVersion: row.version,
      command: { kind: "cell", columnId: c.id, period: "once", value: true },
    });
    expect(r.statusCode, r.body).toBe(200);
    row = r.json();
    expect(row.dueDate).toBe(c === columns[0] ? "2026-11-10" : null);
    await check();
  }
  const follow = await model({
    kind: "followup",
    name: "Récurrent",
    target: "dossier",
    columns: [
      {
        id: operationId(),
        name: "Mensuel",
        type: "boolean",
        frequency: "monthly",
        plannedDate: "2026-01-15",
        plannedMinutes: 30,
        assigneeId: admin.id,
        requiredRoleId: role.id,
      },
    ],
  });
  const recurring = await productionRow(follow, parent);
  const q = "/time/workload?from=2026-10-01&to=2026-11-30&roleId=" + role.id;
  const before = (await f.request("GET", q))
    .json()
    .rows.filter((r: any) => r.target?.id === recurring.id);
  expect(before.map((r: any) => [r.from, r.plannedMinutes, r.roleId])).toEqual([
    ["2026-10-15", 30, role.id],
    ["2026-11-15", 30, role.id],
  ]);
  expect(
    (
      await f.request("POST", `/production/rows/${recurring.id}/commands`, {
        operationId: operationId(),
        expectedVersion: 1,
        command: {
          kind: "cell",
          columnId: follow.model.columns[0].id,
          period: "2026-10",
          value: true,
        },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await f.request("GET", q))
      .json()
      .rows.filter((r: any) => r.target?.id === recurring.id)
      .map((r: any) => [r.key, r.plannedMinutes]),
  ).toEqual(before.map((r: any) => [r.key, r.plannedMinutes]));
});
test("review I4 small filtered workload and configuration stay available beyond global configuration object and user bounds", async () => {
  f = await fixture();
  const admin = await f.setup();
  const parent = (await f.request("POST", "/records", dossier())).json();
  const other = (
    await f.request("POST", "/records", dossier("Autres dossiers"))
  ).json();
  const input = task(parent.id);
  Object.assign(input.record.data, { assigneeIds: [admin.id] });
  const t = (await f.request("POST", "/records", input)).json();
  const plan = await save({
    kind: "plan",
    level: "occurrence",
    targetId: t.id,
    minutes: 45,
    component: "variable",
  });
  const template = {
    ...t,
    dossierId: other.id,
    data: { ...t.data, assigneeIds: [] },
  };
  await f.maintainDatabase((db) =>
    db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO cabinet_records(id,kind,content,search_title) SELECT ('10000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'tache',jsonb_set($1::jsonb,'{id}',to_jsonb(('10000000-0000-4000-8000-'||lpad(g::text,12,'0')))),'other' FROM generate_series(1,10001) g",
        [JSON.stringify(template)],
      );
      await tx.query(
        "INSERT INTO cabinet_time(id,kind,content) SELECT ('20000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'plan',jsonb_set(jsonb_set($1::jsonb,'{id}',to_jsonb(('20000000-0000-4000-8000-'||lpad(g::text,12,'0')))),'{data,targetId}',to_jsonb(('10000000-0000-4000-8000-'||lpad(((g-1)%10001+1)::text,12,'0')))) FROM generate_series(1,20001) g",
        [JSON.stringify(plan)],
      );
      await tx.query(
        "INSERT INTO cabinet_users(id,email,name,password_hash,permissions,active) SELECT ('30000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'outside-'||g||'@example.test','Other '||g,password_hash,'[]'::jsonb,true FROM cabinet_users CROSS JOIN generate_series(1,201) g WHERE id=$1",
        [admin.id],
      );
    }),
  );
  const page = await f.request("GET", "/time/entities?kind=plan");
  expect(page.statusCode, page.body).toBe(200);
  expect(page.json().items).toHaveLength(100);
  expect(page.json().hasMore).toBe(true);
  expect(page.json().total).toBe(20002);
  const tail = await f.request("GET", "/time/entities?kind=plan&offset=20000");
  expect(tail.statusCode, tail.body).toBe(200);
  expect(tail.json()).toMatchObject({
    total: 20002,
    offset: 20000,
    hasMore: false,
  });
  expect(tail.json().items).toHaveLength(2);
  const beyond = await f.request(
    "GET",
    "/time/entities?kind=plan&offset=20100",
  );
  expect(beyond.statusCode, beyond.body).toBe(200);
  expect(beyond.json()).toMatchObject({
    total: 20002,
    offset: 20100,
    hasMore: false,
    items: [],
  });
  const w = await f.request(
    "GET",
    `/time/workload?from=2026-10-01&to=2026-10-31&userId=${admin.id}&dossierId=${parent.id}`,
  );
  expect(w.statusCode, w.body).toBe(200);
  expect(w.json().people).toHaveLength(1);
  expect(w.json().people[0].plannedMinutes).toBe(45);
  expect(
    (
      await f.request(
        "GET",
        `/time/report?from=2026-10-01&to=2026-10-31&recordId=${t.id}`,
      )
    ).json().planned.minutes,
  ).toBe(45);
  const scopedOnly = await f.request(
    "GET",
    `/time/workload?from=2026-10-01&to=2026-10-31&dossierId=${parent.id}`,
  );
  expect(scopedOnly.statusCode, scopedOnly.body).toBe(200);
  expect(scopedOnly.json().people).toHaveLength(1);
  expect(scopedOnly.json().people[0].plannedMinutes).toBe(45);
  await save({ ...plan.data, minutes: 50 }, plan);
}, 120000);
test("review I5 bounded searchable catalogs resolve and select users and inactive natures beyond 200", async () => {
  f = await fixture();
  const admin = await f.setup();
  const nature = await save({
    kind: "nature",
    name: "ZZZ Nature choisie",
    active: true,
  });
  await f.maintainDatabase((db) =>
    db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO cabinet_time(id,kind,content) SELECT ('40000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'nature',jsonb_set(jsonb_set(jsonb_set($1::jsonb,'{id}',to_jsonb('40000000-0000-4000-8000-'||lpad(g::text,12,'0'))),'{data,name}',to_jsonb('AAA Ancienne '||g)),'{data,active}','false'::jsonb) FROM generate_series(1,201) g",
        [JSON.stringify(nature)],
      );
      await tx.query(
        "INSERT INTO cabinet_users(id,email,name,password_hash,permissions,active) SELECT ('50000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'catalog-'||g||'@example.test','AAA User '||g,password_hash,'[]'::jsonb,true FROM cabinet_users CROSS JOIN generate_series(1,201) g WHERE id=$1",
        [admin.id],
      );
    }),
  );
  const last = await person();
  const first = await f.request("GET", "/time/catalog/natures");
  expect(first.statusCode, first.body).toBe(200);
  expect(first.json().items).toHaveLength(100);
  expect(first.json().hasMore).toBe(true);
  const selected = await f.request(
    "GET",
    "/time/catalog/natures?q=ZZZ&active=true",
  );
  expect(selected.json().items).toEqual([
    { id: nature.id, name: nature.data.name, active: true },
  ]);
  const users = await f.request(
    "GET",
    "/time/catalog/users?q=Collègue&active=true",
  );
  expect(users.json().items.map((u: any) => u.id)).toContain(last.id);
  const entry = await save({
    kind: "entry",
    userId: last.id,
    date: "2026-10-17",
    natureId: nature.id,
    link: { kind: "free", label: "Sélection au-delà de 200" },
    seconds: 600,
    source: "manual",
    timerId: null,
    rate: null,
  });
  await save({ ...nature.data, active: false }, nature);
  const resolved = await f.request(
    "GET",
    "/time/catalog/natures?ids=" + entry.data.natureId,
  );
  expect(resolved.json().items).toEqual([
    { id: nature.id, name: nature.data.name, active: false },
  ]);
  expect(
    (await f.request("GET", "/time/catalog/users?ids=" + last.id)).json()
      .items[0].name,
  ).toBe(last.name);
});
test("review C1 populated interoperable HTTP exit includes exact current history active timer configurations links and prepared CSV", async () => {
  f = await fixture(() => new Date("2026-10-17T10:00:00Z"));
  const admin = await f.setup();
  const parent = (await f.request("POST", "/records", dossier())).json();
  const t = (await f.request("POST", "/records", task(parent.id))).json();
  const role = (
    await f.request("POST", "/administration/roles", {
      operationId: operationId(),
      order: 0,
      name: "Comptabilité",
      permissions: [],
    })
  ).json();
  const all = [];
  const nature = await save({
    kind: "nature",
    name: "Révision v1",
    active: true,
  });
  all.push(nature);
  const currentNature = await save(
    { ...nature.data, name: "Révision v2" },
    nature,
  );
  all.push(currentNature);
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
  const m = await model({
    kind: "process",
    name: "Lien Production",
    target: "dossier",
    columns: [],
  });
  const prod = await productionRow(m, parent);
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
  const timer = await f.request("POST", "/time/timers/start", {
    operationId: operationId(),
    date: "2026-10-17",
    natureId: nature.id,
    link: { kind: "record", id: t.id },
  });
  expect(timer.statusCode, timer.body).toBe(200);
  all.push(timer.json());
  const csv = await f.request("POST", "/time/exports", {
    operationId: operationId(),
    query: { ...period, dossierId: parent.id },
  });
  expect(csv.statusCode, csv.body).toBe(202);
  expect(
    (await awaitJob("/time/exports/" + csv.json().id)).json().job.state,
  ).toBe("completed");
  const csvText = await f.request(
    "GET",
    `/time/exports/${csv.json().id}/parts/1`,
  );
  expect(csvText.statusCode, csvText.body).toBe(200);
  const result = await completeExit();
  const latest = new Map(all.map((e) => [e.id, e]));
  expect(
    result.time
      .filter((e: any) => e.entity === "current")
      .map((e: any) => e.data)
      .sort((a: any, b: any) => a.id.localeCompare(b.id)),
  ).toEqual([...latest.values()].sort((a, b) => a.id.localeCompare(b.id)));
  expect(
    result.time
      .filter((e: any) => e.entity === "history")
      .map((e: any) => e.data)
      .sort(
        (a: any, b: any) => a.id.localeCompare(b.id) || a.version - b.version,
      ),
  ).toEqual(
    all.sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version),
  );
  const meta = result.time.find((e: any) => e.entity === "csv");
  expect(meta?.data).toMatchObject({
    actorId: admin.id,
    jobId: csv.json().id,
    query: { ...period, dossierId: parent.id },
  });
  const rows = result.time.filter((e: any) => e.entity === "csv_row");
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row.data.exportId).toBe(meta?.data.id);
    expect(row.data.part).toBe(1);
    expect(row.data.entry).toEqual(latest.get(row.data.entry.id));
    expect(csvText.body).toContain(row.data.entry.id);
    expect(row.data.entry.data.rate).toMatchObject({
      hourlyAmount: "99.99",
      version: 1,
    });
  }
  expect(
    result.time.find(
      (e: any) => e.entity === "current" && e.data.id === timer.json().id,
    )?.data.data.stoppedAt,
  ).toBeNull();
});

test("review I6 custom occurrences retain one period with inherited or frozen plans and scoped owners", async () => {
  f = await fixture();
  const admin = await f.setup();
  const parent = (await f.request("POST", "/records", dossier())).json();
  await save({
    kind: "plan",
    level: "dossier",
    targetId: parent.id,
    minutes: 75,
    component: "variable",
  });
  const rule = {
    frequency: "monthly",
    start: "2026-01-01",
    end: "2026-12-31",
    nominalDay: 31,
    lastDay: false,
    weekDay: 1,
  };
  for (const columns of [
    [],
    [
      {
        id: operationId(),
        name: "Contrôle mensuel",
        type: "completion",
        frequency: "monthly",
        plannedMinutes: 30,
      },
    ],
  ]) {
    const m = await model({
      kind: "custom",
      name: columns.length ? "Avec étape" : "Sans étape",
      target: "dossier",
      rule,
      assigneeId: admin.id,
      columns,
    });
    const created: string[] = [];
    for (const period of ["2026-10", "2026-11"]) {
      const r = await f.request("POST", `/production/models/${m.id}/rows`, {
        operationId: operationId(),
        expectedVersion: 1,
        target: { kind: "dossier", id: parent.id, label: parent.title },
        period,
      });
      expect(r.statusCode, r.body).toBe(200);
      created.push(r.json().id);
    }
    for (const query of ["&dossierId=" + parent.id, "&userId=" + admin.id]) {
      const w = await f.request(
        "GET",
        "/time/workload?from=2026-10-01&to=2026-10-31" + query,
      );
      expect(w.statusCode, w.body).toBe(200);
      const rows = w
        .json()
        .rows.filter((r: any) => created.includes(r.target?.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        target: { kind: "production", id: created[0] },
        plannedMinutes: columns.length ? 30 : 75,
        userId: admin.id,
        from: "2026-10-31",
      });
    }
  }
});

test("round2 I6 custom explicit column dates stay in their canonical occurrence before and after completion", async () => {
  f = await fixture();
  const admin = await f.setup();
  const parent = (await f.request("POST", "/records", dossier())).json();
  const columnId = operationId();
  const m = await model({
    kind: "custom",
    name: "Contrôle mensuel daté",
    target: "dossier",
    assigneeId: admin.id,
    rule: {
      frequency: "monthly",
      start: "2026-01-01",
      end: "2026-12-31",
      nominalDay: 31,
      lastDay: false,
      weekDay: 1,
    },
    columns: [
      {
        id: columnId,
        name: "Contrôle",
        type: "completion",
        frequency: "monthly",
        plannedDate: "2026-10-15",
        plannedMinutes: 30,
      },
    ],
  });
  const nature = await save({
    kind: "nature",
    name: "Contrôle récurrent",
    active: true,
  });
  const occurrences: {
    id: string;
    version: number;
    period: string;
    date: string;
  }[] = [];
  for (const [period, date] of [
    ["2026-10", "2026-10-31"],
    ["2026-11", "2026-11-30"],
  ]) {
    const response = await f.request(
      "POST",
      `/production/models/${m.id}/rows`,
      {
        operationId: operationId(),
        expectedVersion: 1,
        target: { kind: "dossier", id: parent.id, label: parent.title },
        period,
      },
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().dueDate).toBe(date);
    occurrences.push({ id: response.json().id, version: 1, period, date });
    await save({
      kind: "entry",
      userId: admin.id,
      date,
      natureId: nature.id,
      link: { kind: "production", id: response.json().id },
      seconds: 1234,
      source: "manual",
      timerId: null,
      rate: null,
    });
  }
  async function check() {
    for (const o of occurrences) {
      for (const filter of ["dossierId=" + parent.id, "userId=" + admin.id]) {
        const response = await f.request(
          "GET",
          `/time/workload?from=${o.period}-01&to=${o.date}&${filter}`,
        );
        expect(response.statusCode, response.body).toBe(200);
        const result = response.json();
        const planned = result.rows.filter((r: any) =>
          r.key.startsWith("production:"),
        );
        expect(planned).toHaveLength(1);
        expect(planned[0]).toMatchObject({
          key: `production:${o.id}:${columnId}:${o.period}:${admin.id}`,
          target: { kind: "production", id: o.id },
          from: o.date,
          to: o.date,
          plannedMinutes: 30,
          userId: admin.id,
        });
        expect(
          result.rows.reduce((n: number, r: any) => n + r.realizedSeconds, 0),
        ).toBe(1234);
        expect(result.people.find((p: any) => p.id === admin.id)).toMatchObject(
          { plannedMinutes: 30, realizedSeconds: 1234 },
        );
      }
    }
    const columnDay = await f.request(
      "GET",
      `/time/workload?from=2026-10-15&to=2026-10-15&dossierId=${parent.id}`,
    );
    expect(columnDay.statusCode, columnDay.body).toBe(200);
    expect(columnDay.json().rows).toEqual([]);
    expect(columnDay.json().people).toEqual([]);
  }
  await check();
  for (const o of occurrences) {
    const response = await f.request(
      "POST",
      `/production/rows/${o.id}/commands`,
      {
        operationId: operationId(),
        expectedVersion: o.version,
        command: { kind: "cell", columnId, period: o.period, value: "done" },
      },
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ state: "done", dueDate: o.date });
    await check();
  }
});

test("round2 N1 reassignment includes other authorized dossiers and invalidates changed cross-dossier sources", async () => {
  f = await fixture();
  const admin = await f.setup();
  const recipient = await person(),
    unrelated = await person();
  const day = { from: "2026-10-19", to: "2026-10-19" };
  const capacity = await save({
    kind: "capacity",
    userId: null,
    ...day,
    dailyMinutes: [420, 420, 420, 420, 420, 0, 0],
  });
  async function work(
    name: string,
    userId: string,
    minutes: number,
    confidential = false,
  ) {
    const base = dossier(name);
    const parentInput = { ...base, record: { ...base.record, confidential } };
    const parent = (await f.request("POST", "/records", parentInput)).json();
    const input = task(parent.id);
    Object.assign(input.record.data, {
      dueDate: day.from,
      assigneeIds: [userId],
    });
    const record = (await f.request("POST", "/records", input)).json();
    const plan = await save({
      kind: "plan",
      level: "occurrence",
      targetId: record.id,
      minutes,
      component: "variable",
    });
    return { parent, record, plan };
  }
  const a = await work("Dossier A", admin.id, 60),
    b = await work("Dossier B", recipient.id, 1000);
  const hidden = await work("Dossier confidentiel", recipient.id, 7777, true),
    other = await work("Dossier autre porteur", unrelated.id, 8888);
  const allocation = await save({
    kind: "allocation",
    target: { kind: "record", id: a.record.id },
    ...day,
    weights: [{ userId: admin.id, weight: 1 }],
    policyVersion: 1,
  });
  const nature = await save({
    kind: "nature",
    name: "Temps libre hors dossier",
    active: true,
  });
  const actual = await save({
    kind: "entry",
    userId: recipient.id,
    date: day.from,
    natureId: nature.id,
    link: { kind: "free", label: "Réalisé du destinataire" },
    seconds: 120,
    source: "manual",
    timerId: null,
    rate: null,
  });
  // More than 200 unrelated people must not widen the selected-person preview.
  await f.maintainDatabase((db) =>
    db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO cabinet_users(id,email,name,password_hash,permissions,active) SELECT ('60000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'preview-outside-'||g||'@example.test','Outside '||g,password_hash,'[]'::jsonb,true FROM cabinet_users CROSS JOIN generate_series(1,201) g WHERE id=$1",
        [admin.id],
      );
    }),
  );
  await revoke(admin.id, ["confidential"]);
  const query = `/time/workload?from=${day.from}&to=${day.to}&userId=${recipient.id}`;
  const globalBefore = await f.request("GET", query);
  expect(globalBefore.statusCode, globalBefore.body).toBe(200);
  expect(globalBefore.json().people[0]).toMatchObject({
    plannedMinutes: 1000,
    capacityMinutes: 420,
    overloadMinutes: 580,
    realizedSeconds: 120,
  });
  const input = {
    allocationId: allocation.id,
    expectedVersion: 1,
    ...day,
    weights: [{ userId: recipient.id, weight: 1 }],
  };
  const preview = await f.request("POST", "/time/reassignment/preview", input);
  expect(preview.statusCode, preview.body).toBe(200);
  const result = preview.json();
  expect(result.before.people.find((p: any) => p.id === recipient.id)).toEqual(
    globalBefore.json().people[0],
  );
  expect(
    result.after.people.find((p: any) => p.id === recipient.id),
  ).toMatchObject({
    plannedMinutes: 1060,
    capacityMinutes: 420,
    overloadMinutes: 640,
    realizedSeconds: 120,
  });
  expect(result.before.people.map((p: any) => p.id).sort()).toEqual(
    [admin.id, recipient.id].sort(),
  );
  expect(result.sourceVersions).toMatchObject({
    [b.plan.id]: 1,
    [b.record.id]: 1,
    [capacity.id]: 1,
    [actual.id]: 1,
  });
  for (const object of [
    hidden.parent,
    hidden.record,
    hidden.plan,
    other.record,
    other.plan,
  ])
    expect(preview.body).not.toContain(object.id);
  const command = {
    ...input,
    operationId: operationId(),
    sourceVersions: result.sourceVersions,
  };
  const changed = await save({ ...b.plan.data, minutes: 1100 }, b.plan);
  const stale = await f.request("POST", "/time/reassignment/commit", command);
  expect(stale.statusCode, stale.body).toBe(409);
  expect(
    (await f.request("GET", `/time/${allocation.id}/history`)).json().items,
  ).toHaveLength(1);
  const refreshed = await f.request(
    "POST",
    "/time/reassignment/preview",
    input,
  );
  expect(refreshed.statusCode, refreshed.body).toBe(200);
  expect(refreshed.json().sourceVersions[changed.id]).toBe(2);
  expect(
    refreshed.json().after.people.find((p: any) => p.id === recipient.id),
  ).toMatchObject({ plannedMinutes: 1160, overloadMinutes: 740 });
  const freshCommand = {
    ...input,
    operationId: operationId(),
    sourceVersions: refreshed.json().sourceVersions,
  };
  const committed = await f.request(
    "POST",
    "/time/reassignment/commit",
    freshCommand,
  );
  expect(committed.statusCode, committed.body).toBe(200);
  expect(
    (await f.request("POST", "/time/reassignment/commit", freshCommand)).json(),
  ).toEqual(committed.json());
  expect((await f.request("GET", query)).json().people[0]).toEqual(
    refreshed.json().after.people.find((p: any) => p.id === recipient.id),
  );
  expect(
    (await f.request("GET", `/time/${allocation.id}/history`)).json().items,
  ).toHaveLength(2);
});

test("round3 configuration pages count only current and historical authorized record memberships", async () => {
  f = await fixture();
  const admin = await f.setup();
  const publicDossier = (await f.request("POST", "/records", dossier())).json();
  const input = dossier("Confidentiel");
  const hiddenDossier = (
    await f.request("POST", "/records", {
      ...input,
      record: { ...input.record, confidential: true },
    })
  ).json();
  const visible = (
    await f.request("POST", "/records", task(publicDossier.id))
  ).json();
  const formerlyHidden = (
    await f.request("POST", "/records", task(publicDossier.id))
  ).json();
  const hidden = (
    await f.request("POST", "/records", task(hiddenDossier.id))
  ).json();
  const history = await save({
    kind: "plan",
    level: "occurrence",
    targetId: hidden.id,
    minutes: 20,
    component: "variable",
  });
  const moved = await save(
    { ...history.data, targetId: formerlyHidden.id },
    history,
  );
  const currentHidden = await save({
    kind: "plan",
    level: "occurrence",
    targetId: hidden.id,
    minutes: 30,
    component: "variable",
  });
  const currentVisible = await save({
    kind: "plan",
    level: "occurrence",
    targetId: visible.id,
    minutes: 40,
    component: "variable",
  });
  const cabinet = await save({
    kind: "plan",
    level: "cabinet",
    targetId: null,
    minutes: 50,
    component: "variable",
  });
  expect(
    (await f.request("GET", "/time/entities?kind=plan")).json().total,
  ).toBe(4);
  await revoke(admin.id, ["confidential"]);
  const page = await f.request("GET", "/time/entities?kind=plan");
  expect(page.statusCode, page.body).toBe(200);
  expect(page.json()).toMatchObject({ total: 2, offset: 0, hasMore: false });
  expect(
    page
      .json()
      .items.map((e: any) => e.id)
      .sort(),
  ).toEqual([currentVisible.id, cabinet.id].sort());
  expect(page.body).not.toContain(moved.id);
  expect(page.body).not.toContain(currentHidden.id);
  const beyond = await f.request("GET", "/time/entities?kind=plan&offset=2");
  expect(beyond.statusCode, beyond.body).toBe(200);
  expect(beyond.json()).toEqual({
    items: [],
    total: 2,
    offset: 2,
    hasMore: false,
  });
  for (const entry of [moved, currentHidden]) {
    expect(
      (await f.request("GET", `/time/${entry.id}/history`)).statusCode,
    ).toBe(404);
  }
});
