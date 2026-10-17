import { afterEach, expect, test } from "vitest";
import { fixture, operationId, dossier, task } from "./helpers.js";
let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
});
test("vues et tableau de bord : période, état, colonnes, tri et export du même sous-ensemble", async () => {
  f = await fixture(() => new Date("2026-06-15T12:00:00Z"));
  await f.setup();
  const d = (await f.request("POST", "/records", dossier())).json();
  for (const [title, dueDate, state] of [
    ["Bêta juin", "2026-06-20", "a_faire"],
    ["Alpha juin", "2026-06-01", "en_cours"],
    ["Hors période", "2026-07-01", "a_faire"],
  ]) {
    const base = task(d.id);
    expect(
      (
        await f.request("POST", "/records", {
          ...base,
          record: { ...base.record, title, data: { dueDate, state } },
        })
      ).statusCode,
    ).toBe(201);
  }
  const query = `from=2026-06-01&to=2026-06-30&dossierId=${d.id}`;
  const dashboard = await f.request("GET", "/dashboard?" + query);
  expect(dashboard.statusCode).toBe(200);
  expect(dashboard.json()).toMatchObject({
    counts: { tache: 2 },
    openTasks: 2,
    overdueTasks: 1,
    upcomingTasks: 1,
    obligationSources: {
      manual: 0,
      simulated: 0,
      verified: 0,
      freshness: "unknown",
    },
    tasks: [
      { state: "a_faire", count: 1 },
      { state: "en_cours", count: 1 },
      { state: "terminee", count: 0 },
    ],
  });
  const list = await f.request(
    "GET",
    "/records?kind=tache&" + query + "&sort=title&direction=asc&limit=1",
  );
  expect(list.statusCode).toBe(200);
  expect(list.json()).toMatchObject({
    total: 2,
    items: [{ title: "Alpha juin" }],
  });
  const detail = await f.request(
    "GET",
    "/records?kind=tache&state=en_cours&" + query,
  );
  expect(detail.json().items.map((r: { title: string }) => r.title)).toEqual([
    "Alpha juin",
  ]);
  const exported = await f.request(
    "GET",
    "/records/export.csv?kind=tache&state=en_cours&columns=title,dueDate,state&" +
      query,
  );
  expect(exported.statusCode).toBe(200);
  expect(exported.body).toBe(
    '\uFEFF"title";"dueDate";"state"\r\n"Alpha juin";"2026-06-01";"en_cours"\r\n',
  );
  const view = await f.request("POST", "/administration/views", {
    operationId: operationId(),
    name: "Échéances juin",
    query: {
      kind: "tache",
      from: "2026-06-01",
      to: "2026-06-30",
      dossierId: d.id,
      sort: "title",
      direction: "desc",
      columns: "title,dueDate,state",
      limit: 1,
      offset: 1,
    },
  });
  expect(view.statusCode).toBe(201);
  await f.restart();
  expect(
    (await f.request("GET", "/administration/views")).json().items[0],
  ).toMatchObject({
    id: view.json().id,
    name: "Échéances juin",
    query: {
      offset: 1,
      limit: 1,
      direction: "desc",
      columns: "title,dueDate,state",
    },
  });
});

