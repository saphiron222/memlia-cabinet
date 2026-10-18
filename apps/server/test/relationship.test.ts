import { afterEach, expect, test } from "vitest";
import { fixture, operationId } from "./helpers.js";
let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
});
async function save(
  data: Record<string, unknown>,
  old?: { id: string; version: number },
) {
  const r = await f.request("POST", "/relationship/entities", {
    id: old?.id ?? operationId(),
    expectedVersion: old?.version ?? 0,
    operationId: operationId(),
    data,
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
async function start() {
  f = await fixture(() => new Date("2026-10-18T10:00:00Z"));
  return f.setup();
}
test("CRM configured stages convert canonical contact once and preserve task relation, manual temperature and distinct pending triggers", async () => {
  await start();
  const first = operationId(),
    last = operationId();
  const pipeline = await save({
    kind: "pipeline",
    name: "Relation fictive",
    stages: [
      {
        id: first,
        name: "Prise de contact",
        color: "blue",
        icon: "circle",
        final: false,
      },
      {
        id: last,
        name: "Onboarding",
        color: "green",
        icon: "check",
        final: true,
      },
    ],
    conversionStageId: last,
    triggers: { quoteStageId: first, letterStageId: last },
  });
  const c = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "contact",
        title: "Atelier fictif",
        data: { contactType: "organisation" },
      },
    })
  ).json();
  let p = await save({
    kind: "prospect",
    contactId: c.id,
    pipelineId: pipeline.id,
    stageId: first,
    identity: "future_company",
    temperature: "warm",
    manualRisk: "low",
    source: "Recommandation",
    proposedFee: "999.99",
  });
  expect(
    (await f.request("GET", `/relationship/entities/${p.id}/capabilities`))
      .statusCode,
  ).toBe(200);
  expect(
    (await f.request("GET", "/relationship/entities?kind=prospect"))
      .json()
      .items.some((e: any) => e.id === p.id),
  ).toBe(true);
  const task = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: { kind: "tache", title: "Rappeler", data: { prospectId: c.id } },
    })
  ).json();
  const command = {
    operationId: operationId(),
    expectedVersion: p.version,
    stageId: last,
  };
  const response = await f.request(
    "POST",
    `/relationship/prospects/${p.id}/move`,
    command,
  );
  expect(response.statusCode, response.body).toBe(200);
  p = response.json();
  expect(
    (
      await f.request("POST", `/relationship/prospects/${p.id}/move`, command)
    ).json(),
  ).toEqual(p);
  expect(p.data).toMatchObject({
    temperature: "warm",
    manualRisk: "low",
    calculatedScore: null,
  });
  expect(p.data.dossierId).toBeTruthy();
  const dossier = (
    await f.request("GET", `/records/${p.data.dossierId}`)
  ).json();
  expect(dossier.title).toBe("Atelier fictif");
  const contact = (await f.request("GET", `/records/${c.id}`)).json();
  expect(contact.data.relatedDossierIds).toEqual([dossier.id]);
  expect(
    (await f.request("GET", `/records/${task.id}`)).json().data.prospectId,
  ).toBe(c.id);
  const events = (await f.request("GET", `/relationship/${p.id}/events`)).json()
    .items;
  expect(
    events.filter((e: { type: string }) => e.type === "converted"),
  ).toHaveLength(1);
  expect(
    events.filter((e: { type: string }) => e.type === "quote_requested"),
  ).toHaveLength(1);
  expect(
    events.filter((e: { type: string }) => e.type === "letter_requested"),
  ).toHaveLength(1);
  expect(
    events
      .filter((e: { type: string }) => e.type.endsWith("requested"))
      .every((e: { state: string }) => e.state === "pending_producer"),
  ).toBe(true);
  await f.restart();
  expect(
    (await f.request("GET", `/relationship/entities/${p.id}`)).json(),
  ).toEqual(p);
});
test("onboarding distinct manual/source fiscal steps never manufacture habilitation; missing identity and mandate block activation and expiry reopens identity", async () => {
  await start();
  const dossier = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: { kind: "dossier", title: "Dossier accueil", data: {} },
    })
  ).json();
  const person = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "contact",
        title: "Camille fictive",
        dossierId: dossier.id,
        data: { contactType: "personne" },
      },
    })
  ).json();
  const manual = operationId(),
    source = operationId(),
    identity = operationId(),
    mandate = operationId();
  const model = await save({
    kind: "onboarding_model",
    name: "Accueil",
    steps: [
      {
        id: identity,
        name: "Identité",
        type: "boolean",
        semantic: "identity",
        required: true,
      },
      {
        id: mandate,
        name: "Mandat",
        type: "boolean",
        semantic: "mandate",
        required: true,
      },
      {
        id: manual,
        name: "Accès impots.gouv",
        type: "boolean",
        semantic: "fiscal",
        source: "manual",
      },
      {
        id: source,
        name: "Accès impots.gouv",
        type: "boolean",
        semantic: "fiscal",
        source: "system",
      },
    ],
  });
  let row = await save({
    kind: "onboarding",
    dossierId: dossier.id,
    personId: person.id,
    modelId: model.id,
    values: [
      { stepId: manual, value: true, status: "done", note: "Case cabinet" },
    ],
  });
  let status = (
    await f.request("GET", `/relationship/onboarding/${row.id}/status`)
  ).json();
  expect(status.blockers.map((b: { code: string }) => b.code)).toEqual(
    expect.arrayContaining(["IDENTITY_REQUIRED", "MANDATE_REQUIRED"]),
  );
  expect(
    status.steps.find((s: { id: string }) => s.id === manual),
  ).toMatchObject({ value: true, verifiedAccess: false });
  expect(
    status.steps.find((s: { id: string }) => s.id === source),
  ).toMatchObject({ value: null, verifiedAccess: false, source: "system" });
  expect(
    (
      await f.request("POST", `/relationship/onboarding/${row.id}/activate`, {
        operationId: operationId(),
        expectedVersion: row.version,
      })
    ).statusCode,
  ).toBe(409);
  const fake = await f.request("POST", "/relationship/entities", {
    id: row.id,
    expectedVersion: row.version,
    operationId: operationId(),
    data: {
      ...row.data,
      values: [
        ...row.data.values,
        { stepId: source, value: true, status: "done", note: "Fausse source" },
      ],
    },
  });
  expect(fake.statusCode).toBe(403);
  const remove = await f.request("POST", "/relationship/entities", {
    id: model.id,
    expectedVersion: model.version,
    operationId: operationId(),
    data: {
      ...model.data,
      steps: model.data.steps.filter((s: { id: string }) => s.id !== source),
    },
  });
  expect(remove.statusCode).toBe(409);
});
async function proof(dossierId: string, previousVersionId?: string) {
  const meta = {
    operationId: operationId(),
    dossierId,
    previousVersionId,
    filename: "preuve.txt",
    mediaType: "text/plain",
    source: { kind: "manual", reference: "fictif", version: "1" },
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
      `--piece\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(meta)}\r\n--piece\r\nContent-Disposition: form-data; name="file"; filename="preuve.txt"\r\nContent-Type: text/plain\r\n\r\nPreuve strictement fictive\r\n--piece--\r\n`,
    ),
  });
  expect(r.statusCode, r.body).toBe(201);
  const doc = r.json();
  return {
    documentId: doc.id,
    version: doc.version,
    sha256: doc.sha256,
    origin: "manual",
    reference: "Examen fictif",
    acquiredOn: "2026-10-18",
    scope: "Identité et pouvoirs",
    result: "examined",
  };
}
test("LAB retains justified revisions and cabinet policy; common notifications and GED withdraw after LAB permission revocation", async () => {
  const actor = await start();
  expect(
    (await f.request("GET", "/relationship/catalog/people"))
      .json()
      .items.map((p: any) => p.id),
  ).toContain(actor.id);
  expect(
    (await f.request("GET", "/relationship/catalog/teams")).statusCode,
  ).toBe(200);
  const d = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: { kind: "dossier", title: "Vigilance fictive", data: {} },
    })
  ).json();
  const evidence = await proof(d.id),
    policy = await save({
      kind: "lab_policy",
      name: "Politique cabinet",
      periodDays: 90,
      reason: "Décision interne fictive",
    });
  let review = await save({
    kind: "lab",
    dossierId: d.id,
    level: "standard",
    reason: "Pièces examinées par une personne",
    role: "Responsable LAB",
    observedOn: "2026-10-18",
    decisionOn: "2026-10-18",
    nextReviewOn: "2026-10-18",
    policyId: policy.id,
    policyVersion: policy.version,
    evidence: [evidence],
    recipientIds: [actor.id],
  });
  const processing = await f.request("POST", "/relationship/lab/reminders", {
    operationId: operationId(),
  });
  expect(processing.statusCode, processing.body).toBe(202);
  let notices: any[] = [];
  for (let n = 0; n < 100; n++) {
    notices = (await f.request("GET", "/notifications")).json().items;
    if (notices.length) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(notices).toHaveLength(1);
  expect(notices[0]).toMatchObject({
    source: "lab",
    targetKind: "lab",
    text: "Révision de vigilance à examiner.",
  });
  await f.request("POST", "/relationship/lab/reminders", {
    operationId: operationId(),
  });
  const mark = {
    operationId: operationId(),
    expectedVersion: 1,
    state: "read",
  };
  expect(
    (await f.request("POST", `/notifications/${notices[0].id}`, mark))
      .statusCode,
  ).toBe(200);
  review = await save(
    {
      ...review.data,
      level: "enhanced",
      reason: "Changement signalé, examen humain requis",
      nextReviewOn: "2027-01-16",
    },
    review,
  );
  expect(
    (await f.request("GET", `/relationship/${review.id}/history`))
      .json()
      .items.map((e: any) => e.data.level),
  ).toEqual(["enhanced", "standard"]);
  const revoked = await f.request("PUT", `/users/${actor.id}`, {
    operationId: operationId(),
    expectedVersion: actor.version,
    active: true,
    permissions: actor.permissions.filter(
      (p: any) => !p.action.startsWith("lab_"),
    ),
  });
  expect(revoked.statusCode, revoked.body).toBe(200);
  expect(
    (await f.request("GET", `/relationship/entities/${review.id}`)).statusCode,
  ).toBe(404);
  expect(
    (await f.request("GET", "/relationship/entities?kind=lab")).json().total,
  ).toBe(0);
  expect((await f.request("GET", "/notifications")).json()).toMatchObject({
    items: [],
    unread: 0,
  });
  expect(
    (await f.request("POST", `/notifications/${notices[0].id}`, mark))
      .statusCode,
  ).toBe(404);
  expect(
    (await f.request("GET", `/documents/${evidence.documentId}`)).statusCode,
  ).toBe(404);
});
test("assisted pipeline exchange previews unmapped values, requires explicit validation and persists editable ordered model", async () => {
  await start();
  const input = {
    filename: "pipeline.csv",
    base64: Buffer.from(
      "étape;couleur;icône;conversion;devis;lettre;inconnue\nContact;blue;circle;false;true;false;test\nAccueil;green;check;true;false;true;test\nInvalide;mauve;circle;false;false;false;test",
    ).toString("base64"),
    name: "Reprise modèle",
    mapping: {
      stage: "étape",
      color: "couleur",
      icon: "icône",
      conversion: "conversion",
      quote: "devis",
      letter: "lettre",
    },
  };
  const r = await f.request("POST", "/relationship/imports/preview", input);
  expect(r.statusCode, r.body).toBe(201);
  const preview = r.json();
  expect(preview.unmapped).toHaveLength(2);
  expect(preview.model.stages.map((s: any) => s.name)).toEqual([
    "Contact",
    "Accueil",
  ]);
  expect(
    (
      await f.request("POST", `/relationship/imports/${preview.id}/commit`, {
        operationId: operationId(),
        validated: false,
      })
    ).statusCode,
  ).toBe(400);
  const command = { operationId: operationId(), validated: true };
  const result = await f.request(
    "POST",
    `/relationship/imports/${preview.id}/commit`,
    command,
  );
  expect(result.statusCode, result.body).toBe(200);
  expect(
    (
      await f.request(
        "POST",
        `/relationship/imports/${preview.id}/commit`,
        command,
      )
    ).json(),
  ).toEqual(result.json());
  const model = result.json().model;
  expect(model.origin.kind).toBe("import");
  await save({ ...model.data, name: "Modèle édité" }, model);
});
test("interoperable exit retains relationship models, versions, conversions and LAB evidence; prepared exit reauthorizes LAB rights", async () => {
  const actor = await start();
  const d = (
      await f.request("POST", "/records", {
        operationId: operationId(),
        record: { kind: "dossier", title: "Sortie fictive", data: {} },
      })
    ).json(),
    evidence = await proof(d.id),
    policy = await save({
      kind: "lab_policy",
      name: "Politique sortie",
      periodDays: 45,
      reason: "Exemple interne",
    });
  const review = await save({
    kind: "lab",
    dossierId: d.id,
    level: "standard",
    reason: "Examen humain",
    role: "Responsable",
    observedOn: "2026-10-18",
    decisionOn: "2026-10-18",
    nextReviewOn: "2026-12-02",
    policyId: policy.id,
    policyVersion: policy.version,
    evidence: [evidence],
  });
  const command = { operationId: operationId() },
    started = await f.request("POST", "/administration/exports", command);
  expect(started.statusCode, started.body).toBe(202);
  let status: any;
  for (let n = 0; n < 200; n++) {
    status = (
      await f.request("GET", `/administration/exports/${started.json().id}`)
    ).json();
    if (["completed", "failed"].includes(status.job.state)) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(status.job.state, JSON.stringify(status)).toBe("completed");
  const manifest = (
    await f.request(
      "GET",
      `/administration/exports/${started.json().id}/download`,
    )
  ).json();
  const entries: any[] = [];
  for (const part of manifest.parts) {
    const r = await f.request("GET", part.downloadUrl.replace("/api/v1", ""));
    expect(r.statusCode, r.body).toBe(200);
    entries.push(...r.json().relationship);
  }
  expect(
    entries.some((e) => e.entity === "current" && e.data.id === review.id),
  ).toBe(true);
  expect(
    entries.find((e) => e.entity === "history" && e.data.id === review.id).data
      .data.evidence[0],
  ).toMatchObject(evidence);
  await f.request("PUT", `/users/${actor.id}`, {
    operationId: operationId(),
    expectedVersion: actor.version,
    active: true,
    permissions: actor.permissions.filter(
      (p: any) => p.action !== "lab_export",
    ),
  });
  expect(
    (
      await f.request(
        "GET",
        `/administration/exports/${started.json().id}/download`,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (await f.request("POST", "/administration/exports", command)).statusCode,
  ).toBe(404);
});
test("partial bulk move preserves successes and reports stale versions without duplicating conversion", async () => {
  await start();
  const one = operationId(),
    two = operationId(),
    model = await save({
      kind: "pipeline",
      name: "Lot",
      stages: [
        {
          id: one,
          name: "Contact",
          color: "blue",
          icon: "circle",
          final: false,
        },
        { id: two, name: "Client", color: "green", icon: "check", final: true },
      ],
      conversionStageId: two,
    });
  const create = async (name: string) => {
    const c = (
      await f.request("POST", "/records", {
        operationId: operationId(),
        record: {
          kind: "contact",
          title: name,
          data: { contactType: "organisation" },
        },
      })
    ).json();
    return save({
      kind: "prospect",
      contactId: c.id,
      pipelineId: model.id,
      stageId: one,
      identity: "company",
    });
  };
  const a = await create("A fictif"),
    b = await create("B fictif");
  await save({ ...b.data, notes: "Version concurrente" }, b);
  const command = {
    operationId: operationId(),
    stageId: two,
    items: [
      { id: a.id, expectedVersion: 1 },
      { id: b.id, expectedVersion: 1 },
    ],
  };
  const r = await f.request(
    "POST",
    "/relationship/prospects/bulk-move",
    command,
  );
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json().items.map((x: any) => x.state)).toEqual([
    "succeeded",
    "failed",
  ]);
  expect(r.json().items[1].code).toBe("VERSION_CONFLICT");
  expect(
    (
      await f.request("POST", "/relationship/prospects/bulk-move", command)
    ).json(),
  ).toEqual(r.json());
});
test("person-owned identity with exact GED evidence unlocks activation only with examined mandate, then expiry and changed identity reopen blockers", async () => {
  let clock = new Date("2026-10-18T21:30:00Z");
  f = await fixture(() => clock);
  await f.setup();
  const dossier = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: { kind: "dossier", title: "Accueil validité", data: {} },
    })
  ).json();
  let person = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "contact",
        title: "Personne fictive",
        dossierId: dossier.id,
        data: { contactType: "personne", birthDate: "1990-01-01" },
      },
    })
  ).json();
  const evidence = await proof(dossier.id),
    mandate = operationId();
  const m = await save({
    kind: "onboarding_model",
    name: "Examen requis",
    steps: [
      {
        id: mandate,
        name: "Mandat",
        type: "boolean",
        semantic: "mandate",
        required: true,
      },
    ],
  });
  const identity = await save({
    kind: "identity",
    personId: person.id,
    dossierId: dossier.id,
    evidence: [evidence],
    result: "examined",
    observedOn: "2026-10-18",
    expiresOn: "2026-10-18",
    method: "Examen humain fictif",
    address: "Adresse fictive",
    birthIdentity: "Identité fictive",
    reason: "Pièce examinée",
  });
  const row = await save({
    kind: "onboarding",
    dossierId: dossier.id,
    personId: person.id,
    modelId: m.id,
    values: [
      { stepId: mandate, value: true, status: "done", evidence: [evidence] },
    ],
  });
  expect(
    (await f.request("GET", `/relationship/onboarding/${row.id}/status`)).json()
      .complete,
  ).toBe(true);
  const cmd = { operationId: operationId(), expectedVersion: row.version };
  expect(
    (
      await f.request(
        "POST",
        `/relationship/onboarding/${row.id}/activate`,
        cmd,
      )
    ).json().state,
  ).toBe("pending_portal_producer");
  person = (
    await f.request("PUT", `/records/${person.id}`, {
      operationId: operationId(),
      expectedVersion: person.version,
      record: {
        kind: "contact",
        title: person.title,
        dossierId: person.dossierId,
        data: { ...person.data, birthDate: "1990-01-02" },
      },
    })
  ).json();
  expect(
    (await f.request("GET", `/relationship/onboarding/${row.id}/status`))
      .json()
      .blockers.map((b: any) => b.code),
  ).toContain("IDENTITY_REQUIRED");
  await save(
    { ...identity.data, reason: "Nouvel examen après correction" },
    identity,
  );
  clock = new Date("2026-10-18T22:30:00Z");
  expect(
    (await f.request("GET", `/relationship/onboarding/${row.id}/status`))
      .json()
      .blockers.map((b: any) => b.code),
  ).toContain("IDENTITY_REQUIRED");
  expect(
    (
      await f.request(
        "POST",
        `/relationship/onboarding/${row.id}/activate`,
        cmd,
      )
    ).statusCode,
  ).toBe(409);
});
test("direct conversion replay retains canonical identity, inactive missions remain historical, and old contact parents prevent reads and replay", async () => {
  const actor = await start(),
    stage = operationId(),
    model = await save({
      kind: "pipeline",
      name: "Direct",
      stages: [
        {
          id: stage,
          name: "Accueil",
          color: "green",
          icon: "check",
          final: true,
        },
      ],
      conversionStageId: stage,
    });
  const parent = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "dossier",
        title: "Parent confidentiel",
        confidential: true,
        data: {},
      },
    })
  ).json();
  let contact = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "contact",
        title: "Contact protégé",
        dossierId: parent.id,
        data: { contactType: "organisation" },
      },
    })
  ).json();
  let mission = await save({
    kind: "mission",
    name: "Mission historique",
    category: "Comptabilité",
    unit: "mois",
    quantified: true,
  });
  const command = {
    id: operationId(),
    expectedVersion: 0,
    operationId: operationId(),
    data: {
      kind: "prospect",
      contactId: contact.id,
      pipelineId: model.id,
      stageId: stage,
      identity: "company",
      missions: [
        {
          missionId: mission.id,
          missionVersion: mission.version,
          quantity: "2",
          amount: "1234.56",
        },
      ],
    },
  };
  const r = await f.request("POST", "/relationship/entities", command);
  expect(r.statusCode, r.body).toBe(200);
  expect(
    (await f.request("POST", "/relationship/entities", command)).json(),
  ).toEqual(r.json());
  mission = await save({ ...mission.data, active: false }, mission);
  expect(
    (
      await f.request("GET", "/relationship/entities?kind=mission&active=true")
    ).json().items,
  ).toHaveLength(0);
  await save({ ...r.json().data, notes: "Historique préservé" }, r.json());
  contact = (await f.request("GET", `/records/${contact.id}`)).json();
  await f.request("PUT", `/records/${contact.id}`, {
    operationId: operationId(),
    expectedVersion: contact.version,
    record: {
      kind: "contact",
      title: contact.title,
      dossierId: null,
      data: { ...contact.data, relatedDossierIds: [] },
    },
  });
  await f.request("PUT", `/users/${actor.id}`, {
    operationId: operationId(),
    expectedVersion: actor.version,
    active: true,
    permissions: actor.permissions.filter(
      (p: any) => p.action !== "confidential",
    ),
  });
  expect(
    (await f.request("GET", `/relationship/entities/${r.json().id}`))
      .statusCode,
  ).toBe(404);
  expect(
    (await f.request("GET", "/relationship/entities?kind=prospect")).json()
      .total,
  ).toBe(0);
  expect(
    (await f.request("POST", "/relationship/entities", command)).statusCode,
  ).toBe(404);
});

