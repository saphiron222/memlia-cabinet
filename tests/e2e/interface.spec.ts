import { test, expect } from "@playwright/test";
const origin = "http://127.0.0.1:4189";
const captureRun =
  process.env.MEMLIA_CAPTURE_RUN ??
  new Date().toISOString().replaceAll(":", "-");
test.use({ baseURL: origin });
test("interface : les grilles gardent filtres, droits, dates, retour et focus ; compositions remplies", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  await page.getByLabel("Nom complet").fill("Camille · cabinet fictif");
  await page.getByLabel("Adresse email").fill("interface@example.test");
  await page.getByLabel("Mot de passe").fill("MotDePasseFictif123!");
  await page.getByRole("button", { name: "Créer le cabinet" }).click();
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .waitFor();
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post("/api/v1" + path, {
      headers: { origin },
      data,
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const names = [
    "Arpège Conseil",
    "Atelier des Rives",
    "Boulangerie Saint-Clair",
    "Éditions du Passage",
    "Jardin des Cèdres",
    "Lumière Architecture",
    "Maison Solstice",
    "Studio Verne",
  ];
  const dossiers: { id: string; title: string }[] = [];
  const provenance = {
    kind: "manual",
    source: "Saisie fictive",
    account: "Cabinet de démonstration",
    reference: "Exemple local",
    version: "1",
    observedAt: "2026-10-17T10:00:00.000Z",
    sourceUpdatedAt: null,
    coverage: "unknown",
    rawState: "saisie",
  };
  for (const [i, title] of names.entries()) {
    const d = await post("/records", {
      operationId: crypto.randomUUID(),
      record: {
        kind: "dossier",
        title,
        data: {
          siren: i === 6 ? null : String(900000001 + i),
          legalForm: [
            "SAS",
            "SARL",
            "EURL",
            "SASU",
            "SARL",
            "SELARL",
            "",
            "SAS",
          ][i],
          financialYearEnd: i === 6 ? null : "2026-12-31",
          email: "contact" + i + "@example.test",
          vatRegime: i === 6 ? null : "reel_normal",
          vatFrequency: "mensuelle",
          incomeTaxRegime: "IS",
        },
      },
    });
    dossiers.push(d);
    let f = (
      await post("/fiscal", {
        operationId: crypto.randomUUID(),
        dossierId: d.id,
        title: "TVA septembre · " + title,
        nature: "TVA",
        period: {
          start: "2026-09-01",
          end: "2026-09-30",
          campaign: "2026",
          subtype: "CA3",
        },
        regime: "reel_normal",
        amount: [
          "1824.37",
          "0.00",
          "6490.20",
          "387.92",
          "2118.00",
          "562.14",
          "9473.60",
          "1340.80",
        ][i],
      })
    ).record;
    f = (
      await post(`/fiscal/${f.id}/commands`, {
        operationId: crypto.randomUUID(),
        expectedVersion: f.version,
        event: {
          kind: "deadlines",
          observed: "2026-10-" + String(17 + i),
          internalTarget: null,
          campaignDate: null,
          provenance,
        },
      })
    ).record;
    if (i % 3 === 0)
      await post(`/fiscal/${f.id}/commands`, {
        operationId: crypto.randomUUID(),
        expectedVersion: f.version,
        event: { kind: "preparation", state: "preparee" },
      });
    await post("/fiscal", {
      operationId: crypto.randomUUID(),
      dossierId: d.id,
      title: "IS · " + title,
      nature: "IS",
      period: {
        start: "2025-01-01",
        end: "2025-12-31",
        campaign: "2026",
        subtype:
          i === 6
            ? "régularisation à qualifier"
            : ["solde", "acompte_1", "acompte_2", "acompte_3", "acompte_4"][
                i % 5
              ],
      },
      financialYearEnd: "2025-12-31",
      amount: "1540.37",
    });
    await post("/records", {
      operationId: crypto.randomUUID(),
      record: {
        kind: "tache",
        title: "Réviser · " + title,
        dossierId: d.id,
        data: {
          state:
            i % 3 === 0 ? "terminee" : i % 3 === 1 ? "en_cours" : "a_faire",
          dueDate: "2026-10-" + String(i >= 6 ? 17 : 17 + i),
          priority: i % 2 === 0 ? "haute" : "normale",
        },
      },
    });
  }
  await post("/records", {
    operationId: crypto.randomUUID(),
    record: {
      kind: "contact",
      title: "Alex Bernard · contact fictif",
      dossierId: dossiers[0]!.id,
      data: { email: "alex@example.test", phone: "01 00 00 00 00" },
    },
  });
  const capture = async (name: string) => {
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(page.viewportSize()!.width - 8, 998);
    await page.screenshot({
      path: `evidence/private/task13/${captureRun}/current/${name}.png`,
      fullPage: true,
    });
  };
  const resize = page.getByRole("separator", {
    name: "Redimensionner la navigation",
  });
  await resize.focus();
  await resize.press("ArrowRight");
  await expect(resize).toHaveAttribute("aria-valuenow", "260");
  await resize.press("ArrowLeft");
  await expect(resize).toHaveAttribute("aria-valuenow", "250");
  await page
    .getByRole("button", { name: "Replier Fiscalité", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "TVA", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Déplier Fiscalité", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "TVA", exact: true }),
  ).toBeVisible();
  await page.goto("/#dossier");
  await page.getByRole("button", { name: names[0], exact: true }).waitFor();
  await capture("dossiers-1440-light");
  await page.getByRole("button", { name: names[0], exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await capture("dossier-properties-1440-light");
  await page.getByRole("button", { name: "Fermer la fiche" }).click();
  await page.goto("/#fiscal?nature=TVA&year=2026&month=10");
  const occurrence = page.getByRole("link", {
    name: "Ouvrir TVA septembre · Arpège Conseil",
    exact: true,
  });
  await occurrence.waitFor();
  await expect(
    page
      .getByRole("navigation", { name: "Navigation principale" })
      .getByRole("link", { name: "TVA", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.locator(".fiscal-matrix").evaluate((e) => (e.scrollLeft = 600));
  await capture("tva-1440-light-overflow");
  await occurrence.click();
  await page
    .getByRole("heading", {
      name: "TVA septembre · Arpège Conseil",
      exact: true,
    })
    .waitFor();
  await capture("fiscal-peek-1440-light");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(occurrence).toBeFocused();
  await page
    .getByLabel("Référence de date", { exact: true })
    .selectOption("period_end");
  await expect(occurrence).toHaveCount(0);
  await page.getByRole("button", { name: "Sep 2026", exact: true }).click();
  await occurrence.waitFor();
  await page.reload();
  await occurrence.waitFor();
  await expect(
    page.getByLabel("Référence de date", { exact: true }),
  ).toHaveValue("period_end");
  await page
    .getByLabel("Rechercher un dossier", { exact: true })
    .fill("Arpège");
  await expect(page.locator(".fiscal-matrix tbody tr")).toHaveCount(1);
  await page.getByLabel("Rechercher un dossier", { exact: true }).fill("");
  await expect(page.locator(".fiscal-matrix tbody tr")).toHaveCount(8);
  await page.getByLabel("Périmètre", { exact: true }).selectOption("true");
  await expect(
    page.getByText("Aucun dossier autorisé dans ce périmètre.", {
      exact: true,
    }),
  ).toBeVisible();
  await capture("tva-own-empty");
  await page.getByLabel("Périmètre", { exact: true }).selectOption("false");
  await occurrence.waitFor();
  await page.goto("/#fiscal?nature=IS&year=2025&fiscalDateReference=closing");
  await page
    .getByRole("link", { name: "Ouvrir IS · Maison Solstice", exact: true })
    .waitFor();
  await expect(
    page.getByRole("columnheader", { name: "Autres sous-types" }),
  ).toBeVisible();
  await expect(
    page.getByText("régularisation à qualifier", { exact: true }),
  ).toBeVisible();
  await capture("is-1440-light");
  await page.goto(`/#fiscal?matrixDossier=${dossiers[0]!.id}&year=2026`);
  await page.getByRole("table").waitFor();
  await expect(
    page.getByRole("columnheader", { name: "Décembre" }),
  ).toBeVisible();
  await capture("dossier-natures-months");
  await page.goto("/#tache?view=week&q=Arpège");
  await page
    .getByRole("link", { name: "Réviser · Arpège Conseil", exact: true })
    .click();
  await page.getByRole("link", { name: "Revenir aux tâches" }).click();
  await expect(
    page.getByRole("tab", { name: "Semaine", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByPlaceholder("Rechercher le travail…")).toHaveValue(
    "Arpège",
  );
  await expect(
    page
      .getByTestId("panel-card")
      .getByRole("link", { name: "Réviser · Arpège Conseil", exact: true }),
  ).toBeVisible();
  await page.goto(
    "/#calendrier?view=calendar&from=2026-01-01&to=2026-12-31&anchor=2026-10-17",
  );
  await expect(page.locator(".annual-month")).toHaveCount(12);
  const october = page
    .locator(".annual-month")
    .filter({ hasText: "octobre 2026" });
  const annual17 = october
    .locator(".annual-day-button")
    .filter({ hasText: /^17$/ });
  await annual17.focus();
  await annual17.press("ArrowRight");
  await expect(october.locator(".annual-day-button:focus")).toHaveText("18");
  await annual17.click();
  await expect(
    page.getByRole("heading", { name: "Échéances du 17/10/2026" }),
  ).toBeVisible();
  await page
    .getByTestId("panel-card")
    .getByRole("link", { name: "Réviser · Arpège Conseil", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await expect(page).toHaveURL(/#calendrier\?.*view=calendar.*id=/);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("tab", { name: "Année", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.goto("/#calendrier?view=month&anchor=2026-10-17");
  await page
    .getByRole("button", { name: "+2 événements", exact: true })
    .waitFor();
  await capture("calendar-1440-light-compact");
  const day17 = page.locator(".cal-day-button").filter({ hasText: /^17$/ });
  await day17.focus();
  await day17.press("ArrowRight");
  await expect(page.locator(".cal-day-button:focus")).toHaveText("18");
  await page
    .getByRole("button", { name: "+2 événements", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Réviser · Maison Solstice/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Réviser · Studio Verne/ }),
  ).toBeVisible();
  await capture("calendar-1440-light");
  await page.getByRole("button", { name: /Réviser · Arpège Conseil/ }).click();
  await page.getByRole("dialog").waitFor();
  await page.reload();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "octobre 2026", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Semaine", exact: true }).click();
  await capture("calendar-week-1440-light");
  for (const width of [900, 1440])
    for (const theme of ["dark", "light"]) {
      await page.setViewportSize({ width, height: 1000 });
      if ((await page.locator("html").getAttribute("class")) !== theme)
        await page.getByRole("button", { name: /Activer le thème/ }).click();
      await expect(page.locator("html")).toHaveClass(theme);
      await page.goto("/#fiscal?nature=TVA&year=2026&month=10");
      await occurrence.waitFor();
      await expect(page.locator("html")).toHaveClass(theme);
      await page
        .getByRole("button", { name: "Colonnes suivantes", exact: true })
        .click();
      await expect
        .poll(() =>
          page.locator(".fiscal-matrix").evaluate((e) => e.scrollLeft),
        )
        .toBeGreaterThan(0);
      for (const control of await page
        .locator(".matrix-filters select, .month-strip button")
        .all()) {
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      await capture(`tva-${width}-${theme}`);
      await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
      await occurrence.click();
      await page.getByRole("dialog").waitFor();
      await page.getByRole("tab", { name: "Documents", exact: true }).focus();
      await capture(`peek-${width}-${theme}-focus`);
      await page.keyboard.press("Escape");
    }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [route, wait] of [
    ["contact", "Alex Bernard · contact fictif"],
    ["documents", "Bibliothèque documentaire"],
    ["collectes", "Collectes et couverture"],
    ["imports", "Reprise"],
    ["administration", "Administration"],
    ["compte", "Mon compte"],
    ["accueil", "Accueil"],
  ]) {
    await page.goto("/#" + route);
    await page.getByText(wait!, { exact: true }).first().waitFor();
    await capture(route + "-1440-light");
  }
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/v1/fiscal/matrix?**", async (route) => {
    await gate;
    await route.fulfill({
      status: 503,
      json: {
        error: {
          code: "UNAVAILABLE",
          message:
            "Source temporairement indisponible dans ce scénario fictif.",
        },
      },
    });
  });
  await page.goto("/#fiscal?nature=TVA&year=2026&month=10");
  await page.getByText("Chargement de la matrice…", { exact: true }).waitFor();
  await capture("matrix-loading");
  release();
  await page.getByRole("alert").waitFor();
  await capture("matrix-error");
  await page.unroute("**/api/v1/fiscal/matrix?**");
  await page.getByRole("button", { name: "Actualiser la grille" }).click();
  await occurrence.waitFor();
  await page.getByRole("button", { name: "Replier la navigation" }).click();
  await expect(
    page.getByRole("button", { name: "Déplier la navigation" }),
  ).toBeVisible();
  await capture("navigation-collapsed");
  await page.getByRole("button", { name: "Déplier la navigation" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".matrix-occurrence").first()).toHaveCSS(
    "transition-duration",
    "0s",
  );
  await page.goto("/#administration");
  await page.getByRole("button", { name: "Rôles", exact: true }).click();
  await page
    .getByText("Matrice des permissions par rôle", { exact: true })
    .waitFor();
  await capture("roles-matrix-1440-light");
});
