import { test, expect } from "@playwright/test";
const origin = "http://127.0.0.1:4183";
test.use({ baseURL: origin });
test("fiscal : créer, préparer, demander et approuver garde dépôt et paiement distincts après rechargement", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Nom complet").fill("Admin fiscal fictif");
  await page.getByLabel("Adresse email").fill("fiscal@example.test");
  await page.getByLabel("Mot de passe").fill("MotDePasseFictif123!");
  await page.getByRole("button", { name: "Créer le cabinet" }).click();
  await page.getByRole("link", { name: "Dossiers", exact: true }).click();
  await page.getByRole("button", { name: "Créer un dossier" }).click();
  await page.getByLabel("Titre", { exact: true }).fill("Dossier fiscal fictif");
  await page
    .getByLabel("Régime de TVA", { exact: true })
    .selectOption("reel_normal");
  await page
    .getByLabel("Régime d’imposition", { exact: true })
    .selectOption("IS");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("button", { name: "Fermer la fiche" }).click();
  await page.getByRole("link", { name: "Fiscalité", exact: true }).click();
  await page
    .getByRole("button", { name: "Créer une obligation fiscale" })
    .click();
  await page
    .getByLabel("Dossier de l’obligation")
    .selectOption({ label: "Dossier fiscal fictif" });
  await page.getByLabel("Titre fiscal").fill("TVA septembre fictive");
  await page.getByLabel("Début de période").fill("2026-09-01");
  await page.getByLabel("Fin de période").fill("2026-09-30");
  await page.getByLabel("Montant suivi").fill("100.00");
  await page.getByRole("button", { name: "Enregistrer l’obligation" }).click();
  await expect(
    page.getByRole("heading", { name: "TVA septembre fictive" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Marquer préparée", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Demander l’approbation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reprendre la préparation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approuver localement", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Marquer préparée", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Demander l’approbation", exact: true })
    .click();
  await page.getByLabel("Motif de décision").fill("Revue locale fictive");
  await page
    .getByRole("button", { name: "Approuver localement", exact: true })
    .click();
  await expect(page.getByLabel("Situation fiscale")).toContainText(
    "Approuvée localement",
  );
  await expect(page.getByLabel("Situation fiscale")).toContainText(
    "Aucune version acceptée",
  );
  await expect(page.getByLabel("Situation fiscale")).toContainText("0,00 €");
  await page.reload();
  await expect(page.getByLabel("Situation fiscale")).toContainText(
    "Approuvée localement",
  );
  await page
    .getByRole("button", { name: "Modifier le montant", exact: true })
    .click();
  await page.getByLabel("Montant de la révision").fill("120.00");
  await page.getByLabel("Motif de l’action").fill("Correction fictive");
  await page
    .getByRole("button", { name: "Enregistrer l’action fiscale" })
    .click();
  await expect(page.getByLabel("Situation fiscale")).toContainText("120,00 €");
  await page.getByRole("tab", { name: "Historique", exact: true }).click();
  await expect(page.getByLabel("Chronologie fiscale")).toContainText(
    "Correction fictive",
  );
  await page.getByRole("tab", { name: "Dettes et règlements" }).click();
  await page
    .getByRole("button", { name: "Ajouter une dette", exact: true })
    .click();
  await page.getByLabel("Montant", { exact: true }).fill("120.00");
  await page
    .getByLabel("Référence externe", { exact: true })
    .first()
    .fill("Créance fictive septembre");
  const provenance = page.getByRole("group", {
    name: "Origine de l’observation",
    exact: true,
  });
  await provenance.getByLabel("Type de source").selectOption("simulated");
  await provenance.getByLabel("Référence externe").fill("dette-fictive-9");
  await page
    .getByRole("button", { name: "Enregistrer l’action fiscale" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Dettes et apurements" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Détail" }).click();
  await page
    .getByRole("button", { name: "Ajouter une mention manuelle", exact: true })
    .click();
  await page
    .getByLabel("Motif de l’action")
    .fill("Constat manuel fictif sans dépôt");
  await page
    .getByRole("button", { name: "Enregistrer l’action fiscale" })
    .click();
  await expect(
    page.getByText("Mention manuelle active", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Annuler une mention", exact: true })
    .click();
  await page.getByLabel("Mention à annuler").selectOption({ index: 1 });
  await page.getByLabel("Motif de l’action").fill("Annulation fictive");
  await page
    .getByRole("button", { name: "Enregistrer l’action fiscale" })
    .click();
  await expect(
    page.getByText("Mention annulée", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Sources et écarts" }).click();
  await page
    .getByRole("button", { name: "Ajouter une valeur observée", exact: true })
    .click();
  await page.getByLabel("Valeur retenue ou observée").fill("130.00");
  await page
    .getByRole("group", { name: "Origine de l’observation", exact: true })
    .getByLabel("Type de source")
    .selectOption("simulated");
  await page
    .getByRole("group", { name: "Origine de l’observation", exact: true })
    .getByLabel("Référence externe")
    .fill("Observation fiscale fictive");
  await page
    .getByRole("button", { name: "Enregistrer l’action fiscale" })
    .click();
  await expect(
    page.getByRole("heading", { name: /Divergence ouverte/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Résoudre une divergence", exact: true })
    .click();
  const observations = page
    .getByRole("group", { name: "Observations prises en compte", exact: true })
    .getByRole("checkbox");
  await expect(observations).toHaveCount(3);
  for (const checkbox of await observations.all()) await checkbox.check();
  await page.getByLabel("Valeur retenue ou observée").fill("120.00");
  await page
    .getByLabel("Motif de l’action")
    .fill("Révision manuelle retenue après contrôle fictif");
  await page
    .getByRole("button", { name: "Enregistrer l’action fiscale" })
    .click();
  await expect(
    page.getByRole("heading", { name: /Divergence résolue/ }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Détail" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Modifier le montant", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Modifier le montant", exact: true }),
  ).toBeFocused();
  await page.getByRole("tab", { name: "Détail" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Documents" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("link", { name: "Revenir à la grille fiscale" }).click();
  await page.getByText("Filtres et colonnes", { exact: true }).click();
  await page.getByLabel("Filtrer par nature fiscale").selectOption("TVA");
  await expect(
    page.getByRole("link", { name: "TVA septembre fictive", exact: true }),
  ).toBeVisible();
  await page.getByText("Filtres et colonnes", { exact: true }).click();
  await page.screenshot({
    path: "test-results/task2-fiscal-grid.png",
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "TVA septembre fictive", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "TVA septembre fictive" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/task2-fiscal.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 900, height: 900 });
  await page.screenshot({
    path: "test-results/task2-fiscal-900.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Modifier le montant", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/task2-fiscal-panel-900.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /thème/i }).click();
  await page.screenshot({
    path: "test-results/task2-fiscal-dark-900.png",
    fullPage: true,
  });
});

test("review I3 persisted creations inherit only the applicable regime", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Adresse email").fill("fiscal@example.test");
  await page.getByLabel("Mot de passe").fill("MotDePasseFictif123!");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  for (const [nature, regime] of [
    ["TVA", "reel_normal"],
    ["IS", "IS"],
    ["DES", null],
  ] as const) {
    await page.getByRole("link", { name: "Fiscalité", exact: true }).click();
    await page
      .getByRole("button", { name: "Créer une obligation fiscale" })
      .click();
    await page
      .getByLabel("Dossier de l’obligation")
      .selectOption({ label: "Dossier fiscal fictif" });
    await page
      .getByLabel("Nature fiscale", { exact: true })
      .selectOption(nature);
    await page.getByLabel("Titre fiscal").fill(`Revue régime ${nature}`);
    await page.getByLabel("Début de période").fill("2026-09-01");
    await page.getByLabel("Fin de période").fill("2026-09-30");
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/fiscal") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Enregistrer l’obligation" })
      .click();
    const response = await saved;
    expect(response.status()).toBe(201);
    const created = await response.json();
    const persisted = await page.request.get(
      `/api/v1/fiscal/${created.record.id}`,
    );
    expect((await persisted.json()).record.data.fiscal.regime).toBe(regime);
    await expect(
      page.getByRole("heading", { name: `Revue régime ${nature}` }),
    ).toBeVisible();
    if (nature === "TVA")
      await expect(
        page.getByText("Réel normal", { exact: true }),
      ).toBeVisible();
  }
});

test("review I4 UI links a payment to a historical deposit and exposes the link after reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Adresse email").fill("fiscal@example.test");
  await page.getByLabel("Mot de passe").fill("MotDePasseFictif123!");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByRole("link", { name: "Fiscalité", exact: true }).click();
  await page
    .getByRole("link", { name: "Revue régime IS", exact: true })
    .click();
  for (const version of [1, 2]) {
    await page
      .getByRole("button", { name: "Marquer préparée", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Demander l’approbation", exact: true })
      .click();
    await page.getByLabel("Motif de décision").fill("Revue fictive");
    await page
      .getByRole("button", { name: "Approuver localement", exact: true })
      .click();
    await page
      .getByRole("tab", { name: "Dépôts et retours", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Enregistrer une tentative de dépôt",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Destinataires attendus", { exact: true })
      .fill("DGFiP");
    await page
      .getByLabel("Référence de production", { exact: true })
      .fill(`Production fictive ${version}`);
    await page
      .getByRole("group", { name: "Origine de l’observation", exact: true })
      .getByLabel("Référence externe")
      .fill(`depot-${version}`);
    await page
      .getByRole("button", {
        name: "Enregistrer l’action fiscale",
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    if (version === 1) {
      await page.getByRole("tab", { name: "Détail", exact: true }).click();
      await page
        .getByRole("button", { name: "Modifier le montant", exact: true })
        .click();
      await page.getByLabel("Montant de la révision").fill("120.00");
      await page.getByLabel("Motif de l’action").fill("Correction fictive");
      await page
        .getByRole("button", {
          name: "Enregistrer l’action fiscale",
          exact: true,
        })
        .click();
    }
  }
  await page
    .getByRole("tab", { name: "Dettes et règlements", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ajouter un règlement", exact: true })
    .click();
  await page
    .getByLabel("Tentative concernée", { exact: true })
    .selectOption({ index: 1 });
  await expect(page.getByRole("dialog")).toContainText(
    "Version de déclaration : 1",
  );
  await page.getByLabel("Montant", { exact: true }).fill("100.00");
  await page.getByLabel("État constaté", { exact: true }).selectOption("order");
  await page.getByLabel("Motif de l’action").fill("Ordre sur première version");
  await page
    .getByRole("group", { name: "Origine de l’observation", exact: true })
    .getByLabel("Référence externe")
    .fill("paiement-lie");
  await page.setViewportSize({ width: 900, height: 900 });
  await page.screenshot({
    path: "test-results/task2-fix1-payment-panel.png",
    fullPage: true,
  });
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/commands") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Enregistrer l’action fiscale", exact: true })
    .click();
  const detail = await (await saved).json();
  const event = detail.timeline.at(-1).event;
  expect(event.declarationVersion).toBe(1);
  expect(event.attemptId).toBe(detail.situation.attempts[0].id);
  expect(detail.situation.paid).toBe("0.00");
  await page.reload();
  await page
    .getByRole("tab", { name: "Dettes et règlements", exact: true })
    .click();
  await expect(
    page
      .getByText("Déclaration 1 · Production fictive 1", { exact: false })
      .first(),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/task2-fix1-payment-detail.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Historique", exact: true }).click();
  await expect(page.getByLabel("Chronologie fiscale")).toContainText(
    "Déclaration 1 · Production fictive 1",
  );
});