test("onboarding reuses a versioned canonical status type and keeps values after model deactivation", async () => {
  await start();
  const pending = operationId(),
    done = operationId();
  const typeResponse = await f.request("POST", "/production/models", {
    id: operationId(),
    expectedVersion: 0,
    operationId: operationId(),
    model: {
      kind: "stage_type",
      name: "Validation commune",
      statuses: [
        {
          id: pending,
          name: "En cours",
          color: "blue",
          icon: "clock",
          final: false,
        },
        {
          id: done,
          name: "Accepté",
          color: "green",
          icon: "check",
          final: true,
        },
      ],
    },
  });
  expect(typeResponse.statusCode, typeResponse.body).toBe(200);
  const type = typeResponse.json(),
    step = operationId();
  let model = await save({
    kind: "onboarding_model",
    name: "Accueil typé",
    steps: [
      {
        id: step,
        name: "Validation",
        type: "status",
        stageTypeId: type.id,
        stageTypeVersion: type.version,
      },
    ],
  });
  expect(model.data.steps[0].statuses).toEqual(type.model.statuses);
  const dossier = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: { kind: "dossier", title: "Statuts", data: {} },
    })
  ).json();
  const person = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "contact",
        title: "Personne",
        dossierId: dossier.id,
        data: { contactType: "personne" },
      },
    })
  ).json();
  const bad = await f.request("POST", "/relationship/entities", {
    id: operationId(),
    expectedVersion: 0,
    operationId: operationId(),
    data: {
      kind: "onboarding",
      dossierId: dossier.id,
      personId: person.id,
      modelId: model.id,
      values: [{ stepId: step, value: pending, status: "done" }],
    },
  });
  expect(bad.statusCode).toBe(400);
  const row = await save({
    kind: "onboarding",
    dossierId: dossier.id,
    personId: person.id,
    modelId: model.id,
    values: [{ stepId: step, value: done, status: "done" }],
  });
  model = await save(
    { ...model.data, steps: [{ ...model.data.steps[0], active: false }] },
    model,
  );
  expect(
    (await f.request("GET", `/relationship/entities/${row.id}`)).json().data
      .values[0].value,
  ).toBe(done);
  const deletion = await f.request("POST", "/relationship/entities", {
    id: model.id,
    expectedVersion: model.version,
    operationId: operationId(),
    data: {
      ...model.data,
      steps: [{ id: operationId(), name: "Autre", type: "text" }],
    },
  });
  expect(deletion.statusCode).toBe(409);
});

