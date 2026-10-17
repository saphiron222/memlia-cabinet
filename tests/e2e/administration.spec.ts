import { test, expect } from "@playwright/test";
const origin = "http://127.0.0.1:4181";
test.use({ baseURL: origin });
test("administration : rôle ordonné, utilisateur, équipe/site, affectation et retrait en interface", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Nom complet").fill("Admin administration fictive");
  await page.getByLabel("Adresse email").fill("admin-gestion@example.test");
  await page.getByLabel("Mot de passe").fill("MotDePasseFictif123!");
  await page.getByRole("button", { name: "Créer le cabinet" }).click();
  await page.getByRole("link", { name: "Dossiers", exact: true }).click();
  await page.getByRole("button", { name: "Créer un dossier" }).click();
  await page
    .getByLabel("Titre", { exact: true })
    .fill("Dossier affectation fictive");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("button", { name: "Fermer la fiche" }).click();
  await page.getByRole("link", { name: "Administration", exact: true }).click();
  await page.getByLabel("Nom du rôle").fill("Lecteur local");
  await page.getByLabel("Ordre", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Ajouter la permission" }).click();
  await page.getByRole("button", { name: "Enregistrer le rôle" }).click();
  await expect(
    page.getByRole("button", { name: "3 · Lecteur local" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Utilisateurs", exact: true }).click();
  await page.getByLabel("Nom de l’utilisateur").fill("Utilisateur fictif");
  await page
    .getByLabel("Email de l’utilisateur")
    .fill("gestion-user@example.test");
  await page.getByLabel("Mot de passe initial").fill("MotDePasseFictif123!");
  await page.getByRole("button", { name: "Créer l’utilisateur" }).click();
  await expect(
    page.getByRole("button", { name: "Utilisateur fictif", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Équipes et sites", exact: true })
    .click();
  await page.getByLabel("Nom du groupe").fill("Paris fictif");
  await page.getByLabel("Type de groupe").selectOption("site");
  await page
    .getByRole("checkbox", { name: "Utilisateur fictif", exact: true })
    .check();
  await page.getByRole("button", { name: "Enregistrer le groupe" }).click();
  await expect(
    page.getByRole("button", { name: "Site · Paris fictif" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Affectations", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Dossier affectation fictive" })
    .check();
  await page
    .getByLabel("Utilisateur, équipe ou site")
    .selectOption({ label: "Site · Paris fictif" });
  await page
    .getByLabel("Rôle sur les dossiers")
    .selectOption({ label: "Lecteur local" });
  await page
    .getByRole("button", { name: "Appliquer aux dossiers choisis" })
    .click();
  await expect(page.getByLabel("Rapport des affectations")).toContainText(
    "affecté",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Équipes et sites", exact: true })
    .click();
  await page.getByRole("button", { name: "Site · Paris fictif" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Utilisateur fictif", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("checkbox", { name: "Utilisateur fictif", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Enregistrer le groupe" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Configuration enregistrée",
  );
  await page.screenshot({
    path: "test-results/task1-administration.png",
    fullPage: true,
  });
});

test("utilisateur ordinaire : rôle limité au dossier, édition et pièce permises, autre dossier en lecture seule", async ({
  page,
}) => {
  await page.request.post("/api/v1/login", {
    headers: { Origin: origin },
    data: {
      email: "admin-gestion@example.test",
      password: "MotDePasseFictif123!",
    },
  });
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post("/api/v1" + path, {
      headers: { Origin: origin },
      data,
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const a = await post("/records", {
    operationId: crypto.randomUUID(),
    record: {
      kind: "dossier",
      title: "Dossier modifiable ordinaire",
      data: { siren: "001234567" },
    },
  });
  const b = await post("/records", {
    operationId: crypto.randomUUID(),
    record: {
      kind: "dossier",
      title: "Dossier lecture seule ordinaire",
      data: { siren: "009876543" },
    },
  });
  const role = await post("/administration/roles", {
    operationId: crypto.randomUUID(),
    name: "Gestion locale ordinaire",
    order: 4,
    permissions: ["read", "update", "export", "audit", "assign", "create"].map(
      (action) => ({ action, kind: "*", dossierId: null }),
    ),
  });
  const reader = await post("/users", {
    operationId: crypto.randomUUID(),
    name: "Ordinaire fictif",
    email: "ordinaire@example.test",
    password: "MotDePasseFictif123!",
    permissions: [{ action: "read", kind: "dossier", dossierId: b.id }],
  });
  await post("/administration/assignments", {
    operationId: crypto.randomUUID(),
    rows: [
      {
        dossierId: a.id,
        expectedVersion: 1,
        subject: { kind: "user", id: reader.id },
        roleId: role.id,
        remove: false,
      },
    ],
  });
  await page.request.post("/api/v1/logout", {
    headers: { Origin: origin },
    data: {},
  });
  await page.goto("/");
  await page.getByLabel("Adresse email").fill("ordinaire@example.test");
  await page.getByLabel("Mot de passe").fill("MotDePasseFictif123!");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByRole("link", { name: "Dossiers", exact: true }).click();
  await page
    .getByRole("button", { name: "Dossier modifiable ordinaire", exact: true })
    .click();
  await expect(page.getByLabel("Forme juridique")).toBeEnabled();
  await page.getByLabel("Forme juridique").fill("SARL fictive");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Modifications enregistrées.")).toBeVisible();
  await page
    .getByRole("button", { name: "Ajouter une pièce", exact: true })
    .click();
  await page.getByLabel("Fichier original").setInputFiles({
    name: "ordinaire.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Document fictif rôle local"),
  });
  await page.getByRole("button", { name: "Conserver la pièce" }).click();
  await expect(
    page.getByRole("button", { name: "Télécharger ordinaire.txt v1" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fermer la fiche" }).click();
  await page.getByRole("link", { name: "Tâches", exact: true }).click();
  await page
    .getByRole("button", { name: "Créer une tâche", exact: true })
    .click();
  await page
    .getByLabel("Titre", { exact: true })
    .fill("Tâche affectée ordinaire");
  await page
    .getByLabel("Dossier lié")
    .selectOption({ label: "Dossier modifiable ordinaire" });
  await page
    .getByRole("checkbox", { name: "Ordinaire fictif", exact: true })
    .check();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Modifications enregistrées.")).toBeVisible();
  await page.getByRole("button", { name: "Fermer la fiche" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter en CSV" }).click();
  await download;
  await page.getByRole("link", { name: "Dossiers", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Dossier lecture seule ordinaire",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Forme juridique")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Ajouter une pièce", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Enregistrer", exact: true }),
  ).toHaveCount(0);
});
