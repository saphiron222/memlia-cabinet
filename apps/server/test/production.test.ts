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
 const first=rows.find((r:any)=>r.period==='2026-01');
 const mark=await f.request('POST',`/production/rows/${first.id}/commands`,{operationId:operationId(),expectedVersion:1,command:{kind:'properties',dueDate:first.dueDate,assigneeId:null,tags:[],state:'done',documentIds:[]}});expect(mark.statusCode,mark.body).toBe(200);
 const paused=await model({...m.model,paused:true},m.id,m.version);
 expect((await f.request('POST','/production/generate',{operationId:operationId(),modelId:m.id,from:'2026-01-01',to:'2026-03-31'})).statusCode).toBe(409);
 await model({...paused.model,paused:false,rule:{...paused.model.rule,nominalDay:15}},m.id,paused.version);
 const rerun=await f.request('POST','/production/generate',{operationId:operationId(),modelId:m.id,from:'2026-01-01',to:'2026-03-31'});expect(rerun.statusCode,rerun.body).toBe(202);await waitJob(rerun.json().jobId);
 const saved=(await f.request('GET',`/production/models/${m.id}/rows`)).json().items;
 expect(saved).toHaveLength(3);expect(saved.find((r:any)=>r.id===first.id)).toMatchObject({state:'done',dueDate:'2026-01-31'});expect(saved.filter((r:any)=>r.id!==first.id).map((r:any)=>r.dueDate).sort()).toEqual(['2026-02-15','2026-03-15']);
 const outcomes=(await f.request('GET',`/production/jobs/${rerun.json().jobId}/results`)).json().items;expect(outcomes).toHaveLength(3);expect(outcomes.filter((x:any)=>x.state==='regenerated')).toHaveLength(2);

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
  const production=[];
  for(const part of download.json().parts){const p=await f.request('GET',`/administration/exports/${exportId}/parts/${part.number}`);expect(p.statusCode,p.body).toBe(200);production.push(...p.json().production);}
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