test("replaced identity and mandate evidence reopen blockers while unrelated task attachment cannot bypass LAB rights", async () => {
  const actor = await start();
  const dossier = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: { kind: "dossier", title: "Preuves remplacées", data: {} },
    })
  ).json();
  const person = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "contact",
        title: "Personne",
        dossierId: dossier.id,
        data: { contactType: "personne" },
      },
    })
  ).json();
  const evidence = await proof(dossier.id),
    step = operationId();
  await save({
    kind: "identity",
    personId: person.id,
    dossierId: dossier.id,
    evidence: [evidence],
    result: "examined",
    observedOn: "2026-10-18",
    expiresOn: "2027-10-18",
    method: "Examen humain",
    address: "Adresse fictive",
    birthIdentity: "État civil fictif",
    reason: "Pièce examinée",
  });
  const model = await save({
    kind: "onboarding_model",
    name: "Preuves",
    steps: [
      {
        id: step,
        name: "Mandat",
        type: "boolean",
        semantic: "mandate",
        required: true,
      },
    ],
  });
  const row = await save({
    kind: "onboarding",
    dossierId: dossier.id,
    personId: person.id,
    modelId: model.id,
    values: [
      { stepId: step, value: true, status: "done", evidence: [evidence] },
    ],
  });
  expect(
    (await f.request("GET", `/relationship/onboarding/${row.id}/status`)).json()
      .complete,
  ).toBe(true);
  const replacement = await proof(dossier.id, evidence.documentId);
  expect(
    (await f.request("GET", `/relationship/onboarding/${row.id}/status`))
      .json()
      .blockers.map((b: any) => b.code),
  ).toEqual(expect.arrayContaining(["IDENTITY_REQUIRED", "MANDATE_REQUIRED"]));
  const task = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "tache",
        title: "Pièce liée",
        dossierId: dossier.id,
        data: { documentIds: [evidence.documentId] },
      },
    })
  ).json();
  const policy = await save({
    kind: "lab_policy",
    name: "Politique",
    periodDays: 90,
    reason: "Examen",
  });
  await save({
    kind: "lab",
    dossierId: dossier.id,
    level: "standard",
    reason: "Confidentiel LAB",
    role: "Responsable",
    observedOn: "2026-10-18",
    decisionOn: "2026-10-18",
    nextReviewOn: "2027-01-01",
    policyId: policy.id,
    policyVersion: 1,
    evidence: [evidence],
  });
  // The finite GED policy must use the same live team/assignment provider.
  const role = (
    await f.request("POST", "/administration/roles", {
      operationId: operationId(),
      name: "Vigilance locale",
      order: 0,
      permissions: [{ action: "lab_read", kind: "dossier", dossierId: null }],
    })
  ).json();
  const group = (
    await f.request("POST", "/administration/groups", {
      operationId: operationId(),
      kind: "team",
      name: "Équipe vigilance",
      memberIds: [],
    })
  ).json();
  const assigned = await f.request("POST", "/administration/assignments", {
    operationId: operationId(),
    rows: [
      {
        dossierId: dossier.id,
        expectedVersion: dossier.version,
        subject: { kind: "team", id: group.id },
        roleId: role.id,
        remove: false,
      },
    ],
  });
  expect(assigned.statusCode, assigned.body).toBe(200);
  expect(assigned.json().items[0].status).toBe("assigned");
  await f.request("PUT", `/users/${actor.id}`, {
    operationId: operationId(),
    expectedVersion: actor.version,
    active: true,
    permissions: actor.permissions.filter(
      (p: any) => !p.action.startsWith("lab_"),
    ),
  });
  expect(
    (await f.request("GET", `/documents/${replacement.documentId}`)).statusCode,
  ).toBe(404);
  expect((await f.request("GET", `/records/${task.id}`)).statusCode).toBe(404);
  expect(
    (await f.request("GET", "/records?kind=tache")).json().items,
  ).toHaveLength(0);
  const joined = await f.request("PUT", `/administration/groups/${group.id}`, {
    operationId: operationId(),
    expectedVersion: group.version,
    kind: "team",
    name: group.name,
    memberIds: [actor.id],
  });
  expect(joined.statusCode, joined.body).toBe(200);
  expect(
    (await f.request("GET", `/documents/${replacement.documentId}`)).statusCode,
  ).toBe(200);
  expect((await f.request("GET", `/records/${task.id}`)).statusCode).toBe(200);
  const removed = await f.request("PUT", `/administration/groups/${group.id}`, {
    operationId: operationId(),
    expectedVersion: joined.json().version,
    kind: "team",
    name: group.name,
    memberIds: [],
  });
  expect(removed.statusCode, removed.body).toBe(200);
  expect(
    (await f.request("GET", `/documents/${replacement.documentId}`)).statusCode,
  ).toBe(404);
  expect((await f.request("GET", `/records/${task.id}`)).statusCode).toBe(404);
  for (const [kind, dossierId, status] of [
    ["contact", null, 404],
    ["dossier", operationId(), 404],
    ["*", dossier.id, 200],
    ["dossier", null, 200],
  ] as const) {
    const current = (await f.request("GET", "/session")).json().user;
    const changed = await f.request("PUT", `/users/${actor.id}`, {
      operationId: operationId(),
      expectedVersion: current.version,
      active: true,
      permissions: [
        ...actor.permissions.filter((p: any) => !p.action.startsWith("lab_")),
        { action: "lab_read", kind, dossierId },
      ],
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(
      (await f.request("GET", `/documents/${replacement.documentId}`))
        .statusCode,
    ).toBe(status);
    expect((await f.request("GET", `/records/${task.id}`)).statusCode).toBe(
      status,
    );
    expect(
      (await f.request("GET", "/records?kind=tache"))
        .json()
        .items.some((r: any) => r.id === task.id),
    ).toBe(status === 200);
  }
});

