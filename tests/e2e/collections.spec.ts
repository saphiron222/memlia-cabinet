import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { SetupStatusSchema } from "@memlia/contracts";
const origin = "http://127.0.0.1:4177";
test.use({ baseURL: origin });
test.beforeEach(async ({ page }) => {
  const setup = SetupStatusSchema.parse(
    await (await page.request.get("/api/v1/setup")).json(),
  );
  const credentials = {
    email: "camille@example.test",
    password: "Exemple-fictif-2026",
  };
  await page.request.post(
    setup.needsSetup ? "/api/v1/setup" : "/api/v1/login",
    {
      headers: { origin },
      data: setup.needsSetup
        ? { ...credentials, name: "Camille Fictive" }
        : credentials,
    },
  );
});
test("Collectes : validation clavier, progression, preuves fictives, couverture partielle et reprise", async ({
  page,
}) => {
  const dossier = await (
    await page.request.post("/api/v1/records", {
      headers: { origin },
      data: {
        operationId: crypto.randomUUID(),
        record: {
          kind: "dossier",
          title: "Collecte CFE fictive",
          data: { siren: "001234567" },
        },
      },
    })
  ).json();
  await page.goto("/#collectes");
  await expect(
    page.getByRole("heading", { name: "Collectes", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Simulation — pièces fictives, sans valeur fiscale."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Lancer la simulation" }).click();
  await expect(page.getByRole("alert")).toBeFocused();
  await page.getByRole("link", { name: /Dossier lié/ }).click();
  await expect(page.getByLabel("Dossier de la collecte")).toBeFocused();
  await page.getByLabel("Dossier de la collecte").selectOption(dossier.id);
  await page.getByRole("button", { name: "Lancer la simulation" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Complet dans le périmètre demandé",
  );
  await expect(
    page.getByRole("cell", { name: "CFE-FICTIF-2026" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Télécharger avis-cfe-fictif.pdf" })
    .click();
  const file = await download;
  expect((await readFile((await file.path())!)).subarray(0, 5).toString()).toBe(
    "%PDF-",
  );
  await page.screenshot({
    path: "test-results/task4-collections-light.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Activer le thème sombre" }).click();
  // Theme changes animate Button backgrounds for 100ms; inspect stable colors.
  const buttons = page
    .getByRole("button")
    .filter({
      hasText: /^(Lancer la simulation|Télécharger avis-cfe-fictif.pdf)$/,
    });
  const inspect = () =>
    buttons.evaluateAll((elements) =>
      elements.map((element) => {
        const button = element as HTMLButtonElement,
          style = getComputedStyle(button);
        return {
          label: button.textContent,
          disabled: button.disabled,
          dataDisabled: button.hasAttribute("data-disabled"),
          background: style.backgroundColor,
          color: style.color,
          opacity: style.opacity,
          targetBackground: style
            .getPropertyValue("--tw-button-background")
            .trim(),
          targetColor: style.getPropertyValue("--tw-button-color").trim(),
          transition: style.transition,
        };
      }),
    );
  const immediate = await inspect();
  await page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    await Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  const settled = await inspect();
  expect(settled).toHaveLength(2);
  for (const button of settled) {
    expect(button.disabled).toBe(false);
    expect(button.dataDisabled).toBe(false);
    expect(button.opacity).toBe("1");
    expect(button.background).toBe(button.targetBackground);
    expect(button.color).toBe(button.targetColor);
  }
  await test
    .info()
    .attach("dark-buttons-computed", {
      body: JSON.stringify({ immediate, settled }, null, 2),
      contentType: "application/json",
    });
  await page.screenshot({
    path: "test-results/task4-collections-dark.png",
    fullPage: true,
  });
  await page.getByLabel("Scénario fictif").selectOption("missing-page");
  await page.getByRole("button", { name: "Lancer la simulation" }).click();
  await expect(page.getByRole("status")).toContainText("Partiel");
  await expect(page.getByText(/page-2-frontiere-inconnue/)).toBeVisible();
  await page.getByLabel("Scénario fictif").selectOption("interrupted");
  await page.getByRole("button", { name: "Lancer la simulation" }).click();
  await expect(page.getByRole("status")).toContainText("Tentatives : 2");
  await expect(page.getByRole("status")).toContainText("Complet");
  await page.getByText("Journal de progression et reprise").click();
  await expect(
    page.getByText("Reprise au dernier point durable."),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Tentatives : 2");
  await page.getByRole("link", { name: "Documents", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Documents", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Collecte simulée" }),
  ).not.toBeVisible();
});
test("Task3 M1 : nom avec espaces validé dans les deux parties du transfert navigateur", async ({
  page,
}) => {
  const dossier = await (
    await page.request.post("/api/v1/records", {
      headers: { origin },
      data: {
        operationId: crypto.randomUUID(),
        record: { kind: "dossier", title: "Nom de fichier fictif", data: {} },
      },
    })
  ).json();
  await page.goto("/#documents");
  await page
    .getByRole("button", { name: "Ajouter une pièce", exact: true })
    .click();
  await page.getByLabel("Dossier de la pièce").selectOption(dossier.id);
  await page.getByLabel("Fichier original").setInputFiles({
    name: "  espaces-fictifs.txt  ",
    mimeType: "text/plain",
    buffer: Buffer.from("Espaces validés fictifs"),
  });
  await page
    .getByRole("button", { name: "Conserver la pièce", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Télécharger espaces-fictifs.txt v1",
      exact: true,
    }),
  ).toBeVisible();
  const file = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Télécharger espaces-fictifs.txt v1",
      exact: true,
    })
    .click();
  expect(await readFile((await (await file).path())!, "utf8")).toBe(
    "Espaces validés fictifs",
  );
});

test("Collectes : navigation et expiration de session écartent les réponses obsolètes", async ({
  page,
}) => {
  const catalogue = await (
    await page.request.get("/api/v1/collections/catalogue")
  ).json();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const requested = new Promise<void>((resolve) => {
    entered = resolve;
  });
  await page.route("**/api/v1/collections/catalogue", async (route) => {
    entered();
    await pending;
    await route.fulfill({ json: catalogue }).catch(() => {});
  });
  await page.goto("/#collectes");
  await requested;
  await page.getByRole("link", { name: "Accueil", exact: true }).click();
  release();
  await expect(
    page.getByRole("heading", { name: "Accueil", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Collecteur", { exact: true }),
  ).not.toBeVisible();
  await page.unroute("**/api/v1/collections/catalogue");
  await page.route("**/api/v1/collections/catalogue", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "UNAUTHENTICATED", message: "Session expirée." } },
    }),
  );
  await page.getByRole("link", { name: "Collectes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Se connecter", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Collecte simulée" }),
  ).not.toBeVisible();
});
