import { afterEach, expect, test } from "vitest";
import { fixture, dossier, operationId } from "./helpers.js";
let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
});
async function start() {
  f = await fixture(() => new Date("2026-10-17T10:00:00Z"));
  const actor = await f.setup();
  const parent = (await f.request("POST", "/records", dossier())).json();
  return { actor, parent };
}
const monthly = {
  frequency: "monthly",
  start: "2027-01-01",
  end: "2028-03-31",
  nominalDay: 31,
  lastDay: false,
  weekDay: 1,
};
test("civil recurrence preserves nominal 31 through short months, leap years, DST and past starts", async () => {
  await start();
  for (const [rule, from, to, want] of [
    [
      monthly,
      "2027-02-01",
      "2027-04-30",
      ["2027-02-28", "2027-03-31", "2027-04-30"],
    ],
    [monthly, "2028-02-01", "2028-02-29", ["2028-02-29"]],
    [
      { ...monthly, frequency: "quarterly" },
      "2027-01-01",
      "2027-12-31",
      ["2027-01-31", "2027-04-30", "2027-07-31", "2027-10-31"],
    ],
    [
      {
        ...monthly,
        frequency: "yearly",
        start: "2024-02-01",
        end: "2028-12-31",
      },
      "2027-01-01",
      "2028-12-31",
      ["2027-02-28", "2028-02-29"],
    ],
    [
      {
        ...monthly,
        frequency: "weekly",
        start: "2026-03-01",
        end: "2026-04-30",
        weekDay: 7,
      },
      "2026-03-22",
      "2026-04-05",
      ["2026-03-22", "2026-03-29", "2026-04-05"],
    ],
  ] as const) {
    const response = await f.request("POST", "/workflows/preview", {
      rule,
      from,
      to,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().dates).toEqual(want);
  }
});
async function model(
  kind: string,
  data: Record<string, unknown>,
  id?: string,
  version = 0,
) {
  const r = await f.request("POST", "/workflows/models", {
    operationId: operationId(),
    id: id ?? operationId(),
    expectedVersion: version,
    model: { kind, ...data },
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
test("checklist versions freeze existing instances, preserve edits on explicit merge, and reject concurrent writes on task TVA and DAS2", async () => {
  const { parent } = await start();
  const a = operationId(),
    b = operationId(),
    c = operationId();
  let m = await model("checklist", {
    name: "Contrôle fictif",
    targetKinds: ["tache", "TVA", "DAS2"],
    items: [
      { id: a, label: "Pièce" },
      { id: b, label: "Contrôle" },
      { id: c, label: "Archive" },
    ],
  });
  const task = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "tache",
        title: "Travail fictif",
        dossierId: parent.id,
        data: {},
      },
    })
  ).json();
  const ids = [task.id];
  for (const nature of ["TVA", "DAS2"]) {
    const r = await f.request("POST", "/fiscal", {
      operationId: operationId(),
      dossierId: parent.id,
      title: nature + " fictive",
      nature,
      period: {
        start: "2026-01-01",
        end: "2026-12-31",
        campaign: "2026",
        subtype: "annuelle",
      },
    });
    ids.push(r.json().record.id);
  }
  for (const id of ids) {
    let r = await f.request("POST", `/workflows/targets/${id}/commands`, {
      operationId: operationId(),
      expectedVersion: 0,
      command: { kind: "instantiate", modelId: m.id },
    });
    expect(r.statusCode, r.body).toBe(200);
    let work = r.json();
    expect(work.checklist.modelVersion).toBe(1);
    const cmd = {
      operationId: operationId(),
      expectedVersion: work.version,
      command: {
        kind: "checklist",
        items: [
          { ...work.checklist.items[2], done: true },
          { ...work.checklist.items[0], done: true },
        ],
      },
    };
    r = await f.request("POST", `/workflows/targets/${id}/commands`, cmd);
    expect(r.statusCode, r.body).toBe(200);
    expect(
      (
        await f.request("POST", `/workflows/targets/${id}/commands`, cmd)
      ).json(),
    ).toEqual(r.json());
    expect(
      (
        await f.request("POST", `/workflows/targets/${id}/commands`, {
          ...cmd,
          operationId: operationId(),
        })
      ).statusCode,
    ).toBe(409);
  }
  m = await model(
    "checklist",
    {
      ...m.model,
      items: [
        { id: a, label: "Pièce modifiée" },
        { id: b, label: "Contrôle" },
        { id: c, label: "Archive" },
        { id: operationId(), label: "Nouveau" },
      ],
    },
    m.id,
    1,
  );
  await f.restart();
  for (const id of ids) {
    let work = (await f.request("GET", `/workflows/targets/${id}`)).json();
    expect(work.checklist.items.map((i: { label: string }) => i.label)).toEqual(
      ["Archive", "Pièce"],
    );
    expect(work.checklist.modelVersion).toBe(1);
    const r = await f.request("POST", `/workflows/targets/${id}/commands`, {
      operationId: operationId(),
      expectedVersion: work.version,
      command: { kind: "merge", modelId: m.id },
    });
    expect(r.statusCode, r.body).toBe(200);
    work = r.json();
    expect(work.checklist.items.map((i: { label: string }) => i.label)).toEqual(
      ["Archive", "Pièce", "Nouveau"],
    );
    expect(work.checklist.items[0].done).toBe(true);
    expect(work.checklist.modelVersion).toBe(2);
  }
});
test("mentions and subscriptions recheck recipient rights, preserve internal audience and notification read state after restart", async () => {
  const { parent } = await start();
  const u = (
    await f.request("POST", "/users", {
      operationId: operationId(),
      email: "reader@example.test",
      name: "Lecteur fictif",
      password: "UnMotDePasseFictif123!",
      permissions: [{ action: "read", kind: "*", dossierId: null }],
    })
  ).json();
  const login = await f.request(
    "POST",
    "/login",
    { email: "reader@example.test", password: "UnMotDePasseFictif123!" },
    "",
  );
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const task = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "tache",
        title: "Secret fictif",
        dossierId: parent.id,
        data: {},
      },
    })
  ).json();
  let r = await f.request(
    "POST",
    `/workflows/targets/${task.id}/commands`,
    {
      operationId: operationId(),
      expectedVersion: 0,
      command: { kind: "subscribe", enabled: true },
    },
    cookie,
  );
  expect(r.statusCode, r.body).toBe(200);
  r = await f.request("POST", `/workflows/targets/${task.id}/commands`, {
    operationId: operationId(),
    expectedVersion: 1,
    command: {
      kind: "comment",
      text: "Texte identique",
      mentions: [u.id],
      audience: "internal",
    },
  });
  expect(r.statusCode, r.body).toBe(200);
  let notices = await f.request("GET", "/notifications", undefined, cookie);
  expect(notices.statusCode, notices.body).toBe(200);
  expect(notices.json().items).toHaveLength(1);
  expect(notices.json().items[0].text).toBe("Texte identique");
  const notice = notices.json().items[0];
  r = await f.request(
    "POST",
    `/notifications/${notice.id}`,
    { operationId: operationId(), expectedVersion: 1, state: "read" },
    cookie,
  );
  expect(r.statusCode, r.body).toBe(200);
  await f.restart();
  expect(
    (await f.request("GET", "/notifications", undefined, cookie)).json()
      .items[0].state,
  ).toBe("read");
  r = await f.request("POST", `/workflows/targets/${task.id}/commands`, {
    operationId: operationId(),
    expectedVersion: 2,
    command: {
      kind: "comment",
      text: "Texte identique",
      mentions: [u.id],
      audience: "client",
    },
  });
  expect(r.statusCode).toBe(400);
  const revoke = await f.request("PUT", `/users/${u.id}`, {
    operationId: operationId(),
    expectedVersion: u.version,
    active: true,
    permissions: [],
  });
  expect(revoke.statusCode, revoke.body).toBe(200);
  notices = await f.request("GET", "/notifications", undefined, cookie);
  expect(notices.json().items).toEqual([]);
  expect(notices.json().unread).toBe(0);
  expect(
    (await f.request("GET", `/workflows/targets/${task.id}`, undefined, cookie))
      .statusCode,
  ).toBe(404);
});
async function waitJob(id: string) {
  for (let i = 0; i < 100; i++) {
    const r = await f.request("GET", `/workflows/jobs/${id}`);
    expect(r.statusCode, r.body).toBe(200);
    const job = r.json();
    if (job.state === "completed") return job;
    if (job.state === "failed") throw Error(JSON.stringify(job));
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error("Job timeout");
}
test("durable recurrence job uses preview dates and stable task identities after restart and model revision", async () => {
  const { parent } = await start();
  let m = await model("recurrence", {
    name: "Clôture mensuelle",
    dossierId: parent.id,
    rule: monthly,
    task: {},
    checklistModelId: null,
  });
  const input = {
    operationId: operationId(),
    modelId: m.id,
    from: "2027-02-01",
    to: "2027-04-30",
  };
  let r = await f.request("POST", "/workflows/generate", input);
  expect(r.statusCode, r.body).toBe(202);
  await waitJob(r.json().jobId);
  let records = (await f.request("GET", "/records?kind=tache")).json().items;
  expect(
    records.map((r: { data: { dueDate: string } }) => r.data.dueDate).sort(),
  ).toEqual(["2027-02-28", "2027-03-31", "2027-04-30"]);
  const ids = records.map((r: { id: string }) => r.id).sort();
  await f.restart();
  const last = await f.request("GET", `/workflows/models/${m.id}/job`);
  expect(last.statusCode, last.body).toBe(200);
  expect(last.json().job.state).toBe("completed");
  r = await f.request("POST", "/workflows/generate", {
    ...input,
    operationId: operationId(),
  });
  await waitJob(r.json().jobId);
  m = await model(
    "recurrence",
    { ...m.model, rule: { ...monthly, nominalDay: 15 } },
    m.id,
    1,
  );
  r = await f.request("POST", "/workflows/generate", {
    ...input,
    operationId: operationId(),
  });
  await waitJob(r.json().jobId);
  records = (await f.request("GET", "/records?kind=tache")).json().items;
  expect(records.map((r: { id: string }) => r.id).sort()).toEqual(ids);
  expect(
    records.every(
      (r: { data: { recurrence: { modelVersion: number } } }) =>
        r.data.recurrence.modelVersion === 1,
    ),
  ).toBe(true);
});
test("typed stages retain stable references, exactly one final and checklist completion across generic and workflow writes", async () => {
  const { parent } = await start();
  const a = operationId(),
    b = operationId(),
    c = operationId();
  const m = await model("task_type", {
    name: "Révision",
    color: "blue",
    steps: [
      { id: a, name: "À traiter", final: false },
      { id: b, name: "Revue", final: false },
      { id: c, name: "Clos", final: true },
    ],
  });
  let r = await f.request("POST", "/records", {
    operationId: operationId(),
    record: {
      kind: "tache",
      title: "Travail typé",
      dossierId: parent.id,
      data: {
        typeId: m.id,
        stepId: a,
        billing: "billable",
        plannedMinutes: 90,
      },
    },
  });
  expect(r.statusCode, r.body).toBe(201);
  let task = r.json();
  r = await f.request("POST", `/workflows/tasks/${task.id}/move`, {
    operationId: operationId(),
    expectedVersion: task.version,
    stepId: b,
  });
  expect(r.statusCode, r.body).toBe(200);
  task = r.json();
  expect(task.data.state).toBe("en_cours");
  await f.request("POST", `/workflows/targets/${task.id}/commands`, {
    operationId: operationId(),
    expectedVersion: 0,
    command: {
      kind: "checklist",
      items: [{ id: operationId(), label: "Contrôler", done: false }],
    },
  });
  r = await f.request("POST", `/workflows/tasks/${task.id}/move`, {
    operationId: operationId(),
    expectedVersion: task.version,
    stepId: c,
  });
  expect(r.statusCode).toBe(409);
  r = await f.request("POST", "/workflows/models", {
    operationId: operationId(),
    id: m.id,
    expectedVersion: 1,
    model: {
      ...m.model,
      steps: [
        { id: a, name: "À traiter", final: true },
        { id: c, name: "Clos", final: true },
      ],
    },
  });
  expect(r.statusCode).toBe(400);
  const work = (await f.request("GET", `/workflows/targets/${task.id}`)).json();
  const checked = await f.request(
    "POST",
    `/workflows/targets/${task.id}/commands`,
    {
      operationId: operationId(),
      expectedVersion: work.version,
      command: {
        kind: "checklist",
        items: work.checklist.items.map((x: { id: string; label: string }) => ({
          ...x,
          done: true,
        })),
      },
    },
  );
  expect(checked.statusCode, checked.body).toBe(200);
  const close = {
    operationId: operationId(),
    expectedVersion: task.version,
    stepId: c,
  };
  const closed = await f.request(
    "POST",
    `/workflows/tasks/${task.id}/move`,
    close,
  );
  expect(closed.statusCode, closed.body).toBe(200);
  expect(
    (await f.request("POST", `/workflows/tasks/${task.id}/move`, close)).json(),
  ).toEqual(closed.json());
  const blocked = await f.request(
    "POST",
    `/workflows/targets/${task.id}/commands`,
    {
      operationId: operationId(),
      expectedVersion: checked.json().version,
      command: { kind: "checklist", items: [] },
    },
  );
  expect(blocked.statusCode).toBe(409);
  expect(
    (await f.request("GET", `/workflows/targets/${task.id}`)).json().checklist,
  ).toEqual(checked.json().checklist);
});
test("checklist exchange previews mapping and unmapped columns, requires explicit validation and persists versioned models", async () => {
  await start();
  const id = operationId(),
    item = operationId();
  const csv = `Modèle;Nom;Cibles;Élément;Libellé;Ordre;Autre\n${id};Reprise fictive;tache,TVA;${item};Vérifier;1;ignoré\n`;
  const r = await f.request("POST", "/workflows/imports/preview", {
    operationId: operationId(),
    exchange: "memlia-checklists-1",
    format: "csv",
    bytes: Buffer.from(csv).toString("base64"),
    mapping: {
      "0": "modelId",
      "1": "name",
      "2": "targetKinds",
      "3": "itemId",
      "4": "label",
      "5": "order",
    },
  });
  expect(r.statusCode, r.body).toBe(201);
  const p = r.json();
  expect(p.unmapped).toEqual(["Autre"]);
  expect(p.models[0].model.items[0].label).toBe("Vérifier");
  expect(
    (
      await f.request("POST", `/workflows/imports/${p.id}/commit`, {
        operationId: operationId(),
        validatedModelIds: [],
      })
    ).statusCode,
  ).toBe(400);
  const cmd = { operationId: operationId(), validatedModelIds: [id] };
  const saved = await f.request(
    "POST",
    `/workflows/imports/${p.id}/commit`,
    cmd,
  );
  expect(saved.statusCode, saved.body).toBe(200);
  expect(saved.json().models[0].version).toBe(1);
  expect(
    (await f.request("POST", `/workflows/imports/${p.id}/commit`, cmd)).json(),
  ).toEqual(saved.json());
});
test("reminders use cabinet hour, recipient access and deterministic single in-app occurrence", async () => {
  const { actor, parent } = await start();
  const task = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "tache",
        title: "Échéance fictive",
        dossierId: parent.id,
        data: {},
      },
    })
  ).json();
  const reminder = await model("reminder", {
    name: "Rappel fictif",
    targetIds: [task.id],
    recipientIds: [actor.id],
    event: "schedule",
    message: "À contrôler",
    hour: "11:30",
    enabled: true,
    rule: {
      ...monthly,
      start: "2026-10-01",
      end: "2026-12-31",
      nominalDay: 17,
    },
  });
  let r = await f.request("POST", "/notifications/process", {
    operationId: operationId(),
  });
  expect(r.statusCode, r.body).toBe(202);
  for (let i = 0; i < 100; i++) {
    const n = (await f.request("GET", "/notifications")).json();
    if (n.items?.length) break;
    await new Promise((r) => setTimeout(r, 30));
  }
  expect((await f.request("GET", "/notifications")).json().items).toHaveLength(
    1,
  );
  const runs = await f.request(
    "GET",
    "/notifications/runs?modelId=" + reminder.id,
  );
  expect(runs.statusCode, runs.body).toBe(200);
  expect(runs.json().items).toHaveLength(1);
  expect(runs.json().items[0].date).toBe("2026-10-17");
  await f.restart();
  r = await f.request("POST", "/notifications/process", {
    operationId: operationId(),
  });
  expect(r.statusCode, r.body).toBe(202);
  expect((await f.request("GET", "/notifications")).json().items).toHaveLength(
    1,
  );
});
test("complete exit contains versioned workflow relationships and current authorization applies on download", async () => {
  const { parent } = await start();
  const m = await model("checklist", {
    name: "Export fictif",
    targetKinds: ["tache"],
    items: [{ id: operationId(), label: "Pièce" }],
  });
  const task = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "tache",
        title: "Travail exporté",
        dossierId: parent.id,
        data: {},
      },
    })
  ).json();
  await f.request("POST", `/workflows/targets/${task.id}/commands`, {
    operationId: operationId(),
    expectedVersion: 0,
    command: { kind: "instantiate", modelId: m.id },
  });
  const r = await f.request("POST", "/administration/exports", {
    operationId: operationId(),
  });
  expect(r.statusCode, r.body).toBe(202);
  const exported = r.json();
  let manifest;
  for (let n = 0; n < 100; n++) {
    const res = await f.request(
      "GET",
      `/administration/exports/${exported.id}/download`,
    );
    if (res.statusCode === 200) {
      manifest = res.json();
      break;
    }
    await new Promise((r) => setTimeout(r, 30));
  }
  expect(manifest).toBeDefined();
  const entities = [];
  for (const part of manifest.parts) {
    const p = await f.request("GET", part.downloadUrl.replace("/api/v1", ""));
    expect(p.statusCode, p.body).toBe(200);
    entities.push(...p.json().workflows);
  }
  expect(
    entities.some(
      (e: { entity: string; data: { id: string } }) =>
        e.entity === "work" && e.data.id === task.id,
    ),
  ).toBe(true);
  expect(
    entities.some(
      (e: { entity: string; data: { id: string } }) =>
        e.entity === "model_version" && e.data.id === m.id,
    ),
  ).toBe(true);
});
test("shared calendar aggregates canonical task and fiscal IDs and obligation task creation is replay-safe", async () => {
  const { parent } = await start();
  let r = await f.request("POST", "/fiscal", {
    operationId: operationId(),
    dossierId: parent.id,
    title: "TVA calendrier",
    nature: "TVA",
    period: {
      start: "2026-10-01",
      end: "2026-10-31",
      campaign: "2026",
      subtype: "CA3",
    },
    deadlines: {
      observed: "2026-11-20",
      internalTarget: null,
      campaignDate: null,
      provenance: {
        kind: "manual",
        source: "cabinet fictif",
        account: "fictif",
        reference: "cible",
        version: "1",
        observedAt: "2026-10-17T10:00:00Z",
        sourceUpdatedAt: null,
        coverage: "complete",
        rawState: "cible interne",
      },
    },
  });
  expect(r.statusCode, r.body).toBe(201);
  let fiscal = r.json();
  const deadlines = {
    kind: "deadlines",
    observed: "2026-11-20",
    internalTarget: null,
    campaignDate: null,
    provenance: {
      kind: "manual",
      source: "cabinet fictif",
      account: "fictif",
      reference: "cible",
      version: "1",
      observedAt: "2026-10-17T10:00:00Z",
      sourceUpdatedAt: null,
      coverage: "complete",
      rawState: "cible interne",
    },
  };
  r = await f.request("POST", `/fiscal/${fiscal.record.id}/commands`, {
    operationId: operationId(),
    expectedVersion: fiscal.record.version,
    event: deadlines,
  });
  expect(r.statusCode, r.body).toBe(200);
  fiscal = r.json();
  const cmd = { operationId: operationId() };
  r = await f.request(
    "POST",
    `/workflows/targets/${fiscal.record.id}/task`,
    cmd,
  );
  expect(r.statusCode, r.body).toBe(200);
  const task = r.json();
  expect(
    (
      await f.request("POST", `/workflows/targets/${fiscal.record.id}/task`, {
        operationId: operationId(),
      })
    ).json().id,
  ).toBe(task.id);
  const calendar = await f.request(
    "GET",
    "/workflows/calendar?from=2026-01-01&to=2026-12-31&natures=TVA&includeTasks=true",
  );
  expect(calendar.statusCode, calendar.body).toBe(200);
  expect(
    calendar
      .json()
      .items.map((x: { id: string }) => x.id)
      .sort(),
  ).toEqual([fiscal.record.id, task.id].sort());
});
test("notification preferences persist after restart", async () => {
  const { actor } = await start();
  const p = (await f.request("GET", "/notifications/preferences")).json();
  const cmd = { ...p, operationId: operationId(), inApp: false };
  const r = await f.request("POST", "/notifications/preferences", cmd);
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json().inApp).toBe(false);
  await f.restart();
  expect((await f.request("GET", "/notifications/preferences")).json()).toEqual(
    r.json(),
  );
});
test("task document links protect GED search and download through the current confidential task", async () => {
  const { parent } = await start();
  const metadata = {
    operationId: operationId(),
    dossierId: parent.id,
    filename: "travail-fictif.txt",
    mediaType: "text/plain",
    source: { kind: "manual", reference: "workflow-fixture", version: "1" },
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
      `--piece\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n--piece\r\nContent-Disposition: form-data; name="file"; filename="travail-fictif.txt"\r\nContent-Type: text/plain\r\n\r\nPreuve fictive\r\n--piece--\r\n`,
    ),
  });
  expect(upload.statusCode, upload.body).toBe(201);
  const doc = upload.json();
  await f.request("POST", "/records", {
    operationId: operationId(),
    record: {
      kind: "tache",
      title: "Travail confidentiel fictif",
      dossierId: parent.id,
      confidential: true,
      data: { documentIds: [doc.id] },
    },
  });
  await f.request("POST", "/users", {
    operationId: operationId(),
    email: "pieces@example.test",
    name: "Lecteur fictif",
    password: "UnMotDePasseFictif123!",
    permissions: [{ action: "read", kind: "*", dossierId: null }],
  });
  const login = await f.request(
    "POST",
    "/login",
    { email: "pieces@example.test", password: "UnMotDePasseFictif123!" },
    "",
  );
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  expect(
    (await f.request("GET", "/documents", undefined, cookie)).json().items,
  ).toEqual([]);
  expect(
    (await f.request("GET", `/documents/${doc.id}/download`, undefined, cookie))
      .statusCode,
  ).toBe(404);
});

