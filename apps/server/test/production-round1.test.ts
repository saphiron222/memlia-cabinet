import { afterEach, expect, test } from "vitest";
import { fixture, dossier, operationId } from "./helpers.js";
let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
  f = undefined!;
});
async function start() {
  f = await fixture(() => new Date("2026-10-17T10:00:00Z"));
  await f.setup();
  return (await f.request("POST", "/records", dossier())).json();
}
async function model(value: unknown, id = operationId(), expectedVersion = 0) {
  const r = await f.request("POST", "/production/models", {
    operationId: operationId(),
    id,
    expectedVersion,
    model: value,
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
async function create(m: any, target: any, period = "once") {
  const r = await f.request("POST", `/production/models/${m.id}/rows`, {
    operationId: operationId(),
    expectedVersion: m.version,
    target: {
      kind: m.model.target,
      id: target.id,
      label: target.title ?? target.name,
    },
    period,
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
test("I1 migration releases old identity, retains new identity and rejects collisions atomically", async () => {
  const a = await start(),
    b = (await f.request("POST", "/records", dossier("B fictif"))).json();
  let m = await model({
    kind: "process",
    name: "Migration",
    target: "dossier",
    allowDuplicates: false,
  });
  const row = await create(m, a);
  const migrate = await f.request(
    "POST",
    `/production/models/${m.id}/migrate-targets`,
    {
      operationId: operationId(),
      expectedVersion: 1,
      target: "dossier",
      reason: "Réaffectation",
      mappings: [
        {
          rowId: row.id,
          expectedVersion: 1,
          target: { kind: "dossier", id: b.id, label: b.title },
        },
      ],
    },
  );
  expect(migrate.statusCode, migrate.body).toBe(200);
  m = migrate.json();
  const anew = await create(m, a),
    existing = await create(m, b);
  expect(anew.target.id).toBe(a.id);
  expect(anew.id).not.toBe(row.id);
  expect(existing.id).toBe(row.id);
  expect(existing.version).toBe(2);
  const collision = await f.request(
    "POST",
    `/production/models/${m.id}/migrate-targets`,
    {
      operationId: operationId(),
      expectedVersion: m.version,
      target: "dossier",
      reason: "Collision",
      mappings: [anew, existing].map((r) => ({
        rowId: r.id,
        expectedVersion: r.version,
        target: { kind: "dossier", id: a.id, label: a.title },
      })),
    },
  );
  expect(collision.statusCode).toBe(409);
  expect(
    (await f.request("GET", `/production/rows/${existing.id}`)).json().target
      .id,
  ).toBe(b.id);
  await f.maintainDatabase(async (db) => {
    const history = await db.query(
      "SELECT content FROM cabinet_production_row_versions WHERE id=$1 ORDER BY version",
      [row.id],
    );
    expect(history.map((x) => (x.content as any).target.id)).toEqual([
      a.id,
      b.id,
    ]);
  });
  const swap = await f.request(
    "POST",
    `/production/models/${m.id}/migrate-targets`,
    {
      operationId: operationId(),
      expectedVersion: m.version,
      target: "dossier",
      reason: "Permutation sans perte",
      mappings: [
        {
          rowId: anew.id,
          expectedVersion: anew.version,
          target: { kind: "dossier", id: b.id, label: b.title },
        },
        {
          rowId: existing.id,
          expectedVersion: existing.version,
          target: { kind: "dossier", id: a.id, label: a.title },
        },
      ],
    },
  );
  expect(swap.statusCode, swap.body).toBe(200);
  expect((await create(swap.json(), a)).id).toBe(existing.id);
  expect((await create(swap.json(), b)).id).toBe(anew.id);
});
test("I8 duplicate retries the stable public command after source edits", async () => {
  await start();
  let m = await model({
    kind: "balance",
    name: "Bilan",
    target: "dossier",
    year: 2026,
    family: "BIC",
    fee: "120",
  });
  const manager = await person(["read", "manage_users"]);
  const input = { operationId: operationId(), expectedVersion: 1, year: 2027 };
  const first = await f.request(
    "POST",
    `/production/models/${m.id}/duplicate`,
    input,
    manager.cookie,
  );
  expect(first.statusCode, first.body).toBe(200);
  m = await model({ ...m.model, name: "Modifié", fee: "250" }, m.id, 1);
  const retry = await f.request(
    "POST",
    `/production/models/${m.id}/duplicate`,
    input,
    manager.cookie,
  );
  expect(retry.statusCode, retry.body).toBe(200);
  expect(retry.json()).toEqual(first.json());
  const revoke = await f.request(
    "PUT",
    `/administration/users/${manager.user.id}`,
    {
      operationId: operationId(),
      expectedVersion: manager.user.version,
      name: manager.user.name,
      active: true,
      roleIds: [],
      permissions: [{ action: "read", kind: "*", dossierId: null }],
    },
  );
  expect(revoke.statusCode, revoke.body).toBe(200);
  expect(
    (
      await f.request(
        "POST",
        `/production/models/${m.id}/duplicate`,
        input,
        manager.cookie,
      )
    ).statusCode,
  ).toBe(403);
});
test("I10 inactive user target preserves historical reads and catalogue but refuses new targets", async () => {
  await start();
  const u = (
    await f.request("POST", "/users", {
      operationId: operationId(),
      email: "inactive@example.test",
      name: "Cible inactive",
      password: "Longue phrase secrète 123!",
      permissions: [],
    })
  ).json();
  const m = await model({
    kind: "process",
    name: "Process utilisateur",
    target: "utilisateur",
    population: [u.id],
  });
  const row = await create(m, u);
  const deactivated = await f.request("PUT", `/administration/users/${u.id}`, {
    operationId: operationId(),
    expectedVersion: u.version,
    name: u.name,
    active: false,
    permissions: [],
    roleIds: [],
  });
  expect(deactivated.statusCode, deactivated.body).toBe(200);
  const read = await f.request("GET", `/production/rows/${row.id}`);
  expect(read.statusCode, read.body).toBe(200);
  expect(read.json().target).toMatchObject({
    id: u.id,
    label: u.name,
    active: false,
  });
  expect((await f.request("GET", "/production/models")).statusCode).toBe(200);
  const denied = await f.request("POST", `/production/models/${m.id}/rows`, {
    operationId: operationId(),
    expectedVersion: 1,
    target: { kind: "utilisateur", id: u.id, label: u.name },
  });
  expect(denied.statusCode).toBe(400);
});
async function finish(path: string, token = f.cookie) {
  let result: any;
  for (let n = 0; n < 200; n++) {
    const r = await f.request("GET", path, undefined, token);
    expect(r.statusCode, r.body).toBe(200);
    result = r.json();
    if (!result.job) result = { job: result };
    if (["completed", "failed"].includes(result.job.state)) break;
    await new Promise((r) => setTimeout(r, 30));
  }
  expect(result.job.state, JSON.stringify(result)).toBe("completed");
  return result;
}
test("I3 annual followups reject cross-year cells and export only selected month and year", async () => {
  const d = await start(),
    column = operationId();
  const m = await model({
    kind: "followup",
    name: "Périodes",
    target: "dossier",
    columns: [
      { id: column, name: "Montant", type: "decimal", frequency: "monthly" },
    ],
  });
  let a = await create(m, d, "2026"),
    b = await create(m, d, "2027");
  const edit = async (row: any, period: string, value: string) =>
    f.request("POST", `/production/rows/${row.id}/commands`, {
      operationId: operationId(),
      expectedVersion: row.version,
      command: { kind: "cell", columnId: column, period, value },
    });
  const bad = await edit(a, "2027-02", "99");
  expect(bad.statusCode, bad.body).toBe(400);
  a = (await edit(a, "2026-02", "10")).json();
  a = (await edit(a, "2026-03", "20")).json();
  b = (await edit(b, "2027-02", "30")).json();
  const list = await f.request(
    "GET",
    `/production/models/${m.id}/rows?period=2027`,
  );
  expect(list.json().items.map((r: any) => r.id)).toEqual([b.id]);
  for (const [year, value, excluded] of [
    ["2026", "10", "20"],
    ["2027", "30", "10"],
  ]) {
    const started = await f.request("POST", "/production/exports", {
      operationId: operationId(),
      modelId: m.id,
      query: { period: year, referenceDate: `${year}-02-01` },
    });
    expect(started.statusCode, started.body).toBe(202);
    await finish(`/production/exports/${started.json().jobId}`);
    const csv = await f.request(
      "GET",
      `/production/exports/${started.json().jobId}/parts/1`,
    );
    expect(csv.body).toContain(`"${year}-02";"${value}"`);
    expect(csv.body).not.toContain(`;"${excluded}";`);
    expect(csv.body).not.toContain('"2026-03"');
  }
});
test("I6 used balance rows retain their model version, planned calendar and completed state after model edits", async () => {
  const d = await start(),
    col = operationId();
  let m = await model({
    kind: "balance",
    name: "Version figée",
    target: "dossier",
    family: "BIC",
    year: 2026,
    columns: [
      { id: col, name: "Original", type: "boolean", plannedDate: "2026-05-31" },
    ],
  });
  const row = await create(m, d, "2026");
  m = await model(
    {
      ...m.model,
      columns: [
        { ...m.model.columns[0], plannedDate: "2026-11-30", approval: true },
        {
          id: operationId(),
          name: "Nouvelle étape",
          type: "boolean",
          plannedDate: "2026-12-10",
        },
      ],
    },
    m.id,
    1,
  );
  const snapshot = await f.request(
    "GET",
    `/production/models/${m.id}?version=1`,
  );
  expect(snapshot.statusCode, snapshot.body).toBe(200);
  expect(snapshot.json().model.columns).toHaveLength(1);
  expect(snapshot.json().model.columns[0].plannedDate).toBe("2026-05-31");
  const done = await f.request("POST", `/production/rows/${row.id}/commands`, {
    operationId: operationId(),
    expectedVersion: 1,
    command: { kind: "cell", columnId: col, period: "once", value: true },
  });
  expect(done.statusCode, done.body).toBe(200);
  expect(done.json()).toMatchObject({
    modelVersion: 1,
    state: "done",
    dueDate: null,
  });
  const record = await f.request("GET", `/records/${row.id}`);
  expect(record.json().data).toMatchObject({
    preparation: "preparee",
    dueDate: null,
  });
  const nextD = (
    await f.request("POST", "/records", dossier("Nouvelle version"))
  ).json();
  const next = await create(m, nextD, "2026");
  expect(next).toMatchObject({
    modelVersion: 2,
    state: "not_done",
    dueDate: "2026-11-30",
  });
  const calendar = await f.request(
    "GET",
    "/workflows/calendar?kind=obligation",
  );
  expect(
    calendar.json().items.find((r: any) => r.id === row.id).data.dueDate,
  ).toBeNull();
  expect(
    calendar.json().items.find((r: any) => r.id === next.id).data.dueDate,
  ).toBe("2026-11-30");
  const exported = await f.request("POST", "/production/exports", {
    operationId: operationId(),
    modelId: m.id,
    query: { q: d.title },
  });
  await finish(`/production/exports/${exported.json().jobId}`);
  const csv = await f.request(
    "GET",
    `/production/exports/${exported.json().jobId}/parts/1`,
  );
  expect(csv.body).toContain('"2026-05-31"');
  expect(csv.body).not.toContain('"2026-11-30"');
  expect(csv.body).not.toContain("Nouvelle étape");
});
test.each([
  ["yearly", "2026", "2026-01-15"],
  ["quarterly", "2026-Q1", "2026-01-15"],
  ["weekly", "week:2026-01-05", "2026-01-09"],
])(
  "I7 %s manual occurrence shares generation identity and civil due date",
  async (frequency, period, dueDate) => {
    const d = await start();
    const m = await model({
      kind: "custom",
      name: "Récurrence",
      target: "dossier",
      population: [d.id],
      rule: {
        frequency,
        start: "2026-01-01",
        end: "2026-12-31",
        nominalDay: 15,
        lastDay: false,
        weekDay: 5,
      },
    });
    const row = await create(m, d, period);
    expect(row.dueDate).toBe(dueDate);
    const bad = await f.request("POST", `/production/models/${m.id}/rows`, {
      operationId: operationId(),
      expectedVersion: 1,
      target: { kind: "dossier", id: d.id, label: d.title },
      period: "2026-10",
    });
    expect(bad.statusCode).toBe(400);
    const generation = await f.request("POST", "/production/generate", {
      operationId: operationId(),
      modelId: m.id,
      from: dueDate,
      to: dueDate,
    });
    expect(generation.statusCode, generation.body).toBe(202);
    await finish(`/production/jobs/${generation.json().jobId}`);
    const rows = await f.request("GET", `/production/models/${m.id}/rows`);
    expect(rows.json().items.map((r: any) => r.id)).toEqual([row.id]);
  },
);
async function person(actions: string[]) {
  const r = await f.request("POST", "/users", {
    operationId: operationId(),
    name: "Lecteur fictif",
    email: `${operationId()}@example.test`,
    password: "MotDePasseFictif123!",
    permissions: actions.map((action) => ({
      action,
      kind: "*",
      dossierId: null,
    })),
  });
  expect(r.statusCode, r.body).toBe(201);
  const user = r.json();
  const login = await f.request(
    "POST",
    "/login",
    { email: user.email, password: "MotDePasseFictif123!" },
    "",
  );
  return { user, cookie: String(login.headers["set-cookie"]).split(";")[0]! };
}
async function upload(
  dossierId: string,
  confidential = false,
  source = "simulated",
) {
  const metadata = {
    operationId: operationId(),
    dossierId,
    filename: "original.txt",
    mediaType: "text/plain",
    confidential,
    source: { kind: source, reference: "Fictif", version: "1" },
  };
  const r = await f.app.inject({
    method: "POST",
    url: "/api/v1/documents",
    headers: {
      origin: "http://localhost:3000",
      cookie: f.cookie,
      "content-type": "multipart/form-data; boundary=piece",
    },
    payload: Buffer.from(
      `--piece\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n--piece\r\nContent-Disposition: form-data; name="file"; filename="original.txt"\r\nContent-Type: text/plain\r\n\r\nOriginal fictif\r\n--piece--\r\n`,
    ),
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json();
}
test("I5 original assignment and acceptance actions reauthorize before replay without restricting unrelated edits", async () => {
  const d = await start(),
    receipt = await upload(d.id);
  const m = await model({
    kind: "balance",
    name: "Autorisations",
    target: "dossier",
    family: "BIC",
    year: 2026,
  });
  let row = await create(m, d, "2026");
  const p = await person(["read", "update", "assign", "approve"]);
  let u = p.user;
  const call = (i: any) =>
    f.request("POST", `/production/rows/${row.id}/commands`, i, p.cookie);
  const properties = {
    kind: "properties",
    dueDate: null,
    assigneeId: u.id,
    tags: [],
    state: "not_done",
    documentIds: [],
  };
  const assignment = {
    operationId: operationId(),
    expectedVersion: row.version,
    command: properties,
  };
  let r = await call(assignment);
  expect(r.statusCode, r.body).toBe(200);
  row = r.json();
  const acceptance = {
    operationId: operationId(),
    expectedVersion: row.version,
    command: {
      kind: "deposit",
      deposit: {
        ...row.deposit,
        attempts: [
          {
            id: operationId(),
            date: "2026-10-17",
            state: "accepted",
            source: "simulated",
            reference: "Réception fictive",
            documentIds: [],
            receiptDocumentId: receipt.id,
          },
        ],
      },
    },
  };
  r = await call(acceptance);
  expect(r.statusCode, r.body).toBe(200);
  row = r.json();
  const revoke = await f.request("PUT", `/administration/users/${u.id}`, {
    operationId: operationId(),
    expectedVersion: u.version,
    name: u.name,
    active: true,
    permissions: ["read", "update"].map((action) => ({
      action,
      kind: "*",
      dossierId: null,
    })),
    roleIds: [],
  });
  expect(revoke.statusCode, revoke.body).toBe(200);
  expect((await call(assignment)).statusCode).toBe(404);
  expect((await call(acceptance)).statusCode).toBe(404);
  const neutral = await call({
    operationId: operationId(),
    expectedVersion: row.version,
    command: { ...properties, tags: ["Note"] },
  });
  expect(neutral.statusCode, neutral.body).toBe(200);
  row = neutral.json();
  const dates = await call({
    operationId: operationId(),
    expectedVersion: row.version,
    command: {
      kind: "deposit",
      deposit: { ...row.deposit, assemblyDate: "2026-10-15" },
    },
  });
  expect(dates.statusCode, dates.body).toBe(200);
});
test("I2 G2 confidential production history filters full exit and notifications, blocks cached download and pending reminder delivery", async () => {
  const d = await start(),
    visibleD = (await f.request("POST", "/records", dossier("Visible"))).json(),
    column = operationId();
  const m = await model({
    kind: "balance",
    name: "Périmètres",
    target: "dossier",
    family: "BIC",
    year: 2026,
    columns: [{ id: column, name: "Note", type: "text" }],
  });
  const row = await create(m, d, "2026"),
    visible = await create(m, visibleD, "2026");
  const doc = await upload(d.id, true);
  const secretModel = await model({
    kind: "process",
    name: "Modèle documentaire protégé",
    target: "dossier",
    documentIds: [doc.id],
  });
  const p = await person(["read", "export"]);
  const comment = (version: number, text: string) =>
    f.request("POST", `/workflows/targets/${row.id}/commands`, {
      operationId: operationId(),
      expectedVersion: version,
      command: {
        kind: "comment",
        text,
        mentions: [p.user.id],
        audience: "internal",
      },
    });
  expect((await comment(0, "Contenu confidentiel futur")).statusCode).toBe(200);
  const notice = await f.request("GET", "/notifications", undefined, p.cookie);
  expect(notice.json().unread).toBe(1);
  expect(notice.json().items[0].text).toBe("Contenu confidentiel futur");
  const initial = await f.request(
    "POST",
    "/administration/exports",
    { operationId: operationId() },
    p.cookie,
  );
  expect(initial.statusCode, initial.body).toBe(202);
  await finish(`/administration/exports/${initial.json().id}`, p.cookie);
  expect(
    (
      await f.request(
        "GET",
        `/administration/exports/${initial.json().id}/download`,
        undefined,
        p.cookie,
      )
    ).statusCode,
  ).toBe(200);
  const reminder = await f.request("POST", "/workflows/models", {
    operationId: operationId(),
    id: operationId(),
    expectedVersion: 0,
    model: {
      kind: "reminder",
      name: "Rappel en attente",
      targetIds: [row.id],
      recipientIds: [p.user.id],
      event: "schedule",
      message: "Confidentiel",
      hour: "09:00",
      enabled: true,
      rule: {
        frequency: "monthly",
        start: "2026-10-17",
        end: "2026-12-31",
        nominalDay: 17,
        lastDay: false,
        weekDay: 1,
      },
    },
  });
  expect(reminder.statusCode, reminder.body).toBe(200);
  const { JobRunner } = await import("../src/jobs/runner.js"),
    { Reminders } = await import("../src/notifications/reminders.js"),
    { effectiveUser } = await import("../src/identity/service.js"),
    { commandProductionRow } = await import("../src/production/service.js");
  await f.maintainDatabase(async (db) => {
    const jobs = new JobRunner(db),
      reminders = new Reminders(
        db,
        jobs,
        () => new Date("2026-10-17T10:00:00Z"),
        () => "2026-10-17",
        "Europe/Paris",
      );
    const actor = await db.transaction(async (tx) =>
      effectiveUser(
        tx,
        (
          await tx.query(
            "SELECT * FROM cabinet_users WHERE email='admin@example.test'",
          )
        )[0]!,
      ),
    );
    expect(
      (await db.transaction((tx) => reminders.process(tx, actor))).scheduled,
    ).toBe(1);
    expect(
      (
        await db.transaction((tx) =>
          reminders.list(tx, actor, reminder.json().id, 0),
        )
      ).items[0]!.job.state,
    ).toBe("queued");
    await db.transaction(async (tx) => {
      await commandProductionRow(
        tx,
        actor,
        row.id,
        {
          operationId: operationId(),
          expectedVersion: 1,
          command: {
            kind: "cell",
            columnId: column,
            period: "once",
            value: "Protégée",
            approve: false,
            documentIds: [doc.id],
            note: "",
          },
        },
        new Date(),
      );
      await commandProductionRow(
        tx,
        actor,
        row.id,
        {
          operationId: operationId(),
          expectedVersion: 2,
          command: {
            kind: "cell",
            columnId: column,
            period: "once",
            value: "Lien retiré",
            approve: false,
            documentIds: [],
            note: "",
          },
        },
        new Date(),
      );
    });
    await jobs.tick();
    await jobs.stop();
    expect(
      await db.query(
        "SELECT id FROM cabinet_notifications WHERE recipient_id=$1",
        [p.user.id],
      ),
    ).toHaveLength(1);
    expect(
      (
        await db.transaction((tx) =>
          reminders.list(tx, actor, reminder.json().id, 0),
        )
      ).items[0]!.job.state,
    ).toBe("completed");
  });
  const notices = await f.request("GET", "/notifications", undefined, p.cookie);
  expect(notices.json()).toMatchObject({ items: [], unread: 0 });
  expect(notices.body).not.toContain(row.id);
  expect(notices.body).not.toContain("Contenu confidentiel");
  expect((await comment(1, "Nouvelle mention interdite")).statusCode).toBe(200);
  await f.maintainDatabase(async (db) => {
    expect(
      await db.query(
        "SELECT id FROM cabinet_notifications WHERE recipient_id=$1",
        [p.user.id],
      ),
    ).toHaveLength(1);
  });
  expect(
    (
      await f.request(
        "GET",
        `/administration/exports/${initial.json().id}/download`,
        undefined,
        p.cookie,
      )
    ).statusCode,
  ).toBe(403);
  const subset = await f.request(
    "POST",
    "/administration/exports",
    { operationId: operationId() },
    p.cookie,
  );
  expect(subset.statusCode, subset.body).toBe(202);
  await finish(`/administration/exports/${subset.json().id}`, p.cookie);
  const download = await f.request(
    "GET",
    `/administration/exports/${subset.json().id}/download`,
    undefined,
    p.cookie,
  );
  expect(download.statusCode, download.body).toBe(200);
  let data = "";
  for (const part of download.json().parts) {
    const r = await f.request(
      "GET",
      `/administration/exports/${subset.json().id}/parts/${part.number}`,
      undefined,
      p.cookie,
    );
    expect(r.statusCode, r.body).toBe(200);
    data += r.body;
  }
  expect(data).toContain(visible.id);
  expect(data).not.toContain(row.id);
  expect(data).not.toContain(doc.id);
  expect(data).not.toContain(secretModel.id);
});
test("I8 duplicate operations recorded before the public-command journal remain replayable", async () => {
  await start();
  const m = await model({
    kind: "balance",
    name: "Ancien journal",
    target: "dossier",
    year: 2026,
    family: "BIC",
    fee: "120",
  });
  const { stableId } = await import("../src/workflows/generation.js");
  const operation = operationId();
  const prior = await f.request("POST", "/production/models", {
    operationId: operation,
    id: stableId(operation + ":year"),
    expectedVersion: 0,
    model: { ...m.model, year: 2027, closed: false },
  });
  expect(prior.statusCode, prior.body).toBe(200);
  await model({ ...m.model, name: "Source modifiée" }, m.id, 1);
  const retry = await f.request(
    "POST",
    `/production/models/${m.id}/duplicate`,
    { operationId: operation, expectedVersion: 1, year: 2027 },
  );
  expect(retry.statusCode, retry.body).toBe(200);
  expect(retry.json()).toEqual(prior.json());
});

test.each(["public", "legacy-derived", "legacy-null"])(
  "N2 %s custom creation replays original intent after recurrence edits and rechecks current creation rights",
  async (journal) => {
    const d = await start();
    const m = await model({
      kind: "custom",
      name: "Création stable",
      target: "dossier",
      population: [d.id],
      rule: {
        frequency: "yearly",
        start: "2026-01-01",
        end: "2027-12-31",
        nominalDay: 15,
        lastDay: false,
        weekDay: 1,
      },
    });
    const p = await person(["read", "create"]);
    const input = {
      operationId: operationId(),
      expectedVersion: 1,
      target: { kind: "dossier", id: d.id, label: d.title },
      period: "2026",
    };
    const first = await f.request(
      "POST",
      `/production/models/${m.id}/rows`,
      input,
      p.cookie,
    );
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().dueDate).toBe("2026-01-15");
    if (journal !== "public") {
      const { idempotent } = await import("../src/storage/operations.js");
      const { ProductionRowCreateSchema } = await import("@memlia/contracts");
      await f.maintainDatabase(async (db) =>
        db.transaction(async (tx) => {
          await tx.query(
            "DELETE FROM cabinet_operations WHERE actor_id=$1 AND operation_id=$2",
            [p.user.id, input.operationId],
          );
          await idempotent(
            tx,
            p.user,
            input.operationId,
            {
              productionRow: {
                modelId: m.id,
                i: ProductionRowCreateSchema.parse(input),
                dueDate: journal === "legacy-null" ? null : "2026-01-15",
              },
            },
            async () => first.json(),
          );
        }),
      );
    }
    await model(
      { ...m.model, rule: { ...m.model.rule, nominalDay: 20 } },
      m.id,
      1,
    );
    const retry = await f.request(
      "POST",
      `/production/models/${m.id}/rows`,
      input,
      p.cookie,
    );
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json()).toEqual(first.json());
    const changed = await f.request(
      "POST",
      `/production/models/${m.id}/rows`,
      { ...input, period: "2027" },
      p.cookie,
    );
    expect(changed.statusCode, changed.body).toBe(409);
    const revoke = await f.request(
      "PUT",
      `/administration/users/${p.user.id}`,
      {
        operationId: operationId(),
        expectedVersion: p.user.version,
        name: p.user.name,
        active: true,
        roleIds: [],
        permissions: [{ action: "read", kind: "*", dossierId: null }],
      },
    );
    expect(revoke.statusCode, revoke.body).toBe(200);
    expect(
      (
        await f.request(
          "POST",
          `/production/models/${m.id}/rows`,
          input,
          p.cookie,
        )
      ).statusCode,
    ).toBe(403);
  },
);

test.each(["population", "document"])(
  "N3 CSV authorizes frozen model %s at selection and restitution",
  async (boundary) => {
    const a = await start(),
      b = (await f.request("POST", "/records", dossier("Autre portée"))).json();
    const doc = boundary === "document" ? await upload(b.id) : null;
    const column = operationId();
    const m = await model({
      kind: "balance",
      name: "Export historique",
      target: "dossier",
      year: 2026,
      family: "BIC",
      population: boundary === "population" ? [a.id, b.id] : [a.id],
      documentIds: doc ? [doc.id] : [],
      columns: [
        { id: column, name: "Libellé historique protégé", type: "boolean" },
      ],
    });
    const row = await create(m, a, "2026");
    const populated = await f.request(
      "POST",
      `/production/rows/${row.id}/commands`,
      {
        operationId: operationId(),
        expectedVersion: 1,
        command: {
          kind: "cell",
          columnId: column,
          period: "once",
          value: true,
        },
      },
    );
    expect(populated.statusCode, populated.body).toBe(200);
    await model(
      {
        ...m.model,
        population: [a.id],
        documentIds: [],
        columns: [{ ...m.model.columns[0], name: "Libellé courant" }],
      },
      m.id,
      1,
    );
    const p = await person(["read", "export"]);
    const begin = () =>
      f.request(
        "POST",
        "/production/exports",
        {
          operationId: operationId(),
          modelId: m.id,
          query: { period: "2026" },
        },
        p.cookie,
      );
    const initial = await begin();
    expect(initial.statusCode, initial.body).toBe(202);
    await finish(`/production/exports/${initial.json().jobId}`, p.cookie);
    const part = `/production/exports/${initial.json().jobId}/parts/1`;
    expect((await f.request("GET", part, undefined, p.cookie)).body).toContain(
      "Libellé historique protégé",
    );
    const restricted = await f.request("PUT", `/records/${b.id}`, {
      operationId: operationId(),
      expectedVersion: b.version,
      record: {
        kind: "dossier",
        title: b.title,
        confidential: true,
        data: b.data,
      },
    });
    expect(restricted.statusCode, restricted.body).toBe(200);
    expect(
      (
        await f.request(
          "GET",
          `/production/models/${m.id}`,
          undefined,
          p.cookie,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await f.request(
          "GET",
          `/production/rows/${row.id}`,
          undefined,
          p.cookie,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await f.request(
          "GET",
          `/production/models/${m.id}?version=1`,
          undefined,
          p.cookie,
        )
      ).statusCode,
    ).toBe(404);
    const cached = await f.request("GET", part, undefined, p.cookie);
    expect(cached.statusCode, cached.body).toBe(404);
    expect(cached.body).not.toContain("Libellé historique protégé");
    const next = await begin();
    expect(next.statusCode, next.body).toBe(202);
    let status: any;
    for (let n = 0; n < 200; n++) {
      status = (
        await f.request(
          "GET",
          `/production/exports/${next.json().jobId}`,
          undefined,
          p.cookie,
        )
      ).json();
      if (["completed", "failed"].includes(status.job.state)) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(status.job.state).toBe("failed");
    expect(JSON.stringify(status)).not.toContain("Libellé historique protégé");
    expect(
      (
        await f.request(
          "GET",
          `/production/exports/${next.json().jobId}/parts/1`,
          undefined,
          p.cookie,
        )
      ).statusCode,
    ).toBe(409);
  },
);

test.each([2, 102])(
  "N2 legacy dedup uses actual retained source v%s despite stale expectedVersion and preserves the journal",
  async (sourceVersion) => {
    const d = await start(),
      other = (
        await f.request("POST", "/records", dossier("Source historique"))
      ).json(),
      unrelated = (
        await f.request(
          "POST",
          "/records",
          dossier("Version sans correspondance"),
        )
      ).json();
    let m = await model({
      kind: "custom",
      name: "Ancienne déduplication",
      target: "dossier",
      population: [d.id],
      rule: {
        frequency: "yearly",
        start: "2026-01-01",
        end: "2027-12-31",
        nominalDay: 15,
        lastDay: false,
        weekDay: 1,
      },
    });
    const p = await person(["read", "create"]);
    const firstInput = {
      operationId: operationId(),
      expectedVersion: 1,
      target: { kind: "dossier", id: d.id, label: d.title },
      period: "2026",
    };
    const first = await f.request(
      "POST",
      `/production/models/${m.id}/rows`,
      firstInput,
      p.cookie,
    );
    expect(first.statusCode, first.body).toBe(200);
    while (m.version < sourceVersion) {
      m = await model(
        {
          ...m.model,
          population:
            m.version + 1 === sourceVersion
              ? [d.id, other.id]
              : m.version + 1 === sourceVersion - 1
                ? [d.id]
                : [d.id, unrelated.id],
          rule: {
            ...m.model.rule,
            nominalDay: m.version + 1 >= sourceVersion - 1 ? 20 : 18,
          },
        },
        m.id,
        m.version,
      );
    }
    const input = { ...firstInput, operationId: operationId() };
    const dedup = await f.request(
      "POST",
      `/production/models/${m.id}/rows`,
      input,
      p.cookie,
    );
    expect(dedup.statusCode, dedup.body).toBe(200);
    expect(dedup.json()).toEqual(first.json());
    const { idempotent } = await import("../src/storage/operations.js");
    const { ProductionRowCreateSchema } = await import("@memlia/contracts");
    let journal: unknown;
    await f.maintainDatabase(async (db) =>
      db.transaction(async (tx) => {
        await tx.query(
          "DELETE FROM cabinet_operations WHERE actor_id=$1 AND operation_id=$2",
          [p.user.id, input.operationId],
        );
        await idempotent(
          tx,
          p.user,
          input.operationId,
          {
            productionRow: {
              modelId: m.id,
              i: ProductionRowCreateSchema.parse(input),
              dueDate: "2026-01-20",
            },
          },
          async () => dedup.json(),
        );
        journal = await tx.query(
          "SELECT fingerprint,result FROM cabinet_operations WHERE actor_id=$1 AND operation_id=$2",
          [p.user.id, input.operationId],
        );
      }),
    );
    // The effective source is neither expectedVersion nor the current model now.
    m = await model(
      {
        ...m.model,
        population: [d.id],
        rule: { ...m.model.rule, nominalDay: 25 },
      },
      m.id,
      m.version,
    );
    const deniedUnrelated = await f.request("PUT", `/records/${unrelated.id}`, {
      operationId: operationId(),
      expectedVersion: unrelated.version,
      record: {
        kind: "dossier",
        title: unrelated.title,
        confidential: true,
        data: unrelated.data,
      },
    });
    expect(deniedUnrelated.statusCode, deniedUnrelated.body).toBe(200);
    const retry = await f.request(
      "POST",
      `/production/models/${m.id}/rows`,
      input,
      p.cookie,
    );
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json()).toEqual(dedup.json());
    expect(
      (
        await f.request(
          "GET",
          `/production/models/${m.id}/rows`,
          undefined,
          p.cookie,
        )
      ).json().items,
    ).toHaveLength(1);
    expect(
      (
        await f.request(
          "POST",
          `/production/models/${m.id}/rows`,
          { ...input, period: "2027" },
          p.cookie,
        )
      ).statusCode,
    ).toBe(409);
    await f.maintainDatabase(async (db) => {
      expect(
        await db.query(
          "SELECT fingerprint,result FROM cabinet_operations WHERE actor_id=$1 AND operation_id=$2",
          [p.user.id, input.operationId],
        ),
      ).toEqual(journal);
    });
    const restricted = await f.request("PUT", `/records/${other.id}`, {
      operationId: operationId(),
      expectedVersion: other.version,
      record: {
        kind: "dossier",
        title: other.title,
        confidential: true,
        data: other.data,
      },
    });
    expect(restricted.statusCode, restricted.body).toBe(200);
    expect(
      (
        await f.request(
          "GET",
          `/production/models/${m.id}`,
          undefined,
          p.cookie,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await f.request(
          "GET",
          `/production/rows/${first.json().id}`,
          undefined,
          p.cookie,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await f.request(
          "POST",
          `/production/models/${m.id}/rows`,
          input,
          p.cookie,
        )
      ).statusCode,
    ).toBe(404);
  },
);
