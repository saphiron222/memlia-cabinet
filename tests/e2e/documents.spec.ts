import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  CreateRecordInputSchema,
  DocumentListSchema,
  SetupStatusSchema,
} from "@memlia/contracts";
const origin = "http://127.0.0.1:4173";
test("GED : import, erreurs, recherche, versions, téléchargement et pièces du dossier au clavier", async ({
  page,
}) => {
  const setup = SetupStatusSchema.parse(
    await (await page.request.get("/api/v1/setup")).json(),
  );
  const credentials = {
    email: "camille@example.test",
    password: "Exemple-fictif-2026",
  };
  if (setup.needsSetup)
    await page.request.post("/api/v1/setup", {
      headers: { origin },
      data: { ...credentials, name: "Camille Fictive" },
    });
  else
    await page.request.post("/api/v1/login", {
      headers: { origin },
      data: credentials,
    });
  const dossier = await (
    await page.request.post("/api/v1/records", {
      headers: { origin },
      data: CreateRecordInputSchema.parse({
        operationId: crypto.randomUUID(),
        record: { kind: "dossier", title: "Dossier GED fictif", data: {} },
      }),
    })
  ).json();
  await page.goto("/#documents");
  await expect(
    page.getByRole("heading", { name: "Documents", exact: true }),
  ).toBeVisible();
  const opener = page.getByRole("button", {
    name: "Ajouter une pièce",
    exact: true,
  });
  await opener.click();
  await page
    .getByRole("button", { name: "Conserver la pièce", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeFocused();
  await page.getByRole("link", { name: /Fichier original/ }).click();
  await expect(page.getByLabel("Fichier original")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await opener.click();
  await page.getByLabel("Dossier de la pièce").selectOption(dossier.id);
  await page
    .getByLabel("Fichier original")
    .setInputFiles({
      name: "faux.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("<html>Connexion fictive</html>"),
    });
  await page
    .getByRole("button", { name: "Conserver la pièce", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("PDF");
  await expect(page.getByLabel("Fichier original")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page
    .getByLabel("Fichier original")
    .setInputFiles({
      name: "notes-fictives.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("orchidée locale fictive"),
    });
  await page
    .getByRole("button", { name: "Conserver la pièce", exact: true })
    .click();
  await expect(page.getByText("Texte indexé")).toBeVisible();
  await page.getByLabel("Rechercher dans les pièces").fill("orchidée");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page
    .getByRole("button", {
      name: "Nouvelle version de notes-fictives.txt v1",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Fichier original")
    .setInputFiles({
      name: "notes-fictives.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("orchidée révisée fictive"),
    });
  await page
    .getByRole("button", { name: "Conserver la pièce", exact: true })
    .click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Télécharger notes-fictives.txt v2",
      exact: true,
    })
    .click();
  const file = await downloaded;
  expect(await readFile((await file.path())!, "utf8")).toBe(
    "orchidée révisée fictive",
  );
  const list = DocumentListSchema.parse(
    await (
      await page.request.get("/api/v1/documents?dossierId=" + dossier.id)
    ).json(),
  );
  expect(list.items).toHaveLength(2);
  expect(list.items[1]!.previousVersionId).toBe(list.items[0]!.id);
  expect(
    await page
      .locator("tbody tr")
      .first()
      .evaluate((e) => e.getBoundingClientRect().height),
  ).toBe(32);
  await page.screenshot({
    path: "test-results/task3-documents-light.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Activer le thème sombre" }).click();
  await page.screenshot({
    path: "test-results/task3-documents-dark.png",
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Télécharger notes-fictives.txt v2",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Dossiers", exact: true }).click();
  await page
    .getByRole("button", { name: "Dossier GED fictif", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Pièces du dossier" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Télécharger notes-fictives.txt v2",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Ajouter une pièce", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ajouter une pièce", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
