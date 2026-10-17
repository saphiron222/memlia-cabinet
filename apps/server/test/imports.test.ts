import { afterEach, expect, test } from "vitest";
import { fixture, operationId } from "./helpers.js";
let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
});
test("reprise CSV : colonnes réordonnées, erreurs explicites, acceptation durable et engagement sans doublon", async () => {
  f = await fixture();
  await f.setup();
  const response = await f.request("POST", "/imports/preview", {
    operationId: operationId(),
    filename: "dossiers-fictifs.csv",
    format: "csv",
    kind: "dossier",
    delimiter: ";",
    bytes: Buffer.from(
      "Capital;Nom;SIREN;TVA;Début\n0.00;Première fictive;001234567;reel_normal;\n2.50;Erreur fictive;123;inconnu;2026-02-30\n",
    ).toString("base64"),
    mapping: {
      "0": "capital",
      "1": "title",
      "2": "siren",
      "3": "vatRegime",
      "4": "startedOn",
    },
  });
  expect(response.statusCode).toBe(201);
  const preview = response.json();
  expect(preview.total).toBe(2);
  const rows = (await f.request("GET", `/imports/${preview.id}/rows`)).json()
    .items;
  expect(rows[0].record.data).toMatchObject({
    siren: "001234567",
    capital: "0.00",
    startedOn: null,
  });
  expect(rows[1].errors.length).toBeGreaterThan(0);
  const selected = await f.request("PUT", `/imports/${preview.id}/selection`, {
    operationId: operationId(),
    expectedVersion: preview.version,
    rows: [{ lineId: rows[0].lineId, accepted: true }],
  });
  expect(selected.statusCode).toBe(200);
  await f.restart();
  expect(
    (await f.request("GET", `/imports/${preview.id}/rows`)).json().items[0]
      .accepted,
  ).toBe(true);
  const input = {
    operationId: operationId(),
    expectedVersion: selected.json().version,
    sourceHash: preview.sourceHash,
    lineIds: [rows[0].lineId],
  };
  const committed = await f.request(
    "POST",
    `/imports/${preview.id}/commit`,
    input,
  );
  expect(committed.statusCode).toBe(202);
  let state;
  for (let n = 0; n < 100; n++) {
    state = (await f.request("GET", `/imports/${preview.id}`)).json();
    if (state.state === "completed") break;
    await new Promise((r) => setTimeout(r, 30));
  }
  expect(state.state).toBe("completed");
  expect(
    (await f.request("POST", `/imports/${preview.id}/commit`, input)).json()
      .jobId,
  ).toBe(committed.json().jobId);
  expect((await f.request("GET", "/records?kind=dossier")).json().total).toBe(
    1,
  );
  expect(
    (await f.request("GET", `/imports/${preview.id}/report.csv`)).body,
  ).toContain("refused");
});