test("LAB current proof and linked task retain every historical review owner after retargeting and permission withdrawal", async () => {
  const actor = await start();
  const makeD = async (title: string, confidential = false) =>
    (
      await f.request("POST", "/records", {
        operationId: operationId(),
        record: { kind: "dossier", title, confidential, data: {} },
      })
    ).json();
  const former = await makeD("Ancien propriétaire protégé", true),
    current = await makeD("Propriétaire courant");
  const oldEvidence = await proof(former.id),
    evidence = await proof(current.id);
  const policy = await save({
    kind: "lab_policy",
    name: "Politique",
    periodDays: 90,
    reason: "Cabinet",
  });
  const prior = await save({
    kind: "lab",
    dossierId: former.id,
    level: "standard",
    reason: "Premier examen protégé",
    role: "Responsable",
    observedOn: "2026-10-18",
    decisionOn: "2026-10-18",
    nextReviewOn: "2026-10-18",
    policyId: policy.id,
    policyVersion: 1,
    evidence: [oldEvidence],
    recipientIds: [actor.id],
  });
  const review = await save(
    {
      ...prior.data,
      dossierId: current.id,
      evidence: [evidence],
      reason: "Rattachement courant",
    },
    prior,
  );
  const taskResponse = await f.request("POST", "/records", {
    operationId: operationId(),
    record: {
      kind: "tache",
      title: "Pièce actuelle",
      dossierId: current.id,
      data: { documentIds: [evidence.documentId] },
    },
  });
  expect(taskResponse.statusCode, taskResponse.body).toBe(201);
  await f.request("POST", "/relationship/lab/reminders", {
    operationId: operationId(),
  });
  let notice: any;
  for (let i = 0; i < 100; i++) {
    notice = (await f.request("GET", "/notifications")).json().items[0];
    if (notice) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(notice).toBeTruthy();
  const replay = {
    operationId: operationId(),
    expectedVersion: review.version,
    data: review.data,
    id: review.id,
  };
  expect(
    (await f.request("POST", "/relationship/entities", replay)).statusCode,
  ).toBe(200);
  await f.request("PUT", `/users/${actor.id}`, {
    operationId: operationId(),
    expectedVersion: actor.version,
    active: true,
    permissions: actor.permissions.filter(
      (p: any) => p.action !== "confidential",
    ),
  });
  expect(
    (await f.request("GET", `/documents/${evidence.documentId}`)).statusCode,
  ).toBe(404);
  expect(
    (await f.request("GET", `/records/${taskResponse.json().id}`)).statusCode,
  ).toBe(404);
  expect(
    (await f.request("GET", "/records?kind=tache")).json().items,
  ).toHaveLength(0);
  expect(
    (await f.request("GET", `/relationship/entities/${review.id}`)).statusCode,
  ).toBe(404);
  expect(
    (await f.request("GET", "/relationship/entities?kind=lab")).json().total,
  ).toBe(0);
  expect((await f.request("GET", "/notifications")).json()).toMatchObject({
    items: [],
    unread: 0,
  });
  expect(
    (await f.request("POST", "/relationship/entities", replay)).statusCode,
  ).toBe(404);
});

test("document requests follow effective stage entries while replay, notes and conversion reentry preserve canonical identities", async () => {
  await start();
  const first = operationId(),
    last = operationId();
  let pipeline = await save({
    kind: "pipeline",
    name: "Transitions",
    stages: [
      { id: first, name: "Début", color: "blue", icon: "circle", final: false },
      { id: last, name: "Accueil", color: "green", icon: "check", final: true },
    ],
    conversionStageId: last,
    triggers: { quoteStageId: last, letterStageId: last },
  });
  const c = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "contact",
        title: "Transitions",
        data: { contactType: "organisation" },
      },
    })
  ).json();
  let p = await save({
    kind: "prospect",
    contactId: c.id,
    pipelineId: pipeline.id,
    stageId: first,
    identity: "future_company",
  });
  const move = async (stageId: string) => {
    const command = {
      operationId: operationId(),
      expectedVersion: p.version,
      stageId,
    };
    const response = await f.request(
      "POST",
      `/relationship/prospects/${p.id}/move`,
      command,
    );
    expect(response.statusCode, response.body).toBe(200);
    p = response.json();
    expect(
      (
        await f.request("POST", `/relationship/prospects/${p.id}/move`, command)
      ).json(),
    ).toEqual(p);
    return command.operationId;
  };
  const firstEntry = await move(last),
    dossierId = p.data.dossierId;
  p = await save({ ...p.data, notes: "Simple note" }, p);
  pipeline = await save({ ...pipeline.data, name: "Renommé" }, pipeline);
  await move(last);
  let events = (await f.request("GET", `/relationship/${p.id}/events`)).json()
    .items;
  expect(events).toHaveLength(3);
  await move(first);
  const secondEntry = await move(last);
  events = (await f.request("GET", `/relationship/${p.id}/events`)).json()
    .items;
  expect(events.filter((e: any) => e.type === "converted")).toHaveLength(1);
  for (const type of ["quote_requested", "letter_requested"]) {
    const requests = events.filter((e: any) => e.type === type);
    expect(requests).toHaveLength(2);
    expect(requests.map((e: any) => e.operationId).sort()).toEqual(
      [firstEntry, secondEntry].sort(),
    );
    expect(requests.every((e: any) => e.state === "pending_producer")).toBe(
      true,
    );
  }
  expect(p.data.dossierId).toBe(dossierId);
  expect(
    (await f.request("GET", `/records/${c.id}`)).json().data.relatedDossierIds,
  ).toEqual([dossierId]);
  expect(
    (await f.request("GET", "/records?kind=dossier")).json().items,
  ).toHaveLength(1);
});

