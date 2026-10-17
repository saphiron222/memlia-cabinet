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
async function model(model: unknown, id = operationId(), expectedVersion = 0) {
  const r = await f.request("POST", "/production/models", {
    operationId: operationId(),
    id,
    expectedVersion,
    model,
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
test("annual duplication preserves ordered stable typed stages and planned dates, never prior approvals or receipts", async () => {
  await start();
  const columnId = operationId();
  const m = await model({
    kind: "balance",
    name: "Bilan annuel",
    year: 2026,
    family: "BIC",
    target: "dossier",
    columns: [
      {
        id: columnId,
        name: "Révision",
        type: "boolean",
        plannedDate: "2026-05-31",
        plannedMinutes: 90,
      },
    ],
    fee: "1200.50",
  });
  const r = await f.request("POST", `/production/models/${m.id}/duplicate`, {
    operationId: operationId(),
    expectedVersion: 1,
    year: 2027,
  });
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json().model.columns[0]).toMatchObject({
    id: columnId,
    plannedDate: "2027-05-31",
    plannedMinutes: 90,
  });
  expect(r.json().model.fee).toBe("1200.50");
  expect(r.json().model.year).toBe(2027);
  expect(
    (await f.request("GET", `/production/models/${r.json().id}/rows`)).json()
      .items,
  ).toEqual([]);
});
test("balance generation has one canonical work identity, typed concurrent cells, role approval and independent deposit proof", async () => {
  const parent = await start(),
    columnId = operationId();
  const m = await model({
    kind: "balance",
    name: "Bilan",
    year: 2026,
    family: "BIC",
    target: "dossier",
    columns: [
      {
        id: columnId,
        name: "Révision",
        type: "boolean",
        approval: true,
        plannedMinutes: 90,
      },
    ],
  });
  const create = {
    operationId: operationId(),
    expectedVersion: 1,
    target: { kind: "dossier", id: parent.id, label: parent.title },
    period: "2026",
  };
  const a = await f.request("POST", `/production/models/${m.id}/rows`, create);
  expect(a.statusCode, a.body).toBe(200);
  let row = a.json();
  expect(row.id).toBe(row.recordId);
  const duplicate = await f.request("POST", `/production/models/${m.id}/rows`, {
    ...create,
    operationId: operationId(),
  });
  expect(duplicate.json().id).toBe(row.id);
  const cmd = {
    operationId: operationId(),
    expectedVersion: 1,
    command: {
      kind: "cell",
      columnId,
      period: "once",
      value: true,
      approve: true,
    },
  };
  const done = await f.request(
    "POST",
    `/production/rows/${row.id}/commands`,
    cmd,
  );
  expect(done.statusCode, done.body).toBe(200);
  row = done.json();
  expect(row.cells[0].approved).toBe(true);
  expect(row.deposit.attempts).toEqual([]);
  expect(
    (
      await f.request("POST", `/production/rows/${row.id}/commands`, cmd)
    ).json(),
  ).toEqual(row);
  expect(
    (
      await f.request("POST", `/production/rows/${row.id}/commands`, {
        ...cmd,
        operationId: operationId(),
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (await f.request("GET", `/workflows/targets/${row.id}`)).statusCode,
  ).toBe(200);
  expect(
    (
      await f.request("PUT", `/records/${row.id}`, {
        operationId: operationId(),
        expectedVersion: 1,
        record: {
          kind: "obligation",
          title: "Bypass",
          dossierId: parent.id,
          data: { nature: "bilan", period: "2026" },
        },
      })
    ).statusCode,
  ).toBe(409);
});
test("process duplicate policy, column rename and explicit target migration retain row and cell identity", async () => {
  const parent = await start(),
    columnId = operationId();
  let m = await model({
    kind: "process",
    name: "Reprise",
    target: "dossier",
    allowDuplicates: true,
    columns: [{ id: columnId, name: "Collecte", type: "text" }],
  });
  const create = () =>
    f.request("POST", `/production/models/${m.id}/rows`, {
      operationId: operationId(),
      expectedVersion: m.version,
      target: { kind: "dossier", id: parent.id, label: parent.title },
    });
  const a = (await create()).json(),
    b = (await create()).json();
  expect(a.id).not.toBe(b.id);
  const edit = await f.request("POST", `/production/rows/${a.id}/commands`, {
    operationId: operationId(),
    expectedVersion: 1,
    command: { kind: "cell", columnId, period: "once", value: "Dossier reçu" },
  });
  expect(edit.statusCode, edit.body).toBe(200);
  m = await model(
    { ...m.model, columns: [{ ...m.model.columns[0], name: "Pièces" }] },
    m.id,
    m.version,
  );
  expect(
    (await f.request("GET", `/production/rows/${a.id}`)).json().cells[0].value,
  ).toBe("Dossier reçu");
  expect(
    (
      await f.request("POST", "/production/models", {
        operationId: operationId(),
        id: m.id,
        expectedVersion: m.version,
        model: { ...m.model, target: "libre" },
      })
    ).statusCode,
  ).toBe(409);
  const migration = await f.request(
    "POST",
    `/production/models/${m.id}/migrate-targets`,
    {
      operationId: operationId(),
      expectedVersion: m.version,
      target: "libre",
      reason: "Reprise des lignes libres",
      mappings: [
        {
          rowId: a.id,
          expectedVersion: 2,
          target: { kind: "libre", id: null, label: "Reprise A" },
        },
        {
          rowId: b.id,
          expectedVersion: 1,
          target: { kind: "libre", id: null, label: "Reprise B" },
        },
      ],
    },
  );
  expect(migration.statusCode, migration.body).toBe(200);
  const reloaded = (await f.request("GET", `/production/rows/${a.id}`)).json();
  expect(reloaded.id).toBe(a.id);
  expect(reloaded.cells[0].value).toBe("Dossier reçu");
  expect(reloaded.target.kind).toBe("libre");
});
test("custom rule generation pauses, resumes and preserves treated occurrences while reporting every selected target", async () => {
  const parent = await start();
  const m = await model({
    kind: "custom",
    name: "Attestation annuelle",
    target: "dossier",
    population: [parent.id],
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
        id: operationId(),
        name: "État",
        type: "completion",
        frequency: "monthly",
      },
    ],
  });
  const run = await f.request("POST", "/production/generate", {
    operationId: operationId(),
    modelId: m.id,
    from: "2026-01-01",
    to: "2026-03-31",
  });
  expect(run.statusCode, run.body).toBe(202);
  const finished = await waitJob(run.json().jobId);
  expect(finished.state).toBe("completed");
  const rows = (
    await f.request("GET", `/production/models/${m.id}/rows`)
  ).json().items;
  expect(rows.map((r: any) => r.dueDate).sort()).toEqual([
    "2026-01-31",
    "2026-02-28",
    "2026-03-31",
  ]);
  const first = rows.find((r: any) => r.period === "2026-01");
  const mark = await f.request(
    "POST",
    `/production/rows/${first.id}/commands`,
    {
      operationId: operationId(),
      expectedVersion: 1,
      command: {
        kind: "properties",
        dueDate: first.dueDate,
        assigneeId: null,
        tags: [],
        state: "done",
        documentIds: [],
      },
    },
  );
  expect(mark.statusCode, mark.body).toBe(200);
  const paused = await model({ ...m.model, paused: true }, m.id, m.version);
  expect(
    (
      await f.request("POST", "/production/generate", {
        operationId: operationId(),
        modelId: m.id,
        from: "2026-01-01",
        to: "2026-03-31",
      })
    ).statusCode,
  ).toBe(409);
  await model(
    {
      ...paused.model,
      paused: false,
      rule: { ...paused.model.rule, nominalDay: 15 },
    },
    m.id,
    paused.version,
  );
  const rerun = await f.request("POST", "/production/generate", {
    operationId: operationId(),
    modelId: m.id,
    from: "2026-01-01",
    to: "2026-03-31",
  });
  expect(rerun.statusCode, rerun.body).toBe(202);
  await waitJob(rerun.json().jobId);
  const saved = (
    await f.request("GET", `/production/models/${m.id}/rows`)
  ).json().items;
  expect(saved).toHaveLength(3);
  expect(saved.find((r: any) => r.id === first.id)).toMatchObject({
    state: "done",
    dueDate: "2026-01-31",
  });
  expect(
    saved
      .filter((r: any) => r.id !== first.id)
      .map((r: any) => r.dueDate)
      .sort(),
  ).toEqual(["2026-02-15", "2026-03-15"]);
  const outcomes = (
    await f.request("GET", `/production/jobs/${rerun.json().jobId}/results`)
  ).json().items;
  expect(outcomes).toHaveLength(3);
  expect(outcomes.filter((x: any) => x.state === "regenerated")).toHaveLength(
    2,
  );
});

async function waitJob(id: string) {
  for (let i = 0; i < 200; i++) {
    const r = await f.request("GET", `/production/jobs/${id}`);
    expect(r.statusCode, r.body).toBe(200);
    if (r.json().state === "completed") return r.json();
    if (r.json().state === "failed") throw Error(r.body);
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error("Job timeout");
}
test("stage reprise retains mixed invalid rows in report and explicitly commits usable ordered models", async () => {
  await start();
  const csv =
    "Modèle;Statut;Couleur;Icône;Final\nRévision;À faire;gray;circle;false\nRévision;Invalide;magenta;clock;false\nRévision;Terminé;green;check;true";
  const r = await f.request("POST", "/production/imports/preview", {
    format: "memlia-stages-1",
    filename: "stages.csv",
    base64: Buffer.from(csv).toString("base64"),
    mapping: {
      model: "Modèle",
      status: "Statut",
      color: "Couleur",
      icon: "Icône",
      final: "Final",
    },
  });
  expect(r.statusCode, r.body).toBe(201);
  const p = r.json();
  expect(p.models[0].statuses.map((s: any) => s.name)).toEqual([
    "À faire",
    "Terminé",
  ]);
  expect(p.unmapped).toEqual([
    { line: 3, reason: "Statut, couleur, icône ou état final invalide." },
  ]);
  const { xlsxFixture } = await import("./xlsx-fixture.js");
  const xlsx = await f.request("POST", "/production/imports/preview", {
    format: "memlia-stages-1",
    filename: "stages.xlsx",
    base64: xlsxFixture([
      ["Modèle", "Statut", "Couleur", "Icône", "Final"],
      ["Révision XLSX", "Validé", "green", "check", "true"],
    ]).toString("base64"),
    mapping: {
      model: "Modèle",
      status: "Statut",
      color: "Couleur",
      icon: "Icône",
      final: "Final",
    },
  });
  expect(xlsx.statusCode, xlsx.body).toBe(201);
  expect(xlsx.json().models[0].statuses[0]).toMatchObject({
    name: "Validé",
    color: "green",
    icon: "check",
    final: true,
  });
  const c = await f.request("POST", `/production/imports/${p.id}/commit`, {
    operationId: operationId(),
    validatedModels: [0],
  });
  expect(c.statusCode, c.body).toBe(200);
  expect(c.json().items[0].model.statuses).toHaveLength(2);
});

test("a populated balance year duplicates plans and fee without any actual date, approved cell or register receipt", async () => {
  const parent = await start(),
    col = operationId();
  const m = await model({
    kind: "balance",
    name: "Bilan peuplé",
    year: 2026,
    family: "BNC",
    target: "dossier",
    fee: "1500.75",
    columns: [
      {
        id: col,
        name: "Révision",
        type: "boolean",
        approval: true,
        plannedDate: "2026-05-31",
        plannedMinutes: 120,
      },
    ],
  });
  const row = (
    await f.request("POST", `/production/models/${m.id}/rows`, {
      operationId: operationId(),
      expectedVersion: 1,
      target: { kind: "dossier", id: parent.id, label: parent.title },
      period: "2026",
    })
  ).json();
  const meta = {
    operationId: operationId(),
    dossierId: parent.id,
    filename: "recu-fictif.txt",
    mediaType: "text/plain",
    source: {
      kind: "simulated",
      reference: "Registre fictif 2026",
      version: "1",
    },
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
      `--piece\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(meta)}\r\n--piece\r\nContent-Disposition: form-data; name="file"; filename="recu-fictif.txt"\r\nContent-Type: text/plain\r\n\r\nRecu fictif independant\r\n--piece--\r\n`,
    ),
  });
  expect(upload.statusCode, upload.body).toBe(201);
  const doc = upload.json();
  const approved = await f.request(
    "POST",
    `/production/rows/${row.id}/commands`,
    {
      operationId: operationId(),
      expectedVersion: 1,
      command: {
        kind: "cell",
        columnId: col,
        period: "once",
        value: true,
        approve: true,
      },
    },
  );
  expect(approved.statusCode, approved.body).toBe(200);
  const deposited = await f.request(
    "POST",
    `/production/rows/${row.id}/commands`,
    {
      operationId: operationId(),
      expectedVersion: 2,
      command: {
        kind: "deposit",
        deposit: {
          assemblyDate: "2026-06-15",
          liasseDate: "2026-05-29",
          attempts: [
            {
              id: operationId(),
              date: "2026-06-20",
              state: "accepted",
              source: "simulated",
              reference: "INPI fictif",
              documentIds: [doc.id],
              receiptDocumentId: doc.id,
            },
          ],
        },
      },
    },
  );
  expect(deposited.statusCode, deposited.body).toBe(200);
  const duplicate = await f.request(
    "POST",
    `/production/models/${m.id}/duplicate`,
    { operationId: operationId(), expectedVersion: 1, year: 2027 },
  );
  expect(duplicate.statusCode, duplicate.body).toBe(200);
  const next = duplicate.json();
  expect(next.model.columns[0]).toMatchObject({
    id: col,
    plannedDate: "2027-05-31",
    plannedMinutes: 120,
  });
  expect(next.model.fee).toBe("1500.75");
  const fresh = await f.request("POST", `/production/models/${next.id}/rows`, {
    operationId: operationId(),
    expectedVersion: 1,
    target: { kind: "dossier", id: parent.id, label: parent.title },
    period: "2027",
  });
  expect(fresh.statusCode, fresh.body).toBe(200);
  expect(fresh.json()).toMatchObject({
    cells: [],
    deposit: { assemblyDate: null, liasseDate: null, attempts: [] },
  });
  expect(fresh.json().id).not.toBe(row.id);
  expect(
    (await f.request("GET", `/production/rows/${row.id}`)).json().deposit
      .attempts[0].receiptDocumentId,
  ).toBe(doc.id);
});

test("configured role and approval permission are both required before mutation and replay", async () => {
  const parent = await start();
  const roleResponse = await f.request("POST", "/administration/roles", {
    operationId: operationId(),
    name: "Réviseur",
    order: 1,
    permissions: [],
  });
  expect(roleResponse.statusCode, roleResponse.body).toBe(201);
  const role = roleResponse.json(),
    columnId = operationId();
  const m = await model({
    kind: "balance",
    name: "Bilan contrôlé",
    year: 2026,
    family: "BIC",
    target: "dossier",
    columns: [
      {
        id: columnId,
        name: "Révision",
        type: "boolean",
        approval: true,
        requiredRoleId: role.id,
      },
    ],
  });
  const row = (
    await f.request("POST", `/production/models/${m.id}/rows`, {
      operationId: operationId(),
      expectedVersion: 1,
      target: { kind: "dossier", id: parent.id, label: parent.title },
      period: "2026",
    })
  ).json();
  const permissions = ["read", "update", "approve", "export"].map((action) => ({
    action,
    kind: "*",
    dossierId: null,
  }));
  let person = (
    await f.request("POST", "/users", {
      operationId: operationId(),
      email: "reviewer-production@example.test",
      name: "Réviseur fictif",
      password: "MotDePasseFictif123!",
      permissions,
    })
  ).json();
  const login = await f.request(
    "POST",
    "/login",
    { email: person.email, password: "MotDePasseFictif123!" },
    "",
  );
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const command = {
    operationId: operationId(),
    expectedVersion: 1,
    command: {
      kind: "cell",
      columnId,
      period: "once",
      value: true,
      approve: true,
    },
  };
  expect(
    (
      await f.request(
        "POST",
        `/production/rows/${row.id}/commands`,
        command,
        cookie,
      )
    ).statusCode,
  ).toBe(403);
  async function roles(ids: string[], grants = permissions) {
    const r = await f.request("PUT", `/administration/users/${person.id}`, {
      operationId: operationId(),
      expectedVersion: person.version,
      name: person.name,
      active: true,
      permissions: grants,
      roleIds: ids,
    });
    expect(r.statusCode, r.body).toBe(200);
    person = r.json();
  }
  await roles(
    [role.id],
    permissions.filter((x) => x.action !== "approve"),
  );
  expect(
    (
      await f.request(
        "POST",
        `/production/rows/${row.id}/commands`,
        command,
        cookie,
      )
    ).statusCode,
  ).toBe(404);
  await roles([role.id]);
  const success = await f.request(
    "POST",
    `/production/rows/${row.id}/commands`,
    command,
    cookie,
  );
  expect(success.statusCode, success.body).toBe(200);
  await roles([]);
  expect(
    (
      await f.request(
        "POST",
        `/production/rows/${row.id}/commands`,
        command,
        cookie,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (await f.request("GET", `/production/rows/${row.id}`)).json().cells[0]
      .approved,
  ).toBe(true);
});

test("followup cell periods remain independent and async CSV plus complete exit include actual typed values and historical versions", async () => {
  const parent = await start(),
    column = operationId();
  const m = await model({
    kind: "followup",
    name: "Suivi indépendant",
    target: "dossier",
    columns: [
      { id: column, name: "Montant", type: "decimal", frequency: "monthly" },
    ],
  });
  let row = (
    await f.request("POST", `/production/models/${m.id}/rows`, {
      operationId: operationId(),
      expectedVersion: 1,
      target: { kind: "dossier", id: parent.id, label: parent.title },
      period: "2026",
    })
  ).json();
  for (const [period, value] of [
    ["2026-02", "0"],
    ["2026-03", "1200.50"],
  ]) {
    const r = await f.request("POST", `/production/rows/${row.id}/commands`, {
      operationId: operationId(),
      expectedVersion: row.version,
      command: { kind: "cell", columnId: column, period, value },
    });
    expect(r.statusCode, r.body).toBe(200);
    row = r.json();
  }
  await f.restart();
  expect(
    (await f.request("GET", `/production/rows/${row.id}`))
      .json()
      .cells.map((c: any) => c.value),
  ).toEqual(["0", "1200.50"]);
  const started = await f.request("POST", "/production/exports", {
    operationId: operationId(),
    modelId: m.id,
    query: {},
  });
  expect(started.statusCode, started.body).toBe(202);
  let result;
  for (let n = 0; n < 100; n++) {
    result = (
      await f.request("GET", `/production/exports/${started.json().jobId}`)
    ).json();
    if (result.job.state === "completed" || result.job.state === "failed")
      break;
    await new Promise((r) => setTimeout(r, 30));
  }
  expect(result.job.state, JSON.stringify(result)).toBe("completed");
  const csv = await f.request(
    "GET",
    `/production/exports/${started.json().jobId}/parts/1`,
  );
  expect(csv.statusCode, csv.body).toBe(200);
  expect(csv.body).toContain('"2026-02";"0"');
  expect(csv.body).toContain('"2026-03";"1200.50"');
  const exit = await f.request("POST", "/administration/exports", {
    operationId: operationId(),
  });
  expect(exit.statusCode, exit.body).toBe(202);
  const exportId = exit.json().id;
  let done;
  for (let n = 0; n < 200; n++) {
    done = (
      await f.request("GET", `/administration/exports/${exportId}`)
    ).json();
    if (done.job?.state === "completed" || done.job?.state === "failed") break;
    await new Promise((r) => setTimeout(r, 30));
  }
  expect(done.job.state, JSON.stringify(done)).toBe("completed");
  const download = await f.request(
    "GET",
    `/administration/exports/${exportId}/download`,
  );
  expect(download.statusCode, download.body).toBe(200);
  const production = [];
  for (const part of download.json().parts) {
    const p = await f.request(
      "GET",
      `/administration/exports/${exportId}/parts/${part.number}`,
    );
    expect(p.statusCode, p.body).toBe(200);
    production.push(...p.json().production);
  }
  expect(production.some((e: any) => e.entity === "grid_export")).toBe(true);
  expect(production.some((e: any) => e.entity === "grid_export_row")).toBe(
    true,
  );
  expect(
    production.some(
      (x: any) =>
        x.entity === "row" &&
        x.data.id === row.id &&
        x.data.cells[1].value === "1200.50",
    ),
  ).toBe(true);
  expect(
    production.filter(
      (x: any) => x.entity === "row_version" && x.data.id === row.id,
    ),
  ).toHaveLength(3);
});

test("custom local completion and supplier observations remain distinct with typed state and campaign provenance", async () => {
  const parent = await start(),
    col = operationId();
  const m = await model({
    kind: "custom",
    name: "DAS2 locale",
    nature: "DAS2",
    target: "dossier",
    rule: {
      frequency: "yearly",
      start: "2026-01-01",
      end: "2026-12-31",
      nominalDay: 31,
      lastDay: false,
      weekDay: 1,
    },
    allowDuplicates: true,
    columns: [{ id: col, name: "Réalisation", type: "completion" }],
  });
  const create = () =>
    f.request("POST", `/production/models/${m.id}/rows`, {
      operationId: operationId(),
      expectedVersion: 1,
      target: { kind: "dossier", id: parent.id, label: parent.title },
      period: "2026",
    });
  const a = (await create()).json(),
    b = (await create()).json();
  expect(a.id).not.toBe(b.id);
  const completed = await f.request(
    "POST",
    `/production/rows/${a.id}/commands`,
    {
      operationId: operationId(),
      expectedVersion: 1,
      command: { kind: "cell", columnId: col, period: "once", value: "done" },
    },
  );
  expect(completed.statusCode, completed.body).toBe(200);
  expect(completed.json().state).toBe("done");
  expect(completed.json().observations).toEqual([]);
  const observed = await f.request(
    "POST",
    `/production/rows/${a.id}/commands`,
    {
      operationId: operationId(),
      expectedVersion: 2,
      command: {
        kind: "observation",
        observation: {
          id: operationId(),
          source: "simulated",
          reference: "Fournisseur fictif",
          campaign: "2026",
          observedOn: "2026-10-17",
          state: "not_observed",
          documentIds: [],
        },
      },
    },
  );
  expect(observed.statusCode, observed.body).toBe(200);
  expect(observed.json().state).toBe("done");
  expect(observed.json().observations[0]).toMatchObject({
    campaign: "2026",
    state: "not_observed",
    source: "simulated",
  });
});

test("confidential production history is filtered before pagination, calendar and export; read-only readers cannot mutate", async () => {
  const d = await start();
  const c = operationId();
  const m = await model({
    kind: "balance",
    name: "Bilans protégés",
    target: "dossier",
    year: 2026,
    family: "BIC",
    columns: [{ id: c, name: "Note", type: "text" }],
  });
  const r = (
    await f.request("POST", `/production/models/${m.id}/rows`, {
      operationId: operationId(),
      expectedVersion: 1,
      target: { kind: "dossier", id: d.id, label: d.title },
      period: "2026",
    })
  ).json();
  const meta = {
    operationId: operationId(),
    dossierId: d.id,
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
      `--piece\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(meta)}\r\n--piece\r\nContent-Disposition: form-data; name="file"; filename="confidentiel.txt"\r\nContent-Type: text/plain\r\n\r\nOriginal fictif\r\n--piece--\r\n`,
    ),
  });
  expect(upload.statusCode, upload.body).toBe(201);
  const command = {
    operationId: operationId(),
    expectedVersion: 1,
    command: {
      kind: "cell",
      columnId: c,
      period: "once",
      value: "Note protégée",
      documentIds: [upload.json().id],
    },
  };
  expect(
    (await f.request("POST", `/production/rows/${r.id}/commands`, command))
      .statusCode,
  ).toBe(200);
  expect(
    (
      await f.request("POST", `/production/rows/${r.id}/commands`, {
        operationId: operationId(),
        expectedVersion: 2,
        command: {
          kind: "cell",
          columnId: c,
          period: "once",
          value: "Révisée",
          documentIds: [],
        },
      })
    ).statusCode,
  ).toBe(200);
  const d2 = (
    await f.request("POST", "/records", dossier("Visible fictif"))
  ).json();
  const visible = (
    await f.request("POST", `/production/models/${m.id}/rows`, {
      operationId: operationId(),
      expectedVersion: 1,
      target: { kind: "dossier", id: d2.id, label: d2.title },
      period: "2026",
    })
  ).json();
  const person = (
    await f.request("POST", "/users", {
      operationId: operationId(),
      email: "scope-production@example.test",
      name: "Lecture production",
      password: "MotDePasseFictif123!",
      permissions: ["read", "export"].map((action) => ({
        action,
        kind: "*",
        dossierId: null,
      })),
    })
  ).json();
  const login = await f.request(
    "POST",
    "/login",
    { email: person.email, password: "MotDePasseFictif123!" },
    "",
  );
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const list = await f.request(
    "GET",
    `/production/models/${m.id}/rows`,
    undefined,
    cookie,
  );
  expect(list.statusCode, list.body).toBe(200);
  expect(list.json().items.map((r: any) => r.id)).toEqual([visible.id]);
  expect(list.json().hasMore).toBe(false);
  expect(
    (await f.request("GET", `/production/rows/${r.id}`, undefined, cookie))
      .statusCode,
  ).toBe(404);
  expect(
    (
      await f.request(
        "POST",
        `/production/rows/${r.id}/commands`,
        command,
        cookie,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await f.request(
        "POST",
        `/production/rows/${visible.id}/commands`,
        { ...command, operationId: operationId() },
        cookie,
      )
    ).statusCode,
  ).toBe(404);
  const calendar = await f.request(
    "GET",
    "/workflows/calendar?kind=obligation",
    undefined,
    cookie,
  );
  expect(calendar.statusCode, calendar.body).toBe(200);
  expect(calendar.json().items.map((r: any) => r.id)).toEqual([visible.id]);
  expect(calendar.json().productionIds).toEqual([visible.id]);
  const today = await f.request("GET", "/production/calendar");
  expect(today.json()).toEqual({ today: "2026-10-17" });
});

test("DCA filters preserve waiting, rejection and non-applicability while annual planned work advances on the shared calendar", async () => {
  const parent = await start();
  const col1 = operationId(),
    col2 = operationId();
  const m = await model({
    kind: "balance",
    name: "Campagne comptes",
    target: "dossier",
    year: 2026,
    family: "BIC",
    columns: [
      {
        id: col1,
        name: "Révision",
        type: "boolean",
        plannedDate: "2026-04-10",
        plannedMinutes: 90,
      },
      {
        id: col2,
        name: "Finalisation",
        type: "date",
        plannedDate: "2026-05-20",
        plannedMinutes: 30,
      },
    ],
  });
  const rows = [];
  for (const [index, state] of [
    "waiting",
    "rejected",
    "not_applicable",
    "not_submitted",
  ].entries()) {
    const d =
      index === 0
        ? parent
        : (
            await f.request("POST", "/records", dossier("Comptes " + index))
          ).json();
    const response = await f.request(
      "POST",
      `/production/models/${m.id}/rows`,
      {
        operationId: operationId(),
        expectedVersion: 1,
        target: { kind: "dossier", id: d.id, label: d.title },
        period: "2026",
      },
    );
    expect(response.statusCode, response.body).toBe(200);
    const r = response.json();
    expect(r.dueDate).toBe("2026-04-10");
    const update = await f.request(
      "POST",
      `/production/rows/${r.id}/commands`,
      {
        operationId: operationId(),
        expectedVersion: 1,
        command: {
          kind: "deposit",
          deposit: {
            applicable: state !== "not_applicable",
            assemblyDate: `2026-06-${String(index + 10).padStart(2, "0")}`,
            manualComplete: true,
            attempts: ["waiting", "rejected"].includes(state)
              ? [
                  {
                    id: operationId(),
                    date: "2026-06-15",
                    state,
                    source: "manual",
                    reference: "Fictif",
                    documentIds: [],
                    receiptDocumentId: null,
                  },
                ]
              : [],
          },
        },
      },
    );
    expect(update.statusCode, update.body).toBe(200);
    rows.push(update.json());
    const filtered = await f.request(
      "GET",
      `/production/models/${m.id}/rows?deposit=${state}`,
    );
    expect(filtered.statusCode, filtered.body).toBe(200);
    expect(filtered.json().items.map((r: any) => r.id)).toEqual([r.id]);
  }
  const sorted = await f.request(
    "GET",
    `/production/models/${m.id}/rows?sort=assemblyDate&direction=desc`,
  );
  expect(sorted.json().items.map((r: any) => r.id)).toEqual(
    rows.map((r) => r.id).reverse(),
  );
  const changed = await f.request(
    "POST",
    `/production/rows/${rows[0].id}/commands`,
    {
      operationId: operationId(),
      expectedVersion: 2,
      command: { kind: "cell", columnId: col1, period: "once", value: true },
    },
  );
  expect(changed.statusCode, changed.body).toBe(200);
  expect(changed.json().dueDate).toBe("2026-05-20");
  const calendar = (
    await f.request(
      "GET",
      "/workflows/calendar?kind=obligation&from=2026-05-01&to=2026-05-31",
    )
  ).json();
  expect(calendar.items.map((r: any) => r.id)).toEqual([rows[0].id]);
  expect(calendar.productionIds).toEqual([rows[0].id]);
});

test("reusable status models can evolve before use and preserve used values through reorder, rename and preview", async () => {
  const d = await start(),
    a = operationId(),
    b = operationId();
  let type = await model({
    kind: "stage_type",
    name: "Validation",
    statuses: [
      { id: a, name: "À revoir", color: "gray", icon: "circle", final: false },
      { id: b, name: "En cours", color: "blue", icon: "clock", final: false },
    ],
  });
  type = await model(
    {
      ...type.model,
      statuses: [
        {
          ...type.model.statuses[1],
          name: "Validé",
          color: "green",
          icon: "check",
          final: true,
        },
        type.model.statuses[0],
      ],
    },
    type.id,
    type.version,
  );
  const col = operationId(),
    m = await model({
      kind: "process",
      name: "Contrôle",
      target: "dossier",
      columns: [
        { id: col, name: "État", type: "status", stageTypeId: type.id },
      ],
    });
  const row = (
    await f.request("POST", `/production/models/${m.id}/rows`, {
      operationId: operationId(),
      expectedVersion: 1,
      target: { kind: "dossier", id: d.id, label: d.title },
      period: "once",
    })
  ).json();
  const cell = await f.request("POST", `/production/rows/${row.id}/commands`, {
    operationId: operationId(),
    expectedVersion: 1,
    command: { kind: "cell", columnId: col, period: "once", value: b },
  });
  expect(cell.statusCode, cell.body).toBe(200);
  type = await model(
    {
      ...type.model,
      statuses: [
        type.model.statuses[1],
        {
          ...type.model.statuses[0],
          name: "Revu",
          color: "purple",
          icon: "check",
        },
      ],
    },
    type.id,
    type.version,
  );
  expect(type.model.statuses.map((s: any) => s.id)).toEqual([a, b]);
  expect(
    (await f.request("GET", `/production/rows/${row.id}`)).json().cells[0]
      .value,
  ).toBe(b);
  expect(
    (
      await f.request("POST", "/production/models", {
        operationId: operationId(),
        id: type.id,
        expectedVersion: type.version,
        model: { ...type.model, statuses: [type.model.statuses[0]] },
      })
    ).statusCode,
  ).toBe(409);
});

test("generation reports the existing annual family identity even when another configuration owns it", async () => {
  const d = await start();
  const a = await model({
    kind: "balance",
    name: "Famille BIC",
    target: "dossier",
    year: 2026,
    family: "BIC",
  });
  const row = (
    await f.request("POST", `/production/models/${a.id}/rows`, {
      operationId: operationId(),
      expectedVersion: 1,
      target: { kind: "dossier", id: d.id, label: d.title },
      period: "2026",
    })
  ).json();
  const b = await model({
    kind: "balance",
    name: "Autre population BIC",
    target: "dossier",
    year: 2026,
    family: "BIC",
    population: [d.id],
  });
  const started = await f.request("POST", "/production/generate", {
    operationId: operationId(),
    modelId: b.id,
    from: "2026-01-01",
    to: "2026-12-31",
  });
  expect(started.statusCode, started.body).toBe(202);
  await waitJob(started.json().jobId);
  const results = (
    await f.request("GET", `/production/jobs/${started.json().jobId}/results`)
  ).json();
  expect(results.items).toMatchObject([{ state: "existing", rowId: row.id }]);
  const exit = (
    await f.request("POST", "/administration/exports", {
      operationId: operationId(),
    })
  ).json();
  let state;
  for (let n = 0; n < 200; n++) {
    state = (
      await f.request("GET", `/administration/exports/${exit.id}`)
    ).json();
    if (["completed", "failed"].includes(state.job.state)) break;
    await new Promise((r) => setTimeout(r, 30));
  }
  expect(state.job.state, JSON.stringify(state)).toBe("completed");
  const manifest = (
    await f.request("GET", `/administration/exports/${exit.id}/download`)
  ).json();
  const exported = [];
  for (const part of manifest.parts) {
    const data = await f.request(
      "GET",
      `/administration/exports/${exit.id}/parts/${part.number}`,
    );
    expect(data.statusCode, data.body).toBe(200);
    exported.push(...data.json().production);
  }
  expect(
    exported.find((e) => e.entity === "generation_result").data,
  ).toMatchObject({
    runId: started.json().jobId,
    modelId: b.id,
    modelVersion: 1,
    rowId: row.id,
    state: "existing",
  });
});
