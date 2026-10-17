import { afterEach, expect, test } from "vitest";
import { fixture, dossier, operationId } from "./helpers.js";
let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
});
const provenance = {
  kind: "simulated",
  source: "fournisseur fictif",
  account: "compte fictif",
  reference: "decl-1",
  version: "1",
  observedAt: "2026-10-17T10:00:00.000Z",
  sourceUpdatedAt: "2026-10-16T10:00:00.000Z",
  coverage: "complete",
  rawState: "fixture",
};
test("TVA local approval keeps rejected recipient and pending recipient separate without a payment", async () => {
  f = await fixture(() => new Date("2026-10-17T10:00:00Z"));
  await f.setup();
  const parent = (await f.request("POST", "/records", dossier())).json();
  let response = await f.request("POST", "/fiscal", {
    operationId: operationId(),
    dossierId: parent.id,
    title: "TVA septembre fictive",
    nature: "TVA",
    period: {
      start: "2026-09-01",
      end: "2026-09-30",
      campaign: "2026",
      subtype: "CA3",
    },
    amount: "100.00",
  });
  expect(response.statusCode, response.body).toBe(201);
  let detail = response.json();
  async function command(event: Record<string, unknown>) {
    response = await f.request("POST", `/fiscal/${detail.record.id}/commands`, {
      operationId: operationId(),
      expectedVersion: detail.record.version,
      event,
    });
    expect(response.statusCode, response.body).toBe(200);
    detail = response.json();
    return detail;
  }
  await command({ kind: "preparation", state: "preparee" });
  await command({ kind: "approval_request" });
  await command({
    kind: "approval",
    decision: "approved",
    reason: "Revue fictive",
  });
  const declarationVersion = detail.situation.declarationVersion;
  const attemptId = operationId();
  await command({
    kind: "attempt",
    id: attemptId,
    declarationVersion,
    recipients: ["DGFiP", "Banque"],
    productionReference: "production fictive",
    provenance,
  });
  await command({
    kind: "return",
    attemptId,
    target: "recipient",
    recipient: "DGFiP",
    state: "rejected",
    reason: "Rejet fictif",
    provenance: { ...provenance, reference: "retour-1" },
  });
  expect(detail.situation.approval).toBe("approved");
  expect(detail.situation.applicableAcceptedVersion).toBeNull();
  expect(detail.situation.attempts[0].recipients).toEqual({
    DGFiP: "rejected",
    Banque: "pending",
  });
  expect(detail.situation.paid).toBe("0.00");
  expect(detail.situation.remaining).toBe("100.00");
  expect(
    detail.timeline.filter(
      (e: { event: { kind: string } }) => e.event.kind === "return",
    ),
  ).toHaveLength(1);
});
async function startFiscal(nature = "IS", amount: string | null = "100.00") {
  f = await fixture(() => new Date("2026-10-17T10:00:00Z"));
  await f.setup();
  const parent = (await f.request("POST", "/records", dossier())).json();
  const response = await f.request("POST", "/fiscal", {
    operationId: operationId(),
    dossierId: parent.id,
    title: `${nature} fictif`,
    nature,
    period: {
      start: nature === "RCM_2777" ? "2026-09-01" : "2025-07-01",
      end: nature === "RCM_2777" ? "2026-09-30" : "2026-06-30",
      campaign: "2026",
      subtype: "solde",
    },
    financialYearEnd: "2026-06-30",
    amount,
  });
  expect(response.statusCode, response.body).toBe(201);
  let detail = response.json();
  return {
    parent,
    get detail() {
      return detail;
    },
    async command(event: Record<string, unknown>, token = f.cookie) {
      const response = await f.request(
        "POST",
        `/fiscal/${detail.record.id}/commands`,
        {
          operationId: operationId(),
          expectedVersion: detail.record.version,
          event,
        },
        token,
      );
      expect(response.statusCode, response.body).toBe(200);
      detail = response.json();
      return detail;
    },
    async approve() {
      await this.command({ kind: "preparation", state: "preparee" });
      await this.command({ kind: "approval_request" });
      await this.command({
        kind: "approval",
        decision: "approved",
        reason: "Revue fictive",
      });
    },
  };
}
test("accepted IS original survives rejected correction with both receipts and generic writes cannot bypass frozen fiscal content", async () => {
  const s = await startFiscal();
  await s.approve();
  const original = operationId();
  await s.command({
    kind: "attempt",
    id: original,
    declarationVersion: 1,
    recipients: ["DGFiP"],
    productionReference: "original",
    provenance,
  });
  await s.command({
    kind: "return",
    attemptId: original,
    target: "recipient",
    recipient: "DGFiP",
    state: "accepted",
    reason: "Accepté",
    provenance: { ...provenance, reference: "original-accepted" },
  });
  await s.command({
    kind: "revision",
    amount: "120.00",
    reason: "Correction fictive",
  });
  await s.approve();
  const correction = operationId();
  await s.command({
    kind: "attempt",
    id: correction,
    declarationVersion: 2,
    recipients: ["DGFiP"],
    productionReference: "correction",
    provenance: { ...provenance, reference: "correction" },
  });
  await s.command({
    kind: "return",
    attemptId: correction,
    target: "recipient",
    recipient: "DGFiP",
    state: "rejected",
    reason: "Rejet",
    provenance: { ...provenance, reference: "correction-rejected" },
  });
  expect(s.detail.situation.applicableAcceptedVersion).toBe(1);
  expect(
    s.detail.situation.attempts.map((a: { accepted: boolean }) => a.accepted),
  ).toEqual([true, false]);
  const r = s.detail.record;
  const bypass = await f.request("PUT", `/records/${r.id}`, {
    operationId: operationId(),
    expectedVersion: r.version,
    record: {
      kind: r.kind,
      title: r.title,
      dossierId: r.dossierId,
      confidential: r.confidential,
      data: { ...r.data, amount: "0.00" },
    },
  });
  expect(bypass.statusCode).toBe(409);
  await f.restart();
  const reloaded = (await f.request("GET", `/fiscal/${r.id}`)).json();
  expect(reloaded.situation.applicableAcceptedVersion).toBe(1);
});
test("exact debt payments 30.01 and 69.99 are counted once after recollection; schedules and remissions never prove bank debit", async () => {
  const s = await startFiscal();
  const debtId = operationId();
  await s.command({
    kind: "debt",
    id: debtId,
    amount: "100.00",
    sourceBalance: "100.00",
    period: "2026",
    tax: "IS",
    reference: "créance-1",
    provenance,
  });
  await s.command({
    kind: "schedule",
    debtId,
    instalments: [{ date: "2026-11-01", amount: "100.00" }],
    decision: "accepted",
    reason: "Échéancier fictif",
    provenance: { ...provenance, reference: "échéancier-1" },
  });
  expect(s.detail.situation.debts[0].remaining).toBe("100.00");
  const first = {
    kind: "payment",
    id: operationId(),
    debtId,
    amount: "30.01",
    date: "2026-10-10",
    state: "debit_confirmed",
    reason: "Débit acquis fictif",
    provenance: { ...provenance, reference: "règlement-1" },
  };
  await s.command(first);
  await s.command({
    kind: "payment",
    id: operationId(),
    debtId,
    amount: "69.99",
    date: "2026-10-11",
    state: "debit_confirmed",
    reason: "Débit acquis fictif",
    provenance: { ...provenance, reference: "règlement-2" },
  });
  await s.command({
    ...first,
    id: operationId(),
    provenance: { ...first.provenance, observedAt: "2026-10-17T11:00:00.000Z" },
  });
  expect(s.detail.situation.paid).toBe("100.00");
  expect(s.detail.situation.debts[0].remaining).toBe("0.00");
  await s.command({
    kind: "apurement",
    id: operationId(),
    debtId,
    paymentId: first.id,
    amount: "30.01",
    date: "2026-10-10",
    nature: "payment",
    reason: "Même paiement",
    confirmed: true,
    provenance: { ...provenance, reference: "apurement-1" },
  });
  expect(s.detail.situation.debts[0].remaining).toBe("0.00");
  expect(s.detail.situation.debts[0].sourceConfirmedZero).toBe(false);
});
test("unknown differs from zero, remission reduces debt without bank payment, bank candidates expose four independent reasons", async () => {
  const s = await startFiscal("CFE_IFER", null);
  expect(s.detail.situation.remaining).toBeNull();
  const debtId = operationId();
  await s.command({
    kind: "debt",
    id: debtId,
    amount: "100.00",
    sourceBalance: null,
    period: "2026",
    tax: "CFE",
    reference: "rôle fictif",
    provenance,
  });
  await s.command({
    kind: "apurement",
    id: operationId(),
    debtId,
    amount: "20.00",
    date: "2026-10-10",
    nature: "remission",
    reason: "Remise accordée fictive",
    confirmed: true,
    provenance,
  });
  expect(s.detail.situation.debts[0].remaining).toBe("80.00");
  expect(s.detail.situation.paid).toBe("0.00");
  for (const [fields, expected] of [
    [
      {
        accountPresent: false,
        pdfParsed: true,
        iban: "exact",
        orderDate: "2026-10-01",
      },
      "account_absent",
    ],
    [
      {
        accountPresent: true,
        pdfParsed: false,
        iban: "exact",
        orderDate: "2026-10-01",
      },
      "pdf_unparsed",
    ],
    [
      {
        accountPresent: true,
        pdfParsed: true,
        iban: "masked_ambiguous",
        orderDate: "2026-10-01",
      },
      "iban_ambiguous",
    ],
    [
      {
        accountPresent: true,
        pdfParsed: true,
        iban: "exact",
        orderDate: "2025-10-16",
      },
      "order_outside_window",
    ],
  ] as const) {
    await s.command({
      kind: "bank_candidate",
      id: operationId(),
      debtId,
      ...fields,
      evaluatedOn: "2026-10-17",
      rule: {
        id: "fenêtre-fictive",
        version: "1",
        datedOn: "2026-10-01",
        maximumMonths: 12,
      },
      confidence: "low",
      provenance,
    });
    expect(s.detail.situation.bankCandidates.at(-1).reasons).toContain(
      expected,
    );
  }
  expect(s.detail.situation.bankCandidates).toHaveLength(4);
  expect(s.detail.situation.paid).toBe("0.00");
});
test("manual cancellation and new contradictory source preserve all origins and reopen a resolved anomaly", async () => {
  const s = await startFiscal("DAS2");
  const marker = operationId();
  await s.command({
    kind: "manual_mark",
    id: marker,
    state: "done",
    reason: "Réalisation constatée localement",
    documentIds: [],
  });
  await s.command({
    kind: "cancel_mark",
    markId: marker,
    reason: "Erreur de saisie",
  });
  const obs1 = operationId(),
    obs2 = operationId();
  await s.command({
    kind: "observation",
    id: obs1,
    field: "regime",
    value: "IS",
    provenance: {
      ...provenance,
      source: "Pennylane fictif",
      reference: "regime-1",
    },
  });
  await s.command({
    kind: "observation",
    id: obs2,
    field: "regime",
    value: "IR",
    provenance: {
      ...provenance,
      source: "DGFiP fictif",
      reference: "regime-2",
    },
  });
  expect(s.detail.situation.anomalies[0].state).toBe("open");
  await s.command({
    kind: "resolution",
    field: "regime",
    observationIds: [obs1, obs2],
    value: "IS",
    reason: "Vérification manuelle fictive",
  });
  expect(s.detail.situation.anomalies[0].state).toBe("resolved");
  await s.command({
    kind: "observation",
    id: operationId(),
    field: "regime",
    value: "BNC",
    provenance: {
      ...provenance,
      source: "DGFiP fictif",
      reference: "regime-2",
      version: "2",
    },
  });
  expect(s.detail.situation.anomalies[0].state).toBe("open");
  expect(s.detail.situation.manualMarks[0].cancelled).toBe(true);
  expect(s.detail.situation.applicableAcceptedVersion).toBeNull();
  await s.command({
    kind: "classification",
    state: "hidden",
    reason: "Contrôle temporaire fictif",
  });
  expect(s.detail.record.data.fiscal.classification).toBe("hidden");
});
test("IRPP contact confidentiality also protects canonical list detail history export and fiscal replay", async () => {
  const s = await startFiscal();
  const contact = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "contact",
        title: "Contact confidentiel fictif",
        dossierId: s.parent.id,
        confidential: true,
        data: {},
      },
    })
  ).json();
  const input = {
    operationId: operationId(),
    dossierId: s.parent.id,
    contactId: contact.id,
    title: "IRPP fictif",
    nature: "IRPP",
    period: {
      start: "2025-01-01",
      end: "2025-12-31",
      campaign: "2026",
      subtype: "revenus",
    },
  };
  const response = await f.request("POST", "/fiscal", input);
  expect(response.statusCode, response.body).toBe(201);
  const id = response.json().record.id;
  const prefilling = await uploadFiscalOriginal(
    s.parent.id,
    Buffer.from("Prérempli IRPP fictif 2025"),
  );
  const validation = await f.request("POST", `/fiscal/${id}/commands`, {
    operationId: operationId(),
    expectedVersion: response.json().record.version,
    event: {
      kind: "client_validation",
      state: "accepted",
      reason: "Accord client fictif sur le prérempli",
      provenance: { ...provenance, documentIds: [prefilling.id] },
    },
  });
  expect(validation.statusCode, validation.body).toBe(200);
  expect(validation.json().situation.clientValidation).toBe("accepted");
  expect(validation.json().situation.approval).toBe("not_requested");
  expect(validation.json().situation.attempts).toEqual([]);
  await f.request("POST", "/users", {
    operationId: operationId(),
    name: "Lecteur fictif",
    email: "lecteur@example.test",
    password: "MotDePasseFictif123!",
    permissions: ["read", "audit", "export"].map((action) => ({
      action,
      kind: "*",
    })),
  });
  const login = await f.request("POST", "/login", {
    email: "lecteur@example.test",
    password: "MotDePasseFictif123!",
  });
  const token = String(login.headers["set-cookie"]).split(";")[0]!;
  for (const path of [
    `/fiscal/${id}`,
    `/documents/${prefilling.id}/download`,
    `/records/${id}`,
    `/records/${id}/history`,
  ])
    expect((await f.request("GET", path, undefined, token)).statusCode).toBe(
      404,
    );
  expect(
    (await f.request("GET", "/records?kind=obligation", undefined, token))
      .json()
      .items.map((r: { id: string }) => r.id),
  ).not.toContain(id);
  expect(
    (
      await f.request(
        "GET",
        "/records/export.csv?kind=obligation",
        undefined,
        token,
      )
    ).body,
  ).not.toContain(id);
});
test("source freshness uses source update time and versioned cadence, never collection time or verified simulation", async () => {
  const s = await startFiscal("TVA");
  const policy = {
    id: "cadence-fictive",
    version: "1",
    source: "fournisseur fictif",
    maximumAgeHours: 48,
    validFrom: "2026-10-01",
    validTo: "2026-12-31",
    reason: "Politique opérationnelle fictive, aucun SLA fournisseur",
  };
  await s.command({ kind: "source_freshness", provenance, policy });
  expect(s.detail.freshness.state).toBe("fresh");
  expect(s.detail.freshness.verifiedSupplier).toBe(false);
  await s.command({
    kind: "source_freshness",
    provenance: {
      ...provenance,
      sourceUpdatedAt: "2026-10-01T10:00:00.000Z",
      version: "2",
    },
    policy,
  });
  expect(s.detail.freshness.state).toBe("stale");
  const dashboard = (
    await f.request(
      "GET",
      `/dashboard?kind=obligation&dossierId=${s.parent.id}`,
    )
  ).json();
  expect(dashboard.obligationSources.stale).toBe(1);
  const csv = (
    await f.request(
      "GET",
      `/records/export.csv?kind=obligation&columns=id,freshnessState,sourceUpdatedAt,observedAt,cadenceVersion`,
    )
  ).body;
  expect(csv).toContain('"stale"');
  expect(csv).toContain('"2026-10-01T10:00:00.000Z"');
  expect(csv).toContain('"2026-10-17T10:00:00.000Z"');
  await s.command({
    kind: "source_freshness",
    provenance: { ...provenance, sourceUpdatedAt: null },
    policy,
  });
  expect(s.detail.freshness.state).toBe("unknown");
  await s.command({ kind: "source_freshness", provenance, policy: null });
  expect(s.detail.freshness.state).toBe("unknown");
  await s.command({
    kind: "source_freshness",
    provenance: { ...provenance, coverage: "partial" },
    policy,
  });
  expect(s.detail.freshness.state).toBe("unknown");
});
test("IFU needs beneficiary allocation and month coverage; approved aggregate becomes stale after RCM revision", async () => {
  const s = await startFiscal();
  const make = async (nature: string, start: string, end: string) => {
    const r = await f.request("POST", "/fiscal", {
      operationId: operationId(),
      dossierId: s.parent.id,
      title: nature + " fictif",
      nature,
      period: { start, end, campaign: "2026", subtype: "revenus" },
      amount: "100.00",
    });
    expect(r.statusCode, r.body).toBe(201);
    return r.json();
  };
  let rcm = await make("RCM_2777", "2025-01-01", "2025-01-31"),
    ifu = await make("IFU_2561", "2025-01-01", "2025-12-31");
  const command = async (d: typeof ifu, event: Record<string, unknown>) => {
    const r = await f.request("POST", `/fiscal/${d.record.id}/commands`, {
      operationId: operationId(),
      expectedVersion: d.record.version,
      event,
    });
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };
  const rule = {
    id: "compatible-income-sum",
    version: "1",
    campaign: "2026",
    source: "Spécification de préparation fictive",
    datedOn: "2026-01-01",
    status: "draft",
  };
  ifu = await command(ifu, {
    kind: "ifu_prepare",
    sourceIds: [rcm.record.id],
    payer: {
      identity: "Payeur fictif",
      address: "Adresse fictive",
      siret: "00123456700019",
    },
    rule,
  });
  expect(ifu.situation.ifu.coverage.missingMonths).toEqual([
    2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
  ]);
  expect(ifu.situation.ifu.complete).toBe(false);
  expect(ifu.situation.ifu.grossTotal).toBeNull();
  expect(ifu.situation.ifu.certifiedExport).toBe(false);
  rcm = await command(rcm, {
    kind: "income",
    coverage: "complete",
    lines: [
      {
        beneficiary: {
          identity: "Bénéficiaire fictif",
          address: "Adresse fictive",
          type: "organisation",
          siret: "00123456700019",
          birthDate: null,
        },
        category: "distribution_non_eligible",
        gross: "500.00",
        withheld: "100.00",
      },
    ],
    provenance,
  });
  const sources = [rcm.record.id];
  for (let month = 2; month <= 12; month++) {
    const start = `2025-${String(month).padStart(2, "0")}-01`,
      end = new Date(Date.UTC(2025, month, 0)).toISOString().slice(0, 10);
    let zero = await make("RCM_2777", start, end);
    zero = await command(zero, {
      kind: "income",
      coverage: "confirmed_zero",
      lines: [],
      provenance: { ...provenance, reference: `zero-${month}` },
    });
    sources.push(zero.record.id);
  }
  ifu = await command(ifu, {
    kind: "ifu_prepare",
    sourceIds: sources,
    payer: {
      identity: "Payeur fictif",
      address: "Adresse fictive",
      siret: "00123456700019",
    },
    rule,
  });
  expect(ifu.situation.ifu.complete).toBe(true);
  expect(ifu.situation.ifu.grossTotal).toBe("500.00");
  for (const event of [
    { kind: "preparation", state: "preparee" },
    { kind: "approval_request" },
    {
      kind: "approval",
      decision: "approved",
      reason: "Préparation locale seulement",
    },
  ])
    ifu = await command(ifu, event);
  const generatedInput = {
    operationId: operationId(),
    expectedVersion: ifu.record.version,
  };
  const generated = await f.request(
    "POST",
    `/fiscal/${ifu.record.id}/preparation-document`,
    generatedInput,
  );
  expect(generated.statusCode, generated.body).toBe(201);
  const preparation = generated.json();
  ifu = preparation.detail;
  const original = (
    await f.request("GET", `/documents/${preparation.document.id}/download`)
  ).body;
  expect(original).toContain('"grossTotal": "500.00"');
  expect(original).toContain("PRÉPARATION LOCALE NON CERTIFIÉE");
  const replay = await f.request(
    "POST",
    `/fiscal/${ifu.record.id}/preparation-document`,
    generatedInput,
  );
  expect(replay.statusCode, replay.body).toBe(201);
  expect(replay.json().document.id).toBe(preparation.document.id);
  rcm = await command(rcm, {
    kind: "revision",
    amount: "110.00",
    reason: "Source corrigée",
  });
  expect(
    (await f.request("GET", `/documents/${preparation.document.id}/download`))
      .body,
  ).toBe(original);
  ifu = (await f.request("GET", `/fiscal/${ifu.record.id}`)).json();
  expect(ifu.situation.ifu.stale).toBe(true);
  expect(ifu.situation.ifu.sourceVersions[0].version).toBeLessThan(
    rcm.record.version,
  );
  const rejected = await f.request(
    "POST",
    `/fiscal/${ifu.record.id}/commands`,
    {
      operationId: operationId(),
      expectedVersion: ifu.record.version,
      event: {
        kind: "attempt",
        id: operationId(),
        declarationVersion: ifu.situation.declarationVersion,
        recipients: ["DGFiP"],
        productionReference: "non transmis",
        provenance,
      },
    },
  );
  expect(rejected.statusCode).toBe(409);
});
test("occurrences follow dossier frequency and fiscal year, regenerate stably, filter and bulk prepare without universal deadlines", async () => {
  const s = await startFiscal();
  const p = s.parent;
  const updated = await f.request("PUT", `/records/${p.id}`, {
    operationId: operationId(),
    expectedVersion: p.version,
    record: {
      kind: p.kind,
      title: p.title,
      dossierId: p.dossierId,
      confidential: p.confidential,
      data: {
        ...p.data,
        vatRegime: "reel_normal",
        vatFrequency: "trimestrielle",
        incomeTaxRegime: "IS",
        financialYearEnd: "2026-06-30",
      },
    },
  });
  expect(updated.statusCode, updated.body).toBe(200);
  const input = {
    operationId: operationId(),
    dossierId: p.id,
    expectedDossierVersion: updated.json().version,
    nature: "TVA",
    year: 2026,
    campaign: "2026",
    rule: {
      id: "profil-fictif",
      version: "1",
      source: "Paramètres du cabinet fictif",
      datedOn: "2026-01-01",
    },
  };
  const generated = await f.request("POST", "/fiscal/generate", input);
  expect(generated.statusCode, generated.body).toBe(200);
  expect(generated.json().items).toHaveLength(4);
  const repeated = await f.request("POST", "/fiscal/generate", {
    ...input,
    operationId: operationId(),
  });
  expect(repeated.json().items).toEqual(generated.json().items);
  const list = await f.request(
    "GET",
    `/fiscal?nature=TVA&campaign=2026&dossierId=${p.id}`,
  );
  expect(list.statusCode, list.body).toBe(200);
  expect(list.json().total).toBe(4);
  expect(
    list
      .json()
      .items.every((r: { data: { dueDate: null } }) => r.data.dueDate === null),
  ).toBe(true);
  const batch = await f.request("POST", "/fiscal/bulk", {
    operationId: operationId(),
    items: list.json().items.map((r: { id: string; version: number }) => ({
      id: r.id,
      expectedVersion: r.version,
    })),
    event: { kind: "preparation", state: "preparee" },
  });
  expect(batch.statusCode, batch.body).toBe(200);
  expect(
    batch.json().items.every((r: { status: string }) => r.status === "updated"),
  ).toBe(true);
  let batchItems = batch
    .json()
    .items.map((r: { id: string; version: number }) => ({
      id: r.id,
      expectedVersion: r.version,
    }));
  for (const event of [
    { kind: "approval_request" },
    { kind: "approval", decision: "approved", reason: "Revue du lot fictif" },
  ]) {
    const result = await f.request("POST", "/fiscal/bulk", {
      operationId: operationId(),
      items: batchItems,
      event,
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(
      result
        .json()
        .items.every((r: { status: string }) => r.status === "updated"),
    ).toBe(true);
    batchItems = result
      .json()
      .items.map((r: { id: string; version: number }) => ({
        id: r.id,
        expectedVersion: r.version,
      }));
  }
  const is = await f.request("POST", "/fiscal/generate", {
    ...input,
    operationId: operationId(),
    nature: "IS",
  });
  expect(is.statusCode, is.body).toBe(200);
  expect(is.json().items).toHaveLength(5);
  const isList = (
    await f.request("GET", `/fiscal?nature=IS&dossierId=${p.id}`)
  ).json();
  expect(
    isList.items.filter(
      (r: { data: { fiscal: { period: { subtype: string } } } }) =>
        r.data.fiscal.period.subtype.startsWith("acompte"),
    ),
  ).toHaveLength(4);
  expect(
    isList.items.find(
      (r: { data: { fiscal: { period: { subtype: string } } } }) =>
        r.data.fiscal.period.subtype === "solde",
    ).data.fiscal.period.start,
  ).toBe("2025-07-01");
  for (const [nature, regime] of [
    ["TVA", "reel_normal"],
    ["IS", "IS"],
    ["DES", null],
  ] as const) {
    if (nature === "DES") {
      const generatedDes = await f.request("POST", "/fiscal/generate", {
        ...input,
        operationId: operationId(),
        nature,
      });
      expect(generatedDes.statusCode, generatedDes.body).toBe(200);
    }
    const persisted = (
      await f.request("GET", `/fiscal?nature=${nature}&dossierId=${p.id}`)
    ).json();
    expect(persisted.items.length).toBeGreaterThan(0);
    expect(
      persisted.items
        .filter(
          (r: { data: { fiscal: { occurrenceKey: string | null } } }) =>
            r.data.fiscal.occurrenceKey !== null,
        )
        .every(
          (r: { data: { fiscal: { regime: string | null } } }) =>
            r.data.fiscal.regime === regime,
        ),
    ).toBe(true);
  }
});
test("DSN establishment/month/recipient and DES manual evidence keep production and deadlines distinct", async () => {
  const s = await startFiscal();
  const establishmentId = operationId(),
    p = s.parent;
  const parent = await f.request("PUT", `/records/${p.id}`, {
    operationId: operationId(),
    expectedVersion: p.version,
    record: {
      kind: p.kind,
      title: p.title,
      dossierId: p.dossierId,
      confidential: p.confidential,
      data: {
        ...p.data,
        establishments: [
          {
            id: establishmentId,
            name: "Établissement fictif",
            siret: "00123456700019",
          },
        ],
      },
    },
  });
  expect(parent.statusCode).toBe(200);
  for (const nature of ["DSN", "DES"]) {
    const created = await f.request("POST", "/fiscal", {
      operationId: operationId(),
      dossierId: p.id,
      establishmentId: nature === "DSN" ? establishmentId : null,
      title: `${nature} septembre`,
      nature,
      period: {
        start: "2026-09-01",
        end: "2026-09-30",
        campaign: "2026",
        subtype: "mensuelle",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    let d = created.json();
    for (const event of [
      {
        kind: "deadlines",
        observed: "2026-10-15",
        internalTarget: "2026-10-10",
        campaignDate: "2026-10-12",
        provenance,
      },
      {
        kind: "manual_mark",
        id: operationId(),
        state: "done",
        reason: "Déclaration constatée localement",
        documentIds: [],
      },
    ]) {
      const response = await f.request(
        "POST",
        `/fiscal/${d.record.id}/commands`,
        {
          operationId: operationId(),
          expectedVersion: d.record.version,
          event,
        },
      );
      expect(response.statusCode, response.body).toBe(200);
      d = response.json();
    }
    expect(d.record.data.dueDate).toBe("2026-10-15");
    expect(d.record.data.fiscal.deadlines.internalTarget).toBe("2026-10-10");
    expect(d.record.data.fiscal.deadlines.campaignDate).toBe("2026-10-12");
    expect(d.situation.applicableAcceptedVersion).toBeNull();
    expect(d.situation.attempts).toHaveLength(0);
    expect(d.capabilities.realTransmission).toBe(false);
    if (nature === "DSN") {
      const proof = await uploadFiscalOriginal(
        p.id,
        Buffer.from("Accusé DSN septembre fictif"),
      );
      const attempt = operationId();
      const events = [
        { kind: "preparation", state: "preparee" },
        { kind: "approval_request" },
        {
          kind: "approval",
          decision: "approved",
          reason: "Contrôle cabinet fictif",
        },
        {
          kind: "attempt",
          id: attempt,
          declarationVersion: 1,
          recipients: ["URSSAF", "Retraite"],
          productionReference: "Production paie septembre établissement fictif",
          provenance,
        },
        {
          kind: "return",
          attemptId: attempt,
          target: "recipient",
          recipient: "URSSAF",
          state: "accepted",
          reason: "Accusé fictif",
          provenance: {
            ...provenance,
            source: "jedeclare fictif",
            reference: "accuse-septembre",
            documentIds: [proof.id],
          },
        },
      ];
      for (const event of events) {
        const result = await f.request(
          "POST",
          `/fiscal/${d.record.id}/commands`,
          {
            operationId: operationId(),
            expectedVersion: d.record.version,
            event,
          },
        );
        expect(result.statusCode, result.body).toBe(200);
        d = result.json();
      }
      expect(d.situation.attempts[0].recipients).toEqual({
        URSSAF: "accepted",
        Retraite: "pending",
      });
      expect(d.record.data.fiscal.establishmentId).toBe(establishmentId);
      expect(d.record.data.fiscal.period.start).toBe("2026-09-01");
      expect(d.record.data.fiscal.documentIds).toContain(proof.id);
      const wrong = await f.request("POST", `/fiscal/${d.record.id}/commands`, {
        operationId: operationId(),
        expectedVersion: d.record.version,
        event: {
          kind: "return",
          attemptId: operationId(),
          target: "recipient",
          recipient: "URSSAF",
          state: "accepted",
          reason: "Mauvaise tentative",
          provenance,
        },
      });
      expect(wrong.statusCode).toBe(400);
    }
  }
});
async function completeExport(command: Record<string, unknown>) {
  const start = await f.request("POST", "/administration/exports", {
    operationId: operationId(),
    ...command,
  });
  expect(start.statusCode, start.body).toBe(202);
  const id = start.json().id;
  for (let n = 0; n < 500; n++) {
    const state = (
      await f.request("GET", `/administration/exports/${id}`)
    ).json();
    if (state.job.state === "failed") throw Error(JSON.stringify(state));
    if (state.job.state === "completed") return id;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw Error("Export timeout");
}
test("complete interoperable exit includes fiscal events with provenance and canonical obligation identity", async () => {
  const s = await startFiscal();
  await s.approve();
  const id = await completeExport({});
  const manifest = (
    await f.request("GET", `/administration/exports/${id}/download`)
  ).json();
  const events = [];
  for (const part of manifest.parts) {
    const result = (
      await f.request("GET", part.downloadUrl.replace("/api/v1", ""))
    ).json();
    events.push(...result.fiscalEvents);
  }
  expect(
    events.map((e: { event: { kind: string } }) => e.event.kind).sort(),
  ).toEqual(["approval", "approval_request", "observation", "preparation"]);
  expect(
    events.every(
      (e: { obligationId: string }) => e.obligationId === s.detail.record.id,
    ),
  ).toBe(true);
});
test("filtered TF original lot contains principal and every suite despite same filenames and reports newly missing originals", async () => {
  const s = await startFiscal("TF");
  async function upload(bytes: Buffer) {
    const metadata = {
      operationId: operationId(),
      dossierId: s.parent.id,
      filename: "avis.bin",
      mediaType: "application/octet-stream",
      source: { kind: "simulated", reference: operationId(), version: "1" },
    };
    const boundary = "fiscal-piece";
    const response = await f.app.inject({
      method: "POST",
      url: "/api/v1/documents",
      headers: {
        origin: "http://localhost:3000",
        cookie: f.cookie,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="avis.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
  }
  const main = await upload(Buffer.alloc(9 * 1024 * 1024, 65)),
    suite = await upload(Buffer.from("suite originale fictive"));
  await s.command({
    kind: "notice",
    id: operationId(),
    reference: "TF-2026-fictif",
    role: "principal",
    year: 2026,
    establishmentId: null,
    properties: ["Bien A"],
    municipalities: ["Commune fictive"],
    amount: "100.00",
    dueDate: "2026-10-15",
    directDebit: "unknown",
    originalId: main.id,
    suiteIds: [suite.id],
    expectedSuites: 2,
    provenance,
  });
  const id = await completeExport({
    originals: true,
    query: {
      kind: "obligation",
      nature: "TF",
      year: "2026",
      property: "Bien A",
    },
  });
  const response = await f.request(
    "GET",
    `/administration/exports/${id}/originals.tar`,
  );
  expect(response.statusCode, response.body.slice(0, 200)).toBe(200);
  expect(response.headers["content-type"]).toContain("application/x-tar");
  expect(response.rawPayload.length).toBeGreaterThan(9 * 1024 * 1024);
  expect(response.body).toContain("suite originale fictive");
  expect(response.body).toContain("MISSING_SUITE");
  expect(response.body).toContain(main.id);
  expect(response.body).toContain(suite.id);
  const { writeFile } = await import("node:fs/promises"),
    { execFileSync } = await import("node:child_process"),
    { createHash } = await import("node:crypto");
  const archivePath = f.options.dataDirectory + "/lot-fiscal.tar";
  await writeFile(archivePath, response.rawPayload);
  const listing = execFileSync("tar", ["-tf", archivePath], {
    encoding: "utf8",
  });
  expect(listing).toContain(`originals/${main.id}-avis.bin`);
  expect(listing).toContain(`originals/${suite.id}-avis.bin`);
  const extracted = execFileSync(
    "tar",
    ["-xOf", archivePath, `originals/${main.id}-avis.bin`],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  expect(createHash("sha256").update(extracted).digest("hex")).toBe(
    main.sha256,
  );
  expect(extracted.equals(Buffer.alloc(9 * 1024 * 1024, 65))).toBe(true);
  const { unlink } = await import("node:fs/promises"),
    { join } = await import("node:path");
  await unlink(join(f.options.dataDirectory, "documents", suite.id));
  const again = await f.request(
    "GET",
    `/administration/exports/${id}/originals.tar`,
  );
  expect(again.statusCode).toBe(200);
  expect(again.body).toContain("DOCUMENT_MISSING");
  expect(again.body).not.toContain("suite originale fictive");
  await writeFile(
    join(f.options.dataDirectory, "documents", main.id),
    Buffer.from("original altéré fictif"),
  );
  const corrupt = await f.request(
    "GET",
    `/administration/exports/${id}/originals.tar`,
  );
  expect(corrupt.statusCode).toBe(200);
  expect(corrupt.body).toContain("DOCUMENT_CORRUPT");
  expect(corrupt.body).toContain("DOCUMENT_MISSING");
});

test("manual RCM amount conflicts with supplier evidence; approximate raw values and unknown payment amounts stay qualified", async () => {
  f = await fixture();
  await f.setup();
  const parent = (await f.request("POST", "/records", dossier())).json();
  let detail = (
    await f.request("POST", "/fiscal", {
      operationId: operationId(),
      dossierId: parent.id,
      title: "RCM fictif",
      nature: "RCM_2777",
      period: {
        start: "2026-09-01",
        end: "2026-09-30",
        campaign: "2026",
        subtype: "2777",
      },
      amount: "100.00",
    })
  ).json();
  let response = await f.request(
    "POST",
    `/fiscal/${detail.record.id}/commands`,
    {
      operationId: operationId(),
      expectedVersion: detail.record.version,
      event: {
        kind: "observation",
        id: operationId(),
        field: "amount",
        value: "120.00",
        provenance: {
          ...provenance,
          source: "Pennylane fictif",
          reference: "rcm-9",
        },
      },
    },
  );
  expect(response.statusCode, response.body).toBe(200);
  detail = response.json();
  expect(
    detail.situation.anomalies[0].observations.map(
      (o: { value: string }) => o.value,
    ),
  ).toEqual(["100.00", "120.00"]);
  response = await f.request("POST", `/fiscal/${detail.record.id}/commands`, {
    operationId: operationId(),
    expectedVersion: detail.record.version,
    event: {
      kind: "payment",
      id: operationId(),
      amount: null,
      date: "2026-10-01",
      state: "debit_confirmed",
      reason: "Montant non exposé",
      provenance: {
        ...provenance,
        rawAmount: "0.100000001e3",
        amountPrecision: "approximate",
        rawSourceUpdatedAt: "2026-10-01 09:00:00",
        sourceTimeZone: null,
        sourceUpdatedAt: null,
      },
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  detail = response.json();
  expect(detail.situation.paid).toBeNull();
  expect(detail.situation.remaining).toBeNull();
  expect(detail.situation.ambiguities).toContain(
    "Montant d’un règlement acquis inconnu",
  );
});

async function uploadFiscalOriginal(dossierId: string, bytes: Buffer) {
  const metadata = {
    operationId: operationId(),
    dossierId,
    filename: "avis.bin",
    mediaType: "application/octet-stream",
    source: { kind: "simulated", reference: operationId(), version: "1" },
  };
  const boundary = "fiscal-piece";
  const response = await f.app.inject({
    method: "POST",
    url: "/api/v1/documents",
    headers: {
      origin: "http://localhost:3000",
      cookie: f.cookie,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="avis.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json();
}
test("original streaming releases the database during backpressure, aborts revoked scope and permits retry after cancellation", async () => {
  const s = await startFiscal("CFE_IFER");
  const main = await uploadFiscalOriginal(
      s.parent.id,
      Buffer.alloc(9 * 1024 * 1024, 66),
    ),
    suite = await uploadFiscalOriginal(
      s.parent.id,
      Buffer.alloc(9 * 1024 * 1024, 67),
    );
  await s.command({
    kind: "notice",
    id: operationId(),
    reference: "CFE-flux-fictif",
    role: "principal",
    year: 2026,
    establishmentId: null,
    properties: [],
    municipalities: [],
    amount: "100.00",
    dueDate: null,
    directDebit: "unknown",
    originalId: main.id,
    suiteIds: [suite.id],
    expectedSuites: 1,
    provenance,
  });
  const exportId = await completeExport({
      originals: true,
      query: { kind: "obligation", nature: "CFE_IFER" },
    }),
    base = await f.app.listen({ host: "127.0.0.1", port: 0 });
  const url = `${base}/api/v1/administration/exports/${exportId}/originals.tar`;
  const controller = new AbortController();
  const interrupted = await fetch(url, {
    headers: { cookie: f.cookie },
    signal: controller.signal,
  });
  const reader = interrupted.body!.getReader();
  expect((await reader.read()).value!.length).toBeLessThanOrEqual(65536);
  controller.abort();
  await reader.cancel().catch(() => {});
  let status;
  for (let n = 0; n < 100; n++) {
    status = (
      await f.request("GET", `/administration/exports/${exportId}`)
    ).json();
    if (status.error) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  expect(status.error).toContain("interrompue");
  const resumed = await fetch(url, { headers: { cookie: f.cookie } });
  expect(resumed.status).toBe(200);
  const archive = Buffer.from(await resumed.arrayBuffer());
  expect(archive.subarray(-1024).equals(Buffer.alloc(1024))).toBe(true);
  expect(archive.toString()).toContain('"complete":true');
  const live = await fetch(url, { headers: { cookie: f.cookie } });
  const liveReader = live.body!.getReader();
  await liveReader.read();
  // Mutating the same canonical record while the client has stopped reading proves no network-held database transaction.
  const classification = await Promise.race([
    s.command({
      kind: "classification",
      state: "hidden",
      reason: "Concurrence pendant restitution fictive",
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(Error("Download retained database lock")), 3000),
    ),
  ]);
  expect(classification.record.data.fiscal.classification).toBe("hidden");
  // A parent change revokes the whole saved scope for a reader without confidentiality, including an already prepared archive.
  const admin = (await f.request("GET", "/session")).json().user;
  const permissions = admin.permissions.filter(
    (p: { action: string }) => p.action !== "export",
  );
  const revoked = await f.request("PUT", `/users/${admin.id}`, {
    operationId: operationId(),
    expectedVersion: admin.version,
    active: true,
    permissions,
  });
  expect(revoked.statusCode, revoked.body).toBe(200);
  let endedNormally = false;
  try {
    while (!(await liveReader.read()).done) {}
    endedNormally = true;
  } catch {
    /* stream must fail rather than emit a complete archive */
  }
  expect(endedNormally).toBe(false);
  const refused = await f.request(
    "GET",
    `/administration/exports/${exportId}/originals.tar`,
  );
  expect(refused.statusCode).toBe(403);
  expect(refused.headers["content-type"]).toContain("application/json");
}, 20000);

test("fiscal approval, update, assignment and transmission are separate and module withdrawal rejects cached commands", async () => {
  const s = await startFiscal();
  await s.approve();
  const password = "MotDePasseFictif123!";
  const created = (
    await f.request("POST", "/users", {
      operationId: operationId(),
      name: "Préparateur fictif",
      email: "preparateur@example.test",
      password,
      permissions: ["read", "update"].map((action) => ({
        action,
        kind: "*",
        dossierId: null,
      })),
    })
  ).json();
  const login = await f.request(
    "POST",
    "/login",
    { email: created.email, password },
    "",
  );
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const revisionCommand = {
    operationId: operationId(),
    expectedVersion: s.detail.record.version,
    event: {
      kind: "revision",
      amount: "120.00",
      reason: "Nouvelle préparation par le préparateur",
    },
  };
  const revision = await f.request(
    "POST",
    `/fiscal/${s.detail.record.id}/commands`,
    revisionCommand,
    cookie,
  );
  expect(revision.statusCode, revision.body).toBe(200);
  const detail = revision.json();
  const assignment = await f.request(
    "POST",
    `/fiscal/${detail.record.id}/commands`,
    {
      operationId: operationId(),
      expectedVersion: detail.record.version,
      event: {
        kind: "responsibility",
        responsibleIds: [created.id],
        reason: "Affectation fictive",
      },
    },
    cookie,
  );
  expect(assignment.statusCode).toBe(404);
  const assigned = await f.request(
    "POST",
    `/fiscal/${detail.record.id}/commands`,
    {
      operationId: operationId(),
      expectedVersion: detail.record.version,
      event: {
        kind: "responsibility",
        responsibleIds: [created.id],
        reason: "Affectation autorisée",
      },
    },
  );
  expect(assigned.statusCode, assigned.body).toBe(200);
  const candidates = await f.request(
    "GET",
    `/fiscal/${detail.record.id}/responsibles`,
  );
  expect(candidates.statusCode).toBe(200);
  expect(
    candidates.json().items.some((u: { id: string }) => u.id === created.id),
  ).toBe(true);
  const attempt = await f.request(
    "POST",
    `/fiscal/${detail.record.id}/commands`,
    {
      operationId: operationId(),
      expectedVersion: assigned.json().record.version,
      event: {
        kind: "attempt",
        id: operationId(),
        declarationVersion: 2,
        recipients: ["DGFiP"],
        productionReference: "interdit",
        provenance,
      },
    },
    cookie,
  );
  expect(attempt.statusCode).toBe(404);
  const installation = (
    await f.request("GET", "/administration/installation")
  ).json();
  const disabled = await f.request("PUT", "/administration/installation", {
    operationId: operationId(),
    expectedVersion: installation.version,
    name: installation.name,
    enabledModules: installation.enabledModules.filter(
      (m: string) => m !== "fiscal",
    ),
  });
  expect(disabled.statusCode, disabled.body).toBe(200);
  expect(
    (
      await f.request(
        "POST",
        `/fiscal/${s.detail.record.id}/commands`,
        revisionCommand,
        cookie,
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (await f.request("GET", `/fiscal/${detail.record.id}`)).statusCode,
  ).toBe(200);
  expect(
    (
      await f.request("POST", `/fiscal/${detail.record.id}/commands`, {
        operationId: operationId(),
        expectedVersion: assigned.json().record.version,
        event: { kind: "preparation", state: "preparee" },
      })
    ).statusCode,
  ).toBe(409);
});

test("additive fiscal migration upgrades version six without granting module or transmission privileges", async () => {
  f = await fixture();
  await f.setup();
  const parent = (await f.request("POST", "/records", dossier())).json();
  await f.maintainDatabase(async (db) =>
    db.transaction(async (tx) => {
      await tx.query(
        "DROP TABLE cabinet_reminder_preparation, cabinet_workflow_imports, cabinet_notification_preferences, cabinet_notifications, cabinet_work_events, cabinet_work, cabinet_workflow_model_versions, cabinet_workflow_models",
      );
      await tx.query("DROP INDEX cabinet_task_occurrence");
      await tx.query("DROP TABLE cabinet_fiscal_events");
      await tx.query("DROP INDEX cabinet_fiscal_occurrence");
      await tx.query(
        "ALTER TABLE cabinet_export_rows DROP CONSTRAINT cabinet_export_rows_kind_check",
      );
      await tx.query(
        "ALTER TABLE cabinet_export_rows ADD CONSTRAINT cabinet_export_rows_kind_check CHECK(kind IN ('record','document','field'))",
      );
      await tx.query("DELETE FROM schema_migrations WHERE version>=7");
      await tx.query(
        "UPDATE cabinet_installation SET content=jsonb_set(content,'{enabledModules}',(content->'enabledModules')-'fiscal')",
      );
      await tx.query(
        "UPDATE cabinet_users SET permissions=(SELECT jsonb_agg(p) FROM jsonb_array_elements(permissions) p WHERE p->>'action'<>'transmit')",
      );
    }),
  );
  expect((await f.request("GET", `/records/${parent.id}`)).json()).toEqual(
    parent,
  );
  const installation = (
    await f.request("GET", "/administration/installation")
  ).json();
  expect(installation.enabledModules).not.toContain("fiscal");
  expect(
    (await f.request("GET", "/session"))
      .json()
      .user.permissions.some(
        (p: { action: string }) => p.action === "transmit",
      ),
  ).toBe(false);
  await f.maintainDatabase(async (db) => {
    expect(
      (
        await db.query("SELECT max(version) AS version FROM schema_migrations")
      )[0]!.version,
    ).toBe(9);
    expect(await db.query("SELECT * FROM cabinet_fiscal_events")).toEqual([]);
  });
});

test("CVAE reference turnover, IS amounts and fiscal person filters survive list and CSV without invented calculations", async () => {
  const s = await startFiscal("CVAE", null);
  await s.command({
    kind: "observation",
    id: operationId(),
    field: "referenceTurnover",
    value: "1234567890123.45",
    provenance,
  });
  await s.command({
    kind: "observation",
    id: operationId(),
    field: "gross",
    value: "150.01",
    provenance,
  });
  await s.command({
    kind: "observation",
    id: operationId(),
    field: "net",
    value: null,
    provenance,
  });
  const admin = (await f.request("GET", "/session")).json().user;
  await s.command({
    kind: "responsibility",
    responsibleIds: [admin.id],
    reason: "Pilote de la campagne fictive",
  });
  const candidates = await f.request("GET", "/fiscal/responsibles?q=Admin");
  expect(candidates.statusCode, candidates.body).toBe(200);
  expect(candidates.json().items.map((u: { id: string }) => u.id)).toContain(
    admin.id,
  );
  const list = await f.request(
    "GET",
    `/fiscal?assigneeId=${admin.id}&columns=title,fiscalGross,fiscalNet,fiscalEstimate,fiscalReferenceTurnover`,
  );
  expect(list.statusCode, list.body).toBe(200);
  expect(list.json().items[0].data.fiscal.observedValues).toMatchObject({
    gross: "150.01",
    net: null,
    referenceTurnover: "1234567890123.45",
  });
  const csv = await f.request(
    "GET",
    `/records/export.csv?kind=obligation&assigneeId=${admin.id}&columns=title,fiscalGross,fiscalNet,fiscalEstimate,fiscalReferenceTurnover`,
  );
  expect(csv.statusCode, csv.body).toBe(200);
  expect(csv.body).toContain('"150.01";"";"";"1234567890123.45"');
  expect(s.detail.situation.amount).toBeNull();
});

test("cabinet shutdown aborts a paused original download and preserves its durable selection for restart", async () => {
  const s = await startFiscal("TF"),
    doc = await uploadFiscalOriginal(
      s.parent.id,
      Buffer.alloc(9 * 1024 * 1024, 68),
    );
  await s.command({
    kind: "notice",
    id: operationId(),
    reference: "TF-arrêt-fictif",
    role: "principal",
    year: 2026,
    establishmentId: null,
    properties: [],
    municipalities: [],
    amount: null,
    dueDate: null,
    directDebit: "unknown",
    originalId: doc.id,
    suiteIds: [],
    expectedSuites: 0,
    provenance,
  });
  const exportId = await completeExport({
      originals: true,
      query: { kind: "obligation", nature: "TF" },
    }),
    base = await f.app.listen({ host: "127.0.0.1", port: 0 }),
    response = await fetch(
      `${base}/api/v1/administration/exports/${exportId}/originals.tar`,
      { headers: { cookie: f.cookie } },
    ),
    reader = response.body!.getReader();
  await reader.read();
  await Promise.race([
    f.restart(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(Error("Shutdown held by client")), 4000),
    ),
  ]);
  let completed = false;
  try {
    while (!(await reader.read()).done) {}
    completed = true;
  } catch {}
  expect(completed).toBe(false);
  const retry = await f.request(
    "GET",
    `/administration/exports/${exportId}/originals.tar`,
  );
  expect(retry.statusCode).toBe(200);
  expect(retry.body).toContain('"complete":true');
}, 15000);

test("review I1 approval cannot reopen an approved version and a changed preparation invalidates a pending request across distinct roles", async () => {
  const s = await startFiscal();
  const password = "MotDePasseFictif123!";
  const user = (
    await f.request("POST", "/users", {
      operationId: operationId(),
      name: "Préparateur revue",
      email: "review-prep@example.test",
      password,
      permissions: ["read", "update"].map((action) => ({
        action,
        kind: "*",
        dossierId: null,
      })),
    })
  ).json();
  const login = await f.request(
    "POST",
    "/login",
    { email: user.email, password },
    "",
  );
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  async function prepare(event: Record<string, unknown>) {
    const detail = (
      await f.request("GET", `/fiscal/${s.detail.record.id}`)
    ).json();
    return f.request(
      "POST",
      `/fiscal/${s.detail.record.id}/commands`,
      {
        operationId: operationId(),
        expectedVersion: detail.record.version,
        event,
      },
      cookie,
    );
  }
  await s.approve();
  expect((await prepare({ kind: "approval_request" })).statusCode).toBe(409);
  expect(
    (await prepare({ kind: "preparation", state: "a_preparer" })).statusCode,
  ).toBe(409);
  await s.command({
    kind: "revision",
    amount: "110.00",
    reason: "Correction explicite",
  });
  await s.command({ kind: "preparation", state: "preparee" }, cookie);
  await s.command({ kind: "approval_request" }, cookie);
  await s.command({ kind: "preparation", state: "a_preparer" }, cookie);
  expect(s.detail.situation.approval).toBe("not_requested");
  const refused = await f.request(
    "POST",
    `/fiscal/${s.detail.record.id}/commands`,
    {
      operationId: operationId(),
      expectedVersion: s.detail.record.version,
      event: {
        kind: "approval",
        decision: "approved",
        reason: "Demande devenue caduque",
      },
    },
  );
  expect(refused.statusCode).toBe(409);
  await s.approve();
  expect(s.detail.situation.approval).toBe("approved");
  expect(s.detail.situation.declarationVersion).toBe(2);
});

test("review I2 current notice filters retain history but match property and year on the same current notice", async () => {
  const s = await startFiscal("TF");
  const id = operationId();
  const notice = {
    kind: "notice",
    id,
    reference: "avis-corrige",
    role: "principal",
    year: 2025,
    establishmentId: null,
    properties: ["Bien A"],
    municipalities: [],
    amount: "100.00",
    dueDate: null,
    directDebit: "unknown",
    originalId: null,
    suiteIds: [],
    expectedSuites: 0,
    provenance,
  };
  await s.command(notice);
  await s.command({
    ...notice,
    year: 2026,
    properties: ["Bien B"],
    provenance: { ...provenance, version: "2" },
  });
  await s.command({
    ...notice,
    id: operationId(),
    reference: "autre-avis",
    year: 2027,
    properties: ["Bien C"],
    provenance: { ...provenance, reference: "autre-avis" },
  });
  expect(s.detail.record.data.fiscal.properties.sort()).toEqual([
    "Bien B",
    "Bien C",
  ]);
  expect(s.detail.record.data.fiscal.noticeYears.sort()).toEqual([2026, 2027]);
  for (const [query, total] of [
    ["property=Bien%20A", 0],
    ["year=2025", 0],
    ["year=2026&property=Bien%20C", 0],
    ["year=2026&property=Bien%20B", 1],
    ["year=2027&property=Bien%20C", 1],
  ] as const) {
    expect(
      (await f.request("GET", `/fiscal?nature=TF&${query}`)).json().total,
      query,
    ).toBe(total);
  }
  expect(
    s.detail.timeline.filter(
      (e: { event: { kind: string } }) => e.event.kind === "notice",
    ),
  ).toHaveLength(3);
  const exportId = await completeExport({
    originals: true,
    query: {
      kind: "obligation",
      nature: "TF",
      year: "2026",
      property: "Bien B",
    },
  });
  const archive = await f.request(
    "GET",
    `/administration/exports/${exportId}/originals.tar`,
  );
  expect(archive.statusCode).toBe(200);
  expect(archive.rawPayload.toString()).toContain('"reference":"avis-corrige"');
  expect(archive.rawPayload.toString()).not.toContain(
    '"reference":"autre-avis"',
  );
  expect(archive.rawPayload.toString()).toContain(
    '"missing":1,"complete":false',
  );
  const emptyId = await completeExport({
    originals: true,
    query: { kind: "obligation", nature: "TF", property: "Bien A" },
  });
  const empty = await f.request(
    "GET",
    `/administration/exports/${emptyId}/originals.tar`,
  );
  expect(empty.rawPayload.toString()).toContain('"emptySelection":true');
  expect(empty.rawPayload.toString()).toContain('"complete":false');
});

test("review I4 payments identify their own historical attempt and version without implying acceptance or debit", async () => {
  const s = await startFiscal("RCM_2777");
  await s.approve();
  const first = operationId(),
    second = operationId();
  await s.command({
    kind: "attempt",
    id: first,
    declarationVersion: 1,
    recipients: ["DGFiP"],
    productionReference: "premier",
    provenance,
  });
  await s.command({
    kind: "revision",
    amount: "120.00",
    reason: "Nouvelle correction",
  });
  await s.approve();
  await s.command({
    kind: "attempt",
    id: second,
    declarationVersion: 2,
    recipients: ["DGFiP"],
    productionReference: "second",
    provenance: { ...provenance, reference: "second" },
  });
  const payment = {
    kind: "payment",
    id: operationId(),
    attemptId: first,
    declarationVersion: 1,
    amount: "100.00",
    date: "2026-10-17",
    state: "order",
    reason: "Ordre de la première version",
    provenance: { ...provenance, reference: "paiement-original" },
  };
  await s.command(payment);
  const event = s.detail.timeline.at(-1).event;
  expect(event.attemptId).toBe(first);
  expect(event.declarationVersion).toBe(1);
  expect(s.detail.situation.paid).toBe("0.00");
  expect(s.detail.situation.applicableAcceptedVersion).toBeNull();
  const foreign = (
    await f.request("POST", "/fiscal", {
      operationId: operationId(),
      dossierId: s.parent.id,
      title: "Autre obligation",
      nature: "IS",
      period: {
        start: "2026-01-01",
        end: "2026-12-31",
        campaign: "2026",
        subtype: "solde",
      },
    })
  ).json();
  let foreignVersion = foreign.record.version;
  const foreignAttempt = operationId();
  for (const event of [
    { kind: "preparation", state: "preparee" },
    { kind: "approval_request" },
    { kind: "approval", decision: "approved", reason: "Validation fictive" },
    {
      kind: "attempt",
      id: foreignAttempt,
      declarationVersion: 1,
      recipients: ["DGFiP"],
      productionReference: "Autre déclaration",
      provenance,
    },
  ]) {
    const response = await f.request(
      "POST",
      `/fiscal/${foreign.record.id}/commands`,
      { operationId: operationId(), expectedVersion: foreignVersion, event },
    );
    expect(response.statusCode, response.body).toBe(200);
    foreignVersion = response.json().record.version;
  }
  for (const invalid of [
    { attemptId: first, declarationVersion: 2 },
    { attemptId: foreignAttempt, declarationVersion: 1 },
  ]) {
    const response = await f.request(
      "POST",
      `/fiscal/${s.detail.record.id}/commands`,
      {
        operationId: operationId(),
        expectedVersion: s.detail.record.version,
        event: {
          ...payment,
          ...invalid,
          id: operationId(),
          provenance: { ...provenance, reference: operationId() },
        },
      },
    );
    expect(response.statusCode, response.body).toBe(400);
  }
  await s.command({
    ...payment,
    id: operationId(),
    attemptId: null,
    declarationVersion: null,
    state: "unknown",
    amount: null,
    provenance: { ...provenance, reference: "origine-inconnue" },
  });
  await f.restart();
  const restored = (
    await f.request("GET", `/fiscal/${s.detail.record.id}`)
  ).json();
  expect(
    restored.timeline.find(
      (e: { event: { id?: string } }) => e.event.id === payment.id,
    ).event,
  ).toMatchObject({ attemptId: first, declarationVersion: 1 });
});