test("public task creation cannot forge recurrence provenance", async () => {
  const { parent } = await start();
  const r = await f.request("POST", "/records", {
    operationId: operationId(),
    record: {
      kind: "tache",
      title: "Occurrence fabriquée",
      dossierId: parent.id,
      data: {
        recurrence: {
          modelId: operationId(),
          modelVersion: 1,
          period: "2026-10",
          key: "forged",
        },
      },
    },
  });
  expect(r.statusCode, r.body).toBe(400);
});
test("model mutation authorizes the current scope before retargeting or operation replay", async () => {
  const { parent } = await start();
  const other = (
    await f.request("POST", "/records", dossier("Autre périmètre fictif"))
  ).json();
  const m = await model("recurrence", {
    name: "Modèle protégé",
    dossierId: other.id,
    rule: monthly,
    task: {},
    checklistModelId: null,
  });
  const u = (
    await f.request("POST", "/users", {
      operationId: operationId(),
      email: "models@example.test",
      name: "Gestionnaire fictif",
      password: "UnMotDePasseFictif123!",
      permissions: [
        { action: "manage_users", kind: "*", dossierId: null },
        { action: "read", kind: "dossier", dossierId: parent.id },
      ],
    })
  ).json();
  const login = await f.request(
    "POST",
    "/login",
    { email: u.email, password: "UnMotDePasseFictif123!" },
    "",
  );
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const r = await f.request(
    "POST",
    "/workflows/models",
    {
      operationId: operationId(),
      id: m.id,
      expectedVersion: 1,
      model: { ...m.model, dossierId: parent.id },
    },
    cookie,
  );
  expect(r.statusCode, r.body).toBe(404);
});
test("weekly recurrence edits retain the same treated week rather than creating a second occurrence", async () => {
  const { parent } = await start();
  let m = await model("recurrence", {
    name: "Semaine fictive",
    dossierId: parent.id,
    rule: {
      ...monthly,
      frequency: "weekly",
      weekDay: 1,
      start: "2026-10-12",
      end: "2026-10-18",
    },
    task: {},
    checklistModelId: null,
  });
  const generate = async () => {
    const r = await f.request("POST", "/workflows/generate", {
      operationId: operationId(),
      modelId: m.id,
      from: "2026-10-12",
      to: "2026-10-18",
    });
    expect(r.statusCode, r.body).toBe(202);
    await waitJob(r.json().jobId);
  };
  await generate();
  const before = (await f.request("GET", "/records?kind=tache")).json().items;
  m = await model(
    "recurrence",
    { ...m.model, rule: { ...m.model.rule, weekDay: 5 } },
    m.id,
    1,
  );
  await generate();
  expect((await f.request("GET", "/records?kind=tache")).json().items).toEqual(
    before,
  );
});