test("reprise XLSX réelle : identifiants textuels, nombres exacts, dates 1900/1904 et refus formules/externes/quotas", async () => {
  f = await fixture();
  await f.setup();
  const { xlsxFixture } = await import("./xlsx-fixture.js");
  const preview = (bytes: Buffer) =>
    f.request("POST", "/imports/preview", {
      operationId: operationId(),
      filename: "fictif.xlsx",
      format: "xlsx",
      kind: "dossier",
      bytes: bytes.toString("base64"),
      mapping: { "0": "title", "1": "siren", "2": "capital", "3": "startedOn" },
    });
  const valid = await preview(
    xlsxFixture([
      ["Nom", "SIREN", "Capital", "Début"],
      [
        "Excel fictif",
        "001234567",
        { type: "number", value: "0.00" },
        { type: "date", value: "46176" },
      ],
    ]),
  );
  expect(valid.statusCode).toBe(201);
  const row = (
    await f.request("GET", `/imports/${valid.json().id}/rows`)
  ).json().items[0];
  expect(row.errors).toEqual([]);
  expect(row.record.data).toMatchObject({
    siren: "001234567",
    capital: "0.00",
    startedOn: "2026-06-03",
  });
  const epoch = await preview(
    xlsxFixture(
      [
        ["Nom", "SIREN", "Capital", "Début"],
        [
          "Époque fictive",
          "002345678",
          { type: "number", value: "0" },
          { type: "date", value: "1" },
        ],
      ],
      { epoch1904: true },
    ),
  );
  expect(epoch.statusCode).toBe(201);
  expect(
    (await f.request("GET", `/imports/${epoch.json().id}/rows`)).json().items[0]
      .record.data.startedOn,
  ).toBe("1904-01-02");
  const numeric = await preview(
    xlsxFixture([
      ["Nom", "SIREN", "Capital", "Début"],
      ["Zéros perdus", { type: "number", value: "1234567" }, "", ""],
    ]),
  );
  expect(numeric.statusCode).toBe(201);
  expect(
    (await f.request("GET", `/imports/${numeric.json().id}/rows`))
      .json()
      .items[0].errors.join(" "),
  ).toContain("identifiant attendu en texte");
  for (const [bytes, code] of [
    [
      xlsxFixture([["Nom"], [{ type: "formula", value: "2" }]]),
      "FORMULA_FORBIDDEN",
    ],
    [
      xlsxFixture([["Nom"], ["Externe"]], { external: true }),
      "EXTERNAL_RELATION_FORBIDDEN",
    ],
    [
      xlsxFixture([["Nom"], ["Limite"]], { dimension: "A1:XFD1048576" }),
      "COLUMN_LIMIT",
    ],
    [
      xlsxFixture([["Nom"], ["Macro"]], {
        extra: { "xl/vbaProject.bin": "fictif" },
      }),
      "UNSUPPORTED_XLSX_PART",
    ],
    [Buffer.from("Nom;SIREN\nRenommé;001234567"), "INVALID_FILE"],
  ] as const) {
    const r = await preview(bytes);
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe(code);
  }
});

test("reprise : différence explicitement approuvée, conflit concurrent et doublon contact", async () => {
  f = await fixture();
  await f.setup();
  const original = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "contact",
        title: "Contact fictif",
        data: { email: "contact@example.test", phone: "ancien" },
      },
    })
  ).json();
  const response = await f.request("POST", "/imports/preview", {
    operationId: operationId(),
    filename: "contacts.csv",
    format: "csv",
    kind: "contact",
    bytes: Buffer.from(
      "Nom;Email;Téléphone\nContact fictif;contact@example.test;nouveau\nContact fictif;contact@example.test;autre\n",
    ).toString("base64"),
    mapping: { "0": "title", "1": "email", "2": "phone" },
  });
  expect(response.statusCode).toBe(201);
  const p = response.json(),
    rows = (await f.request("GET", `/imports/${p.id}/rows`)).json().items;
  expect(rows[0].duplicate).toBe(true);
  expect(rows[0].changes).toEqual([
    { field: "phone", before: "ancien", after: "nouveau" },
  ]);
  const select = {
    operationId: operationId(),
    expectedVersion: p.version,
    rows: [{ lineId: rows[0].lineId, accepted: true }],
  };
  expect(
    (await f.request("PUT", `/imports/${p.id}/selection`, select)).statusCode,
  ).toBe(409);
  const selected = (
    await f.request("PUT", `/imports/${p.id}/selection`, {
      ...select,
      operationId: operationId(),
      rows: [{ ...select.rows[0], overwriteFields: ["phone"] }],
    })
  ).json();
  expect(
    (
      await f.request("PUT", `/records/${original.id}`, {
        operationId: operationId(),
        expectedVersion: 1,
        record: {
          kind: "contact",
          title: original.title,
          data: { ...original.data, phone: "modification concurrente" },
        },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await f.request("POST", `/imports/${p.id}/commit`, {
        operationId: operationId(),
        expectedVersion: selected.version,
        sourceHash: p.sourceHash,
        lineIds: [rows[0].lineId],
      })
    ).statusCode,
  ).toBe(202);
  for (let n = 0; n < 100; n++) {
    if (
      (await f.request("GET", `/imports/${p.id}`)).json().state === "completed"
    )
      break;
    await new Promise((r) => setTimeout(r, 30));
  }
  const result = (await f.request("GET", `/imports/${p.id}/rows`)).json().items;
  expect(result[0].status).toBe("refused");
  expect(result[0].errors[0]).toContain("VERSION_CONFLICT");
  expect(
    (await f.request("GET", `/records/${original.id}`)).json().data.phone,
  ).toBe("modification concurrente");
});