test("onboarding completion follows current inline final statuses without erasing the retained value", async () => {
  await start();
  const dossier = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: { kind: "dossier", title: "Configuration courante", data: {} },
    })
  ).json();
  const person = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "contact",
        title: "Personne",
        dossierId: dossier.id,
        data: { contactType: "personne" },
      },
    })
  ).json();
  const step = operationId(),
    status = operationId();
  let model = await save({
    kind: "onboarding_model",
    name: "Statuts locaux",
    steps: [
      {
        id: step,
        name: "Validation requise",
        type: "status",
        required: true,
        statuses: [
          {
            id: status,
            name: "Examiné",
            color: "green",
            icon: "check",
            final: true,
          },
        ],
      },
    ],
  });
  const row = await save({
    kind: "onboarding",
    dossierId: dossier.id,
    personId: person.id,
    modelId: model.id,
    values: [{ stepId: step, value: status, status: "done" }],
  });
  expect(
    (await f.request("GET", `/relationship/onboarding/${row.id}/status`))
      .json()
      .blockers.some((b: any) => b.stepId === step),
  ).toBe(false);
  model = await save(
    {
      ...model.data,
      steps: [
        {
          ...model.data.steps[0],
          statuses: [{ ...model.data.steps[0].statuses[0], final: false }],
        },
      ],
    },
    model,
  );
  const result = (
    await f.request("GET", `/relationship/onboarding/${row.id}/status`)
  ).json();
  expect(result.blockers).toContainEqual(
    expect.objectContaining({ stepId: step, code: "STEP_REQUIRED" }),
  );
  expect(result.steps[0]).toMatchObject({ value: status, status: "blocked" });
  expect(
    (await f.request("GET", `/relationship/entities/${row.id}`)).json(),
  ).toEqual(row);
});

