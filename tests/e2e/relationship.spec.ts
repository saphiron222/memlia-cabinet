import { test, expect } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
async function sourceIdentity() {
  const paths = [
    ...new Set(
      execFileSync(
        "git",
        [
          "ls-files",
          "-co",
          "--exclude-standard",
          "apps/web",
          "packages/ui",
          "packages/contracts/src",
          "package-lock.json",
          "apps/web/vite.config.ts",
          "playwright.config.ts",
          "tests/e2e/serve.ts",
        ],
        { encoding: "utf8" },
      )
        .trim()
        .split("\n"),
    ),
  ].sort();
  return Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [
        path,
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      ]),
    ),
  );
}
const origin = "http://127.0.0.1:4195";
test.use({ baseURL: origin });
test("relationship: filled CRM conversion, onboarding provenance, LAB, models, durable navigation and accessible readonly/errors", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const capture =
    "evidence/private/task6/browser-" +
    (process.env.MEMLIA_CAPTURE_RUN ??
      new Date().toISOString().replaceAll(":", "-"));
  await mkdir(capture, { recursive: true });
  const sources = await sourceIdentity();
  const sourceReceiptIdentity = {
    base: "ca2b13474136a3be6d695e4dc894a552d8971859",
    head: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    dirty: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }),
    environment:
      "macOS; Playwright Chromium; local source Vite; isolated PGlite fixture; no real portal",
    sources,
  };
  await writeFile(
    capture + "/source-identity.json",
    JSON.stringify(sourceReceiptIdentity, null, 2),
  );
  await page.goto("/");
  await page.getByLabel("Nom complet").fill("Admin relation fictif");
  await page.getByLabel("Adresse email").fill("relationship@example.test");
  await page.getByLabel("Mot de passe").fill("MotDePasseFictif123!");
  await page.getByRole("button", { name: "Créer le cabinet" }).click();
  await expect(
    page.getByRole("navigation", { name: "Navigation principale" }),
  ).toBeVisible();
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post("/api/v1" + path, {
      headers: { origin },
      data,
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const save = (data: unknown) =>
    post("/relationship/entities", {
      id: crypto.randomUUID(),
      expectedVersion: 0,
      operationId: crypto.randomUUID(),
      data,
    });
  const first = crypto.randomUUID(),
    last = crypto.randomUUID();
  const pipeline = await save({
    kind: "pipeline",
    name: "Acquisition cabinet",
    stages: [
      {
        id: first,
        name: "Prise de contact",
        color: "blue",
        icon: "circle",
        final: false,
      },
      {
        id: crypto.randomUUID(),
        name: "Découverte",
        color: "orange",
        icon: "clock",
        final: false,
      },
      {
        id: crypto.randomUUID(),
        name: "Intéressé",
        color: "purple",
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
  for (const [name, temp, amount] of [
    ["Atelier Horizon", "warm", "1450.25"],
    ["Maison des Aulnes", "hot", "900.00"],
    ["Studio Lumière", "cold", null],
  ] as const) {
    const c = await post("/records", {
      operationId: crypto.randomUUID(),
      record: {
        kind: "contact",
        title: name,
        data: { contactType: "organisation" },
      },
    });
    await save({
      kind: "prospect",
      contactId: c.id,
      pipelineId: pipeline.id,
      stageId: first,
      identity: "company",
      temperature: temp,
      proposedFee: amount,
      source: "Recommandation",
      notes: "Échanges préparatoires fictifs",
      manualRisk: "low",
    });
  }
  await save({
    kind: "mission",
    name: "Tenue comptable",
    category: "Comptabilité",
    unit: "mois",
    quantified: true,
    order: 1,
  });
  await page.goto("/#relationship");
  await expect(
    page.getByRole("button", { name: "Atelier Horizon", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Nouveau prospect", exact: true })
    .click();
  await page
    .getByLabel("Nom du prospect", { exact: true })
    .fill("Entreprise future Bastide");
  await page
    .getByLabel("Nature du prospect", { exact: true })
    .selectOption("future_company");
  await page.getByRole("tab", { name: "Relation", exact: true }).click();
  await page.getByLabel("Pipeline", { exact: true }).selectOption(pipeline.id);
  await page.getByLabel("Honoraires proposés (€)").fill("1234.56");
  await page.getByLabel("Température manuelle").selectOption("hot");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Enregistré" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fermer le détail" }).click();
  await page.getByRole("tab", { name: "Pipeline", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Entreprise future Bastide",
      exact: true,
    }),
  ).toBeVisible();
  const card = page.locator("article").filter({
    has: page.getByRole("button", {
      name: "Entreprise future Bastide",
      exact: true,
    }),
  });
  await card.getByLabel("Déplacer vers").selectOption(last);
  await expect(
    page.getByRole("heading", { name: "Créer le dossier lié" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirmer la conversion" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Étape enregistrée" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Pipeline", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("region", { name: "Onboarding", exact: true }),
  ).toContainText("Entreprise future Bastide");
  const prospects = (
    await (
      await page.request.get("/api/v1/relationship/entities?kind=prospect")
    ).json()
  ).items;
  let converted: any;
  for (const p of prospects) {
    const c = await (
      await page.request.get("/api/v1/records/" + p.data.contactId)
    ).json();
    if (c.title === "Entreprise future Bastide") converted = p;
  }
  expect(converted.data.dossierId).toBeTruthy();
  const person = await post("/records", {
    operationId: crypto.randomUUID(),
    record: {
      kind: "contact",
      title: "Camille Exemple",
      dossierId: converted.data.dossierId,
      data: { contactType: "personne" },
    },
  });
  const identity = crypto.randomUUID(),
    mandate = crypto.randomUUID(),
    manual = crypto.randomUUID(),
    system = crypto.randomUUID();
  const model = await save({
    kind: "onboarding_model",
    name: "Entrée client 2026",
    steps: [
      {
        id: identity,
        name: "Identité reçue",
        type: "boolean",
        semantic: "identity",
        required: true,
      },
      {
        id: mandate,
        name: "Mandat et pouvoirs",
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
        id: system,
        name: "Accès impots.gouv",
        type: "boolean",
        semantic: "fiscal",
        source: "system",
      },
      {
        id: crypto.randomUUID(),
        name: "Début de mission",
        type: "date",
        semantic: "custom",
      },
    ],
  });
  const onboarding = await save({
    kind: "onboarding",
    dossierId: converted.data.dossierId,
    personId: person.id,
    modelId: model.id,
    values: [
      {
        stepId: manual,
        value: true,
        status: "done",
        note: "Déclaration cabinet, aucun droit source observé",
      },
    ],
  });
  for (const [name, value] of [
    ["Accueil Rivage", false],
    ["Accueil Érable", true],
  ] as const) {
    const d = await post("/records", {
      operationId: crypto.randomUUID(),
      record: { kind: "dossier", title: name, data: {} },
    });
    const p = await post("/records", {
      operationId: crypto.randomUUID(),
      record: {
        kind: "contact",
        title: "Personne " + name,
        dossierId: d.id,
        data: { contactType: "personne" },
      },
    });
    await save({
      kind: "onboarding",
      dossierId: d.id,
      personId: p.id,
      modelId: model.id,
      origin: value ? "reprise" : "creation",
      values: [{ stepId: manual, value, status: value ? "done" : "pending" }],
    });
  }
  await page.goto("/#relationship?view=onboarding");
  await expect(
    page.getByRole("button", {
      name: "Entreprise future Bastide",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Entreprise future Bastide", exact: true })
    .click();
  await expect(
    page.getByText(
      "Identité requise : examen humain et pièce en cours de validité manquants.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Demander l’activation" }).click();
  await expect(page.getByRole("alert")).toContainText("Activation bloquée");
  await page.screenshot({
    path: capture + "/onboarding-error.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  const evidenceDoc = await page.request.post("/api/v1/documents", {
    headers: { origin },
    multipart: {
      metadata: JSON.stringify({
        operationId: crypto.randomUUID(),
        dossierId: converted.data.dossierId,
        filename: "preuve-lab.txt",
        mediaType: "text/plain",
        confidential: true,
        source: { kind: "manual", reference: "fictif", version: "1" },
      }),
      file: {
        name: "preuve-lab.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Preuve humaine fictive"),
      },
    },
  });
  expect(evidenceDoc.ok(), await evidenceDoc.text()).toBeTruthy();
  const doc = await evidenceDoc.json();
  const policy = await save({
    kind: "lab_policy",
    name: "Politique cabinet datée",
    periodDays: 90,
    reason: "Fréquence décidée par le cabinet",
  });
  const lab = await save({
    kind: "lab",
    dossierId: converted.data.dossierId,
    personId: person.id,
    level: "standard",
    reason: "Examen humain documenté avec justificatif fictif",
    role: "Responsable LAB",
    observedOn: "2026-10-18",
    decisionOn: "2026-10-18",
    nextReviewOn: "2027-01-16",
    policyId: policy.id,
    policyVersion: policy.version,
    evidence: [
      {
        documentId: doc.id,
        version: doc.version,
        sha256: doc.sha256,
        origin: "manual",
        reference: "Examen fictif",
        acquiredOn: "2026-10-18",
        scope: "Identité et pouvoirs",
        result: "examined",
      },
    ],
  });
  const receipts: unknown[] = [];
  for (const width of [1440, 900])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate((t) => {
        document.documentElement.setAttribute("data-theme", t);
        document.documentElement.className = t;
      }, theme);
      for (const [view, label] of [
        ["kanban", "crm-kanban"],
        ["onboarding", "onboarding-matrix"],
        ["lab", "lab-list"],
        ["settings", "pipeline-settings"],
      ]) {
        await page.goto("/#relationship?view=" + view);
        await expect(page.locator(".relationship-workspace")).toBeVisible();
        await expect(
          page.getByText("Chargement de la relation client…", { exact: true }),
        ).toHaveCount(0);
        if (view === "settings") {
          await page
            .getByRole("button", { name: "Acquisition cabinet", exact: true })
            .click();
          await expect(page.getByLabel("Nom du modèle")).toHaveValue(
            "Acquisition cabinet",
          );
        }
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({
          path: `${capture}/${label}-${width}-${theme}.png`,
          fullPage: true,
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        if (view === "onboarding" && width === 900) {
          const grid = page.getByRole("region", {
            name: "Tableau relation client défilant",
          });
          await grid.focus();
          await page.keyboard.press("End");
          await grid.evaluate((e) => (e.scrollLeft = e.scrollWidth));
          const before = await grid.evaluate((e) => ({
            scroll: e.scrollLeft,
            width: e.clientWidth,
            total: e.scrollWidth,
          }));
          expect(before.total).toBeGreaterThan(before.width);
          expect(before.scroll).toBeGreaterThan(0);
          const rightButton = grid
            .getByRole("button", { name: "Ouvrir", exact: true })
            .last();
          await rightButton.focus();
          const reachable = await rightButton.evaluate((e) => {
            const r = e.getBoundingClientRect();
            return {
              left: r.left,
              right: r.right,
              focused: document.activeElement === e,
              viewport: innerWidth,
            };
          });
          expect(reachable.focused).toBe(true);
          expect(reachable.left).toBeGreaterThanOrEqual(0);
          expect(reachable.right).toBeLessThanOrEqual(reachable.viewport);
          await page.screenshot({
            path: `${capture}/onboarding-right-keyboard-${width}-${theme}.png`,
            fullPage: true,
          });
          await page.keyboard.press("Enter");
          await expect(
            page.getByLabel("Dossier", { exact: true }),
          ).toBeVisible();
          await page.keyboard.press("Escape");
          receipts.push({
            view: "onboarding-right-keyboard",
            width,
            theme,
            before,
            reachable,
            activation: "Enter opens actual row",
          });
        }
        receipts.push({
          view,
          width,
          theme,
          url: page.url(),
          assets: await page.evaluate(() =>
            performance
              .getEntriesByType("resource")
              .map((r) => r.name)
              .filter(
                (n) =>
                  n.includes(".css") ||
                  n.includes(".tsx") ||
                  n.includes(".woff"),
              ),
          ),
          environment: "isolated source/Vite/PGlite; fictitious data; Chromium",
          zoom: 1,
        });
      }
    }
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.goto("/#relationship?view=lab&id=" + lab.id);
  await expect(page.getByLabel("Justification de la vigilance")).toHaveValue(
    "Examen humain documenté avec justificatif fictif",
  );
  await page.getByLabel("Justification de la vigilance").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator(".relationship-detail-context")).toContainText(
    "Entreprise future Bastide",
  );
  await expect(page.locator(".relationship-detail-context > p")).toBeInViewport(
    { ratio: 1 },
  );
  await page.screenshot({
    path: capture + "/lab-keyboard.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  for (let i = 0; i < 51; i++)
    await post("/records", {
      operationId: crypto.randomUUID(),
      record: {
        kind: "contact",
        title: "AAA catalogue " + String(i).padStart(3, "0"),
        data: { contactType: "organisation" },
      },
    });
  const reader = await post("/users", {
    operationId: crypto.randomUUID(),
    email: "reader.relationship@example.test",
    name: "Lecteur fictif",
    password: "MotDePasseFictif123!",
    permissions: [{ action: "read", kind: "*", dossierId: null }],
  });
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 900, height: 1000 },
  });
  await context.request.post("/api/v1/login", {
    headers: { origin },
    data: { email: reader.email, password: "MotDePasseFictif123!" },
  });
  const readonly = await context.newPage();
  await readonly.goto("/#relationship?id=" + converted.id);
  await expect(
    readonly.getByText("Lecture seule : modification non autorisée."),
  ).toBeVisible();
  await expect(
    readonly.getByLabel("Contact du prospect", { exact: true }),
  ).toHaveValue(converted.data.contactId);
  await expect(
    readonly
      .getByLabel("Contact du prospect", { exact: true })
      .locator("option:checked"),
  ).toHaveText("Entreprise future Bastide");
  await expect(
    readonly
      .getByLabel("Interlocuteur principal", { exact: true })
      .locator("option:checked"),
  ).toHaveText("Non renseigné");
  await readonly.screenshot({
    path: capture + "/crm-readonly.png",
    fullPage: true,
  });
  await readonly.goto("/#relationship?view=lab");
  await expect(
    readonly.getByText("Aucun revue lab accessible", { exact: false }),
  ).toBeVisible();
  await context.close();
  const finalSources = await sourceIdentity();
  expect(finalSources).toEqual(sources);
  await writeFile(
    capture + "/receipt.json",
    JSON.stringify(
      {
        origin,
        sourceIdentity: "source-identity.json",
        sourceManifestSha256: createHash("sha256")
          .update(JSON.stringify(sources))
          .digest("hex"),
        sourcesUnchangedDuringCapture: true,
        receipts,
        browser: browser.version(),
        onboardingId: onboarding.id,
      },
      null,
      2,
    ),
  );
});