test("reprise : mapping sans écrasement ambigu et refus du faux 29 février 1900 Excel", async () => {
  f = await fixture();
  await f.setup();
  const duplicate = await f.request("POST", "/imports/preview", {
    operationId: operationId(),
    filename: "ambigu.csv",
    format: "csv",
    kind: "dossier",
    bytes: Buffer.from("Nom;Autre\nPremier;Dernier\n").toString("base64"),
    mapping: { "0": "title", "1": "title" },
  });
  expect(duplicate.statusCode).toBe(400);
  const { xlsxFixture } = await import("./xlsx-fixture.js");
  const leap = await f.request("POST", "/imports/preview", {
    operationId: operationId(),
    filename: "date.xlsx",
    format: "xlsx",
    kind: "dossier",
    bytes: xlsxFixture([
      ["Nom", "Date"],
      ["Faux jour", { type: "date", value: "60" }],
    ]).toString("base64"),
    mapping: { "0": "title", "1": "startedOn" },
  });
  expect(leap.statusCode).toBe(422);
  expect(leap.json().error.code).toBe("INVALID_EXCEL_DATE");
});

test("aperçu de reprise : champs personnalisés et cohérence des établissements validés avant sélection", async () => {
  f = await fixture();
  await f.setup();
  const field = (
    await f.request("POST", "/administration/fields", {
      operationId: operationId(),
      kind: "dossier",
      name: "Nombre obligatoire si connu",
      type: "number",
      placement: "information",
      choices: [],
    })
  ).json();
  const response = await f.request("POST", "/imports/preview", {
    operationId: operationId(),
    filename: "validation.csv",
    format: "csv",
    kind: "dossier",
    delimiter: ";",
    bytes: Buffer.from(
      'Nom;SIREN;Nombre;Sites\nErreur custom;001234567;invalide;\nErreur établissement;001234567;0;"[{""id"":""11111111-1111-4111-8111-111111111111"",""siret"":""00234567800012"",""name"":""Site fictif""}]"\n',
    ).toString("base64"),
    mapping: {
      "0": "title",
      "1": "siren",
      "2": "custom." + field.id,
      "3": "establishments",
    },
  });
  expect(response.statusCode).toBe(201);
  const lines = (
    await f.request("GET", `/imports/${response.json().id}/rows`)
  ).json().items;
  expect(lines[0].errors).toContain(
    "Valeur incompatible avec le champ personnalisé.",
  );
  expect(lines[1].errors).toContain(
    "Le SIRET doit appartenir au SIREN du dossier.",
  );
  expect(
    (
      await f.request("PUT", `/imports/${response.json().id}/selection`, {
        operationId: operationId(),
        expectedVersion: 1,
        rows: [{ lineId: lines[0].lineId, accepted: true }],
      })
    ).statusCode,
  ).toBe(409);
});

