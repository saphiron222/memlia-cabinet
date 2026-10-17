import { test, expect } from "@playwright/test";
const origin = "http://127.0.0.1:4185";
const captureRun =
  process.env.MEMLIA_CAPTURE_RUN ??
  new Date().toISOString().replaceAll(":", "-");
test.use({ baseURL: origin });
test("workflows : liste Kanban semaine calendrier et détail partagé TVA DAS2 gardent le travail après rechargement", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page.getByLabel("Nom complet").fill("Admin workflows fictif");
  await page.getByLabel("Adresse email").fill("workflows@example.test");
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
  const dossier = await post("/records", {
    operationId: crypto.randomUUID(),
    record: { kind: "dossier", title: "Atelier Horizon fictif", data: {} },
  });
  await post("/workflows/models", {
    operationId: crypto.randomUUID(),
    id: crypto.randomUUID(),
    expectedVersion: 0,
    model: {
      kind: "checklist",
      name: "Contrôle de production",
      targetKinds: ["tache", "TVA", "DAS2"],
      items: [{ id: crypto.randomUUID(), label: "Rapprocher les pièces" }],
    },
  });
  await page.getByRole("link", { name: "Tâches", exact: true }).click();
  await page
    .getByRole("button", { name: "Créer une tâche", exact: true })
    .click();
  await page.getByLabel("Titre de la tâche").fill("Réviser Atelier Horizon");
  await page.getByLabel("Dossier de la tâche").selectOption(dossier.id);
  await page.getByLabel("Échéance de la tâche").fill("2026-10-31");
  await page.getByRole("button", { name: "Enregistrer la tâche" }).click();
  await expect(
    page.getByRole("heading", { name: "Réviser Atelier Horizon" }),
  ).toBeVisible();
  await page
    .getByLabel("Modèle de checklist")
    .selectOption({ label: "Contrôle de production · v1" });
  await page.getByRole("button", { name: "Appliquer le modèle" }).click();
  await page.getByRole("checkbox", { name: "Rapprocher les pièces" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Rapprocher les pièces" }),
  ).toBeChecked();
  await page.getByRole("tab", { name: "Commentaires", exact: true }).click();
  await page
    .getByLabel("Nouveau commentaire")
    .fill("Contrôle interne fictif terminé");
  await page.getByRole("button", { name: "Publier le commentaire" }).click();
  await expect(page.getByLabel("Nouveau commentaire")).toHaveValue("");
  await page.reload();
  await page.getByRole("tab", { name: "Commentaires", exact: true }).click();
  await expect(page.getByText("Contrôle interne fictif terminé")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `evidence/private/task13/${captureRun}/regression-task3/task-detail-desktop-light.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.screenshot({
    path: `evidence/private/task13/${captureRun}/regression-task3/task-detail-900-light.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Activer le thème sombre" }).click();
  await expect(page.locator("html")).toHaveClass("dark");
  await page.screenshot({
    path: `evidence/private/task13/${captureRun}/regression-task3/task-detail-900-dark.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: `evidence/private/task13/${captureRun}/regression-task3/task-detail-desktop-dark.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Activer le thème clair" }).click();
  await page.getByRole("tab", { name: "Checklist", exact: false }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Commentaires", exact: true }),
  ).toBeFocused();
  await page.getByRole("link", { name: "Revenir aux tâches" }).click();
  for (const name of ["Kanban", "Semaine", "Calendrier", "Liste"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(
      page.getByRole("link", { name: "Réviser Atelier Horizon", exact: true }),
    ).toBeVisible();
    if (name === "Kanban" || name === "Semaine")
      await page.screenshot({
        path:
          `evidence/private/task13/${captureRun}/regression-task3/` +
          (name === "Kanban" ? "kanban" : "week") +
          "-desktop-light.png",
        fullPage: true,
      });
  }
  await page.screenshot({
    path: `evidence/private/task13/${captureRun}/regression-task3/task-grid-desktop-light.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.screenshot({
    path: `evidence/private/task13/${captureRun}/regression-task3/task-grid-900-light.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Activer le thème sombre" }).click();
  await expect(page.locator("html")).toHaveClass("dark");
  await page.screenshot({
    path: `evidence/private/task13/${captureRun}/regression-task3/task-grid-900-dark.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: `evidence/private/task13/${captureRun}/regression-task3/task-grid-desktop-dark.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Activer le thème clair" }).click();
  await page
    .getByText("Filtres, colonnes et vues enregistrées", { exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: "Afficher la colonne Priorité",
      exact: true,
    })
    .uncheck();
  await page
    .getByLabel("Nom de la vue", { exact: true })
    .fill("Production fictive");
  await page
    .getByRole("button", { name: "Enregistrer une nouvelle vue" })
    .click();
  await expect(page.getByLabel("Mes vues", { exact: true })).not.toHaveValue(
    "",
  );
  await page.reload();
  await page
    .getByText("Filtres, colonnes et vues enregistrées", { exact: true })
    .click();
  await page
    .getByLabel("Mes vues", { exact: true })
    .selectOption({ label: "Production fictive" });
  await expect(
    page.getByRole("columnheader", { name: "Priorité", exact: true }),
  ).toHaveCount(0);
  await page
    .getByText("Filtres, colonnes et vues enregistrées", { exact: true })
    .click();
  // Actual model editing, anchored recurrence preview and durable generation.
  await page.getByRole("button", { name: "Modèles et récurrences" }).click();
  await page
    .getByRole("button", { name: "Nouveau modèle · Récurrence", exact: true })
    .click();
  await page.getByLabel("Nom du modèle").fill("Clôture mensuelle fictive");
  await page.getByLabel("Dossier de la récurrence").selectOption(dossier.id);
  await page.getByLabel("Début de la règle").fill("2027-01-01");
  await page.getByLabel("Fin de la règle").fill("2027-03-31");
  await page.getByRole("button", { name: "Prévisualiser les dates" }).click();
  await expect(page.getByText("2027-02-28", { exact: false })).toBeVisible();
  await page
    .getByRole("button", { name: "Enregistrer le modèle", exact: true })
    .click();
  await expect(page.getByText("Modèle enregistré · version 1")).toBeVisible();
  await page
    .getByRole("button", { name: "Générer les tâches enregistrées" })
    .click();
  await expect(
    page.getByText("Génération : terminée", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: `evidence/private/task13/${captureRun}/regression-task3/recurrence-desktop-light.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Fermer le modèle", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Nouveau modèle · Type de tâche",
      exact: true,
    })
    .click();
  await page.getByLabel("Nom du modèle").fill("Révision fictive");
  await expect(
    page.getByText("Génération : terminée", { exact: false }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Enregistrer le modèle", exact: true })
    .click();
  await expect(page.getByText("Modèle enregistré · version 1")).toBeVisible();
  await page.screenshot({
    path: `evidence/private/task13/${captureRun}/regression-task3/models-desktop-light.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Nouveau modèle · Rappel", exact: true })
    .click();
  await page.getByLabel("Nom du modèle").fill("Rappel interne fictif");
  await page
    .getByRole("checkbox", { name: "Réviser Atelier Horizon", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Admin workflows fictif", exact: true })
    .check();
  await page.getByLabel("Début de la règle").fill("2027-01-01");
  await page.getByLabel("Fin de la règle").fill("2027-02-28");
  await page
    .getByRole("button", { name: "Prévisualiser les dates", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Enregistrer le modèle", exact: true })
    .click();
  await expect(page.getByText("Modèle enregistré · version 1")).toBeVisible();
  await expect(
    page.getByText("Aucune occurrence traitée pour ce modèle."),
  ).toBeVisible();
  await page.screenshot({
    path: `evidence/private/task13/${captureRun}/regression-task3/reminder-desktop-light.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Fermer le modèle", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reprendre des modèles", exact: true })
    .click();
  const invalidModel = crypto.randomUUID();
  const invalidCsv = `id;name;targets;item;label;order\n${invalidModel};Reprise mixte;tache;${crypto.randomUUID()};Valide;1\n${invalidModel};Reprise mixte;tache;${crypto.randomUUID()};;2\n`;
  await page.getByLabel("Fichier de modèles").setInputFiles({
    name: "mixte.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(invalidCsv),
  });
  await page.getByRole("button", { name: "Prévisualiser la reprise" }).click();
  await expect(page.getByRole("alert")).toContainText("Ligne 3");
  await expect(
    page.getByRole("checkbox", {
      name: /Valider « Reprise mixte » — 1 éléments/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enregistrer les modèles validés" }),
  ).toBeDisabled();
  await page.screenshot({
    path: `evidence/private/task13/${captureRun}/regression-task3/r1-import-invalid.png`,
    fullPage: true,
  });
  const csv =
    "id;name;targets;item;label;order;extra\n" +
    crypto.randomUUID() +
    ";Reprise fictive;tache;" +
    crypto.randomUUID() +
    ";Pièce reprise;1;information non reprise\n";
  await page.getByLabel("Fichier de modèles").setInputFiles({
    name: "modeles-fictifs.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "Prévisualiser la reprise" }).click();
  await expect(page.getByText("Non repris : extra.")).toBeVisible();
  await page
    .getByRole("checkbox", { name: /Valider « Reprise fictive »/ })
    .check();
  await page.screenshot({
    path: `evidence/private/task13/${captureRun}/regression-task3/checklist-reprise-desktop-light.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Enregistrer les modèles validés" })
    .click();
  await expect(
    page.getByText("1 modèles enregistrés.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Fermer les modèles", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Réviser Atelier Horizon", exact: true })
    .click();
  await page.getByRole("button", { name: "Modifier la tâche" }).click();
  await page
    .getByLabel("Type de tâche", { exact: true })
    .selectOption({ label: "Révision fictive" });
  await page.getByRole("button", { name: "Enregistrer la tâche" }).click();
  await expect(
    page.getByRole("heading", { name: "Réviser Atelier Horizon" }),
  ).toBeVisible();
  await page
    .getByLabel("Déplacer la tâche", { exact: true })
    .selectOption({ label: "Terminé" });
  await expect(page.locator(".work-record-header .badge")).toHaveText(
    "Terminée",
  );
  await page.reload();
  await expect(page.locator(".work-record-header .badge")).toHaveText(
    "Terminée",
  );
  await page
    .getByLabel("Déplacer la tâche", { exact: true })
    .selectOption({ label: "À traiter" });
  await expect(page.locator(".work-record-header .badge")).toHaveText(
    "À faire",
  );
  const reader = await post("/users", {
    operationId: crypto.randomUUID(),
    email: "reader-workflows@example.test",
    name: "Lecteur workflows fictif",
    password: "MotDePasseFictif123!",
    permissions: [{ action: "read", kind: "*", dossierId: null }],
  });
  const readerContext = await browser.newContext({ baseURL: origin });
  const readerPage = await readerContext.newPage();
  const logged = await readerPage.request.post("/api/v1/login", {
    headers: { origin },
    data: { email: reader.email, password: "MotDePasseFictif123!" },
  });
  expect(logged.ok()).toBeTruthy();
  const fiscalIds: string[] = [];
  const pieces: string[] = [];
  for (const nature of ["TVA", "DAS2"]) {
    const f = await post("/fiscal", {
      operationId: crypto.randomUUID(),
      dossierId: dossier.id,
      title: nature + " Horizon fictive",
      nature,
      period: {
        start: "2026-01-01",
        end: "2026-12-31",
        campaign: "2026",
        subtype: "annuelle",
      },
    });
    fiscalIds.push(f.record.id);
    const uploaded = await page.request.post("/api/v1/documents", {
      headers: { origin },
      multipart: {
        metadata: JSON.stringify({
          operationId: crypto.randomUUID(),
          dossierId: dossier.id,
          filename: nature + "-fictive.txt",
          mediaType: "text/plain",
          source: { kind: "manual", reference: "task3-fictive", version: "1" },
        }),
        file: {
          name: nature + "-fictive.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Preuve fictive " + nature),
        },
      },
    });
    expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
    const document = await uploaded.json();
    pieces.push(document.id);
    const evidenced = await post("/fiscal/" + f.record.id + "/commands", {
      operationId: crypto.randomUUID(),
      expectedVersion: f.record.version,
      event: {
        kind: "evidence",
        documentIds: [document.id],
        purpose: "support",
        reason: "Pièce fictive de recette commune",
      },
    });
    await post("/fiscal/" + f.record.id + "/commands", {
      operationId: crypto.randomUUID(),
      expectedVersion: evidenced.record.version,
      event: {
        kind: "deadlines",
        observed: "2026-10-20",
        internalTarget: null,
        campaignDate: null,
        provenance: {
          kind: "manual",
          source: "Cabinet fictif",
          account: "Fictif",
          reference: "Recette calendrier",
          version: "1",
          observedAt: "2026-10-17T10:00:00Z",
          sourceUpdatedAt: null,
          coverage: "complete",
          rawState: "échéance observée",
        },
      },
    });
    await page.goto("/#fiscal?id=" + f.record.id);
    await page
      .getByRole("tab", { name: "Travail interne", exact: true })
      .click();
    await page
      .getByLabel("Modèle de checklist")
      .selectOption({ label: "Contrôle de production · v1" });
    await page.getByRole("button", { name: "Appliquer le modèle" }).click();
    await page.getByRole("checkbox", { name: "Rapprocher les pièces" }).click();
    await expect(
      page.getByRole("checkbox", { name: "Rapprocher les pièces" }),
    ).toBeChecked();
    await page.getByRole("tab", { name: "Commentaires", exact: true }).click();
    await page
      .getByLabel("Nouveau commentaire")
      .fill(nature + " commentaire fictif");
    await page.getByRole("button", { name: "Publier le commentaire" }).click();
    await expect(page.getByLabel("Nouveau commentaire")).toHaveValue("");
    await page.getByRole("tab", { name: "Documents", exact: true }).click();
    await expect(
      page.getByRole("link", { name: "Pièce liée 1", exact: true }),
    ).toHaveAttribute("href", "/api/v1/documents/" + document.id + "/download");
    await page.reload();
    await page
      .getByRole("tab", { name: "Travail interne", exact: true })
      .click();
    await expect(
      page.getByRole("checkbox", { name: "Rapprocher les pièces" }),
    ).toBeChecked();
    await page.getByRole("tab", { name: "Commentaires", exact: true }).click();
    await expect(
      page.getByText(nature + " commentaire fictif", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path:
        `evidence/private/task13/${captureRun}/regression-task3/` +
        nature +
        "-shared-desktop-light.png",
      fullPage: true,
    });
    await readerPage.goto("/#fiscal?id=" + f.record.id);
    await readerPage
      .getByRole("tab", { name: "Travail interne", exact: true })
      .click();
    await readerPage
      .getByRole("tab", { name: "Commentaires", exact: true })
      .click();
    await expect(
      readerPage.getByText(nature + " commentaire fictif", { exact: true }),
    ).toBeVisible();
    const work = await (
      await page.request.get("/api/v1/workflows/targets/" + f.record.id)
    ).json();
    await post("/workflows/targets/" + f.record.id + "/commands", {
      operationId: crypto.randomUUID(),
      expectedVersion: work.version,
      command: {
        kind: "comment",
        text: "Mention fiscale fictive " + nature,
        mentions: [reader.id],
        audience: "internal",
      },
    });
  }
  await page.goto("/#calendrier");
  await page.getByRole("tab", { name: "Année", exact: true }).click();
  await expect(page.getByLabel("Calendrier annuel")).toBeVisible();
  await expect(
    page.locator(".work-calendar .work-event .work-date"),
  ).toHaveText(["20/10/2026", "20/10/2026", "31/10/2026"]);
  await expect(
    page.getByText("TVA · À préparer", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `evidence/private/task13/${captureRun}/regression-task3/calendar-desktop-light.png`,
    fullPage: true,
  });
  await readerPage.goto("/#notifications");
  await expect(
    readerPage.getByText("Mention fiscale fictive TVA", { exact: true }),
  ).toBeVisible();
  await readerPage.getByRole("button", { name: "Marquer lue" }).first().click();
  await readerPage.reload();
  await expect(
    readerPage.getByRole("button", { name: "Marquer lue" }),
  ).toHaveCount(1);
  await readerPage.getByRole("button", { name: "Masquer" }).first().click();
  await readerPage.reload();
  await expect(readerPage.getByRole("button", { name: "Masquer" })).toHaveCount(
    1,
  );
  await readerPage
    .getByText("Préférences de notifications", { exact: true })
    .click();
  await readerPage
    .getByRole("checkbox", { name: "Mentions", exact: true })
    .uncheck();
  await readerPage
    .getByRole("button", { name: "Enregistrer les préférences" })
    .click();
  await expect(readerPage.getByText("Préférences enregistrées.")).toBeVisible();
  await readerPage.reload();
  await readerPage
    .getByText("Préférences de notifications", { exact: true })
    .click();
  await expect(
    readerPage.getByRole("checkbox", { name: "Mentions", exact: true }),
  ).not.toBeChecked();
  await readerPage.screenshot({
    path: `evidence/private/task13/${captureRun}/regression-task3/notifications-desktop-light.png`,
    fullPage: true,
  });
  await readerPage.setViewportSize({ width: 900, height: 1000 });
  await readerPage
    .getByRole("button", { name: "Activer le thème sombre" })
    .click();
  await expect(readerPage.locator("html")).toHaveClass("dark");
  await readerPage.screenshot({
    path: `evidence/private/task13/${captureRun}/regression-task3/notifications-900-dark.png`,
    fullPage: true,
  });
  const currentReader = (
    await (await page.request.get("/api/v1/users")).json()
  ).items.find((u: { id: string }) => u.id === reader.id);
  const revoked = await page.request.put("/api/v1/users/" + reader.id, {
    headers: { origin },
    data: {
      operationId: crypto.randomUUID(),
      expectedVersion: currentReader.version,
      active: true,
      permissions: [],
    },
  });
  expect(revoked.ok(), await revoked.text()).toBeTruthy();
  await readerPage.reload();
  await expect(
    readerPage.getByText("Aucune notification accessible."),
  ).toBeVisible();
  for (const id of fiscalIds) {
    await readerPage.goto("/#fiscal?id=" + id);
    await expect(
      readerPage.getByRole("tab", { name: "Travail interne", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await readerPage.request.get("/api/v1/workflows/targets/" + id)
      ).status(),
    ).toBe(404);
  }
  for (const id of pieces)
    expect(
      (
        await readerPage.request.get("/api/v1/documents/" + id + "/download")
      ).status(),
    ).toBe(404);
  await readerContext.close();
});

for (const zone of ["Europe/Paris", "Pacific/Auckland"]) {
  test(`dates civiles : ${zone} garde détail liste semaine calendrier formulaire et export`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: origin,
      timezoneId: zone,
      locale: "fr-FR",
      viewport: {
        width: zone === "Pacific/Auckland" ? 900 : 1440,
        height: 1000,
      },
    });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByLabel("Adresse email").fill("workflows@example.test");
    await page.getByLabel("Mot de passe").fill("MotDePasseFictif123!");
    await page
      .getByRole("button", { name: "Se connecter", exact: true })
      .click();
    await expect(
      page.getByRole("navigation", { name: "Navigation principale" }),
    ).toBeVisible();
    const title = "Date civile " + zone;
    const r = await page.request.post("/api/v1/records", {
      headers: { origin },
      data: {
        operationId: crypto.randomUUID(),
        record: {
          kind: "tache",
          title,
          data: {
            dueDate: "2026-10-31",
            checklist: [
              {
                id: crypto.randomUUID(),
                label: "Ancienne vérification",
                done: false,
              },
            ],
          },
        },
      },
    });
    expect(r.status()).toBe(201);
    const t = await r.json();
    await page.goto("/#tache?id=" + t.id);
    await page
      .getByRole("checkbox", { name: "Ancienne vérification", exact: true })
      .click();
    await expect(
      page.getByRole("checkbox", {
        name: "Ancienne vérification",
        exact: true,
      }),
    ).toBeChecked();
    await page.getByLabel("Déplacer la tâche").selectOption("terminee");
    await expect(page.locator(".work-record-header .badge")).toHaveText(
      "Terminée",
    );
    await expect(page.getByText("31/10/2026", { exact: true })).toBeVisible();
    await expect(page.getByText("01/11/2026", { exact: true })).toHaveCount(0);
    await page
      .getByRole("button", { name: "Modifier la tâche", exact: true })
      .click();
    await expect(page.getByLabel("Échéance de la tâche")).toHaveValue(
      "2026-10-31",
    );
    await page.getByRole("button", { name: "Annuler", exact: true }).click();
    await page.screenshot({
      path: `evidence/private/task13/${captureRun}/regression-task3/r1-date-${zone.split("/")[1]}-detail.png`,
      fullPage: true,
    });
    await page.getByRole("link", { name: "Revenir aux tâches" }).click();
    await page.getByPlaceholder("Rechercher le travail…").fill(title);
    for (const name of ["Liste", "Semaine", "Calendrier"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await expect(
        page.getByRole("link", { name: title, exact: true }),
      ).toBeVisible();
      await expect(page.getByText("31/10/2026", { exact: true })).toBeVisible();
      await expect(page.getByText("01/11/2026", { exact: true })).toHaveCount(
        0,
      );
    }
    await page.screenshot({
      path: `evidence/private/task13/${captureRun}/regression-task3/r1-date-${zone.split("/")[1]}-calendar.png`,
      fullPage: true,
    });
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Exporter en CSV", exact: true })
      .click();
    const stream = await (await download).createReadStream();
    let csv = "";
    for await (const chunk of stream!) csv += chunk.toString();
    expect(csv).toContain(title);
    expect(csv).toContain("2026-10-31");
    expect(csv).not.toContain("2026-11-01");
    await context.close();
  });
}

test("rappel : rechercher au-delà de 200 objets et conserver la sélection entre les pages", async ({
  page,
}) => {
  test.setTimeout(90000);
  const setup = await (await page.request.get("/api/v1/setup")).json();
  if (setup.needsSetup) {
    await page.request.post("/api/v1/setup", {
      headers: { origin },
      data: {
        name: "Admin workflows fictif",
        email: "workflows@example.test",
        password: "MotDePasseFictif123!",
      },
    });
    await page.request.post("/api/v1/logout", {
      headers: { origin },
      data: {},
    });
  }
  await page.goto("/");
  await page.getByLabel("Adresse email").fill("workflows@example.test");
  await page.getByLabel("Mot de passe").fill("MotDePasseFictif123!");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Navigation principale" }),
  ).toBeVisible();
  const create = async (kind: string, title: string) => {
    const r = await page.request.post("/api/v1/records", {
      headers: { origin },
      data: {
        operationId: crypto.randomUUID(),
        record: { kind, title, data: {} },
      },
    });
    expect(r.status()).toBe(201);
    return r.json();
  };
  for (let n = 0; n < 210; n++)
    await create("contact", "AAA Contact " + String(n).padStart(3, "0"));
  for (let n = 1; n <= 51; n++)
    await create("tache", "ZZ Sélection " + String(n).padStart(2, "0"));
  const general = await (
    await page.request.get("/api/v1/records?limit=200")
  ).json();
  expect(general.items.every((r: any) => r.kind === "contact")).toBe(true);
  await page.getByRole("link", { name: "Tâches", exact: true }).click();
  await page.getByRole("button", { name: "Modèles et récurrences" }).click();
  await page
    .getByRole("button", { name: "Nouveau modèle · Rappel", exact: true })
    .click();
  await page
    .getByLabel("Nom du modèle", { exact: true })
    .fill("Périmètre paginé");
  await page.getByLabel("Rechercher un travail").fill("ZZ Sélection");
  await expect(
    page.getByRole("checkbox", { name: "ZZ Sélection 01", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "ZZ Sélection 51", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Travaux suivants" }).focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("checkbox", { name: "ZZ Sélection 51", exact: true })
    .focus();
  await page.keyboard.press("Space");
  await page.getByLabel("Rechercher un travail").fill("ZZ Sélection 01");
  await page
    .getByRole("checkbox", { name: "ZZ Sélection 01", exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", { name: "ZZ Sélection 51", exact: true }),
  ).toBeChecked();
  await page.getByLabel("Rechercher un travail").fill("Aucun résultat fictif");
  await expect(
    page.getByRole("checkbox", { name: "ZZ Sélection 01", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "ZZ Sélection 51", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("checkbox", { name: "Admin workflows fictif", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Enregistrer le modèle", exact: true })
    .click();
  await expect(
    page.getByText("Modèle enregistré · version 1", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reprendre la préparation", exact: true })
    .click();
  await expect(page.getByText(/À préparer à partir du/)).toBeVisible();
  await page.screenshot({
    path: `evidence/private/task13/${captureRun}/regression-task3/r1-reminder-selection.png`,
    fullPage: true,
  });
  await page
    .locator(".work-model-editor")
    .screenshot({
      path: `evidence/private/task13/${captureRun}/regression-task3/r1-reminder-editor.png`,
    });
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.getByRole("button", { name: "Activer le thème sombre" }).click();
  await expect(page.locator("html")).toHaveClass("dark");
  await page.locator(".work-model-editor").screenshot({
    path: `evidence/private/task13/${captureRun}/regression-task3/r1-reminder-editor-900-dark.png`,
  });
  await page.reload();
  await page.getByRole("button", { name: "Modèles et récurrences" }).click();
  await page.getByRole("button", { name: /Périmètre paginé/ }).click();
  await expect(
    page.getByRole("checkbox", { name: "ZZ Sélection 01", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "ZZ Sélection 51", exact: true }),
  ).toBeChecked();
});
