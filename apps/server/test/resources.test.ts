import { expect, it } from "vitest";
import {
  CabinetRecordSchema,
  CatalogueSchema,
  ApiErrorSchema,
} from "@memlia/contracts";
import { fixture, dossier, operationId, credentials } from "./helpers.js";
import { createApplication } from "../src/app.js";

it("exposes canonical catalogue, contact and obligation lifecycle, exact amounts and archival", async () => {
  const f = await fixture();
  try {
    await f.setup();
    const catalogue = CatalogueSchema.parse(
      (await f.request("GET", "/catalogue")).json(),
    );
    expect(catalogue.resources.map((r) => r.kind)).toEqual([
      "dossier",
      "contact",
      "tache",
      "obligation",
    ]);
    expect(
      JSON.stringify(
        catalogue.resources.find((r) => r.kind === "tache")!.inputSchema,
      ),
    ).toContain("dueDate");
    const d = (await f.request("POST", "/records", dossier())).json();
    const contact = await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "contact",
        title: "Contact fictif",
        dossierId: d.id,
        data: { email: "client@example.test", contactType: "organisation" },
      },
    });
    expect(contact.statusCode).toBe(201);
    expect(CabinetRecordSchema.parse(contact.json())).toMatchObject({
      kind: "contact",
      data: { email: "client@example.test" },
    });
    const command = (amount: string | null, title = "Obligation fictive") => ({
      operationId: operationId(),
      record: {
        kind: "obligation",
        title,
        dossierId: d.id,
        data: {
          nature: "Personnalisée",
          period: "2026-10",
          dueDate: "2026-10-31",
          amount,
        },
      },
    });
    const obligation = (
      await f.request("POST", "/records", command("0.00"))
    ).json();
    const unknown = (
      await f.request("POST", "/records", command(null, "Montant inconnu"))
    ).json();
    expect(CabinetRecordSchema.parse(obligation)).toMatchObject({
      data: { amount: "0.00", validation: "non_validee" },
    });
    expect(CabinetRecordSchema.parse(unknown)).toMatchObject({
      data: { amount: null },
    });
    const { id, version, createdAt, updatedAt, ...record } = obligation;
    expect(
      (
        await f.request("PUT", `/records/${id}`, {
          operationId: operationId(),
          expectedVersion: version,
          record: { ...record, data: { ...record.data, archived: true } },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await f.request("GET", "/records?kind=obligation"))
        .json()
        .items.map((r: { id: string }) => r.id),
    ).toEqual([unknown.id]);
    expect(
      (await f.request("GET", "/records?kind=obligation&archived=true")).json()
        .items[0].data.amount,
    ).toBe("0.00");
    expect(
      (await f.request("GET", `/records/${id}`)).json().data.archived,
    ).toBe(true);
    expect(
      (
        await f.request(
          "GET",
          "/records/export.csv?kind=obligation&archived=true",
        )
      ).body,
    ).toContain("0.00");
    expect(
      (await f.request("POST", "/records", command("0.001"))).statusCode,
    ).toBe(400);
    expect(
      (
        await f.request("POST", "/records", {
          operationId: operationId(),
          record: {
            kind: "contact",
            title: "Invalide",
            data: { arbitrary: "refused" },
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await f.request("GET", `/records/${id}/history`)).json().items,
    ).toHaveLength(2);
    const missing = await f.request("GET", "/inconnu");
    expect(missing.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(missing.json()).error.code).toBe("NOT_FOUND");
    await f.restart();
    expect((await f.request("GET", `/records/${d.id}`)).json().data.siren).toBe(
      "001234567",
    );
  } finally {
    await f.close();
  }
});

it("combines dossier grants with confidentiality and refuses moving a record outside the granted dossier", async () => {
  const f = await fixture();
  try {
    await f.setup();
    const a = (await f.request("POST", "/records", dossier("A fictif"))).json();
    const b = (await f.request("POST", "/records", dossier("B fictif"))).json();
    const permissions = ["read", "create", "update", "export", "audit"].map(
      (action) => ({ action, kind: "*", dossierId: a.id }),
    );
    const user = (
      await f.request("POST", "/users", {
        operationId: operationId(),
        ...credentials,
        email: "local@example.test",
        permissions,
      })
    ).json();
    const session = await f.request(
      "POST",
      "/login",
      { email: user.email, password: credentials.password },
      "",
    );
    const cookie = String(session.headers["set-cookie"]).split(";")[0]!;
    expect(
      (await f.request("GET", "/records?kind=dossier", undefined, cookie))
        .json()
        .items.map((r: { id: string }) => r.id),
    ).toEqual([a.id]);
    const command = {
      operationId: operationId(),
      record: {
        kind: "contact",
        title: "Contact local fictif",
        dossierId: a.id,
        data: {},
      },
    };
    const created = await f.request("POST", "/records", command, cookie);
    expect(created.statusCode).toBe(201);
    const { id, version, createdAt, updatedAt, ...content } = created.json();
    expect(
      (
        await f.request(
          "PUT",
          `/records/${id}`,
          {
            operationId: operationId(),
            expectedVersion: version,
            record: { ...content, dossierId: b.id },
          },
          cookie,
        )
      ).statusCode,
    ).toBe(404);
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
      (await f.request("POST", "/records", command, cookie)).statusCode,
    ).toBe(404);
    expect(
      (await f.request("GET", "/records/export.csv", undefined, cookie)).body,
    ).not.toContain(id);
    expect(
      (await f.request("GET", "/users", undefined, cookie)).statusCode,
    ).toBe(403);
    expect((await f.request("GET", "/users")).json().items).toHaveLength(2);
  } finally {
    await f.close();
  }
});

it("requires an explicit embedded database opt-in", async () => {
  await expect(
    createApplication({
      dataDirectory: "/unused-test-path",
      publicOrigin: "http://localhost:3000",
    }),
  ).rejects.toThrow("DATABASE_URL requis");
});