async function commitSelection(preview: any, rows: any[], token = f.cookie) {
  const selected = await f.request(
    "PUT",
    `/imports/${preview.id}/selection`,
    {
      operationId: operationId(),
      expectedVersion: preview.version,
      rows: rows.map((row) => ({
        lineId: row.lineId,
        accepted: true,
        overwriteFields: row.changes.map((c: any) => c.field),
      })),
    },
    token,
  );
  expect(selected.statusCode).toBe(200);
  const command = {
    operationId: operationId(),
    expectedVersion: selected.json().version,
    sourceHash: preview.sourceHash,
    lineIds: rows.map((r) => r.lineId),
  };
  const enqueued = await f.request(
    "POST",
    `/imports/${preview.id}/commit`,
    command,
    token,
  );
  expect(enqueued.statusCode).toBe(202);
  for (let n = 0; n < 150; n++) {
    const state = await f.request(
      "GET",
      `/imports/${preview.id}`,
      undefined,
      token,
    );
    if (state.json().state === "completed") break;
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(
    (await f.request("GET", `/imports/${preview.id}`, undefined, token)).json()
      .state,
  ).toBe("completed");
  expect(
    (
      await f.request("POST", `/imports/${preview.id}/commit`, command, token)
    ).json().jobId,
  ).toBe(enqueued.json().jobId);
  return (
    await f.request("GET", `/imports/${preview.id}/rows`, undefined, token)
  ).json().items;
}
test("reprises XLSX et CSV : mises à jour explicites, blanc conservé, zéro confirmé et affectation puis retrait", async () => {
  f = await fixture();
  await f.setup();
  const { xlsxFixture } = await import("./xlsx-fixture.js");
  const d = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "dossier",
        title: "Dossier à reprendre",
        data: {
          siren: "001234567",
          capital: "10.00",
          activity: "Conserver cette activité",
        },
      },
    })
  ).json();
  const p = (
    await f.request("POST", "/imports/preview", {
      operationId: operationId(),
      filename: "mise-a-jour.xlsx",
      format: "xlsx",
      kind: "dossier",
      bytes: xlsxFixture([
        ["Nom", "SIREN", "Capital", "Activité"],
        [d.title, "001234567", { type: "number", value: "0.00" }, ""],
      ]).toString("base64"),
      mapping: { "0": "title", "1": "siren", "2": "capital", "3": "activity" },
    })
  ).json();
  const rows = (await f.request("GET", `/imports/${p.id}/rows`)).json().items;
  expect(rows[0].changes).toEqual([
    { field: "capital", before: "10.00", after: "0.00" },
  ]);
  expect((await commitSelection(p, rows))[0].status).toBe("updated");
  const updated = (await f.request("GET", `/records/${d.id}`)).json();
  expect(updated.data).toMatchObject({
    capital: "0.00",
    activity: "Conserver cette activité",
    fieldOrigins: { capital: { kind: "import" }, activity: { kind: "manual" } },
  });
  const u = (
    await f.request("POST", "/users", {
      operationId: operationId(),
      name: "Affecté",
      email: "affecte@example.test",
      password: "MotDePasseFictif123!",
      permissions: [],
    })
  ).json();
  const role = (
    await f.request("POST", "/administration/roles", {
      operationId: operationId(),
      name: "Lecteur importé",
      order: 1,
      permissions: [{ action: "read", kind: "dossier", dossierId: null }],
    })
  ).json();
  const login = await f.request(
    "POST",
    "/login",
    { email: u.email, password: "MotDePasseFictif123!" },
    "",
  );
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  for (const format of ["csv", "xlsx"] as const) {
    const remove = format === "xlsx";
    const headers = ["Dossier", "Sujet", "Identité", "Rôle", "Retrait"],
      line = [d.id, "user", u.id, role.id, String(remove)];
    const bytes =
      format === "csv"
        ? Buffer.from(headers.join(";") + "\n" + line.join(";"))
        : xlsxFixture([headers, line]);
    const response = await f.request("POST", "/imports/preview", {
      operationId: operationId(),
      filename: "affectations." + format,
      format,
      kind: "assignment",
      bytes: bytes.toString("base64"),
      mapping: {
        "0": "dossierId",
        "1": "subjectKind",
        "2": "subjectId",
        "3": "roleId",
        "4": "remove",
      },
    });
    expect(response.statusCode).toBe(201);
    const p = response.json(),
      rows = (await f.request("GET", `/imports/${p.id}/rows`)).json().items;
    expect((await commitSelection(p, rows))[0].status).toBe(
      remove ? "removed" : "assigned",
    );
    expect(
      (await f.request("GET", `/records/${d.id}`, undefined, cookie))
        .statusCode,
    ).toBe(remove ? 404 : 200);
  }
});

