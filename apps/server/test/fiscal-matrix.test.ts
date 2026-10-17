import { afterEach, expect, test } from "vitest";
import { fixture, dossier, operationId } from "./helpers.js";
let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
});
const provenance = {
  kind: "manual",
  source: "Saisie fictive",
  account: "cabinet fictif",
  reference: "date",
  version: "1",
  observedAt: "2026-10-17T10:00:00.000Z",
  sourceUpdatedAt: null,
  coverage: "unknown",
  rawState: "saisie",
};
test("matrix separates dossier pagination and date reference, preserving exact amounts and export filters", async () => {
  f = await fixture();
  await f.setup();
  const a = (await f.request("POST", "/records", dossier("Atelier A"))).json();
  await f.request("POST", "/records", dossier("Atelier B sans occurrence"));
  let r = await f.request("POST", "/fiscal", {
    operationId: operationId(),
    dossierId: a.id,
    title: "TVA septembre",
    nature: "TVA",
    period: {
      start: "2026-09-01",
      end: "2026-09-30",
      campaign: "2026",
      subtype: "CA3",
    },
    financialYearEnd: "2026-12-31",
    regime: "reel_normal",
    amount: "123456789012.37",
  });
  expect(r.statusCode, r.body).toBe(201);
  const fiscal = r.json().record;
  r = await f.request("POST", `/fiscal/${fiscal.id}/commands`, {
    operationId: operationId(),
    expectedVersion: fiscal.version,
    event: {
      kind: "deadlines",
      observed: "2026-10-20",
      internalTarget: null,
      campaignDate: null,
      provenance,
    },
  });
  expect(r.statusCode, r.body).toBe(200);
  const query =
    "nature=TVA&year=2026&month=10&fiscalDateReference=due&dossierQuery=Atelier";
  r = await f.request("GET", "/fiscal/matrix?" + query + "&limit=1");
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json().total).toBe(2);
  expect(r.json().rows).toHaveLength(1);
  expect(r.json().rows[0].occurrences[0].data.amount).toBe("123456789012.37");
  expect(r.json().rows[0].complete).toBe(true);
  const next = (
    await f.request("GET", "/fiscal/matrix?" + query + "&limit=1&offset=1")
  ).json();
  expect(next.rows[0].dossier.title).toBe("Atelier B sans occurrence");
  expect(next.rows[0].occurrences).toEqual([]);
  expect(
    (
      await f.request(
        "GET",
        "/fiscal/matrix?" + query.replace("=due", "=period_end"),
      )
    ).json().rows[0].occurrences,
  ).toEqual([]);
  const csv = await f.request(
    "GET",
    "/records/export.csv?kind=obligation&fiscalOnly=true&" +
      query +
      "&columns=title,amount",
  );
  expect(csv.statusCode, csv.body).toBe(200);
  expect(csv.body).toContain("TVA septembre");
  expect(csv.body).toContain("123456789012.37");
  const empty = await f.request(
    "GET",
    "/records/export.csv?kind=obligation&fiscalOnly=true&" +
      query.replace("=due", "=period_end") +
      "&columns=title,amount",
  );
  expect(empty.body).not.toContain("TVA septembre");
  const own = (
    await f.request("GET", "/fiscal/matrix?" + query + "&own=true")
  ).json();
  expect(own.total).toBe(0); // global administrator is not an assignment.
});
test("matrix authorizes occurrences and confidential dossiers independently and updates after revocation", async () => {
  f = await fixture();
  await f.setup();
  const a = (
    await f.request("POST", "/records", dossier("Public fictif"))
  ).json();
  const secret = dossier("Secret fictif");
  const hidden = (
    await f.request("POST", "/records", {
      ...secret,
      record: { ...secret.record, confidential: true },
    })
  ).json();
  for (const parent of [a, hidden]) {
    const r = await f.request("POST", "/fiscal", {
      operationId: operationId(),
      dossierId: parent.id,
      title: "IS " + parent.title,
      nature: "IS",
      period: {
        start: "2025-01-01",
        end: "2025-12-31",
        campaign: "2026",
        subtype: "sous-type libre",
      },
      financialYearEnd: "2025-12-31",
    });
    expect(r.statusCode, r.body).toBe(201);
  }
  const u = await f.request("POST", "/users", {
    operationId: operationId(),
    name: "Lecteur fictif",
    email: "matrix-reader@example.test",
    password: "MotDePasseFictif123!",
    permissions: [{ action: "read", kind: "dossier", dossierId: null }],
  });
  expect(u.statusCode, u.body).toBe(201);
  const login = await f.request(
    "POST",
    "/login",
    { email: "matrix-reader@example.test", password: "MotDePasseFictif123!" },
    "",
  );
  const token = String(login.headers["set-cookie"]).split(";")[0]!;
  const r = await f.request(
    "GET",
    "/fiscal/matrix?nature=IS&year=2025&fiscalDateReference=closing",
    undefined,
    token,
  );
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json().total).toBe(1);
  expect(r.json().rows[0].occurrences).toEqual([]);
  const revoked = await f.request("PUT", `/users/${u.json().id}`, {
    operationId: operationId(),
    expectedVersion: u.json().version,
    active: true,
    permissions: [],
  });
  expect(revoked.statusCode, revoked.body).toBe(200);
  const after = await f.request(
    "GET",
    "/fiscal/matrix?nature=IS&year=2025&fiscalDateReference=closing",
    undefined,
    token,
  );
  expect(after.json().total).toBe(0);
  const admin = (
    await f.request(
      "GET",
      "/fiscal/matrix?nature=IS&year=2025&fiscalDateReference=closing",
    )
  ).json();
  expect(admin.total).toBe(2);
  expect(admin.rows[0].occurrences[0].data.fiscal.period.subtype).toBe(
    "sous-type libre",
  );
});
test("matrix marks partial occurrence coverage and own follows a live team assignment", async () => {
  f = await fixture();
  const admin = await f.setup();
  const d = (
    await f.request("POST", "/records", dossier("Dossier très actif"))
  ).json();
  const role = (
    await f.request("POST", "/administration/roles", {
      operationId: operationId(),
      name: "Référent",
      order: 1,
      permissions: [{ action: "read", kind: "*", dossierId: null }],
    })
  ).json();
  const group = (
    await f.request("POST", "/administration/groups", {
      operationId: operationId(),
      kind: "team",
      name: "Équipe fictive",
      memberIds: [admin.id],
    })
  ).json();
  const assigned = await f.request("POST", "/administration/assignments", {
    operationId: operationId(),
    rows: [
      {
        dossierId: d.id,
        expectedVersion: d.version,
        subject: { kind: "team", id: group.id },
        roleId: role.id,
        remove: false,
      },
    ],
  });
  expect(assigned.json().items[0].status).toBe("assigned");
  for (let i = 0; i < 201; i++) {
    const r = await f.request("POST", "/fiscal", {
      operationId: operationId(),
      dossierId: d.id,
      title: `TVA ${String(i).padStart(3, "0")}`,
      nature: "TVA",
      period: {
        start: "2026-09-01",
        end: "2026-09-30",
        campaign: "2026",
        subtype: `CA3 ${i}`,
      },
    });
    expect(r.statusCode, r.body).toBe(201);
  }
  const query =
    "nature=TVA&year=2026&month=09&fiscalDateReference=period_end&own=true";
  let result = (await f.request("GET", "/fiscal/matrix?" + query)).json();
  expect(result.total).toBe(1);
  expect(result.rows[0].total).toBe(201);
  expect(result.rows[0].occurrences).toHaveLength(200);
  expect(result.rows[0].complete).toBe(false);
  const rest = (
    await f.request(
      "GET",
      "/fiscal?" + query + "&dossierId=" + d.id + "&offset=200&limit=200",
    )
  ).json();
  expect(rest.items).toHaveLength(1);
  expect(rest.items[0].title).toBe("TVA 200");
  const removed = await f.request("POST", "/administration/assignments", {
    operationId: operationId(),
    rows: [
      {
        dossierId: d.id,
        expectedVersion: assigned.json().items[0].version,
        subject: { kind: "team", id: group.id },
        roleId: role.id,
        remove: true,
      },
    ],
  });
  expect(removed.json().items[0].status).toBe("removed");
  result = (await f.request("GET", "/fiscal/matrix?" + query)).json();
  expect(result.total).toBe(0);
});
