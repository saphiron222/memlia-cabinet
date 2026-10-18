import { test, expect } from "@playwright/test";
const origin = "http://127.0.0.1:4193";
test.use({ baseURL: origin });
test("temps : clavier, relation canonique, semaine, forfait, réaffectation et captures remplies", async ({
  page,
  browser,
}) => {
  test.setTimeout(240000);
  page.setDefaultTimeout(15000);
  await page.goto("/");
  await page.getByLabel("Nom complet").fill("Camille Temps fictif");
  await page.getByLabel("Adresse email").fill("temps@example.test");
  await page
    .getByLabel("Mot de passe", { exact: true })
    .fill("MotDePasseFictif123!");
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
  const save = async (data: unknown) =>
    post("/time/entities", {
      id: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      expectedVersion: 0,
      data,
    });
  const actor = (await (await page.request.get("/api/v1/session")).json()).user;
  const colleague = await post("/users", {
    operationId: crypto.randomUUID(),
    email: "alex-temps@example.test",
    name: "Alex Martin fictif",
    password: "MotDePasseFictif123!",
    permissions: [{ action: "read", kind: "*", dossierId: null }],
  });
  const dossier = await post("/records", {
    operationId: crypto.randomUUID(),
    record: { kind: "dossier", title: "Atelier Horizon fictif", data: {} },
  });
  const task = await post("/records", {
    operationId: crypto.randomUUID(),
    record: {
      kind: "tache",
      title: "Révision du bilan Horizon",
      dossierId: dossier.id,
      data: { dueDate: "2026-10-22" },
    },
  });
  const nature = await save({
    kind: "nature",
    name: "Révision comptable",
    active: true,
  });
  await save({
    kind: "plan",
    level: "cabinet",
    targetId: null,
    minutes: 120,
    component: "variable",
  });
  await save({
    kind: "plan",
    level: "dossier",
    targetId: dossier.id,
    minutes: 90,
    component: "variable",
  });
  await save({
    kind: "rate",
    userId: null,
    from: "2026-10-01",
    to: "2026-10-31",
    hourlyAmount: "99.99",
    currency: "EUR",
  });
  await save({
    kind: "capacity",
    userId: null,
    from: "2026-10-01",
    to: "2026-10-31",
    dailyMinutes: [420, 420, 420, 420, 420, 0, 0],
  });
  await save({
    kind: "allocation",
    target: { kind: "record", id: task.id },
    from: "2026-10-01",
    to: "2026-10-31",
    weights: [{ userId: actor.id, weight: 1 }],
    policyVersion: 1,
  });
  const role = await post("/administration/roles", {
    operationId: crypto.randomUUID(),
    name: "Comptabilité",
    order: 0,
    permissions: [],
  });
  await save({
    kind: "assignment",
    dossierId: dossier.id,
    roleId: role.id,
    userId: colleague.id,
    from: "2026-10-01",
    to: "2026-10-31",
    weight: 1,
    policyVersion: 1,
  });
  await save({
    kind: "forfait",
    dossierId: dossier.id,
    roleId: role.id,
    from: "2026-10-01",
    to: "2026-10-31",
    activityStart: "2026-10-10",
    monthlyMinutes: 310,
    amount: "1250.00",
    currency: "EUR",
    prorating: "calendar_days",
    policyVersion: 1,
  });
  await page.goto("/#tache?id=" + task.id + "&section=time");
  await expect(
    page.getByRole("heading", { name: "Temps lié à cette tâche" }),
  ).toBeVisible();
  await expect(
    page.getByText("Héritage actuel : dossier, version 1."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Saisir du temps", exact: true })
    .click();
  await page.getByLabel("Nature du temps").selectOption(nature.id);
  await page.getByLabel("Date du temps").fill("2026-10-22");
  await page.getByLabel("Durée en minutes").fill("90");
  await page.getByLabel("Durée en minutes").press("Tab");
  await expect(
    page.getByRole("button", { name: "Enregistrer le temps", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("table", { name: "Saisies de temps" }).getByText("1 h 30"),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("table", { name: "Saisies de temps" }).getByText("1 h 30"),
  ).toBeVisible();
  await page.screenshot({
    path: "evidence/private/task5/round1-final/task-time-1440-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("link", { name: "Mes temps", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Mes temps", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Du", { exact: true }).fill("2026-10-19");
  await page.getByLabel("Au", { exact: true }).fill("2026-10-25");
  await expect(page.getByLabel("Du", { exact: true })).toHaveValue(
    "2026-10-19",
  );
  await expect(page.getByLabel("Au", { exact: true })).toHaveValue(
    "2026-10-25",
  );
  await page
    .getByRole("button", { name: "Saisir du temps", exact: true })
    .click();
  await page.getByLabel("Date du temps").fill("2026-10-23");
  await page.getByLabel("Nature du temps").selectOption(nature.id);
  await page.getByLabel("Libellé libre").fill("Révision du bilan Horizon");
  await page.getByLabel("Durée en minutes").fill("30");
  await page
    .getByRole("button", { name: "Enregistrer le temps", exact: true })
    .click();
  await expect(
    page
      .getByRole("table", { name: "Saisies de temps" })
      .getByText("Libre · Révision du bilan Horizon"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Exporter les temps" }).click();
  await expect(page.getByText("CSV prêt", { exact: false })).toBeVisible();
  await page.screenshot({
    path: "evidence/private/task5/round1-final/time-week-1440-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 900, height: 1000 });
  const region = page.getByRole("region", {
    name: "Tableau défilant des temps",
  });
  const geometry = await region.evaluate((el) => ({
    client: el.clientWidth,
    scroll: el.scrollWidth,
    overflow: getComputedStyle(el).overflowX,
  }));
  expect(geometry.scroll).toBeGreaterThan(geometry.client);
  expect(geometry.overflow).toBe("auto");
  await region.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => region.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Historique", exact: true })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Historique du temps" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await region.evaluate((el) => (el.scrollLeft = 0));
  await expect(
    page.getByRole("button", { name: "Colonnes précédentes", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: "evidence/private/task5/round1-final/time-week-900-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Activer le thème sombre" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: "evidence/private/task5/round1-final/time-week-900-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "Plan de charge", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "Capacité et charge des collaborateurs" }),
  ).toBeVisible();
  for (const label of ["Collaborateur", "Pôle / site", "Rôle porteur"]) {
    const box = await page.getByLabel(label, { exact: true }).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(250);
    expect(box!.x + box!.width).toBeLessThanOrEqual(900);
  }
  await page.screenshot({
    path: "evidence/private/task5/round1-final/workload-900-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "evidence/private/task5/round1-final/workload-1440-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("table", { name: "Contributions de charge" })
    .getByRole("row")
    .filter({ hasText: "Révision du bilan Horizon" })
    .first()
    .getByRole("button", { name: "Voir la charge" })
    .click();
  await page
    .getByRole("button", { name: "Retirer ce porteur", exact: true })
    .click();
  await page
    .getByLabel("Ajouter un porteur", { exact: true })
    .selectOption(colleague.id);
  await page.getByLabel("Poids du porteur", { exact: true }).fill("1");
  await page
    .getByRole("button", { name: "Prévisualiser la réaffectation" })
    .click();
  await expect(
    page.getByRole("table", { name: "Aperçu de réaffectation" }),
  ).toBeVisible();
  await page.screenshot({
    path: "evidence/private/task5/round1-final/reassignment-1440-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Confirmer la réaffectation" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("tab", { name: "Configuration", exact: true }).click();
  await page
    .getByRole("button", { name: "Capacités journalières", exact: true })
    .click();
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  await expect(page.getByLabel("Lundi (min)")).toHaveValue("420");
  await page.screenshot({
    path: "evidence/private/task5/round1-final/capacity-editor-1440-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Modifier", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Activer le thème clair" }).click();
  await page.getByRole("tab", { name: "Plan de charge", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "Contributions de charge" }),
  ).toBeVisible();
  await page.screenshot({
    path: "evidence/private/task5/round1-final/workload-1440-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "Temps saisis", exact: true }).click();
  await page
    .getByRole("button", { name: "Saisir du temps", exact: true })
    .click();
  await page.getByLabel("Date du temps").fill("2026-10-22");
  await page.getByLabel("Nature du temps").selectOption(nature.id);
  await page.getByLabel("Libellé libre").fill("Contrôle chronométré fictif");
  await page.getByRole("button", { name: "Démarrer le chronomètre" }).click();
  await expect(
    page.getByText("Chronomètre actif depuis", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: "evidence/private/task5/round1-final/time-timer-active.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.reload();
  await expect(
    page.getByText("Chronomètre actif depuis", { exact: false }),
  ).toBeVisible();
  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: "Arrêter et enregistrer" }).click();
  await expect(
    page.getByText("Chronomètre actif depuis", { exact: false }),
  ).toHaveCount(0);
  await page.getByLabel("Du", { exact: true }).fill("");
  await expect(
    page.getByRole("button", { name: "Semaine précédente" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Choisir une semaine" }).click();
  await expect(
    page.getByRole("dialog", { name: "Choisir une semaine" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.route("**/api/v1/time/report?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  await page.getByLabel("Du", { exact: true }).fill("2027-01-01");
  await page.getByLabel("Au", { exact: true }).fill("2027-01-07");
  await expect(
    page.getByText("Chargement des temps…", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "evidence/private/task5/round1-final/time-loading.png",
    fullPage: true,
    animations: "disabled",
  });
  await expect(
    page.getByText("Aucun temps saisi sur cette période et ce périmètre."),
  ).toBeVisible();
  await page.screenshot({
    path: "evidence/private/task5/round1-final/time-empty.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.unroute("**/api/v1/time/report?**");
  await page.route("**/api/v1/time/report?**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "UNAVAILABLE",
          message: "Lecture temporairement indisponible.",
        },
      }),
    }),
  );
  await page.getByLabel("Au", { exact: true }).fill("2027-01-08");
  await expect(page.getByRole("alert")).toContainText(
    "Lecture temporairement indisponible.",
  );
  await page.screenshot({
    path: "evidence/private/task5/round1-final/time-error.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.unroute("**/api/v1/time/report?**");
  const context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 900, height: 1000 },
    }),
    readonly = await context.newPage();
  await readonly.goto("/");
  await readonly.getByLabel("Adresse email").fill("alex-temps@example.test");
  await readonly
    .getByLabel("Mot de passe", { exact: true })
    .fill("MotDePasseFictif123!");
  await readonly
    .getByRole("button", { name: "Se connecter", exact: true })
    .click();
  await readonly
    .getByRole("link", { name: "Plan de charge", exact: true })
    .click();
  await expect(
    readonly.getByRole("tab", { name: "Configuration", exact: true }),
  ).toHaveCount(0);
  await expect(
    readonly.getByRole("link", { name: "Temps du cabinet", exact: true }),
  ).toHaveCount(0);
  await expect(
    readonly.getByRole("heading", { name: "Plan de charge", exact: true }),
  ).toBeVisible();
  await readonly.getByLabel("Du", { exact: true }).fill("2026-10-19");
  await readonly.getByLabel("Au", { exact: true }).fill("2026-10-25");
  await expect(
    readonly
      .getByRole("table", { name: "Capacité et charge des collaborateurs" })
      .getByText("Alex Martin fictif"),
  ).toBeVisible();
  await expect(
    readonly
      .getByRole("table", { name: "Capacité et charge des collaborateurs" })
      .getByText("Camille Temps fictif"),
  ).toHaveCount(0);
  await readonly.screenshot({
    path: "evidence/private/task5/round1-final/workload-readonly-900-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await readonly
    .getByRole("button", { name: "Voir la charge", exact: true })
    .first()
    .focus();
  await readonly.keyboard.press("Enter");
  await expect(
    readonly.getByText("Lecture seule : modification de charge non autorisée."),
  ).toBeVisible();
  await readonly.screenshot({
    path: "evidence/private/task5/round1-final/workload-readonly-detail.png",
    fullPage: true,
    animations: "disabled",
  });
  await context.close();
  await page.setViewportSize({ width: 900, height: 1000 });
  // Real catalogs: the chosen identities sort after more than 200 existing options.
  for (let i = 0; i < 201; i++) {
    await save({
      kind: "nature",
      name: `AAA Nature ancienne ${String(i).padStart(3, "0")}`,
      active: false,
    });
    await post("/users", {
      operationId: crypto.randomUUID(),
      email: `catalog-${i}@example.test`,
      name: `AAA Compte ${String(i).padStart(3, "0")}`,
      password: "MotDePasseFictif123!",
      permissions: [],
    });
  }
  const lateNature = await save({
    kind: "nature",
    name: "ZZZ Expertise spéciale",
    active: true,
  });
  const lateUser = await post("/users", {
    operationId: crypto.randomUUID(),
    email: "catalog-last@example.test",
    name: "ZZZ Zoé Catalogue",
    password: "MotDePasseFictif123!",
    permissions: [],
  });
  await page.goto("/#temps-cabinet");
  await page.getByLabel("Du", { exact: true }).fill("2026-10-19");
  await page.getByLabel("Au", { exact: true }).fill("2026-10-25");
  await page
    .getByRole("button", { name: "Saisir du temps", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Rechercher une nature", { exact: true }).fill("ZZZ");
  await dialog
    .getByLabel("Nature du temps", { exact: true })
    .selectOption(lateNature.id);
  await dialog
    .getByLabel("Rechercher une personne", { exact: true })
    .fill("ZZZ");
  await dialog
    .getByLabel("Auteur du temps", { exact: true })
    .selectOption(lateUser.id);
  await dialog.getByLabel("Date du temps").fill("2026-10-22");
  await dialog
    .getByLabel("Libellé libre")
    .fill("Choix au-delà de deux cents options");
  await dialog.getByLabel("Durée en minutes").fill("15");
  await page.screenshot({
    path: "evidence/private/task5/round1-final/catalog-beyond200-900.png",
    fullPage: true,
    animations: "disabled",
  });
  await dialog
    .getByRole("button", { name: "Enregistrer le temps", exact: true })
    .click();
  await post("/time/entities", {
    id: lateNature.id,
    expectedVersion: lateNature.version,
    operationId: crypto.randomUUID(),
    data: { ...lateNature.data, active: false },
  });
  await page.reload();
  await page.getByLabel("Du", { exact: true }).fill("2026-10-19");
  await page.getByLabel("Au", { exact: true }).fill("2026-10-25");
  const historyRow = page
    .getByRole("row")
    .filter({ hasText: "Choix au-delà de deux cents options" });
  await expect(historyRow).toContainText("ZZZ Zoé Catalogue");
  await expect(historyRow).toContainText("ZZZ Expertise spéciale · Inactif");
  await expect(
    page
      .getByRole("table", { name: "Saisies de temps" })
      .getByText("Chargement…", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "evidence/private/task5/round1-final/catalog-history-900.png",
    fullPage: true,
    animations: "disabled",
  });
  const plans = (
    await (await page.request.get("/api/v1/time/entities?kind=plan")).json()
  ).items;
  for (const plan of plans)
    await post("/time/entities", {
      id: plan.id,
      expectedVersion: plan.version,
      operationId: crypto.randomUUID(),
      data: { ...plan.data, minutes: null },
    });
  await post("/records", {
    operationId: crypto.randomUUID(),
    record: {
      kind: "tache",
      title: "Prévision à renseigner",
      dossierId: dossier.id,
      data: { dueDate: "2026-10-22", assigneeIds: [actor.id] },
    },
  });
  await page.getByRole("tab", { name: "Plan de charge", exact: true }).click();
  await page
    .getByLabel("Rechercher une personne", { exact: true })
    .fill("Camille");
  await page
    .getByLabel("Collaborateur", { exact: true })
    .selectOption(actor.id);
  const incomplete = page
    .getByRole("table", { name: "Capacité et charge des collaborateurs" })
    .getByRole("row")
    .filter({ hasText: "Camille" });
  await expect(incomplete).toContainText("Partiel");
  await expect(incomplete).toContainText("Inconnue");
  await expect(incomplete).not.toContainText("Capacité respectée");
  for (const theme of ["light", "dark"] as const) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await page
        .getByRole("button", {
          name:
            theme === "dark"
              ? "Activer le thème sombre"
              : "Activer le thème clair",
        })
        .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.screenshot({
      path: `evidence/private/task5/round1-final/workload-unknown-900-${theme}.png`,
      fullPage: true,
      animations: "disabled",
    });
    const frame = page
      .getByRole("table", { name: "Capacité et charge des collaborateurs" })
      .locator("..")
      .locator("..");
    const next = frame.getByRole("button", {
      name: "Colonnes suivantes",
      exact: true,
    });
    const viewport = frame.locator(".time-table-scroll");
    for (let i = 0; i < 4 && (await next.isEnabled()); i++) {
      const end = await viewport.evaluate((el) =>
        Math.min(el.scrollLeft + 360, el.scrollWidth - el.clientWidth),
      );
      await next.click();
      await expect
        .poll(() => viewport.evaluate((el) => el.scrollLeft))
        .toBeCloseTo(end, 0);
      if (
        end ===
        (await viewport.evaluate((el) => el.scrollWidth - el.clientWidth))
      ) {
        await expect(next).toBeDisabled();
        break;
      }
    }
    await expect(
      incomplete
        .getByRole("cell", { name: "Inconnue", exact: true })
        .locator("span"),
    ).toBeInViewport({ ratio: 1 });
    await page.screenshot({
      path: `evidence/private/task5/round1-final/workload-unknown-right-900-${theme}.png`,
      fullPage: true,
      animations: "disabled",
    });
    const previous = frame.getByRole("button", {
      name: "Colonnes précédentes",
      exact: true,
    });
    for (let i = 0; i < 4 && (await previous.isEnabled()); i++) {
      const end = await viewport.evaluate((el) =>
        Math.max(el.scrollLeft - 360, 0),
      );
      await previous.click();
      await expect
        .poll(() => viewport.evaluate((el) => el.scrollLeft))
        .toBeCloseTo(end, 0);
      if (end === 0) {
        await expect(previous).toBeDisabled();
        break;
      }
    }
  }
  await page.getByRole("tab", { name: "Temps saisis", exact: true }).click();
  await page
    .getByRole("button", { name: "Saisir du temps", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Rechercher une nature", { exact: true })
    .fill("Révision comptable");
  await page
    .getByLabel("Nature du temps", { exact: true })
    .selectOption(nature.id);
  await page.getByLabel("Date du temps").fill("2026-10-22");
  await page.getByLabel("Libellé libre").fill("Chronomètre abandonné");
  await page
    .getByRole("button", { name: "Démarrer le chronomètre", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Abandonner sans temps", exact: true })
    .click();
  await page
    .getByLabel("Motif de l’abandon")
    .fill("Départ involontaire, aucun temps à imputer");
  await page.screenshot({
    path: "evidence/private/task5/round1-final/timer-abandon-900.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Confirmer l’abandon", exact: true })
    .click();
  await expect(
    page.getByText("Chronomètre actif depuis", { exact: false }),
  ).toHaveCount(0);
});