test("reprise différée : empreinte, capacité et droits courants recontrôlés après l’aperçu", async () => {
  f = await fixture();
  const actor = await f.setup();
  const upload = {
    operationId: operationId(),
    filename: "borne.csv",
    format: "csv",
    kind: "dossier",
    bytes: Buffer.from("Nom;SIREN\nNe pas créer;001234567").toString("base64"),
    mapping: { "0": "title", "1": "siren" },
  };
  const p = (await f.request("POST", "/imports/preview", upload)).json(),
    rows = (await f.request("GET", `/imports/${p.id}/rows`)).json().items;
  const selected = (
    await f.request("PUT", `/imports/${p.id}/selection`, {
      operationId: operationId(),
      expectedVersion: p.version,
      rows: [{ lineId: rows[0].lineId, accepted: true }],
    })
  ).json();
  const command = {
    operationId: operationId(),
    expectedVersion: selected.version,
    sourceHash: p.sourceHash,
    lineIds: [rows[0].lineId],
  };
  expect(
    (
      await f.request("POST", `/imports/${p.id}/commit`, {
        ...command,
        sourceHash: "0".repeat(64),
      })
    ).json().error.code,
  ).toBe("SOURCE_CHANGED");
  const { JobRunner } = await import("../src/jobs/runner.js"),
    { Imports } = await import("../src/imports/service.js"),
    { installation, updateInstallation } =
      await import("../src/administration/settings.js");
  await f.maintainDatabase(async (db) => {
    const runner = new JobRunner(db),
      imports = new Imports(db, runner, () => new Date());
    await db.transaction((tx) => imports.commit(tx, actor, p.id, command));
    await db.transaction(async (tx) => {
      const config = await installation(tx);
      await updateInstallation(
        tx,
        actor,
        {
          operationId: operationId(),
          expectedVersion: config.version,
          name: config.name,
          enabledModules: config.enabledModules.filter((m) => m !== "imports"),
        },
        new Date(),
      );
    });
    await runner.tick();
    await runner.tick();
    await runner.tick();
    expect(
      (await db.transaction((tx) => imports.get(tx, actor, p.id))).state,
    ).toBe("failed");
    await runner.stop();
  });
  expect((await f.request("GET", "/records?kind=dossier")).json().total).toBe(
    0,
  );
  expect(
    (await f.request("POST", `/imports/${p.id}/commit`, command)).json().error
      .code,
  ).toBe("MODULE_DISABLED");
  const config = (
    await f.request("GET", "/administration/installation")
  ).json();
  await f.request("PUT", "/administration/installation", {
    operationId: operationId(),
    expectedVersion: config.version,
    name: config.name,
    enabledModules: [...config.enabledModules, "imports"],
  });
  const user = (
    await f.request("POST", "/users", {
      operationId: operationId(),
      name: "Importeur",
      email: "importeur@example.test",
      password: "MotDePasseFictif123!",
      permissions: [{ action: "create", kind: "dossier" }],
    })
  ).json();
  const login = await f.request(
    "POST",
    "/login",
    { email: user.email, password: "MotDePasseFictif123!" },
    "",
  );
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const preview = (
      await f.request(
        "POST",
        "/imports/preview",
        { ...upload, operationId: operationId() },
        cookie,
      )
    ).json(),
    line = (
      await f.request("GET", `/imports/${preview.id}/rows`, undefined, cookie)
    ).json().items[0];
  const selection = (
    await f.request(
      "PUT",
      `/imports/${preview.id}/selection`,
      {
        operationId: operationId(),
        expectedVersion: 1,
        rows: [{ lineId: line.lineId, accepted: true }],
      },
      cookie,
    )
  ).json();
  const currentActor = (
    await f.request("GET", "/account", undefined, cookie)
  ).json().profile;
  await f.maintainDatabase(async (db) => {
    const runner = new JobRunner(db),
      imports = new Imports(db, runner, () => new Date());
    await db.transaction((tx) =>
      imports.commit(tx, currentActor, preview.id, {
        operationId: operationId(),
        expectedVersion: selection.version,
        sourceHash: preview.sourceHash,
        lineIds: [line.lineId],
      }),
    );
    await runner.pause();
  });
  expect(
    (
      await f.request("PUT", `/users/${user.id}`, {
        operationId: operationId(),
        expectedVersion: user.version,
        active: true,
        permissions: [],
      })
    ).statusCode,
  ).toBe(200);
  await f.maintainDatabase(async (db) => {
    const runner = new JobRunner(db);
    new Imports(db, runner, () => new Date());
    await runner.resume();
    await runner.tick();
    await runner.tick();
    await runner.tick();
    await runner.stop();
  });
  expect((await f.request("GET", "/records?kind=dossier")).json().total).toBe(
    0,
  );
  expect(
    (await f.request("GET", `/imports/${preview.id}/rows`, undefined, cookie))
      .statusCode,
  ).toBe(403);
});

