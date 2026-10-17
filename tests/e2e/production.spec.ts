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
