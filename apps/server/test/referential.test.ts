import { afterEach, expect, test } from "vitest";
import { fixture, dossier, operationId } from "./helpers.js";
let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
});
test("dossier/contact complets : identifiants textuels, établissements, dates, capital exact, relations et archive", async () => {
  f = await fixture();
  await f.setup();
  const input = dossier("Entreprise fictive complète");
  const created = await f.request("POST", "/records", {
    ...input,
    record: {
      ...input.record,
      data: {
        ...input.record.data,
        capital: "0.00",
        vatRegime: "reel_normal",
        vatFrequency: "mensuelle",
        financialYearEnd: "2026-12-31",
        address: {
          line1: "1 rue fictive",
          postalCode: "00120",
          city: "Ville fictive",
          country: "FR",
        },
        establishments: [
          {
            id: operationId(),
            siret: "00123456700012",
            name: "Établissement fictif",
            openedOn: "2020-02-29",
          },
        ],
        identifiers: [{ kind: "compte_TI", value: "000-TI-TEST" }],
      },
    },
  });
  expect(created.statusCode).toBe(201);
  const d = created.json();
  const contact = await f.request("POST", "/records", {
    operationId: operationId(),
    record: {
      kind: "contact",
      title: "Personne fictive",
      dossierId: d.id,
      data: {
        firstName: "Camille",
        lastName: "Fictive",
        birthDate: "2000-02-29",
        taxNumber: "0001234567890",
        nationality: "FR",
        email: "camille-fictive@example.test",
        address: { postalCode: "00120" },
      },
    },
  });
  expect(contact.statusCode).toBe(201);
  await f.restart();
  const loaded = (await f.request("GET", `/records/${d.id}`)).json();
  expect(loaded.data).toMatchObject({
    siren: "001234567",
    capital: "0.00",
    address: { postalCode: "00120" },
    establishments: [{ siret: "00123456700012", openedOn: "2020-02-29" }],
  });
  const bad = await f.request("PUT", `/records/${d.id}`, {
    operationId: operationId(),
    expectedVersion: 1,
    record: {
      ...input.record,
      data: {
        siren: "001234567",
        establishments: [{ id: operationId(), siret: "123" }],
      },
    },
  });
  expect(bad.statusCode).toBe(400);
  const archived = await f.request("PUT", `/records/${d.id}`, {
    operationId: operationId(),
    expectedVersion: 1,
    record: {
      kind: "dossier",
      title: d.title,
      data: { ...d.data, archived: true },
    },
  });
  expect(archived.statusCode).toBe(200);
  expect(
    (await f.request("GET", "/records?kind=dossier")).json().items,
  ).toEqual([]);
  expect(
    (await f.request("GET", "/records?kind=dossier&archived=true")).json()
      .items[0].id,
  ).toBe(d.id);
  const restored = await f.request("PUT", `/records/${d.id}`, {
    operationId: operationId(),
    expectedVersion: 2,
    record: {
      kind: "dossier",
      title: d.title,
      data: { ...d.data, archived: false },
    },
  });
  expect(restored.statusCode).toBe(200);
  expect(
    (await f.request("GET", "/records/export.csv?kind=contact")).body,
  ).toContain("0001234567890");
});
test("champs personnalisés : inconnu/0/false, renommage stable et migration explicite atomique", async () => {
  f = await fixture();
  await f.setup();
  const field = await f.request("POST", "/administration/fields", {
    operationId: operationId(),
    kind: "dossier",
    name: "Effectif",
    type: "number",
    placement: "information",
    choices: [],
  });
  expect(field.statusCode).toBe(201);
  const definition = field.json();
  const a = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "dossier",
        title: "Zéro fictif",
        data: { customFields: { [definition.id]: "0" } },
      },
    })
  ).json();
  const b = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "dossier",
        title: "Inconnu fictif",
        data: { customFields: { [definition.id]: null } },
      },
    })
  ).json();
  const renamed = await f.request(
    "PUT",
    `/administration/fields/${definition.id}`,
    {
      operationId: operationId(),
      expectedVersion: 1,
      kind: "dossier",
      name: "Nombre de salariés",
      type: "number",
      placement: "header",
      choices: [],
    },
  );
  expect(renamed.statusCode).toBe(200);
  expect(
    (await f.request("GET", `/records/${a.id}`)).json().data.customFields[
      definition.id
    ],
  ).toBe("0");
  const change = {
    operationId: operationId(),
    expectedVersion: 2,
    kind: "dossier",
    name: "Présence",
    type: "boolean",
    placement: "header",
    choices: [],
  };
  const incompatible = await f.request(
    "PUT",
    `/administration/fields/${definition.id}`,
    change,
  );
  expect(incompatible.statusCode).toBe(409);
  expect(incompatible.json().error.code).toBe("FIELD_MIGRATION_REQUIRED");
  const migrate = await f.request(
    "PUT",
    `/administration/fields/${definition.id}`,
    {
      ...change,
      operationId: operationId(),
      migration: [{ recordId: a.id, expectedVersion: a.version, value: false }],
    },
  );
  expect(migrate.statusCode).toBe(200);
  await f.restart();
  expect(
    (await f.request("GET", `/records/${a.id}`)).json().data.customFields[
      definition.id
    ],
  ).toBe(false);
  expect(
    (await f.request("GET", `/records/${b.id}`)).json().data.customFields[
      definition.id
    ],
  ).toBeNull();
  const bad = await f.request("POST", "/records", {
    operationId: operationId(),
    record: {
      kind: "dossier",
      title: "Incorrect",
      data: { customFields: { [definition.id]: "false" } },
    },
  });
  expect(bad.statusCode).toBe(400);
});
test("détection simulée : rapprochement stable, décision manuelle de conflit, masquer/restaurer sans doublon", async () => {
  f = await fixture();
  await f.setup();
  const d = (
    await f.request("POST", "/records", dossier("Nom validé manuellement"))
  ).json();
  const detected = await f.request(
    "POST",
    "/administration/detections/simulate",
    {
      operationId: operationId(),
      sourceId: "portefeuille-fictif:entreprise-1",
      sourceVersion: "v1",
      values: {
        title: "Nom fournisseur fictif",
        siren: "001234567",
        legalForm: "SARL",
      },
    },
  );
  expect(detected.statusCode).toBe(201);
  const candidate = detected.json();
  expect(candidate.origin.kind).toBe("simulated");
  const preview = await f.request(
    "GET",
    `/administration/detections/${candidate.id}/preview`,
  );
  expect(preview.statusCode).toBe(200);
  expect(preview.json().target.id).toBe(d.id);
  expect(preview.json().conflicts).toContain("title");
  const input = {
    operationId: operationId(),
    expectedVersion: candidate.version,
    decision: "merge",
    targetId: d.id,
    expectedRecordVersion: 1,
    choices: {
      title: "keep_manual",
      siren: "use_source",
      legalForm: "use_source",
    },
  };
  const merged = await f.request(
    "POST",
    `/administration/detections/${candidate.id}/decide`,
    input,
  );
  expect(merged.statusCode).toBe(200);
  expect(
    (
      await f.request(
        "POST",
        `/administration/detections/${candidate.id}/decide`,
        input,
      )
    ).json(),
  ).toEqual(merged.json());
  const record = (await f.request("GET", `/records/${d.id}`)).json();
  expect(record.title).toBe("Nom validé manuellement");
  expect(record.data.legalForm).toBe("SARL");
  expect(record.data.fieldOrigins.legalForm.kind).toBe("simulated");
  expect(record.data.fieldOrigins.title.kind).toBe("manual");
  const hidden = await f.request(
    "POST",
    `/administration/detections/${candidate.id}/decide`,
    {
      operationId: operationId(),
      expectedVersion: merged.json().version,
      decision: "hide",
    },
  );
  expect(hidden.statusCode).toBe(200);
  expect(
    (await f.request("GET", "/administration/detections")).json().items,
  ).toEqual([]);
  const restored = await f.request(
    "POST",
    `/administration/detections/${candidate.id}/decide`,
    {
      operationId: operationId(),
      expectedVersion: hidden.json().version,
      decision: "restore",
    },
  );
  expect(restored.statusCode).toBe(200);
  const repeat = await f.request(
    "POST",
    "/administration/detections/simulate",
    {
      operationId: operationId(),
      sourceId: "portefeuille-fictif:entreprise-1",
      sourceVersion: "v1",
      values: {
        title: "Nom fournisseur fictif",
        siren: "001234567",
        legalForm: "SARL",
      },
    },
  );
  expect(repeat.json().id).toBe(candidate.id);
  expect((await f.request("GET", "/records?kind=dossier")).json().total).toBe(
    1,
  );
});
test("détection automatique : création et reprise partagent le rapprochement, provenance simulée conservée", async () => {
  f = await fixture();
  await f.setup();
  const input = {
    operationId: operationId(),
    sourceId: "fictif:auto:1",
    sourceVersion: "1",
    values: { title: "Création auto fictive", siren: "002345678" },
    automatic: true,
  };
  const a = await f.request(
    "POST",
    "/administration/detections/simulate",
    input,
  );
  expect(a.statusCode).toBe(201);
  expect(a.json()).toMatchObject({
    status: "linked",
    automatic: true,
    origin: { kind: "simulated" },
  });
  const replay = await f.request(
    "POST",
    "/administration/detections/simulate",
    { ...input, operationId: operationId() },
  );
  expect(replay.json().dossierId).toBe(a.json().dossierId);
  expect((await f.request("GET", "/records?kind=dossier")).json().total).toBe(
    1,
  );
});