test("aperçu reconfiguré : catalogue, choix effacés explicitement, source conservée et suppression locale", async () => {
  f = await fixture();
  await f.setup();
  expect((await f.request("GET", "/imports/catalogue")).json()).toMatchObject({
    maxBytes: 10485760,
    maxRows: 10000,
    maxColumns: 100,
  });
  const response = await f.request("POST", "/imports/preview", {
    operationId: operationId(),
    filename: "remap.csv",
    format: "csv",
    kind: "dossier",
    bytes: Buffer.from("Nom;Code\nReprise fictive;001234567").toString(
      "base64",
    ),
    mapping: { "0": "title", "1": "siren" },
  });
  expect(response.statusCode).toBe(201);
  const preview = response.json(),
    row = (await f.request("GET", `/imports/${preview.id}/rows`)).json()
      .items[0];
  const selected = (
    await f.request("PUT", `/imports/${preview.id}/selection`, {
      operationId: operationId(),
      expectedVersion: 1,
      rows: [{ lineId: row.lineId, accepted: true }],
    })
  ).json();
  expect(
    (await f.request("GET", `/imports/${preview.id}/accepted`)).json().lineIds,
  ).toEqual([row.lineId]);
  const remap = await f.request("PUT", `/imports/${preview.id}/mapping`, {
    operationId: operationId(),
    expectedVersion: selected.version,
    mapping: { "0": "title" },
  });
  expect(remap.statusCode).toBe(200);
  expect(remap.json().sourceHash).toBe(preview.sourceHash);
  expect(
    (await f.request("GET", `/imports/${preview.id}/accepted`)).json().lineIds,
  ).toEqual([]);
  expect(
    (await f.request("GET", `/imports/${preview.id}/rows`)).json().items[0],
  ).toMatchObject({
    lineId: row.lineId,
    accepted: false,
    record: { data: { siren: null } },
  });
  expect((await f.request("GET", "/imports")).json().items).toHaveLength(1);
  expect(
    (await f.request("POST", `/imports/${preview.id}/remove`, {})).statusCode,
  ).toBe(200);
  expect((await f.request("GET", "/imports")).json().items).toEqual([]);
  expect(
    (await f.request("GET", `/imports/${preview.id}/rows`)).statusCode,
  ).toBe(404);
});

test("reprise CSV : booléens personnalisés et frontière explicite entre installations", async () => {
  f = await fixture();
  await f.setup();
  const field = (
    await f.request("POST", "/administration/fields", {
      operationId: operationId(),
      kind: "dossier",
      name: "Accord fictif",
      type: "boolean",
      placement: "information",
      choices: [],
    })
  ).json();
  const record = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: { kind: "dossier", title: "Fiche locale", data: {} },
    })
  ).json();
  const preview = (
    await f.request("POST", "/imports/preview", {
      operationId: operationId(),
      filename: "frontiere.csv",
      format: "csv",
      kind: "dossier",
      delimiter: ";",
      sourceInstallationId: operationId(),
      bytes: Buffer.from(
        `Nom;Accord;Identité\nNouvelle fiche;non;\nFiche étrangère;oui;${record.id}\n`,
      ).toString("base64"),
      mapping: { "0": "title", "1": "custom." + field.id, "2": "recordId" },
    })
  ).json();
  const rows = (await f.request("GET", `/imports/${preview.id}/rows`)).json()
    .items;
  expect(rows[0].errors).toEqual([]);
  expect(rows[0].record.data.customFields[field.id]).toBe(false);
  expect(rows[1].errors).toContain(
    "Identité issue d’une autre installation : rapprocher les fiches sans réutiliser leurs identifiants internes.",
  );
  await commitSelection(preview, [rows[0]]);
  expect(
    (await f.request("GET", "/records?kind=dossier&q=Nouvelle")).json().items[0]
      .data.customFields[field.id],
  ).toBe(false);
});
