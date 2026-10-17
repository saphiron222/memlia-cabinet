import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  RecordListSchema,
  CabinetRecordSchema,
  CreateRecordInputSchema,
  UpdateRecordInputSchema,
  SetupStatusSchema,
  SetupInputSchema,
} from "@memlia/contracts";
test("installation, dossiers, tâches : persistance, checklist, transitions et export", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Installer Memlia Cabinet" }),
  ).toBeVisible();
  await page.getByLabel("Nom complet").fill("Camille Fictive");
  await page.getByLabel("Adresse email").fill("camille@example.test");
  await page.getByLabel("Mot de passe").fill("Exemple-fictif-2026");
  await page.getByRole("button", { name: "Créer le cabinet" }).click();
  await page.getByRole("link", { name: "Dossiers", exact: true }).click();
  await page.getByRole("button", { name: "Créer un dossier" }).click();
  await page.getByLabel("Titre", { exact: true }).fill("Atelier Fictif");
  await page.getByLabel("SIREN").fill("001234567");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Modifications enregistrées.")).toBeVisible();
  await page.getByRole("button", { name: "Fermer la fiche" }).click();
  await page.getByRole("link", { name: "Tâches", exact: true }).click();
  await page.getByRole("button", { name: "Créer une tâche" }).click();
  await page
    .getByLabel("Titre", { exact: true })
    .fill("Préparer le bilan fictif");
  await page
    .getByLabel("Dossier lié")
    .selectOption({ label: "Atelier Fictif" });
  await page.getByLabel("Échéance").fill("2026-10-31");
  await page
    .getByLabel("Nouvel élément de checklist")
    .fill("Vérifier les pièces");
  await page.getByRole("button", { name: "Ajouter à la checklist" }).click();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByLabel("Échéance").fill("2026-11-30");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Modifications enregistrées.")).toBeVisible();
  await page.getByRole("button", { name: "Fermer la fiche" }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Préparer le bilan fictif", exact: true })
    .click();
  await expect(page.getByLabel("Échéance")).toHaveValue("2026-11-30");
  await page.getByRole("button", { name: "Terminer", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("checklist");
  await page
    .getByRole("checkbox", { name: "Vérifier les pièces", exact: true })
    .check();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("button", { name: "Terminer", exact: true }).click();
  await expect(
    page.getByText("État : Terminée", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Réouvrir", exact: true }).click();
  await page.getByRole("button", { name: "Historique", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Historique" })).toBeVisible();
  await expect(page.getByText("Transition", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Fermer la fiche" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter en CSV" }).click();
  const download = await downloadPromise;
  expect(await readFile((await download.path())!, "utf8")).toContain(
    "2026-11-30",
  );
  await page.screenshot({
    path: "test-results/task2-light.png",
    fullPage: true,
  });
});

async function login(
  page: import("@playwright/test").Page,
  origin = "http://127.0.0.1:4173",
) {
  const status = SetupStatusSchema.parse(
    await (await page.request.get("/api/v1/setup")).json(),
  );
  if (status.needsSetup) {
    await page.request.post("/api/v1/setup", {
      headers: { Origin: origin },
      data: SetupInputSchema.parse({
        name: "Camille Fictive",
        email: "camille@example.test",
        password: "Exemple-fictif-2026",
      }),
    });
    await page.request.post("/api/v1/logout", {
      headers: { Origin: origin },
      data: {},
    });
  }
  await page.goto("/");
  await page.getByLabel("Adresse email").fill("camille@example.test");
  await page.getByLabel("Mot de passe").fill("Exemple-fictif-2026");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Navigation principale" }),
  ).toBeVisible();
}

test("erreurs reliées aux champs, clavier, thèmes et mesures Twenty", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  const opener = page.getByRole("button", { name: "Créer un contact" });
  await opener.click();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("alert")).toBeFocused();
  await page.getByRole("link", { name: /Titre :/ }).click();
  await expect(page.getByLabel("Titre", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Titre", { exact: true })).toHaveAttribute(
    "aria-describedby",
    "title-error",
  );
  await page.getByLabel("Titre", { exact: true }).fill("Contact Fictif");
  await page.getByLabel("Adresse email").fill("invalide");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("alert")).toBeFocused();
  await page.getByRole("link", { name: /Adresse email :/ }).click();
  await expect(page.getByLabel("Adresse email")).toBeFocused();
  await page.getByLabel("Adresse email").fill("contact@example.test");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Modifications enregistrées.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  expect(
    await page
      .locator("tbody tr")
      .first()
      .evaluate((e) => e.getBoundingClientRect().height),
  ).toBe(32);
  expect(
    await page
      .locator("aside")
      .evaluate((e) => e.getBoundingClientRect().width),
  ).toBe(220);
  expect(
    await page
      .locator(".app-header")
      .evaluate((e) => e.getBoundingClientRect().height),
  ).toBe(48);
  expect(
    await page.locator("html").evaluate((e) => getComputedStyle(e).fontSize),
  ).toBe("13px");
  expect(await page.evaluate(() => document.fonts.check("13px Inter"))).toBe(
    true,
  );
  await page.getByRole("button", { name: "Activer le thème sombre" }).click();
  await expect(page.locator("html")).toHaveClass("dark");
  await page.getByRole("button", { name: "Replier la navigation" }).click();
  expect(
    await page
      .locator("aside")
      .evaluate((e) => e.getBoundingClientRect().width),
  ).toBe(48);
  await page.screenshot({
    path: "test-results/task2-dark.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator("html")).toHaveClass("dark");
  await page.getByRole("button", { name: "Déplier la navigation" }).click();
  await page.getByRole("button", { name: "Activer le thème clair" }).click();
  await page
    .getByRole("button", { name: "Contact Fictif", exact: true })
    .click();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((e) => e.getBoundingClientRect().width),
  ).toBe(400);
  await page.screenshot({
    path: "test-results/task2-panel.png",
    fullPage: true,
  });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  expect(
    await page
      .getByRole("dialog")
      .evaluate((e) => e.contains(document.activeElement)),
  ).toBe(true);
});

test("conflit réel entre deux éditions : saisie conservée et résolution explicite", async ({
  page,
  context,
}) => {
  await login(page);
  await createFixture(page, "dossier", "Dossier du conflit");
  await page.getByRole("link", { name: "Dossiers", exact: true }).click();
  await page
    .getByRole("button", { name: "Dossier du conflit", exact: true })
    .click();
  await page.getByLabel("Titre", { exact: true }).fill("Mon intitulé conservé");
  const list = RecordListSchema.parse(
    await (
      await context.request.get(
        "/api/v1/records?kind=dossier&q=Dossier%20du%20conflit",
      )
    ).json(),
  );
  const current = list.items[0];
  const { id, version, createdAt, updatedAt, ...record } = current;
  const update = await context.request.put("/api/v1/records/" + id, {
    headers: { Origin: "http://127.0.0.1:4173" },
    data: {
      operationId: crypto.randomUUID(),
      expectedVersion: version,
      record: { ...record, title: "Changement concurrent" },
    },
  });
  expect(update.status()).toBe(200);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("changé");
  await expect(page.getByLabel("Titre", { exact: true })).toHaveValue(
    "Mon intitulé conservé",
  );
  await page
    .getByRole("button", { name: "Consulter la dernière version" })
    .click();
  await expect(
    page.getByText("Changement concurrent", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Conserver ma saisie", exact: true })
    .click();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Modifications enregistrées.")).toBeVisible();
  await page.getByRole("button", { name: "Fermer la fiche" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Mon intitulé conservé", exact: true }),
  ).toBeVisible();
});

test("obligations : décimal exact, validation locale et invalidation du contenu", async ({
  page,
}) => {
  await login(page);
  await createFixture(page, "dossier", "Dossier obligation");
  await page.getByRole("link", { name: "Obligations", exact: true }).click();
  await page.getByRole("button", { name: "Créer une obligation" }).click();
  await page.getByLabel("Titre", { exact: true }).fill("TVA fictive");
  await page
    .getByLabel("Dossier lié")
    .selectOption({ label: "Dossier obligation" });
  await page.getByLabel("Nature", { exact: true }).fill("TVA");
  await page.getByLabel("Période", { exact: true }).fill("2026-10");
  await page
    .getByLabel("Montant", { exact: true })
    .fill("123456789012345678.10");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Modifications enregistrées.")).toBeVisible();
  await page.getByLabel("Validation locale").selectOption("validee_localement");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Modifications enregistrées.")).toBeVisible();
  await page
    .getByLabel("Montant", { exact: true })
    .fill("123456789012345678.11");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByLabel("Validation locale")).toHaveValue("non_validee");
  await page.getByRole("button", { name: "Fermer la fiche" }).click();
  await page.reload();
  await page.getByRole("button", { name: "TVA fictive", exact: true }).click();
  await expect(page.getByLabel("Montant", { exact: true })).toHaveValue(
    "123456789012345678.11",
  );
});

test("chargement, panne, refus et réponse obsolète après navigation", async ({
  page,
}) => {
  await login(page);
  await createFixture(page, "dossier", "Dossier réseau");
  await createFixture(page, "contact", "Contact réseau");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/v1/records?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("kind") === "contact") {
      await gate;
      await route.fulfill({
        status: 403,
        json: {
          error: { code: "FORBIDDEN", message: "Lecture non autorisée." },
        },
      });
    } else await route.continue();
  });
  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  await expect(page.getByText("Chargement de la liste…")).toBeVisible();
  await page.getByRole("link", { name: "Dossiers", exact: true }).click();
  release();
  await expect(
    page.getByRole("button", { name: "Dossier réseau", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Accès refusé : vous ne pouvez pas consulter cette liste."),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Accès refusé");
  await page.unroute("**/api/v1/records?**");
  await page.route("**/api/v1/records?**", (route) => route.abort());
  await page.getByRole("button", { name: "Réessayer" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Connexion au cabinet interrompue",
  );
  await page.unroute("**/api/v1/records?**");
  await page.getByRole("button", { name: "Réessayer" }).click();
  await expect(
    page.getByRole("button", { name: "Contact réseau", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Rechercher", { exact: true }).fill("x".repeat(301));
  await expect(page.getByLabel("Rechercher", { exact: true })).toHaveValue(
    "x".repeat(300),
  );
  await page.getByLabel("Rechercher", { exact: true }).fill("Introuvable");
  await expect(
    page.getByRole("heading", { name: "Aucun résultat" }),
  ).toBeVisible();
});

test("installation réseau : jeton requis, erreur ciblée et aucune persistance du secret", async ({
  page,
}) => {
  await page.route("**/api/v1/setup", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { needsSetup: true, requiresToken: true } })
      : route.fulfill({
          status: 403,
          json: {
            error: {
              code: "BOOTSTRAP_TOKEN_REQUIRED",
              message: "Jeton local incorrect.",
            },
          },
        }),
  );
  await page.goto("/");
  await page.getByLabel("Nom complet").fill("Fictif");
  await page.getByLabel("Adresse email").fill("autre@example.test");
  await page
    .getByLabel("Mot de passe", { exact: true })
    .fill("Mot-de-passe-fictif");
  await page.getByRole("button", { name: "Créer le cabinet" }).click();
  await expect(page.getByLabel("Jeton local d’installation")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.getByLabel("Jeton local d’installation").fill("JETON-FICTIF");
  const sent = page.waitForRequest(
    (r) => r.url().endsWith("/setup") && r.method() === "POST",
  );
  await page.getByRole("button", { name: "Créer le cabinet" }).click();
  expect((await sent).headers()["x-bootstrap-token"]).toBe("JETON-FICTIF");
  await expect(page.getByRole("alert")).toContainText("Jeton local incorrect.");
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("JETON-FICTIF");
});

async function createFixture(
  page: import("@playwright/test").Page,
  kind: "dossier" | "contact",
  title: string,
  origin = "http://127.0.0.1:4173",
) {
  const response = await page.request.post("/api/v1/records", {
    headers: { Origin: origin },
    data: CreateRecordInputSchema.parse({
      operationId: crypto.randomUUID(),
      record: { kind, title, data: {} },
    }),
  });
  expect(response.status()).toBe(201);
  return CabinetRecordSchema.parse(await response.json());
}

test("déconnexion pendant une liste retardée : aucun retour des données", async ({
  page,
}) => {
  await login(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/v1/records?**", async (route) => {
    await gate;
    await route.fulfill({
      json: RecordListSchema.parse({
        items: [],
        total: 0,
        offset: 0,
        limit: 50,
      }),
    });
  });
  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  await expect(page.getByText("Chargement de la liste…")).toBeVisible();
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  release();
  await expect(
    page.getByRole("heading", { name: "Connexion au cabinet" }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Connexion au cabinet" }),
  ).toBeVisible();
});

test("droits réels : lecture seule et refus serveur", async ({ page }) => {
  await login(page);
  const { CreateUserInputSchema } = await import("@memlia/contracts");
  const user = await page.request.post("/api/v1/users", {
    headers: { Origin: "http://127.0.0.1:4173" },
    data: CreateUserInputSchema.parse({
      operationId: crypto.randomUUID(),
      name: "Lecteur fictif",
      email: "lecteur@example.test",
      password: "Acces-lecteur-fictif",
      permissions: [{ action: "read", kind: "contact", dossierId: null }],
    }),
  });
  expect(user.status()).toBe(201);
  await createFixture(page, "contact", "Contact en lecture seule");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.getByLabel("Adresse email").fill("lecteur@example.test");
  await page.getByLabel("Mot de passe").fill("Acces-lecteur-fictif");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Créer un contact" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Exporter en CSV" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Contact en lecture seule", exact: true })
    .click();
  await expect(
    page.getByText("Lecture seule : modification non autorisée."),
  ).toBeVisible();
  await expect(page.getByLabel("Titre", { exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Dossiers", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Accès refusé");
});

test("étiquettes : saisir plusieurs valeurs au clavier puis recharger", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "Tâches", exact: true }).click();
  await page.getByRole("button", { name: "Créer une tâche" }).click();
  await page.getByLabel("Titre", { exact: true }).fill("Tâche avec étiquettes");
  await page
    .getByLabel("Étiquettes", { exact: true })
    .pressSequentially("bilan, urgent");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Modifications enregistrées.")).toBeVisible();
  await page.getByRole("button", { name: "Fermer la fiche" }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Tâche avec étiquettes", exact: true })
    .click();
  await expect(page.getByLabel("Étiquettes", { exact: true })).toHaveValue(
    "bilan, urgent",
  );
});

async function limitedDossierUser(
  page: import("@playwright/test").Page,
  suffix: string,
) {
  const origin = "http://127.0.0.1:4175";
  await login(page, origin);
  const a = await createFixture(page, "dossier", `Dossier A ${suffix}`, origin);
  const b = await createFixture(page, "dossier", `Dossier B ${suffix}`, origin);
  const taskResponse = await page.request.post("/api/v1/records", {
    headers: { Origin: origin },
    data: CreateRecordInputSchema.parse({
      operationId: crypto.randomUUID(),
      record: {
        kind: "tache",
        title: `Tâche A ${suffix}`,
        dossierId: a.id,
        data: {},
      },
    }),
  });
  expect(taskResponse.status()).toBe(201);
  const task = CabinetRecordSchema.parse(await taskResponse.json());
  const { CreateUserInputSchema } = await import("@memlia/contracts");
  const email = `limite-${suffix}@example.test`;
  const created = await page.request.post("/api/v1/users", {
    headers: { Origin: origin },
    data: CreateUserInputSchema.parse({
      operationId: crypto.randomUUID(),
      name: "Utilisateur limité fictif",
      email,
      password: "Droits-limites-fictifs",
      permissions: [
        { action: "read", kind: "*", dossierId: null },
        { action: "update", kind: "tache", dossierId: a.id },
        { action: "create", kind: "tache", dossierId: a.id },
      ],
    }),
  });
  expect(created.status()).toBe(201);
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.getByLabel("Adresse email").fill(email);
  await page.getByLabel("Mot de passe").fill("Droits-limites-fictifs");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByRole("link", { name: "Tâches", exact: true }).click();
  return { a, b, task };
}

test.describe("Droits par dossier", () => {
  test.use({ baseURL: "http://127.0.0.1:4175" });

  test("droits limités au dossier A : corriger un rattachement sans perdre la saisie", async ({
    page,
  }) => {
    const { a, b, task } = await limitedDossierUser(page, "modification");
    await page.getByRole("button", { name: task.title, exact: true }).click();
    await page
      .getByLabel("Titre", { exact: true })
      .fill("Saisie conservée sur A");
    await page
      .getByLabel("Description", { exact: true })
      .fill("Notes à conserver malgré le rattachement refusé.");
    for (const destination of ["", b.id]) {
      await page.getByLabel("Dossier lié").selectOption(destination);
      await expect(page.getByLabel("Dossier lié")).toBeEnabled();
      await expect(page.getByLabel("Titre", { exact: true })).toBeEnabled();
      const refused = page.waitForResponse(
        (response) =>
          response.url().endsWith("/records/" + task.id) &&
          response.request().method() === "PUT",
      );
      await page
        .getByRole("button", { name: "Enregistrer", exact: true })
        .click();
      expect((await refused).status()).toBe(404);
      await expect(page.getByRole("alert")).toBeFocused();
      await expect(page.getByLabel("Dossier lié")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await page.getByRole("link", { name: /^Dossier lié :/ }).click();
      await expect(page.getByLabel("Dossier lié")).toBeFocused();
      await page.getByLabel("Dossier lié").selectOption(a.id);
      await expect(page.getByLabel("Titre", { exact: true })).toHaveValue(
        "Saisie conservée sur A",
      );
      await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
        "Notes à conserver malgré le rattachement refusé.",
      );
    }
    await page
      .getByRole("button", { name: "Enregistrer", exact: true })
      .click();
    await expect(page.getByText("Modifications enregistrées.")).toBeVisible();
    await page.getByRole("button", { name: "Fermer la fiche" }).click();
    await page.reload();
    await page
      .getByRole("button", { name: "Saisie conservée sur A", exact: true })
      .click();
    await expect(page.getByLabel("Dossier lié")).toHaveValue(a.id);
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
      "Notes à conserver malgré le rattachement refusé.",
    );
  });

  test("création limitée au dossier A : rattachement initial corrigeable", async ({
    page,
  }) => {
    const { a, b } = await limitedDossierUser(page, "creation");
    await page.getByRole("button", { name: "Créer une tâche" }).click();
    await expect(page.getByLabel("Dossier lié")).toHaveValue("");
    await expect(page.getByLabel("Dossier lié")).toBeEnabled();
    await page
      .getByLabel("Titre", { exact: true })
      .fill("Création autorisée sur A");
    for (const destination of ["", b.id]) {
      await page.getByLabel("Dossier lié").selectOption(destination);
      const refused = page.waitForResponse(
        (response) =>
          response.url().endsWith("/records") &&
          response.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Enregistrer", exact: true })
        .click();
      expect((await refused).status()).toBe(403);
      await expect(page.getByLabel("Dossier lié")).toBeEnabled();
      await expect(page.getByLabel("Dossier lié")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await expect(page.getByLabel("Titre", { exact: true })).toHaveValue(
        "Création autorisée sur A",
      );
    }
    await page.getByLabel("Dossier lié").selectOption(a.id);
    await page
      .getByRole("button", { name: "Enregistrer", exact: true })
      .click();
    await expect(page.getByText("Modifications enregistrées.")).toBeVisible();
    await page.getByRole("button", { name: "Fermer la fiche" }).click();
    await page.reload();
    await page
      .getByRole("button", { name: "Création autorisée sur A", exact: true })
      .click();
    await expect(page.getByLabel("Dossier lié")).toHaveValue(a.id);
  });
});

test.describe("Connexion après installation réseau", () => {
  test.use({ baseURL: "http://127.0.0.1:4179" });
  test("connexion réseau après rechargement sans champ ni en-tête bootstrap", async ({
    page,
  }) => {
    await login(page, "http://127.0.0.1:4179");
    await page.getByRole("button", { name: "Se déconnecter" }).click();
    // Reproduces the previous server's network status as well as protecting the UI independently.
    await page.route("**/api/v1/setup", (route) =>
      route.fulfill({ json: { needsSetup: false, requiresToken: true } }),
    );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Connexion au cabinet" }),
    ).toBeVisible();
    await expect(page.getByLabel("Jeton local d’installation")).toHaveCount(0);
    await page.getByLabel("Adresse email").fill("camille@example.test");
    await page
      .getByLabel("Mot de passe", { exact: true })
      .fill("Exemple-fictif-2026");
    const sent = page.waitForRequest(
      (r) => r.url().endsWith("/login") && r.method() === "POST",
    );
    await page
      .getByRole("button", { name: "Se connecter", exact: true })
      .click();
    expect((await sent).headers()["x-bootstrap-token"]).toBeUndefined();
    await expect(page.getByRole("navigation")).toBeVisible();
  });
});