test("une source partielle ne remplace pas les valeurs absentes de son contrat", async () => {
  f = await fixture();
  await f.setup();
  const original = dossier("Partiel fictif");
  const created = await f.request("POST", "/records", {
    ...original,
    record: {
      ...original.record,
      data: {
        siren: "001234567",
        capital: "99.00",
        activity: "Activité manuelle",
      },
    },
  });
  const record = created.json();
  const detection = (
    await f.request("POST", "/administration/detections/simulate", {
      operationId: operationId(),
      sourceId: "partiel-fictif",
      sourceVersion: "1",
      values: { title: record.title, siren: "001234567" },
    })
  ).json();
  const merged = await f.request(
    "POST",
    `/administration/detections/${detection.id}/decide`,
    {
      operationId: operationId(),
      expectedVersion: detection.version,
      decision: "merge",
      expectedRecordVersion: record.version,
      choices: {},
    },
  );
  expect(merged.statusCode).toBe(200);
  const result = (await f.request("GET", `/records/${record.id}`)).json();
  expect(result.data.capital).toBe("99.00");
  expect(result.data.activity).toBe("Activité manuelle");
});

test("migration explicite paginée : plus de 200 valeurs, version figée et renommage sans perte", async () => {
  f = await fixture();
  await f.setup();
  const field = (
    await f.request("POST", "/administration/fields", {
      operationId: operationId(),
      kind: "dossier",
      name: "Ancien nombre",
      type: "text",
      placement: "header",
      choices: [],
    })
  ).json();
  const records = [];
  for (let i = 0; i < 201; i++) {
    const source = dossier(`Migration ${String(i).padStart(3, "0")}`);
    const response = await f.request("POST", "/records", {
      ...source,
      record: {
        ...source.record,
        data: { customFields: { [field.id]: String(i) } },
      },
    });
    expect(response.statusCode).toBe(201);
    records.push(response.json());
  }
  const first = (
    await f.request("GET", `/administration/fields/${field.id}/values?offset=0`)
  ).json();
  const last = (
    await f.request(
      "GET",
      `/administration/fields/${field.id}/values?offset=200`,
    )
  ).json();
  expect(first.items).toHaveLength(200);
  expect(last.items).toHaveLength(1);
  expect(first.total).toBe(201);
  expect(
    new Set([...first.items, ...last.items].map((v) => v.recordId)).size,
  ).toBe(201);
  const input = {
    operationId: operationId(),
    expectedVersion: 1,
    kind: "dossier",
    name: "Nombre renommé",
    type: "number",
    placement: "parameters",
    choices: [],
    migration: records.map((r) => ({
      recordId: r.id,
      expectedVersion: r.version,
      value: r.data.customFields[field.id],
    })),
  };
  const result = await f.request(
    "PUT",
    `/administration/fields/${field.id}`,
    input,
  );
  expect(result.statusCode).toBe(200);
  expect(result.json().id).toBe(field.id);
  expect(
    (await f.request("GET", `/records/${records[0]!.id}`)).json().data
      .customFields[field.id],
  ).toBe("0");
  expect(
    (
      await f.request("PUT", `/administration/fields/${field.id}`, {
        ...input,
        operationId: operationId(),
        expectedVersion: 2,
      })
    ).statusCode,
  ).toBe(409);
});

