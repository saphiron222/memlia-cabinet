import { afterEach, expect, test } from "vitest";
import { fixture, dossier, operationId, origin } from "./helpers.js";
let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
});
const permissions = ["read", "export", "audit", "update"].map((action) => ({
  action,
  kind: "*",
  dossierId: null,
}));
async function role(name: string, grants = permissions) {
  const res = await f.request("POST", "/administration/roles", {
    operationId: operationId(),
    name,
    order: 10,
    permissions: grants,
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}
async function reader() {
  const res = await f.request("POST", "/users", {
    operationId: operationId(),
    email: "reader@example.test",
    name: "Lecteur fictif",
    password: "MotDePasseFictif123!",
    permissions: [],
  });
  expect(res.statusCode).toBe(201);
  const login = await f.request(
    "POST",
    "/login",
    { email: "reader@example.test", password: "MotDePasseFictif123!" },
    "",
  );
  return {
    user: res.json(),
    cookie: String(login.headers["set-cookie"]).split(";")[0]!,
  };
}
test("équipe et site persistés : affectation explicite, révocation immédiate, rapport non divulguant et rejeu autorisé", async () => {
  f = await fixture();
  await f.setup();
  const a = (
    await f.request("POST", "/records", dossier("Dossier accessible"))
  ).json();
  const b = (
    await f.request("POST", "/records", dossier("Dossier étranger"))
  ).json();
  const r = await role("Collaborateur");
  const u = await reader();
  const team = await f.request("POST", "/administration/groups", {
    operationId: operationId(),
    kind: "team",
    name: "Équipe Paris",
    memberIds: [u.user.id],
  });
  expect(team.statusCode).toBe(201);
  const group = team.json();
  const assignment = {
    operationId: operationId(),
    rows: [
      {
        dossierId: a.id,
        expectedVersion: a.version,
        subject: { kind: "team", id: group.id },
        roleId: r.id,
        remove: false,
      },
    ],
  };
  const assigned = await f.request(
    "POST",
    "/administration/assignments",
    assignment,
  );
  expect(assigned.statusCode).toBe(200);
  expect(assigned.json().items).toEqual([
    { dossierId: a.id, status: "assigned", version: 2 },
  ]);
  expect(
    (await f.request("POST", "/administration/assignments", assignment)).json(),
  ).toEqual(assigned.json());
  expect(
    (await f.request("GET", `/records/${a.id}`, undefined, u.cookie))
      .statusCode,
  ).toBe(200);
  expect(
    (await f.request("GET", `/records/${b.id}`, undefined, u.cookie))
      .statusCode,
  ).toBe(404);
  expect(
    (await f.request("GET", "/records?kind=dossier", undefined, u.cookie))
      .json()
      .items.map((x: { title: string }) => x.title),
  ).toEqual(["Dossier accessible"]);
  const exported = await f.request(
    "GET",
    "/records/export.csv?kind=dossier",
    undefined,
    u.cookie,
  );
  expect(exported.statusCode).toBe(200);
  expect(exported.body).toContain("Dossier accessible");
  expect(exported.body).not.toContain("Dossier étranger");
  const capabilities = await f.request(
    "GET",
    `/capabilities/records?ids=${a.id},${b.id}`,
    undefined,
    u.cookie,
  );
  expect(capabilities.statusCode).toBe(200);
  expect(
    capabilities.json().items.map((item: { id: string }) => item.id),
  ).toEqual([a.id]);
  expect(capabilities.json().items[0].actions).toEqual([
    "read",
    "update",
    "export",
    "audit",
  ]);
  expect(
    (
      await f.request(
        "GET",
        `/capabilities/create?kind=tache&dossierId=${b.id}`,
        undefined,
        u.cookie,
      )
    ).json().actions,
  ).toEqual([]);
  await f.restart();
  expect(
    (await f.request("GET", "/administration/groups")).json().items[0]
      .memberIds,
  ).toEqual([u.user.id]);
  const removed = await f.request("PUT", `/administration/groups/${group.id}`, {
    operationId: operationId(),
    expectedVersion: group.version,
    kind: "team",
    name: "Équipe Paris",
    memberIds: [],
  });
  expect(removed.statusCode).toBe(200);
  expect(
    (await f.request("GET", `/records/${a.id}`, undefined, u.cookie))
      .statusCode,
  ).toBe(404);
  expect(
    (await f.request("GET", "/records?kind=dossier", undefined, u.cookie)).body,
  ).not.toContain("Dossier accessible");
  expect(
    (
      await f.request(
        "GET",
        "/records/export.csv?kind=dossier",
        undefined,
        u.cookie,
      )
    ).body,
  ).not.toContain("Dossier accessible");
});
test("rôle global : nom/ordre/droits persistés et dernier administrateur protégé par toutes les éditions", async () => {
  f = await fixture();
  const admin = await f.setup();
  const manager = await role("Responsable", [
    { action: "manage_users", kind: "*", dossierId: null },
  ]);
  const assigned = await f.request("PUT", `/administration/users/${admin.id}`, {
    operationId: operationId(),
    expectedVersion: admin.version,
    active: true,
    permissions: [],
    roleIds: [manager.id],
    name: "Admin nommé",
  });
  expect(assigned.statusCode).toBe(200);
  const edit = await f.request("PUT", `/administration/roles/${manager.id}`, {
    operationId: operationId(),
    expectedVersion: manager.version,
    name: "Gestionnaire",
    order: 1,
    permissions: [],
  });
  expect(edit.statusCode).toBe(409);
  expect(edit.json().error.code).toBe("LAST_ADMINISTRATOR");
  const removed = await f.request("PUT", `/administration/users/${admin.id}`, {
    operationId: operationId(),
    expectedVersion: assigned.json().version,
    active: false,
    permissions: [],
    roleIds: [],
    name: "Admin nommé",
  });
  expect(removed.statusCode).toBe(409);
  expect(removed.json().error.code).toBe("LAST_ADMINISTRATOR");
  const oldRoute = await f.request("PUT", `/users/${admin.id}`, {
    operationId: operationId(),
    expectedVersion: assigned.json().version,
    active: false,
    permissions: [],
  });
  expect(oldRoute.statusCode).toBe(409);
  await f.restart();
  expect(
    (await f.request("GET", "/administration/users")).json().items[0].roleIds,
  ).toEqual([manager.id]);
  expect(
    (await f.request("GET", "/administration/roles")).json().items[0],
  ).toMatchObject({ name: "Responsable", order: 10 });
  const current = await f.request("GET", "/session");
  expect(current.json().user.permissions).toContainEqual({
    action: "manage_users",
    kind: "*",
    dossierId: null,
  });
});
test("lot partiellement autorisé : seul le dossier accessible change ; pièce, recherche et ancien rejeu sont révoqués", async () => {
  f = await fixture();
  await f.setup();
  const a = (
    await f.request("POST", "/records", dossier("Autorisé fictif"))
  ).json();
  const b = (
    await f.request("POST", "/records", dossier("Secret hors portée"))
  ).json();
  const u = await reader();
  const r = await role("Gestion locale", [
    ...permissions,
    { action: "assign", kind: "*", dossierId: null },
  ]);
  const initial = await f.request("POST", "/administration/assignments", {
    operationId: operationId(),
    rows: [
      {
        dossierId: a.id,
        expectedVersion: 1,
        subject: { kind: "user", id: u.user.id },
        roleId: r.id,
        remove: false,
      },
    ],
  });
  expect(initial.statusCode).toBe(200);
  const upload = await f.app.inject({
    method: "POST",
    url: "/api/v1/documents",
    headers: {
      origin,
      cookie: f.cookie,
      "content-type": "multipart/form-data; boundary=piece",
    },
    payload: Buffer.from(
      `--piece\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify({ operationId: operationId(), dossierId: a.id, filename: "preuve.txt", mediaType: "text/plain", source: { kind: "manual", reference: "fictif", version: "1" } })}\r\n--piece\r\nContent-Disposition: form-data; name="file"; filename="preuve.txt"\r\nContent-Type: text/plain\r\n\r\nPièce fictive accessible\r\n--piece--\r\n`,
    ),
  });
  expect(upload.statusCode).toBe(201);
  const doc = upload.json();
  expect(
    (await f.request("GET", "/documents?q=fictive", undefined, u.cookie))
      .json()
      .items.map((x: { id: string }) => x.id),
  ).toEqual([doc.id]);
  expect(
    (
      await f.request(
        "GET",
        `/documents/${doc.id}/download`,
        undefined,
        u.cookie,
      )
    ).statusCode,
  ).toBe(200);
  const site = (
    await f.request("POST", "/administration/groups", {
      operationId: operationId(),
      kind: "site",
      name: "Site fictif",
      memberIds: [],
    })
  ).json();
  const input = {
    operationId: operationId(),
    rows: [
      {
        dossierId: a.id,
        expectedVersion: 2,
        subject: { kind: "site", id: site.id },
        roleId: r.id,
        remove: false,
      },
      {
        dossierId: b.id,
        expectedVersion: 1,
        subject: { kind: "site", id: site.id },
        roleId: r.id,
        remove: false,
      },
    ],
  };
  const batch = await f.request(
    "POST",
    "/administration/assignments",
    input,
    u.cookie,
  );
  expect(batch.statusCode).toBe(200);
  expect(batch.json().items).toEqual([
    { dossierId: a.id, status: "assigned", version: 3 },
    { dossierId: b.id, status: "refused" },
  ]);
  expect(
    (await f.request("GET", `/administration/assignments/${b.id}`)).json()
      .items,
  ).toEqual([]);
  const changed = await f.request("PUT", `/administration/roles/${r.id}`, {
    operationId: operationId(),
    expectedVersion: r.version,
    name: "Rôle retiré",
    order: 0,
    permissions: [],
  });
  expect(changed.statusCode).toBe(200);
  expect(
    (
      await f.request(
        "GET",
        `/documents/${doc.id}/download`,
        undefined,
        u.cookie,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (await f.request("GET", "/documents?q=fictive", undefined, u.cookie)).json()
      .items,
  ).toEqual([]);
  expect(
    (await f.request("GET", `/records/${a.id}`, undefined, u.cookie))
      .statusCode,
  ).toBe(404);
  expect(
    (
      await f.request("POST", "/administration/assignments", input, u.cookie)
    ).json().items,
  ).toEqual([
    { dossierId: a.id, status: "refused" },
    { dossierId: b.id, status: "refused" },
  ]);
  expect(
    (await f.request("GET", `/records/${a.id}/history`)).json().items,
  ).toHaveLength(1);
});
test("une affectation déléguée ne peut s’accorder une permission confidentielle absente", async () => {
  f = await fixture();
  await f.setup();
  const d = (await f.request("POST", "/records", dossier())).json();
  const u = await reader();
  const delegate = await role("Affectation limitée", [
    ...permissions,
    { action: "assign", kind: "*", dossierId: null },
  ]);
  const elevated = await role("Confidentiel", [
    ...permissions,
    { action: "confidential", kind: "*", dossierId: null },
  ]);
  expect(
    (
      await f.request("POST", "/administration/assignments", {
        operationId: operationId(),
        rows: [
          {
            dossierId: d.id,
            expectedVersion: 1,
            subject: { kind: "user", id: u.user.id },
            roleId: delegate.id,
            remove: false,
          },
        ],
      })
    ).statusCode,
  ).toBe(200);
  const attempt = await f.request(
    "POST",
    "/administration/assignments",
    {
      operationId: operationId(),
      rows: [
        {
          dossierId: d.id,
          expectedVersion: 2,
          subject: { kind: "user", id: u.user.id },
          roleId: elevated.id,
          remove: false,
        },
      ],
    },
    u.cookie,
  );
  expect(attempt.json().items).toEqual([
    { dossierId: d.id, status: "refused" },
  ]);
});
