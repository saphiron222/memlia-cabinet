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
  // Hold the real refresh response so confirmation and loading coexist deterministically.
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  await page.route("**/api/v1/administration/groups", async (route) => {
    const response = await route.fetch();
    await refreshGate;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("button", { name: "Enregistrer le groupe" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Chargement de l’administration" }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(2);
    await expect(
      page.getByRole("status").filter({ hasText: "Configuration enregistrée" }),
    ).toHaveText(
      "Configuration enregistrée. Les droits prennent effet à la prochaine commande.",
    );
  } finally {
    releaseRefresh();
    await page.unrouteAll({ behavior: "wait" });
  }
  await expect(
    page.getByRole("button", { name: "Site · Paris fictif" }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Équipes et sites", exact: true })
    .click();
  await page.getByRole("button", { name: "Site · Paris fictif" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Utilisateur fictif", exact: true }),
  ).not.toBeChecked();
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
  await expect(
    page.getByLabel("Forme juridique", { exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Forme juridique", { exact: true })
    .fill("SARL fictive");
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
    .getByLabel("Dossier lié", { exact: true })
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
  await expect(
    page.getByLabel("Forme juridique", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Ajouter une pièce", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Enregistrer", exact: true }),
  ).toHaveCount(0);
});

test("référentiel : champ personnalisé, établissement, contact lié et détection manuelle", async ({
  page,
}) => {
  await page.request.post("/api/v1/login", {
    headers: { Origin: origin },
    data: {
      email: "admin-gestion@example.test",
      password: "MotDePasseFictif123!",
    },
  });
  await page.goto("/#administration");
  await page
    .getByRole("button", { name: "Champs personnalisés", exact: true })
    .click();
  await page.getByLabel("Libellé du champ").fill("Effectif interface");
  await page.getByLabel("Type de valeur").selectOption("number");
  await page
    .getByRole("button", { name: "Enregistrer le champ", exact: true })
    .click();
  await expect(
    page.getByText(
      "Champ enregistré ; les identités et les valeurs compatibles sont conservées.",
    ),
  ).toBeVisible();
  await page.getByRole("link", { name: "Dossiers", exact: true }).click();
  await page
    .getByRole("button", { name: "Créer un dossier", exact: true })
    .click();
  await page
    .getByLabel("Titre", { exact: true })
    .fill("Référentiel complet fictif");
  await page.getByLabel("Effectif interface", { exact: true }).fill("0");
  await page.getByLabel("SIREN", { exact: true }).fill("003456789");
  await page.getByLabel("Capital", { exact: true }).fill("0.00");
  await page.getByRole("button", { name: "Ajouter un établissement" }).click();
  await page.getByLabel("SIRET 1").fill("00345678900012");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Modifications enregistrées.")).toBeVisible();
  await page.getByRole("button", { name: "Fermer la fiche" }).click();
  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  await page
    .getByRole("button", { name: "Créer un contact", exact: true })
    .click();
  await page.getByLabel("Titre", { exact: true }).fill("Contact lié fictif");
  await page
    .getByLabel("Dossier lié", { exact: true })
    .selectOption({ label: "Référentiel complet fictif" });
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Ouvrir le dossier lié 1" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Ouvrir le dossier lié 1" }).click();
  await expect(page.getByLabel("Titre", { exact: true })).toHaveValue(
    "Référentiel complet fictif",
  );
  await expect(
    page.getByLabel("Effectif interface", { exact: true }),
  ).toHaveValue("0");
  await expect(page.getByLabel("SIRET 1")).toHaveValue("00345678900012");
  await page.getByRole("button", { name: "Fermer la fiche" }).click();
  await page
    .getByText("Recherche d’entreprise et dossiers détectés", { exact: true })
    .click();
  await page
    .getByText("Simulation locale d’une détection fournisseur", { exact: true })
    .click();
  await page
    .getByLabel("Nom fictif", { exact: true })
    .fill("Détection interface fictive");
  await page.getByLabel("SIREN fictif").fill("004567890");
  await page
    .getByLabel("Identité de source fictive stable")
    .fill("interface-test");
  await page
    .getByRole("button", { name: "Simuler la détection", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Examiner Détection interface fictive" })
    .click();
  await page.getByRole("button", { name: "Créer le dossier proposé" }).click();
  await expect(
    page.getByRole("button", {
      name: "Détection interface fictive",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Masquer Détection interface fictive" })
    .click();
  await page.getByLabel("Afficher les détections masquées").check();
  await page
    .getByRole("button", { name: "Restaurer Détection interface fictive" })
    .click();
  await page.getByLabel("Afficher les détections masquées").uncheck();
  await expect(
    page.getByRole("button", { name: "Examiner Détection interface fictive" }),
  ).toBeVisible();
  await page
    .getByLabel("Sélectionner Détection interface fictive", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Masquer la sélection", exact: true })
    .click();
  await expect(
    page.getByRole("list", { name: "Rapport des décisions" }),
  ).toContainText("décision conservée");
  await page.getByLabel("Afficher les détections masquées").check();
  await page
    .getByLabel("Sélectionner Détection interface fictive", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Restaurer la sélection", exact: true })
    .click();
  await page.getByLabel("Afficher les détections masquées").uncheck();
  await expect(
    page.getByRole("button", { name: "Examiner Détection interface fictive" }),
  ).toBeVisible();
});

test("reprise en interface : mapping CSV, choix persistant, engagement et rapport", async ({
  page,
}) => {
  await page.request.post("/api/v1/login", {
    headers: { Origin: origin },
    data: {
      email: "admin-gestion@example.test",
      password: "MotDePasseFictif123!",
    },
  });
  await page.goto("/#imports");
  await page.getByLabel("Fichier de reprise", { exact: true }).setInputFiles({
    name: "reprise-interface.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "SIREN;Nom;Capital\n005678901;Dossier repris interface;0.00\n123;Ligne incorrecte;9.00\n",
    ),
  });
  await page.getByRole("button", { name: "Préparer l’aperçu" }).click();
  await page.getByLabel("Colonne SIREN").selectOption("siren");
  await page.getByLabel("Colonne Nom").selectOption("title");
  await page.getByLabel("Colonne Capital").selectOption("capital");
  await page.getByRole("button", { name: "Actualiser l’aperçu" }).click();
  await page
    .getByRole("button", { name: "Retenir ligne 2", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Écarter ligne 2", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retenir ligne 3", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: /reprise-interface.csv ·/ }).click();
  await expect(
    page.getByRole("button", { name: "Écarter ligne 2", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Engager les lignes retenues" })
    .click();
  await expect(page.getByText(/Traitement terminé/)).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Lignes de reprise" }),
  ).toContainText("Créée");
  const download = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Exporter le rapport des lignes" })
    .click();
  await download;
  await page.getByRole("link", { name: "Dossiers", exact: true }).click();
  await page
    .getByRole("button", { name: "Dossier repris interface", exact: true })
    .click();
  await expect(page.getByLabel("SIREN", { exact: true })).toHaveValue(
    "005678901",
  );
  await expect(page.getByLabel("Capital", { exact: true })).toHaveValue("0.00");
});

test("compte et capacités : préférences conservées, autre compte indépendant, GED désactivée sans perte", async ({
  page,
}) => {
  await page.request.post("/api/v1/login", {
    headers: { Origin: origin },
    data: {
      email: "admin-gestion@example.test",
      password: "MotDePasseFictif123!",
    },
  });
  await page.goto("/#compte");
  await page.getByLabel("Thème de l’interface").selectOption("dark");
  await expect(page.locator("html")).toHaveClass("dark");
  await page.getByLabel("Densité des tableaux").selectOption("compact");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await page.reload();
  await expect(page.getByLabel("Thème de l’interface")).toHaveValue("dark");
  await expect(page.getByLabel("Densité des tableaux")).toHaveValue("compact");
  await page.getByRole("link", { name: "Administration", exact: true }).click();
  await page
    .getByRole("button", { name: "Installation et capacités", exact: true })
    .click();
  await page
    .getByLabel("Nom du cabinet", { exact: true })
    .fill("Cabinet interface fictif");
  await page
    .getByLabel("Activer Documents du cabinet", { exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "Appliquer les capacités du cabinet" })
    .click();
  await expect(
    page.getByText(
      "Paramètres appliqués. Les opérations suivantes recontrôlent les capacités activées.",
    ),
  ).toBeVisible();
  await page.getByRole("link", { name: "Documents", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Ajouter une pièce", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Télécharger ordinaire.txt v1" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Se déconnecter", exact: true })
    .click();
  await page.getByLabel("Adresse email").fill("ordinaire@example.test");
  await page.getByLabel("Mot de passe").fill("MotDePasseFictif123!");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByRole("link", { name: "Mon compte", exact: true }).click();
  await expect(page.getByLabel("Thème de l’interface")).toHaveValue("system");
  await expect(page.getByLabel("Densité des tableaux")).toHaveValue("normal");
});

test("tableau de bord : période, détail et export concordants, vue et ordre personnels", async ({
  page,
}) => {
  await page.request.post("/api/v1/login", {
    headers: { Origin: origin },
    data: {
      email: "admin-gestion@example.test",
      password: "MotDePasseFictif123!",
    },
  });
  const post = async (data: object) => {
    const r = await page.request.post("/api/v1/records", {
      headers: { Origin: origin },
      data: { operationId: crypto.randomUUID(), record: data },
    });
    expect(r.status()).toBe(201);
    return r.json();
  };
  const dossier = await post({
    kind: "dossier",
    title: "Dossier synthèse fictive",
    dossierId: null,
    confidential: false,
    data: {},
  });
  for (const [title, dueDate, state] of [
    ["Alpha échéance juin", "2026-06-01", "en_cours"],
    ["Bêta échéance juin", "2026-06-20", "a_faire"],
    ["Échéance juillet", "2026-07-01", "a_faire"],
  ])
    await post({
      kind: "tache",
      title,
      dossierId: dossier.id,
      confidential: false,
      data: { dueDate, state },
    });
  await page.goto("/");
  await page.getByLabel("Du", { exact: true }).fill("2026-06-01");
  await page.getByLabel("Au", { exact: true }).fill("2026-06-30");
  await page
    .getByLabel("Dossier du filtre", { exact: true })
    .selectOption(dossier.id);
  await expect(
    page.getByRole("region", { name: "Progression des tâches", exact: true }),
  ).toContainText("2 tâches ouvertes");
  await expect(
    page.getByRole("link", { name: "En cours : 1", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Monter Progression des tâches", exact: true })
    .click();
  await expect(page.locator(".dashboard-widget").first()).toHaveAttribute(
    "aria-label",
    "Progression des tâches",
  );
  const download = page.waitForEvent("download");
  await page
    .getByRole("region", { name: "Progression des tâches", exact: true })
    .getByRole("link", { name: "Exporter En cours", exact: true })
    .click();
  const exported = await download;
  const stream = await exported.createReadStream();
  let text = "";
  for await (const chunk of stream!) text += chunk.toString();
  expect(text).toContain("Alpha échéance juin");
  expect(text).not.toContain("Bêta échéance juin");
  expect(text).not.toContain("Échéance juillet");
  await page.getByRole("link", { name: "En cours : 1", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Alpha échéance juin", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bêta échéance juin", exact: true }),
  ).toHaveCount(0);
  await page
    .getByText("Filtres, colonnes et vues enregistrées", { exact: true })
    .click();
  await page.getByLabel("Ordre de tri").selectOption("desc");
  await page.getByLabel("Lignes par page").selectOption("10");
  await page.getByLabel("Nom de la vue").fill("Juin en cours");
  await page
    .getByRole("button", { name: "Enregistrer une nouvelle vue", exact: true })
    .click();
  await expect(page.getByLabel("Mes vues")).not.toHaveValue("");
  await page.reload();
  await page
    .getByText("Filtres, colonnes et vues enregistrées", { exact: true })
    .click();
  await page.getByLabel("Mes vues").selectOption({ label: "Juin en cours" });
  await expect(page.getByLabel("Ordre de tri")).toHaveValue("desc");
  await expect(page.getByLabel("Lignes par page")).toHaveValue("10");
  await page.getByLabel("Nom de la vue").fill("Juin suivi");
  await page
    .getByRole("button", { name: "Mettre à jour cette vue", exact: true })
    .click();
  await expect(
    page.getByLabel("Mes vues").locator("option:checked"),
  ).toHaveText("Juin suivi");
  await page
    .getByRole("button", { name: "Supprimer cette vue", exact: true })
    .click();
  await expect(page.getByLabel("Mes vues")).toHaveValue("");
  await page.goto("/");
  await expect(page.locator(".dashboard-widget").first()).toHaveAttribute(
    "aria-label",
    "Progression des tâches",
  );
  await page
    .getByRole("checkbox", { name: "Préparation des obligations", exact: true })
    .uncheck();
  await expect(
    page.getByRole("checkbox", {
      name: "Préparation des obligations",
      exact: true,
    }),
  ).toBeEnabled();
  await page.reload();
  await expect(
    page.getByRole("region", {
      name: "Préparation des obligations",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "Préparation des obligations", exact: true })
    .check();
  await expect(
    page.getByRole("region", {
      name: "Préparation des obligations",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/task1-dashboard.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Se déconnecter", exact: true })
    .click();
  await page.getByLabel("Adresse email").fill("ordinaire@example.test");
  await page.getByLabel("Mot de passe").fill("MotDePasseFictif123!");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.locator(".dashboard-widget").first()).toHaveAttribute(
    "aria-label",
    "Synthèse",
  );
});

test("sortie complète : préparation visible, manifeste et partie téléchargeables", async ({
  page,
}) => {
  await page.request.post("/api/v1/login", {
    headers: { Origin: origin },
    data: {
      email: "admin-gestion@example.test",
      password: "MotDePasseFictif123!",
    },
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Mon compte", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Préparer la sortie complète en JSON",
      exact: true,
    })
    .click();
  await expect(page.getByText("Sortie prête", { exact: false })).toBeVisible();
  const manifestDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Télécharger le manifeste", exact: true })
    .click();
  const manifestStream = await (await manifestDownload).createReadStream();
  let manifestText = "";
  for await (const chunk of manifestStream!) manifestText += chunk.toString();
  const manifest = JSON.parse(manifestText);
  expect(manifest.format).toBe("memlia-cabinet-manifest-1");
  expect(manifest.parts.length).toBeGreaterThan(0);
  const partDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: /Télécharger la partie 1 \(/ })
    .click();
  const partStream = await (await partDownload).createReadStream();
  let partText = "";
  for await (const chunk of partStream!) partText += chunk.toString();
  expect(
    JSON.parse(partText).records.map((r: { title: string }) => r.title),
  ).toContain("Dossier synthèse fictive");
  await page.getByRole("link", { name: "Dossiers", exact: true }).click();
  await page
    .getByRole("button", { name: "Exporter en CSV", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Préparation CSV de cette vue",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Préparer le CSV de cette vue", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Télécharger le manifeste", exact: true }),
  ).toBeVisible();
  const csvManifestDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Télécharger le manifeste", exact: true })
    .click();
  await csvManifestDownload;
  const csvDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: /Télécharger la partie 1 \(/ })
    .click();
  const csvStream = await (await csvDownload).createReadStream();
  let csvText = "";
  for await (const chunk of csvStream!) csvText += chunk.toString();
  expect(csvText).toContain("Dossier synthèse fictive");
});

test("champs des vues : chargement, indisponibilité, refus, reprise et absence explicites", async ({
  page,
}) => {
  const credentials = {
    email: "admin-gestion@example.test",
    name: "Admin administration fictive",
    password: "MotDePasseFictif123!",
  };
  await page.request.post("/api/v1/setup", {
    headers: { Origin: origin },
    data: credentials,
  });
  expect(
    (
      await page.request.post("/api/v1/login", {
        headers: { Origin: origin },
        data: { email: credentials.email, password: credentials.password },
      })
    ).status(),
  ).toBe(200);
  const field = await page.request.post("/api/v1/administration/fields", {
    headers: { Origin: origin },
    data: {
      operationId: crypto.randomUUID(),
      name: "Repère reprise fictif",
      kind: "dossier",
      type: "text",
      placement: "information",
      choices: [],
    },
  });
  expect(field.status()).toBe(201);
  const fieldId = (await field.json()).id;
  expect(
    (
      await page.request.post("/api/v1/records", {
        headers: { Origin: origin },
        data: {
          operationId: crypto.randomUUID(),
          record: {
            kind: "dossier",
            title: "Fiche reprise colonnes",
            data: { customFields: { [fieldId]: "Valeur retrouvée" } },
          },
        },
      })
    ).status(),
  ).toBe(201);

  let mode = "waiting",
    calls = 0,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/administration/fields", async (route) => {
    calls++;
    if (mode === "waiting") {
      await gate;
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: "UNAVAILABLE",
            message: "Référentiel temporairement indisponible.",
          },
        },
      });
    }
    if (mode === "forbidden")
      return route.fulfill({
        status: 403,
        json: { error: { code: "FORBIDDEN", message: "Lecture interdite." } },
      });
    if (mode === "empty")
      return route.fulfill({ status: 200, json: { items: [] } });
    return route.continue();
  });
  await page.goto("/#dossier");
  await expect(
    page.getByText("Chargement des champs personnalisés…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Aucun champ personnalisé pour ce type de fiche.", {
      exact: true,
    }),
  ).toHaveCount(0);
  release();
  await expect(
    page.getByText(
      "Champs personnalisés indisponibles : Référentiel temporairement indisponible.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByText("Filtres, colonnes et vues enregistrées", { exact: true })
    .click();
  await expect(
    page.getByText("Colonnes personnalisées non chargées.", { exact: true }),
  ).toBeVisible();
  mode = "forbidden";
  await page
    .getByRole("button", {
      name: "Réessayer les champs personnalisés",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Champs personnalisés : accès refusé.", { exact: true }),
  ).toBeVisible();
  mode = "success";
  await page
    .getByRole("button", {
      name: "Réessayer les champs personnalisés",
      exact: true,
    })
    .click();
  await page
    .getByRole("checkbox", {
      name: "Afficher la colonne Repère reprise fictif",
      exact: true,
    })
    .check();
  await expect(
    page.getByText("Colonnes personnalisées non chargées.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("columnheader", {
      name: "Repère reprise fictif",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Valeur retrouvée", exact: true }),
  ).toBeVisible();
  expect(calls).toBe(3);
  mode = "empty";
  await page.reload();
  await expect(
    page.getByText("Aucun champ personnalisé pour ce type de fiche.", {
      exact: true,
    }),
  ).toBeVisible();
  // A response from the previous record kind cannot replace the new screen.
  let finishLate!: () => void, lateDone!: () => void;
  const waitLate = new Promise<void>((resolve) => {
    finishLate = resolve;
  });
  const finishedLate = new Promise<void>((resolve) => {
    lateDone = resolve;
  });
  await page.unroute("**/api/v1/administration/fields");
  let late = true;
  await page.route("**/api/v1/administration/fields", async (route) => {
    if (!late) return route.fulfill({ status: 200, json: { items: [] } });
    await waitLate;
    try {
      await route.fulfill({
        status: 503,
        json: {
          error: { code: "LATE", message: "Ancienne réponse à ignorer." },
        },
      });
    } finally {
      lateDone();
    }
  });
  await page.reload();
  await expect(
    page.getByText("Chargement des champs personnalisés…", { exact: true }),
  ).toBeVisible();
  late = false;
  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  await expect(
    page.getByText("Aucun champ personnalisé pour ce type de fiche.", {
      exact: true,
    }),
  ).toBeVisible();
  finishLate();
  await finishedLate;
  await expect(page.getByText(/Ancienne réponse à ignorer/)).toHaveCount(0);
});
