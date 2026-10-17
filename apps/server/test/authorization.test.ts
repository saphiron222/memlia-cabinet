import { expect, it } from "vitest";
import { fixture, dossier, task, credentials, operationId } from "./helpers.js";
it("checks live permissions, confidentiality on every surface and revokes sessions", async () => {
  const f = await fixture();
  try {
    await f.setup();
    const d = (await f.request("POST", "/records", dossier())).json();
    const secret = (
      await f.request("POST", "/records", {
        ...task(d.id),
        record: { ...task(d.id).record, confidential: true },
      })
    ).json();
    const makeUser = async (email: string, permissions: unknown[]) => {
      const res = await f.request("POST", "/users", {
        operationId: operationId(),
        name: "Utilisateur fictif",
        email,
        password: credentials.password,
        permissions,
      });
      expect(res.statusCode).toBe(201);
      return res.json();
    };
    const noRights = await makeUser("sans-droit@example.test", []);
    const login = await f.request(
      "POST",
      "/login",
      { email: noRights.email, password: credentials.password },
      "",
    );
    expect(login.statusCode).toBe(200);
    const none = String(login.headers["set-cookie"]).split(";")[0]!;
    expect(
      (await f.request("GET", `/records/${d.id}`, undefined, none)).statusCode,
    ).toBe(404);
    expect(
      (await f.request("GET", "/records/export.csv", undefined, none))
        .statusCode,
    ).toBe(403);
    expect(
      (await f.request("POST", "/records", dossier(), none)).statusCode,
    ).toBe(403);
    const reader = await makeUser(
      "lecture@example.test",
      ["read", "export", "audit"].map((action) => ({ action, kind: "*" })),
    );
    const lr = await f.request(
      "POST",
      "/login",
      { email: reader.email, password: credentials.password },
      "",
    );
    const readCookie = String(lr.headers["set-cookie"]).split(";")[0]!;
    expect(
      (await f.request("GET", `/records/${secret.id}`, undefined, readCookie))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await f.request(
          "GET",
          `/records/${secret.id}/history`,
          undefined,
          readCookie,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await f.request("GET", "/records?q=Bilan", undefined, readCookie)).json()
        .items,
    ).toEqual([]);
    expect(
      (await f.request("GET", "/records/export.csv", undefined, readCookie))
        .body,
    ).not.toContain(secret.id);
    expect(
      (await f.request("GET", "/dashboard", undefined, readCookie)).json()
        .counts.tache,
    ).toBe(0);
    expect(
      (
        await f.request("PUT", `/users/${reader.id}`, {
          operationId: operationId(),
          expectedVersion: reader.version,
          active: true,
          permissions: [],
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await f.request("PUT", `/users/${reader.id}`, {
          operationId: operationId(),
          expectedVersion: reader.version,
          active: false,
          permissions: [],
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await f.request("GET", `/records/${d.id}`, undefined, readCookie))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await f.request("PUT", `/users/${reader.id}`, {
          operationId: operationId(),
          expectedVersion: reader.version + 1,
          active: false,
          permissions: [],
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await f.request("GET", "/session", undefined, readCookie)).json(),
    ).toEqual({ user: null });
    expect(
      (await f.request("POST", "/logout", undefined, none)).statusCode,
    ).toBe(200);
    expect(
      (await f.request("GET", "/records", undefined, none)).statusCode,
    ).toBe(401);
    expect(
      (
        await f.request(
          "POST",
          "/login",
          { email: reader.email, password: credentials.password },
          "",
        )
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/v1/records",
          headers: { cookie: f.cookie, origin: "https://evil.example" },
          payload: dossier(),
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    await f.close();
  }
});
it("expires sessions, limits login attempts, and restricts bootstrap to local access", async () => {
  let now = new Date("2026-10-17T10:00:00Z");
  const f = await fixture(() => now);
  try {
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/v1/setup",
          remoteAddress: "192.0.2.5",
          headers: { origin: f.options.publicOrigin },
          payload: credentials,
        })
      ).statusCode,
    ).toBe(403);
    await f.setup();
    now = new Date("2026-10-17T19:00:00Z");
    expect((await f.request("GET", "/records")).statusCode).toBe(401);
    for (let i = 0; i < 10; i++)
      expect(
        (
          await f.request(
            "POST",
            "/login",
            { email: "absent@example.test", password: "faux" },
            "",
          )
        ).statusCode,
      ).toBe(401);
    expect(
      (
        await f.request(
          "POST",
          "/login",
          { email: "absent@example.test", password: "faux" },
          "",
        )
      ).statusCode,
    ).toBe(429);
  } finally {
    await f.close();
  }
});

it("requires approval and assignment permissions separately from general editing", async () => {
  const f = await fixture();
  try {
    await f.setup();
    const d = (await f.request("POST", "/records", dossier())).json();
    const ob = (
      await f.request("POST", "/records", {
        operationId: operationId(),
        record: {
          kind: "obligation",
          title: "Validation fictive",
          dossierId: d.id,
          data: { nature: "Personnalisée", period: "2026-10" },
        },
      })
    ).json();
    const editor = (
      await f.request("POST", "/users", {
        operationId: operationId(),
        ...credentials,
        email: "edition@example.test",
        permissions: ["read", "create", "update"].map((action) => ({
          action,
          kind: "*",
        })),
      })
    ).json();
    const login = await f.request(
      "POST",
      "/login",
      { email: editor.email, password: credentials.password },
      "",
    );
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const { id, version, createdAt, updatedAt, ...record } = ob;
    expect(
      (
        await f.request(
          "PUT",
          `/records/${id}`,
          {
            operationId: operationId(),
            expectedVersion: version,
            record: {
              ...record,
              data: { ...record.data, validation: "validee_localement" },
            },
          },
          cookie,
        )
      ).statusCode,
    ).toBe(404);
    const command = {
      operationId: operationId(),
      record: {
        kind: "tache",
        title: "Affectation fictive",
        dossierId: d.id,
        data: { assigneeIds: [editor.id] },
      },
    };
    expect(
      (await f.request("POST", "/records", command, cookie)).statusCode,
    ).toBe(404);
    expect(
      (
        await f.request("PUT", `/records/${id}`, {
          operationId: operationId(),
          expectedVersion: version,
          record: {
            ...record,
            data: { ...record.data, validation: "validee_localement" },
          },
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    await f.close();
  }
});

it("requires audit permission on each historical dossier after a contact moves from B to A", async () => {
  const f = await fixture();
  try {
    await f.setup();
    const a = (await f.request("POST", "/records", dossier("A fictif"))).json();
    const b = (await f.request("POST", "/records", dossier("B fictif"))).json();
    const contact = (
      await f.request("POST", "/records", {
        operationId: operationId(),
        record: {
          kind: "contact",
          title: "Contact déplacé fictif",
          dossierId: b.id,
          data: {},
        },
      })
    ).json();
    const { id, version, createdAt, updatedAt, ...content } = contact;
    expect(
      (
        await f.request("PUT", `/records/${id}`, {
          operationId: operationId(),
          expectedVersion: version,
          record: { ...content, dossierId: a.id },
        })
      ).statusCode,
    ).toBe(200);
    const auditor = (
      await f.request("POST", "/users", {
        operationId: operationId(),
        name: "Auditeur fictif",
        email: "audit-a@example.test",
        password: credentials.password,
        permissions: [
          { action: "read", kind: "*" },
          { action: "audit", kind: "*", dossierId: a.id },
        ],
      })
    ).json();
    const login = await f.request(
      "POST",
      "/login",
      { email: auditor.email, password: credentials.password },
      "",
    );
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    expect(
      (await f.request("GET", `/records/${id}/history`))
        .json()
        .items.map((event: { version: number }) => event.version),
    ).toEqual([1, 2]);
    const history = await f.request(
      "GET",
      `/records/${id}/history`,
      undefined,
      cookie,
    );
    expect(history.statusCode).toBe(200);
    expect(
      history.json().items.map((event: { version: number }) => event.version),
    ).toEqual([2]);
  } finally {
    await f.close();
  }
});
