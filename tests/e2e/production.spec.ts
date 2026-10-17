import { test, expect } from "@playwright/test";
const origin = "http://127.0.0.1:4187";
test.use({ baseURL: origin });
test("production : dense bilan grid, typed detail, keyboard, concurrency, reload, model and independent IRPP followup", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  await page.getByLabel("Nom complet").fill("Admin production fictif");
  await page.getByLabel("Adresse email").fill("production@example.test");
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
  const statusA = crypto.randomUUID(),
    statusB = crypto.randomUUID(),
    type = await post("/production/models", {
      operationId: crypto.randomUUID(),
      id: crypto.randomUUID(),
      expectedVersion: 0,
      model: {
        kind: "stage_type",
        name: "Révision comptable",
        statuses: [
          {
            id: statusA,
            name: "À préparer",
            color: "gray",
            icon: "circle",
            final: false,
          },
          {
            id: statusB,
            name: "Validé",
            color: "green",
            icon: "check",
            final: true,
          },
        ],
      },
    });
  const column = crypto.randomUUID(),
    dateColumn = crypto.randomUUID();
  const m = await post("/production/models", {
    operationId: crypto.randomUUID(),
    id: crypto.randomUUID(),
    expectedVersion: 0,
    model: {
      kind: "balance",
      name: "Bilans BIC 2026",
      target: "dossier",
      year: 2026,
      family: "BIC",
      fee: "1200.50",
      columns: [
        {
          id: column,
          name: "Révision",
          type: "status",
          stageTypeId: type.id,
          plannedMinutes: 120,
          plannedDate: "2026-10-31",
        },
        {
          id: dateColumn,
          name: "Liasse préparée",
          type: "date",
          plannedMinutes: 30,
        },
      ],
    },
  });
  let first: any;
  for (const name of [
    "Atelier Horizon",
    "Cabinet des Aulnes",
    "Maison Lumière",
    "Studio Rivage",
    "Les Jardins",
    "Néo Services",
    "Transport Vallon",
    "Comptoir des Arts",
  ]) {
    const d = await post("/records", {
      operationId: crypto.randomUUID(),
      record: { kind: "dossier", title: name + " fictif", data: {} },
    });
    const row = await post(`/production/models/${m.id}/rows`, {
      operationId: crypto.randomUUID(),
      expectedVersion: 1,
      target: { kind: "dossier", id: d.id, label: d.title },
      period: "2026",
    });
    if (!first) first = row;
  }
  await page.getByRole("link", { name: "Production", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Atelier Horizon fictif", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "evidence/private/task4/production-grid-desktop-light.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Atelier Horizon fictif", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Renseigner Révision", exact: true })
    .click();
  await page.getByLabel("Valeur de Révision").selectOption(statusB);
  await page.getByRole("button", { name: "Enregistrer l’étape" }).click();
  await expect(
    page.getByRole("button", { name: "Enregistrer l’étape" }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".production-detail .production-status")
      .filter({ hasText: "Validé" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".production-detail")
      .getByText("Saisie enregistrée", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: "evidence/private/task4/production-detail-desktop-light.png",
    fullPage: true,
  });
  await page.keyboard.press("Tab");
  await page.getByRole("tab", { name: "Propriétés", exact: true }).focus();
  await page.screenshot({
    path: "evidence/private/task4/production-keyboard-focus.png",
    fullPage: true,
  });
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Sources", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Comptes annuels", exact: true }).click();
  await expect(
    page.getByText("Aucune tentative ni preuve de dépôt enregistrée."),
  ).toBeVisible();
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.screenshot({
    path: "evidence/private/task4/production-detail-900-light.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Activer le thème sombre" }).click();
  await expect(page.locator("html")).toHaveClass("dark");
  await page.screenshot({
    path: "evidence/private/task4/production-detail-900-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "evidence/private/task4/production-detail-desktop-dark.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Étapes", exact: true }).click();
  await page
    .getByRole("button", { name: "Renseigner Liasse préparée" })
    .click();
  await page.getByLabel("Valeur de Liasse préparée").fill("2026-10-30");
  const remote = await post(`/production/rows/${first.id}/commands`, {
    operationId: crypto.randomUUID(),
    expectedVersion: 2,
    command: {
      kind: "cell",
      columnId: dateColumn,
      period: "once",
      value: "2026-10-29",
    },
  });
  expect(remote.version).toBe(3);
  await page.getByRole("button", { name: "Enregistrer l’étape" }).click();
  await expect(page.getByRole("alert")).toContainText("Cette ligne a changé");
  await page.screenshot({
    path: "evidence/private/task4/production-conflict.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Recharger la version enregistrée" })
    .click();
  await expect(
    page.locator(".production-detail").getByText("29/10/2026"),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Atelier Horizon fictif", exact: true })
    .click();
  await expect(
    page
      .locator(".production-detail .production-status")
      .filter({ hasText: "Validé" }),
  ).toBeVisible();
  await expect(
    page.locator(".production-detail").getByText("29/10/2026"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fermer la fiche" }).click();
  await page.getByRole("button", { name: "Configurer", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("tab", { name: "Étapes", exact: true }).click();
  await page.getByText("Révision", { exact: true }).last().click();
  await page.screenshot({
    path: "evidence/private/task4/production-model-editor.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("tab", { name: "Suivis périodiques", exact: true })
    .click();
  await page.getByRole("button", { name: "Modèle IRPP Contact" }).click();
  await page.getByRole("button", { name: "Enregistrer le modèle" }).click();
  await expect(
    page.getByRole("columnheader", { name: "Questionnaire" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Blocage" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Charges / crédits" }),
  ).toBeVisible();
  await page.screenshot({
    path: "evidence/private/task4/production-irpp-empty.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Bilans", exact: true }).click();
  await page.route("**/api/v1/production/models/*/rows?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  await page.getByLabel("Rechercher dans la grille").fill("Horizon");
  await expect(page.getByText("Chargement de la production…")).toBeVisible();
  await page.screenshot({
    path: "evidence/private/task4/production-loading.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("button", { name: "Atelier Horizon fictif", exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/v1/production/models/*/rows?**");
  await page.getByLabel("Rechercher dans la grille").fill("aucun résultat");
  await expect(page.getByText("Aucune ligne dans ce périmètre")).toBeVisible();
  await page.screenshot({
    path: "evidence/private/task4/production-filter-empty.png",
    fullPage: true,
  });
  const reader = await post("/users", {
    operationId: crypto.randomUUID(),
    email: "reader-production@example.test",
    name: "Lecteur production fictif",
    password: "MotDePasseFictif123!",
    permissions: [{ action: "read", kind: "*", dossierId: null }],
  });
  const context = await browser.newContext({ baseURL: origin });
  try {
    const p = await context.newPage();
    await p.request.post("/api/v1/login", {
      headers: { origin },
      data: { email: reader.email, password: "MotDePasseFictif123!" },
    });
    await p.goto("/#production");
    await p
      .getByRole("button", { name: "Atelier Horizon fictif", exact: true })
      .click();
    await expect(
      p.getByRole("button", { name: "Renseigner Révision", exact: true }),
    ).toBeDisabled();
    await expect(
      p.getByRole("button", { name: "Configurer", exact: true }),
    ).toHaveCount(0);
    await p.screenshot({
      path: "evidence/private/task4/production-readonly.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});

async function roundSetup(page: import("@playwright/test").Page) {
  await page.request.post("/api/v1/setup", {
    headers: { origin },
    data: {
      email: "production@example.test",
      name: "Admin production fictif",
      password: "MotDePasseFictif123!",
    },
  });
  const login = await page.request.post("/api/v1/login", {
    headers: { origin },
    data: {
      email: "production@example.test",
      password: "MotDePasseFictif123!",
    },
  });
  expect(login.ok()).toBeTruthy();
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post("/api/v1" + path, {
      headers: { origin },
      data,
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const model = (
    value: unknown,
    id = crypto.randomUUID(),
    expectedVersion = 0,
  ) =>
    post("/production/models", {
      operationId: crypto.randomUUID(),
      id,
      expectedVersion,
      model: value,
    });
  return { post, model };
}
test("round1 I4 ordinary year editing and invalid filter drafts retain the production screen", async ({
  page,
}) => {
  const { model } = await roundSetup(page);
  const m = await model({
    kind: "custom",
    name: "Filtres sûrs",
    target: "dossier",
    rule: {
      frequency: "yearly",
      start: "2026-01-01",
      end: "2028-12-31",
      nominalDay: 15,
      lastDay: false,
      weekDay: 1,
    },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#production");
  await page
    .getByRole("tab", { name: "Échéances personnalisées", exact: true })
    .click();
  await page.getByLabel("Modèle", { exact: true }).selectOption(m.id);
  const year = page.getByLabel("Année", { exact: true });
  await year.fill("");
  await year.pressSequentially("2");
  await expect(page.getByRole("alert")).toContainText(
    "année à quatre chiffres",
  );
  await expect(year).toBeFocused();
  await expect(year).toHaveAttribute("aria-invalid", "true");
  await page.screenshot({
    path: "evidence/private/task4/round1-year-focus-preserved.png",
    fullPage: true,
  });
  await page.keyboard.type("027", { delay: 60 });
  await expect(year).toHaveValue("2027");
  await expect(page.getByText("Aucune ligne dans ce périmètre")).toBeVisible();
  await page.getByLabel("Rechercher dans la grille").fill("x".repeat(201));
  await expect(page.getByRole("alert")).toContainText("200 caractères");
  await page.screenshot({
    path: "evidence/private/task4/round1-invalid-filter.png",
    fullPage: true,
  });
  await page.getByLabel("Rechercher dans la grille").fill("");
  await page.getByLabel("Étiquette", { exact: true }).fill("x".repeat(81));
  await expect(page.getByRole("alert")).toContainText("80 caractères");
  await page.getByLabel("Étiquette", { exact: true }).fill("");
  await expect(page.getByText("Aucune ligne dans ce périmètre")).toBeVisible();
  expect(errors).toEqual([]);
});
test("round1 I9 model dependencies distinguish loading denied unavailable and retry while retaining references", async ({
  page,
}) => {
  const { post, model } = await roundSetup(page);
  const role = await post("/administration/roles", {
    operationId: crypto.randomUUID(),
    order: 1,
    name: "Rôle conservé",
    permissions: [],
  });
  const checklist = await post("/workflows/models", {
    operationId: crypto.randomUUID(),
    id: crypto.randomUUID(),
    expectedVersion: 0,
    model: {
      kind: "checklist",
      name: "Checklist conservée",
      targetKinds: ["obligation"],
      items: [{ id: crypto.randomUUID(), label: "Contrôle" }],
    },
  });
  const m = await model({
    kind: "balance",
    name: "Dépendances conservées",
    target: "dossier",
    year: 2026,
    family: "BNC",
    checklistModelId: checklist.id,
    columns: [
      {
        id: crypto.randomUUID(),
        name: "Révision protégée",
        type: "boolean",
        requiredRoleId: role.id,
      },
    ],
  });
  await page.goto("/#production");
  await page.getByLabel("Modèle", { exact: true }).selectOption(m.id);
  await page.route("**/api/v1/administration/roles", async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "FORBIDDEN", message: "Accès refusé fictif" },
      }),
    });
  });
  await page.route("**/api/v1/workflows/models", async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "UNAVAILABLE", message: "Indisponible fictif" },
      }),
    });
  });
  await page.getByRole("button", { name: "Configurer", exact: true }).click();
  await expect(page.getByText("Rôles : chargement…")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enregistrer le modèle" }),
  ).toBeDisabled();
  await page.screenshot({
    path: "evidence/private/task4/round1-dependencies-loading.png",
    fullPage: true,
  });
  await expect(page.getByText(/Rôles : accès refusé/)).toBeVisible();
  await expect(
    page.getByText(/Checklists : service indisponible/),
  ).toBeVisible();
  await expect(page.getByLabel("Checklist commune")).toHaveValue(checklist.id);
  await expect(page.getByLabel("Checklist commune")).toBeDisabled();
  await page.getByRole("tab", { name: "Étapes", exact: true }).click();
  await expect(page.getByLabel("Rôle supplémentaire")).toBeVisible();
  await expect(page.getByLabel("Rôle supplémentaire")).toHaveValue(role.id);
  await expect(page.getByLabel("Rôle supplémentaire")).toBeDisabled();
  await page.screenshot({
    path: "evidence/private/task4/round1-dependencies-denied-unavailable.png",
    fullPage: true,
  });
  await page.unroute("**/api/v1/administration/roles");
  await page.unroute("**/api/v1/workflows/models");
  await page.getByRole("button", { name: "Réessayer les dépendances" }).click();
  await expect(page.getByLabel("Rôle supplémentaire")).toBeEnabled();
  await expect(page.getByLabel("Rôle supplémentaire")).toHaveValue(role.id);
  await page.getByRole("tab", { name: "Général", exact: true }).click();
  await expect(page.getByLabel("Checklist commune")).toHaveValue(checklist.id);
  await expect(
    page.getByRole("button", { name: "Enregistrer le modèle" }),
  ).toBeEnabled();
  await page.screenshot({
    path: "evidence/private/task4/round1-dependencies-retry.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Enregistrer le modèle" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = await page.request.get(`/api/v1/production/models/${m.id}`);
  expect((await saved.json()).model).toMatchObject({
    checklistModelId: checklist.id,
    columns: [{ requiredRoleId: role.id }],
  });
});
test("round1 I3 I6 I7 frozen populated models annual followup selection and manual civil occurrences", async ({
  page,
}) => {
  const { post, model } = await roundSetup(page);
  const d = await post("/records", {
    operationId: crypto.randomUUID(),
    record: { kind: "dossier", title: "Cible périodique fictive", data: {} },
  });
  const col = crypto.randomUUID();
  let balance = await model({
    kind: "balance",
    name: "Bilan figé",
    target: "dossier",
    year: 2026,
    family: "BIC",
    columns: [
      {
        id: col,
        name: "Étape originale",
        type: "boolean",
        plannedDate: "2026-05-31",
      },
    ],
  });
  const row = await post(`/production/models/${balance.id}/rows`, {
    operationId: crypto.randomUUID(),
    expectedVersion: 1,
    target: { kind: "dossier", id: d.id, label: d.title },
    period: "2026",
  });
  await post(`/production/rows/${row.id}/commands`, {
    operationId: crypto.randomUUID(),
    expectedVersion: 1,
    command: { kind: "cell", columnId: col, period: "once", value: true },
  });
  balance = await model(
    {
      ...balance.model,
      columns: [
        {
          ...balance.model.columns[0],
          plannedDate: "2026-11-30",
          approval: true,
        },
        {
          id: crypto.randomUUID(),
          name: "Nouvelle étape",
          type: "boolean",
          plannedDate: "2026-12-15",
        },
      ],
    },
    balance.id,
    1,
  );
  await page.goto("/#production");
  await page.getByLabel("Modèle", { exact: true }).selectOption(balance.id);
  await expect(
    page.getByRole("columnheader", { name: /Étape originale/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: /Nouvelle étape/ }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Configuration v1", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: /1\/1/ })).toBeVisible();
  await page.getByRole("button", { name: d.title, exact: true }).click();
  await expect(
    page.locator(".production-detail").getByText("31/05/2026"),
  ).toBeVisible();
  if (
    await page.getByRole("button", { name: "Activer le thème clair" }).count()
  )
    await page.getByRole("button", { name: "Activer le thème clair" }).click();
  await expect(page.locator("html")).toHaveClass("light");
  await page.screenshot({
    path: "evidence/private/task4/round1-frozen-model-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.getByRole("button", { name: "Activer le thème sombre" }).click();
  await expect(page.locator("html")).toHaveClass("dark");
  await page.screenshot({
    path: "evidence/private/task4/round1-frozen-model-900-dark.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Fermer la fiche" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const monthly = crypto.randomUUID();
  const follow = await model({
    kind: "followup",
    name: "Années indépendantes",
    target: "dossier",
    columns: [
      {
        id: monthly,
        name: "Montant périodique",
        type: "decimal",
        frequency: "monthly",
      },
    ],
  });
  for (const year of ["2026", "2027"]) {
    const r = await post(`/production/models/${follow.id}/rows`, {
      operationId: crypto.randomUUID(),
      expectedVersion: 1,
      target: { kind: "dossier", id: d.id, label: d.title },
      period: year,
    });
    await post(`/production/rows/${r.id}/commands`, {
      operationId: crypto.randomUUID(),
      expectedVersion: 1,
      command: {
        kind: "cell",
        columnId: monthly,
        period: `${year}-02`,
        value: year === "2026" ? "10" : "30",
      },
    });
  }
  await page.reload();
  await page
    .getByRole("tab", { name: "Suivis périodiques", exact: true })
    .click();
  await page.getByLabel("Modèle", { exact: true }).selectOption(follow.id);
  await page.getByLabel("Année", { exact: true }).fill("2027");
  await page.getByLabel("Mois de référence").selectOption("02");
  await expect(page.locator(".production-grid tbody tr")).toHaveCount(1);
  await expect(
    page.getByRole("cell", { name: "2027", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".production-grid").getByText("30", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "evidence/private/task4/round1-followup-year-month.png",
    fullPage: true,
  });
  for (const [frequency, period, due] of [
    ["yearly", "2026", "2026-01-15"],
    ["quarterly", "2026-Q1", "2026-01-15"],
    ["weekly", "week:2025-12-29", "2026-01-02"],
  ]) {
    const m = await model({
      kind: "custom",
      name: `Manuel ${{ yearly: "annuel", quarterly: "trimestriel", weekly: "hebdomadaire" }[frequency!]}`,
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
    await page.reload();
    await page
      .getByRole("tab", { name: "Échéances personnalisées", exact: true })
      .click();
    await page.getByLabel("Modèle", { exact: true }).selectOption(m.id);
    await page.getByLabel("Année", { exact: true }).fill("2026");
    await page
      .getByRole("button", { name: "Ajouter une ligne", exact: true })
      .click();
    await expect(page.getByLabel("Occurrence prévue")).toHaveValue(due);
    if (frequency === "weekly") {
      await expect(
        page.getByLabel("Occurrence prévue").locator("option:checked"),
      ).toHaveText("Semaine du 29/12/2025 · 02/01/2026");
      await page.screenshot({
        path: "evidence/private/task4/round1-manual-weekly.png",
        fullPage: true,
      });
    }
    await page.getByLabel("Cible", { exact: true }).selectOption(d.id);
    await page.getByRole("button", { name: "Ajouter cette cible" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const response = await page.request.get(
      `/api/v1/production/models/${m.id}/rows`,
    );
    const rows = (await response.json()).items;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ period, dueDate: due });
  }
});