test("reverse Work proof owner withdraws current and historical LAB detail, history, reminders, exports and replay consistently with GED, then restores them", async () => {
  const admin = await start();
  const created = await f.request("POST", "/users", {
    operationId: operationId(),
    email: "proof-reader@example.test",
    name: "Lecteur preuve",
    password: "MotDePasseFictif123!",
    permissions: admin.permissions,
  });
  expect(created.statusCode, created.body).toBe(201);
  let reader = created.json();
  const login = await f.request(
    "POST",
    "/login",
    {
      email: reader.email,
      password: "MotDePasseFictif123!",
    },
    "",
  );
  expect(login.statusCode, login.body).toBe(200);
  const token = String(login.headers["set-cookie"]).split(";")[0]!;
  const request = (
    method: "GET" | "POST",
    path: string,
    payload?: Record<string, unknown>,
  ) => f.request(method, path, payload, token);
  const d = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "dossier",
        title: "Preuve partagée Work et LAB",
        data: {},
      },
    })
  ).json();
  const evidence = await proof(d.id);
  const task = await f.request("POST", "/records", {
    operationId: operationId(),
    record: {
      kind: "tache",
      title: "Propriétaire de preuve",
      dossierId: d.id,
      data: { documentIds: [evidence.documentId] },
    },
  });
  expect(task.statusCode, task.body).toBe(201);
  const policy = await save({
    kind: "lab_policy",
    name: "Politique preuve partagée",
    periodDays: 90,
    reason: "Cabinet",
  });
  const writeReview = async (
    data: Record<string, unknown>,
    old?: { id: string; version: number },
  ) => {
    const command = {
      id: old?.id ?? operationId(),
      expectedVersion: old?.version ?? 0,
      operationId: operationId(),
      data,
    };
    const r = await request("POST", "/relationship/entities", command);
    expect(r.statusCode, r.body).toBe(200);
    return { review: r.json(), command };
  };
  const data = {
    kind: "lab",
    dossierId: d.id,
    level: "standard",
    reason: "Examen humain partagé",
    role: "Responsable",
    observedOn: "2026-10-18",
    decisionOn: "2026-10-18",
    nextReviewOn: "2026-10-18",
    policyId: policy.id,
    policyVersion: 1,
    evidence: [evidence],
    recipientIds: [reader.id],
  };
  const current = await writeReview(data);
  const historical = await writeReview({
    ...data,
    reason: "Ancien justificatif",
  });
  const unrelatedProof = await proof(d.id);
  const historicalOnly = await writeReview(
    {
      ...historical.review.data,
      evidence: [unrelatedProof],
      reason: "Preuve Work dans l’historique seulement",
    },
    historical.review,
  );
  const reviews = [current, historicalOnly];
  expect(
    (
      await request("POST", "/relationship/lab/reminders", {
        operationId: operationId(),
      })
    ).statusCode,
  ).toBe(202);
  let notices: any[] = [];
  for (let n = 0; n < 100; n++) {
    notices = (await request("GET", "/notifications")).json().items;
    if (notices.length === 2) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(notices).toHaveLength(2);
  const mark = {
    operationId: operationId(),
    expectedVersion: 1,
    state: "read",
  };
  expect(
    (await request("POST", `/notifications/${notices[0].id}`, mark)).statusCode,
  ).toBe(200);
  const exportCommand = { operationId: operationId() };
  const started = await request(
    "POST",
    "/administration/exports",
    exportCommand,
  );
  expect(started.statusCode, started.body).toBe(202);
  let exportState: any;
  for (let n = 0; n < 200; n++) {
    exportState = (
      await request("GET", `/administration/exports/${started.json().id}`)
    ).json();
    if (["completed", "failed"].includes(exportState.job.state)) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(exportState.job.state, JSON.stringify(exportState)).toBe("completed");
  const download = `/administration/exports/${started.json().id}/download`;
  const manifestResponse = await request("GET", download);
  expect(manifestResponse.statusCode, manifestResponse.body).toBe(200);
  const parts = manifestResponse
    .json()
    .parts.map((p: any) => p.downloadUrl.replace("/api/v1", ""));
  const entries: any[] = [];
  for (const path of parts)
    entries.push(...(await request("GET", path)).json().relationship);
  for (const { review } of reviews)
    expect(
      entries.some((e) => e.entity === "current" && e.data.id === review.id),
    ).toBe(true);
  expect(
    entries.some(
      (e) =>
        e.entity === "history" &&
        e.data.id === historical.review.id &&
        e.data.data.evidence.some(
          (p: any) => p.documentId === evidence.documentId,
        ),
    ),
  ).toBe(true);
  const assertSurfaces = async (allowed: boolean) => {
    const status = allowed ? 200 : 404;
    expect(
      (await request("GET", `/documents/${evidence.documentId}`)).statusCode,
    ).toBe(status);
    expect(
      (await request("GET", `/records/${task.json().id}`)).statusCode,
    ).toBe(status);
    // The dossier and dedicated LAB grants remain readable throughout the withdrawal.
    expect((await request("GET", `/records/${d.id}`)).statusCode).toBe(200);
    expect(
      (await request("GET", `/documents/${unrelatedProof.documentId}`))
        .statusCode,
    ).toBe(200);
    expect(
      (await request("GET", `/relationship/entities/${policy.id}`)).statusCode,
    ).toBe(200);
    for (const { review, command } of reviews) {
      for (const path of [
        `/relationship/entities/${review.id}`,
        `/relationship/${review.id}/history`,
        `/relationship/${review.id}/events`,
        `/relationship/entities/${review.id}/capabilities`,
      ])
        expect((await request("GET", path)).statusCode, path).toBe(status);
      expect(
        (await request("POST", "/relationship/entities", command)).statusCode,
      ).toBe(status);
    }
    expect(
      (await request("GET", "/relationship/entities?kind=lab")).json(),
    ).toMatchObject({ total: allowed ? 2 : 0 });
    const n = (await request("GET", "/notifications")).json();
    expect(n.items).toHaveLength(allowed ? 2 : 0);
    expect(n.unread).toBe(allowed ? 1 : 0);
    expect(
      (await request("POST", `/notifications/${notices[0].id}`, mark))
        .statusCode,
    ).toBe(status);
    expect((await request("GET", download)).statusCode).toBe(
      allowed ? 200 : 403,
    );
    for (const path of parts)
      expect((await request("GET", path)).statusCode).toBe(allowed ? 200 : 403);
    expect(
      (await request("POST", "/administration/exports", exportCommand))
        .statusCode,
    ).toBe(allowed ? 202 : 403);
  };
  await assertSurfaces(true);
  const withoutWorkRead = admin.permissions.flatMap((p: any) =>
    p.action === "read" && p.kind === "*"
      ? ["dossier", "contact", "obligation"].map((kind) => ({ ...p, kind }))
      : p.action === "read" && p.kind === "tache"
        ? []
        : [p],
  );
  for (const [permissions, allowed] of [
    [withoutWorkRead, false],
    [admin.permissions, true],
  ] as const) {
    const updated = await f.request("PUT", `/users/${reader.id}`, {
      operationId: operationId(),
      expectedVersion: reader.version,
      active: true,
      permissions,
    });
    expect(updated.statusCode, updated.body).toBe(200);
    reader = updated.json();
    await assertSurfaces(allowed);
    if (!allowed) {
      const filtered = await request("POST", "/administration/exports", {
        operationId: operationId(),
      });
      expect(filtered.statusCode, filtered.body).toBe(202);
      let state: any;
      for (let n = 0; n < 200; n++) {
        state = (
          await request("GET", `/administration/exports/${filtered.json().id}`)
        ).json();
        if (["completed", "failed"].includes(state.job.state)) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(state.job.state, JSON.stringify(state)).toBe("completed");
      const result = await request(
        "GET",
        `/administration/exports/${filtered.json().id}/download`,
      );
      expect(result.statusCode, result.body).toBe(200);
      for (const part of result.json().parts) {
        const response = await request(
          "GET",
          part.downloadUrl.replace("/api/v1", ""),
        );
        expect(response.statusCode, response.body).toBe(200);
        const rows = response.json().relationship;
        expect(
          rows.some((e: any) =>
            [current.review.id, historicalOnly.review.id].includes(e.data.id),
          ),
        ).toBe(false);
        expect(JSON.stringify(rows)).not.toContain(evidence.documentId);
      }
    }
    const reminders = await request("POST", "/relationship/lab/reminders", {
      operationId: operationId(),
    });
    expect(reminders.statusCode, reminders.body).toBe(202);
    expect(reminders.json().scheduled).toBe(0);
  }
});

test("LAB v13 migration preserves the v12 verdict for historical owners, contact confidentiality and every version of a proof", async () => {
  const actor = await start();
  await f.maintainDatabase(async (db) => {
    expect(
      (await db.query("SELECT max(version) version FROM schema_migrations"))[0]!
        .version,
    ).toBe(14);
  });
  const create = async (record: Record<string, unknown>) => {
    const result = await f.request("POST", "/records", {
      operationId: operationId(),
      record,
    });
    expect(result.statusCode, result.body).toBe(201);
    return result.json();
  };
  const a = await create({ kind: "dossier", title: "Historique A", data: {} }),
    b = await create({ kind: "dossier", title: "Courant B", data: {} });
  const person = await create({
    kind: "contact",
    title: "Personne confidentielle",
    dossierId: a.id,
    confidential: true,
    data: { contactType: "personne", relatedDossierIds: [b.id] },
  });
  const old = await proof(a.id),
    next = await proof(a.id, old.documentId),
    unrelated = await proof(b.id);
  const policy = await save({
    kind: "lab_policy",
    name: "Migration",
    periodDays: 90,
    reason: "Examen fictif",
  });
  let review = await save({
    kind: "lab",
    dossierId: a.id,
    personId: person.id,
    level: "standard",
    reason: "Historique",
    role: "Responsable",
    observedOn: "2026-10-18",
    decisionOn: "2026-10-18",
    nextReviewOn: "2027-01-01",
    policyId: policy.id,
    policyVersion: policy.version,
    evidence: [{ ...old, documentId: old.documentId.toUpperCase() }],
  });
  review = await save(
    { ...review.data, dossierId: b.id, personId: null, evidence: [next] },
    review,
  );
  const changed = await f.request("PUT", `/records/${person.id}`, {
    operationId: operationId(),
    expectedVersion: person.version,
    record: {
      kind: "contact",
      title: person.title,
      dossierId: person.dossierId,
      data: person.data,
      confidential: false,
    },
  });
  expect(changed.statusCode, changed.body).toBe(200);
  const grant = (
    action: string,
    kind = "*",
    dossierId: string | null = null,
  ) => ({ action, kind, dossierId });
  const matrices = [
    actor.permissions,
    [grant("read"), grant("confidential")],
    [grant("read"), grant("lab_read")],
    [grant("read"), grant("confidential"), grant("lab_read", "dossier", b.id)],
    [
      grant("read"),
      grant("confidential"),
      grant("lab_read", "dossier", a.id),
      grant("lab_read", "dossier", b.id),
    ],
    [
      grant("read", "dossier", a.id),
      grant("read", "dossier", b.id),
      grant("read", "contact"),
      grant("confidential"),
      grant("lab_read"),
    ],
  ];
  const ids = [old.documentId, next.documentId, unrelated.documentId];
  let before: unknown[],
    verdicts: boolean[] = [];
  await f.maintainDatabase(async (db) => {
    before = await db.query(
      "SELECT id,version,content FROM cabinet_relationship_history ORDER BY id,version",
    );
    for (const permissions of matrices)
      for (const id of ids) {
        const row = (
          await db.query(
            "SELECT cabinet_relationship_document_allowed_v12($1::uuid,$2::jsonb,$3::uuid) old,cabinet_relationship_document_allowed_v13($1::uuid,$2::jsonb,$3::uuid) current",
            [actor.id, JSON.stringify(permissions), id],
          )
        )[0]!;
        expect(row.current).toBe(row.old);
        verdicts.push(Boolean(row.old));
      }
    expect(verdicts).toEqual([
      true,
      true,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    await db.query(
      "DROP FUNCTION cabinet_relationship_document_allowed_v13(uuid,jsonb,uuid)",
    );
    await db.query(
      "DROP FUNCTION cabinet_work_document_allowed_v14(uuid,jsonb,uuid)",
    );
    await db.query("DELETE FROM schema_migrations WHERE version>=13");
  });
  await f.maintainDatabase(async (db) => {
    expect(
      (await db.query("SELECT max(version) version FROM schema_migrations"))[0]!
        .version,
    ).toBe(14);
    expect(
      await db.query(
        "SELECT id,version,content FROM cabinet_relationship_history ORDER BY id,version",
      ),
    ).toEqual(before);
    let index = 0;
    for (const permissions of matrices)
      for (const id of ids)
        expect(
          (
            await db.query(
              "SELECT cabinet_relationship_document_allowed_v13($1::uuid,$2::jsonb,$3::uuid) allowed",
              [actor.id, JSON.stringify(permissions), id],
            )
          )[0]!.allowed,
        ).toBe(verdicts[index++]);
    const properties = await db.query(
      "SELECT prosecdef,provolatile,proconfig FROM pg_proc WHERE proname='cabinet_relationship_document_allowed_v13' AND pronamespace=current_schema()::regnamespace",
    );
    expect(properties).toHaveLength(1);
    expect(properties[0]).toMatchObject({ prosecdef: false, provolatile: "s" });
  });
  expect(
    (await f.request("GET", `/relationship/entities/${review.id}`)).statusCode,
  ).toBe(200);
});

test("GED proof discovery keeps uppercase historical links and the full document chain protected after LAB withdrawal", async () => {
  const actor = await start();
  const createDossier = async (title: string) => {
    const response = await f.request("POST", "/records", {
      operationId: operationId(),
      record: { kind: "dossier", title, data: {} },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
  };
  const a = await createDossier("Ancien propriétaire"),
    b = await createDossier("Propriétaire courant");
  const old = await proof(a.id),
    replacement = await proof(a.id, old.documentId),
    currentProof = await proof(b.id),
    unrelated = await proof(b.id);
  const policy = await save({
    kind: "lab_policy",
    name: "Découverte historique",
    periodDays: 90,
    reason: "Examen fictif",
  });
  let review = await save({
    kind: "lab",
    dossierId: a.id,
    personId: null,
    level: "standard",
    reason: "Preuve ancienne",
    role: "Responsable",
    observedOn: "2026-10-18",
    decisionOn: "2026-10-18",
    nextReviewOn: "2027-01-01",
    policyId: policy.id,
    policyVersion: policy.version,
    evidence: [{ ...old, documentId: old.documentId.toUpperCase() }],
  });
  // The current review no longer names either version of this proof chain.
  review = await save(
    { ...review.data, dossierId: b.id, evidence: [currentProof] },
    review,
  );
  const base = actor.permissions.filter((p: any) => p.action !== "lab_read");
  for (const [permissions, status] of [
    [base, 404],
    [[...base, { action: "lab_read", kind: "dossier", dossierId: b.id }], 404],
    [actor.permissions, 200],
    [base, 404],
    [actor.permissions, 200],
  ] as const) {
    const current = (await f.request("GET", "/session")).json().user;
    const changed = await f.request("PUT", `/users/${actor.id}`, {
      operationId: operationId(),
      expectedVersion: current.version,
      active: true,
      permissions,
    });
    expect(changed.statusCode, changed.body).toBe(200);
    for (const id of [old.documentId, replacement.documentId])
      expect((await f.request("GET", `/documents/${id}`)).statusCode).toBe(
        status,
      );
    expect(
      (await f.request("GET", `/documents/${unrelated.documentId}`)).statusCode,
    ).toBe(200);
    const listing = await f.request("GET", `/documents?dossierId=${a.id}`);
    expect(listing.statusCode, listing.body).toBe(200);
    expect(listing.json().total).toBe(status === 200 ? 2 : 0);
    expect(
      listing
        .json()
        .items.map((item: any) => item.id)
        .sort(),
    ).toEqual(
      status === 200 ? [old.documentId, replacement.documentId].sort() : [],
    );
  }
});

test("Work document v14 shares concrete grants, all current owners and historical LAB checks through populated migration and team withdrawal", async () => {
  const admin = await start();
  const { authorizedPredicate } = await import("../src/records/query.js");
  const create = async (record: Record<string, unknown>) => {
    const response = await f.request("POST", "/records", {
      operationId: operationId(),
      record,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
  };
  const a = await create({ kind: "dossier", title: "Work A", data: {} });
  const b = await create({ kind: "dossier", title: "Lien B", data: {} });
  const person = await create({
    kind: "contact",
    title: "Contact sans dossier principal",
    confidential: true,
    data: { contactType: "personne", relatedDossierIds: [a.id, b.id] },
  });
  const evidence = await proof(a.id),
    independent = await proof(a.id),
    otherEvidence = await proof(b.id);
  const first = await create({
    kind: "tache",
    title: "Premier propriétaire",
    dossierId: a.id,
    data: { documentIds: [evidence.documentId] },
  });
  const second = await create({
    kind: "tache",
    title: "Second propriétaire confidentiel",
    dossierId: a.id,
    confidential: true,
    data: { documentIds: [evidence.documentId], prospectId: person.id },
  });
  const grant = (
    action: string,
    kind = "*",
    dossierId: string | null = null,
  ) => ({ action, kind, dossierId });
  const scoped = [
    grant("read", "*", a.id),
    grant("confidential", "*", a.id),
    grant("read", "dossier", b.id),
    grant("read", "contact"),
    grant("confidential", "contact"),
  ];
  const compare = async (
    permissions: typeof admin.permissions,
    expected: boolean,
    actorId = admin.id,
  ) => {
    await f.maintainDatabase(async (db) => {
      const params: unknown[] = [[first.id, second.id]];
      const predicate = authorizedPredicate(
        { ...admin, id: actorId, permissions },
        "read",
        (value) => {
          params.push(value);
          return "$" + params.length;
        },
      );
      const concrete = (
        await db.query(
          `SELECT NOT EXISTS(SELECT 1 FROM cabinet_records r WHERE r.id=ANY($1::uuid[]) AND (${predicate}) IS NOT TRUE) allowed`,
          params,
        )
      )[0]!.allowed;
      const symbolic = (
        await db.query(
          "SELECT cabinet_work_document_allowed_v14($1::uuid,$2::jsonb,$3::uuid) allowed",
          [actorId, JSON.stringify(permissions), evidence.documentId],
        )
      )[0]!.allowed;
      expect([concrete, symbolic]).toEqual([expected, expected]);
      expect(
        (
          await db.query(
            "SELECT cabinet_work_document_allowed_v14($1::uuid,$2::jsonb,$3::uuid) allowed",
            [actorId, JSON.stringify(permissions), independent.documentId],
          )
        )[0]!.allowed,
      ).toBe(true);
    });
  };
  for (const [permissions, allowed] of [
    [admin.permissions, true],
    [[grant("read"), grant("confidential")], true],
    [[grant("read", "*", a.id), grant("confidential", "*", a.id)], false],
    [scoped, true],
    [
      scoped.filter(
        (p) => !(p.action === "confidential" && p.kind === "contact"),
      ),
      false,
    ],
    [
      [
        grant("read", "dossier", a.id),
        grant("read", "dossier", b.id),
        grant("read", "tache", a.id),
        grant("read", "contact"),
        grant("confidential", "tache", a.id),
        grant("confidential", "contact"),
      ],
      true,
    ],
    [[grant("read", "dossier"), grant("confidential")], false],
    [[], false],
  ] as const)
    await compare([...permissions], allowed);

  const policy = await save({
    kind: "lab_policy",
    name: "Historique Work",
    periodDays: 90,
    reason: "Examen fictif",
  });
  let review = await save({
    kind: "lab",
    dossierId: a.id,
    personId: person.id,
    level: "standard",
    reason: "Preuve historique",
    role: "Responsable",
    observedOn: "2026-10-18",
    decisionOn: "2026-10-18",
    nextReviewOn: "2027-01-01",
    policyId: policy.id,
    policyVersion: policy.version,
    evidence: [{ ...evidence, documentId: evidence.documentId.toUpperCase() }],
  });
  review = await save(
    {
      ...review.data,
      dossierId: b.id,
      personId: null,
      evidence: [otherEvidence],
    },
    review,
  );
  const changed = await f.request("PUT", `/records/${person.id}`, {
    operationId: operationId(),
    expectedVersion: person.version,
    record: {
      kind: person.kind,
      title: person.title,
      dossierId: person.dossierId,
      data: person.data,
      confidential: false,
    },
  });
  expect(changed.statusCode, changed.body).toBe(200);
  await compare(scoped, false);
  await compare([...scoped, grant("lab_read", "dossier", a.id)], false);
  const complete = [
    ...scoped,
    grant("lab_read", "dossier", a.id),
    grant("lab_read", "dossier", b.id),
  ];
  await compare(complete, true);
  await compare(
    complete.filter(
      (p) => !(p.action === "confidential" && p.kind === "contact"),
    ),
    false,
  );

  let before: unknown[] = [];
  await f.maintainDatabase(async (db) => {
    before = await db.query(
      "SELECT id,version,content FROM cabinet_relationship_history ORDER BY id,version",
    );
    await db.query(
      "DROP FUNCTION cabinet_work_document_allowed_v14(uuid,jsonb,uuid)",
    );
    await db.query("DELETE FROM schema_migrations WHERE version=14");
    expect(
      (await db.query("SELECT max(version) version FROM schema_migrations"))[0]!
        .version,
    ).toBe(13);
  });
  await compare(complete, true);
  await compare(
    complete.filter((p) => p.action !== "lab_read"),
    false,
  );
  await f.maintainDatabase(async (db) => {
    expect(
      await db.query(
        "SELECT id,version,content FROM cabinet_relationship_history ORDER BY id,version",
      ),
    ).toEqual(before);
    expect(
      (await db.query("SELECT max(version) version FROM schema_migrations"))[0]!
        .version,
    ).toBe(14);
    const schema = String(
      (await db.query("SELECT current_schema() name"))[0]!.name,
    );
    const properties = await db.query(
      "SELECT prosecdef,provolatile,proconfig FROM pg_proc WHERE proname='cabinet_work_document_allowed_v14' AND pronamespace=current_schema()::regnamespace",
    );
    expect(properties).toEqual([
      {
        prosecdef: false,
        provolatile: "s",
        proconfig: [`search_path=${schema}, pg_catalog`],
      },
    ]);
    const otherSchema =
      "diag_relationship_" + operationId().replaceAll("-", "");
    const { migrate } = await import("../src/storage/migrations.js");
    await db.transaction(async (tx) => {
      await tx.query(`CREATE SCHEMA ${otherSchema}`);
      try {
        await tx.query(`SET LOCAL search_path TO ${otherSchema}, pg_catalog`);
        await migrate(tx);
        const result = (
          await tx.query(
            `SELECT "${schema}".cabinet_work_document_allowed_v14($1::uuid,'[]'::jsonb,$2::uuid) installation,${otherSchema}.cabinet_work_document_allowed_v14($1::uuid,'[]'::jsonb,$2::uuid) empty_installation`,
            [admin.id, evidence.documentId],
          )
        )[0];
        expect(result).toEqual({
          installation: false,
          empty_installation: true,
        });
      } finally {
        await tx.query(`DROP SCHEMA ${otherSchema} CASCADE`);
      }
    });
  });

  const withoutWork = [
    grant("read", "dossier"),
    grant("read", "contact"),
    grant("confidential", "contact"),
    grant("lab_read"),
  ];
  const user = (
    await f.request("POST", "/users", {
      operationId: operationId(),
      email: "work-owner-reader@example.test",
      name: "Lecteur Work",
      password: "FictitiousReader123!",
      permissions: withoutWork,
    })
  ).json();
  const role = (
    await f.request("POST", "/administration/roles", {
      operationId: operationId(),
      name: "Lecture des propriétaires",
      order: 0,
      permissions: [grant("read", "tache"), grant("confidential", "tache")],
    })
  ).json();
  let group = (
    await f.request("POST", "/administration/groups", {
      operationId: operationId(),
      kind: "team",
      name: "Équipe des propriétaires",
      memberIds: [],
    })
  ).json();
  const assigned = await f.request("POST", "/administration/assignments", {
    operationId: operationId(),
    rows: [
      {
        dossierId: a.id,
        expectedVersion: a.version,
        subject: { kind: "team", id: group.id },
        roleId: role.id,
        remove: false,
      },
    ],
  });
  expect(assigned.statusCode, assigned.body).toBe(200);
  const login = await f.request(
    "POST",
    "/login",
    {
      email: "work-owner-reader@example.test",
      password: "FictitiousReader123!",
    },
    "",
  );
  expect(login.statusCode, login.body).toBe(200);
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  for (const allowed of [false, true, false, true]) {
    const changed = await f.request(
      "PUT",
      `/administration/groups/${group.id}`,
      {
        operationId: operationId(),
        expectedVersion: group.version,
        kind: "team",
        name: group.name,
        memberIds: allowed ? [user.id] : [],
      },
    );
    expect(changed.statusCode, changed.body).toBe(200);
    group = changed.json();
    await compare(withoutWork, allowed, user.id);
    expect(
      (
        await f.request(
          "GET",
          `/documents/${evidence.documentId}`,
          undefined,
          cookie,
        )
      ).statusCode,
    ).toBe(allowed ? 200 : 404);
    expect(
      (
        await f.request(
          "GET",
          `/documents?dossierId=${a.id}`,
          undefined,
          cookie,
        )
      ).json().total,
    ).toBe(allowed ? 2 : 1);
    expect(
      (
        await f.request(
          "GET",
          `/documents/${independent.documentId}`,
          undefined,
          cookie,
        )
      ).statusCode,
    ).toBe(200);
  }
});