test("vues personnelles et périmètres : aucun partage implicite, contacts multi-dossiers et révocation", async () => {
  f = await fixture();
  await f.setup();
  const a = (await f.request("POST", "/records", dossier("Visible"))).json();
  const b = (await f.request("POST", "/records", dossier("Privé"))).json();
  const user = (
    await f.request("POST", "/users", {
      operationId: operationId(),
      name: "Lecteur",
      email: "lecteur-vues@example.test",
      password: "MotDePasseFictif123!",
      permissions: [],
    })
  ).json();
  const role = (
    await f.request("POST", "/administration/roles", {
      operationId: operationId(),
      name: "Lecture locale",
      order: 1,
      permissions: ["read", "export"].map((action) => ({
        action,
        kind: "*",
        dossierId: null,
      })),
    })
  ).json();
  const group = (
    await f.request("POST", "/administration/groups", {
      operationId: operationId(),
      kind: "team",
      name: "Équipe visible",
      memberIds: [user.id],
    })
  ).json();
  expect(
    (
      await f.request("POST", "/administration/assignments", {
        operationId: operationId(),
        rows: [
          {
            dossierId: a.id,
            expectedVersion: 1,
            subject: { kind: "team", id: group.id },
            roleId: role.id,
            remove: false,
          },
        ],
      })
    ).statusCode,
  ).toBe(200);
  const visibleContact = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "contact",
        title: "Contact visible",
        dossierId: a.id,
        confidential: false,
        data: { relatedDossierIds: [a.id] },
      },
    })
  ).json();
  const hiddenContact = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "contact",
        title: "Contact multi privé",
        dossierId: a.id,
        confidential: false,
        data: { relatedDossierIds: [b.id] },
      },
    })
  ).json();
  const login = await f.request(
    "POST",
    "/login",
    { email: user.email, password: "MotDePasseFictif123!" },
    "",
  );
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  expect(
    (
      await f.request(
        "GET",
        "/administration/scopes?kind=dossier",
        undefined,
        cookie,
      )
    )
      .json()
      .items.map((x: { id: string }) => x.id),
  ).toEqual([a.id]);
  expect(
    (
      await f.request(
        "GET",
        "/administration/scopes?kind=group",
        undefined,
        cookie,
      )
    )
      .json()
      .items.map((x: { id: string }) => x.id),
  ).toEqual([group.id]);
  const query = `kind=contact&groupId=${group.id}`;
  expect(
    (await f.request("GET", "/records?" + query, undefined, cookie)).json(),
  ).toMatchObject({ total: 1, items: [{ id: visibleContact.id }] });
  expect(
    (await f.request("GET", "/dashboard?" + query, undefined, cookie)).json()
      .counts.contact,
  ).toBe(1);
  const csv = await f.request(
    "GET",
    "/records/export.csv?" + query,
    undefined,
    cookie,
  );
  expect(csv.body).toContain(visibleContact.id);
  expect(csv.body).not.toContain(hiddenContact.id);
  const create = {
    operationId: operationId(),
    name: "Vue A",
    query: { kind: "contact", groupId: group.id },
  };
  const view = (
    await f.request("POST", "/administration/views", create, cookie)
  ).json();
  expect(
    (await f.request("POST", "/administration/views", create, cookie)).json()
      .id,
  ).toBe(view.id);
  expect(
    (await f.request("GET", "/administration/views")).json().items,
  ).toEqual([]);
  expect(
    (
      await f.request("PUT", `/administration/views/${view.id}`, {
        operationId: operationId(),
        expectedVersion: 1,
        name: "Intrusion",
        query: { kind: "dossier" },
      })
    ).statusCode,
  ).toBe(404);
  const update = {
    operationId: operationId(),
    expectedVersion: 1,
    name: "Vue modifiée",
    query: { kind: "contact", groupId: group.id, columns: "title,email" },
  };
  expect(
    (
      await f.request("PUT", `/administration/views/${view.id}`, update, cookie)
    ).json().version,
  ).toBe(2);
  expect(
    (
      await f.request(
        "PUT",
        `/administration/views/${view.id}`,
        { ...update, operationId: operationId() },
        cookie,
      )
    ).statusCode,
  ).toBe(409);
  await f.request("PUT", `/administration/groups/${group.id}`, {
    operationId: operationId(),
    expectedVersion: group.version,
    kind: "team",
    name: group.name,
    memberIds: [],
  });
  expect(
    (
      await f.request(
        "GET",
        "/administration/scopes?kind=group",
        undefined,
        cookie,
      )
    ).json().total,
  ).toBe(0);
  expect(
    (await f.request("GET", "/records?" + query, undefined, cookie)).statusCode,
  ).toBe(403);
  expect(
    (await f.request("GET", `/records/${visibleContact.id}`, undefined, cookie))
      .statusCode,
  ).toBe(404);
  expect(
    (await f.request("GET", "/records/export.csv?" + query, undefined, cookie))
      .statusCode,
  ).toBe(403);
  const remove = { operationId: operationId(), expectedVersion: 2 };
  expect(
    (
      await f.request(
        "POST",
        `/administration/views/${view.id}/remove`,
        remove,
        cookie,
      )
    ).json(),
  ).toEqual({ removed: true });
  expect(
    (
      await f.request(
        "POST",
        `/administration/views/${view.id}/remove`,
        remove,
        cookie,
      )
    ).json(),
  ).toEqual({ removed: true });
});

test("synthèse des sources : manuelle et simulée restent sans fraîcheur vérifiée dans le détail et l’export", async () => {
  f = await fixture();
  await f.setup();
  const d = (await f.request("POST", "/records", dossier())).json();
  for (const source of ["manuelle", "simulee"])
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "obligation",
        title: source,
        dossierId: d.id,
        data: {
          nature: "TVA",
          period: "2026-06",
          dueDate: "2026-06-30",
          source,
        },
      },
    });
  const query = `from=2026-06-01&to=2026-06-30&dossierId=${d.id}`;
  expect(
    (await f.request("GET", "/dashboard?" + query)).json().obligationSources,
  ).toEqual({ manual: 1, simulated: 1, verified: 0, freshness: "unknown" });
  expect(
    (
      await f.request(
        "GET",
        "/records?kind=obligation&source=manuelle&" + query,
      )
    )
      .json()
      .items.map((r: { title: string }) => r.title),
  ).toEqual(["manuelle"]);
  const csv = await f.request(
    "GET",
    "/records/export.csv?kind=obligation&source=manuelle&columns=title,source,dueDate&" +
      query,
  );
  expect(csv.body).toContain('"manuelle";"manuelle";"2026-06-30"');
  expect(csv.body).not.toContain("simulee");
});