test.each(["simulate", "propose"] as const)(
  "rejeu %s : périmètre historique et rattachement courant protégés après retrait",
  async (route) => {
    const { createServer } = await import("node:http");
    let calls = 0;
    const server = createServer((_req, res) => {
      calls++;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          results: [
            { siren: "001234567", nom_complet: "Détection retrait fictive" },
          ],
          page: 1,
          total_results: 1,
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      f = await fixture(undefined, {
        companySearchOrigin: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      });
      await f.setup();
      const role = (
        await f.request("POST", "/administration/roles", {
          operationId: operationId(),
          name: "Lecture révocable",
          order: 1,
          permissions: [{ action: "read", kind: "*" }],
        })
      ).json();
      const u = (
        await f.request("POST", "/users", {
          operationId: operationId(),
          name: "Détecteur fictif",
          email: "detecteur@example.test",
          password: "MotDePasseFictif123!",
          permissions: ["manage_users", "create", "update"].map((action) => ({
            action,
            kind: "*",
          })),
        })
      ).json();
      expect(
        (
          await f.request("PUT", `/administration/users/${u.id}`, {
            operationId: operationId(),
            expectedVersion: u.version,
            name: u.name,
            active: true,
            permissions: u.permissions,
            roleIds: [role.id],
          })
        ).statusCode,
      ).toBe(200);
      const login = await f.request(
        "POST",
        "/login",
        { email: u.email, password: "MotDePasseFictif123!" },
        "",
      );
      const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
      const command =
        route === "simulate"
          ? {
              operationId: operationId(),
              sourceId: "retrait-fictif",
              sourceVersion: "1",
              automatic: true,
              values: {
                title: "Détection retrait fictive",
                siren: "001234567",
              },
            }
          : {
              operationId: operationId(),
              candidateId: (
                await f.request(
                  "GET",
                  "/administration/companies/search?q=fictif",
                  undefined,
                  cookie,
                )
              ).json().items[0].candidateId,
            };
      const path =
        route === "simulate"
          ? "/administration/detections/simulate"
          : "/administration/companies/propose";
      const first = await f.request("POST", path, command, cookie);
      expect(first.statusCode).toBe(route === "simulate" ? 201 : 200);
      const historical = first.json();
      const linked =
        route === "simulate"
          ? historical
          : (
              await f.request(
                "POST",
                `/administration/detections/${historical.id}/decide`,
                {
                  operationId: operationId(),
                  expectedVersion: historical.version,
                  decision: "create",
                  choices: {},
                },
              )
            ).json();
      expect(linked.dossierId).toBeTruthy();
      // Historical result linked for simulate; propose's old result was unlinked.
      expect((await f.request("POST", path, command, cookie)).json()).toEqual(
        historical,
      );
      const record = (
        await f.request("GET", `/records/${linked.dossierId}`)
      ).json();
      const { id, version, createdAt, updatedAt, ...content } = record;
      expect(
        (
          await f.request("PUT", `/records/${id}`, {
            operationId: operationId(),
            expectedVersion: version,
            record: { ...content, confidential: true },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await f.request(
            "GET",
            `/administration/detections/${historical.id}/preview`,
            undefined,
            cookie,
          )
        ).statusCode,
      ).toBe(404);
      expect((await f.request("POST", path, command, cookie)).statusCode).toBe(
        404,
      );
      expect(
        (
          await f.request(
            "POST",
            path,
            { ...command, operationId: operationId() },
            cookie,
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await f.request("PUT", `/records/${id}`, {
            operationId: operationId(),
            expectedVersion: version + 1,
            record: content,
          })
        ).statusCode,
      ).toBe(200);
      expect((await f.request("POST", path, command, cookie)).json()).toEqual(
        historical,
      );
      expect(
        (
          await f.request("PUT", `/administration/roles/${role.id}`, {
            operationId: operationId(),
            expectedVersion: role.version,
            name: role.name,
            order: 1,
            permissions: [],
          })
        ).statusCode,
      ).toBe(200);
      await f.restart();
      const denied = await f.request("POST", path, command, cookie);
      expect(denied.statusCode).toBe(404);
      expect(denied.body).not.toContain(id);
      // Restore only a scoped assignment, then withdraw that assignment too.
      expect(
        (
          await f.request("PUT", `/administration/roles/${role.id}`, {
            operationId: operationId(),
            expectedVersion: role.version + 1,
            name: role.name,
            order: 1,
            permissions: [{ action: "read", kind: "*" }],
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await f.request("PUT", `/administration/users/${u.id}`, {
            operationId: operationId(),
            expectedVersion: u.version + 1,
            name: u.name,
            active: true,
            permissions: u.permissions,
            roleIds: [],
          })
        ).statusCode,
      ).toBe(200);
      const scope = {
        dossierId: id,
        expectedVersion: 1,
        subject: { kind: "user", id: u.id },
        roleId: role.id,
        remove: false,
      };
      expect(
        (
          await f.request("POST", "/administration/assignments", {
            operationId: operationId(),
            rows: [scope],
          })
        ).json().items[0].status,
      ).toBe("assigned");
      expect((await f.request("POST", path, command, cookie)).json()).toEqual(
        historical,
      );
      expect(
        (
          await f.request("POST", "/administration/assignments", {
            operationId: operationId(),
            rows: [{ ...scope, expectedVersion: 2, remove: true }],
          })
        ).json().items[0].status,
      ).toBe("removed");
      expect((await f.request("POST", path, command, cookie)).statusCode).toBe(
        404,
      );
      expect(
        (await f.request("GET", "/records?kind=dossier")).json().total,
      ).toBe(1);
      expect(calls).toBe(route === "propose" ? 1 : 0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
