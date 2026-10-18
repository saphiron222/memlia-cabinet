import { expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fixture, dossier, operationId } from "./helpers.js";
import { DocumentStore } from "../src/documents/store.js";
import { DocumentInputSchema } from "@memlia/contracts";
test("sortie complète : identité installation, objets archivés, références manquantes et confidentialité courante", async () => {
  const f = await fixture();
  try {
    const actor = await f.setup(),
      publicRecord = (
        await f.request("POST", "/records", dossier("Dossier exportable"))
      ).json();
    const secret = dossier("SECRET non exportable");
    await f.request("POST", "/records", {
      ...secret,
      record: { ...secret.record, confidential: true },
    });
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "contact",
        title: "Contact archivé",
        data: { archived: true },
        dossierId: null,
      },
    });
    const store = new DocumentStore(f.options.dataDirectory);
    let id = "",
      hidden = "";
    await f.maintainDatabase(async (db) => {
      for (const confidential of [false, true]) {
        const p = await store.prepare(
          DocumentInputSchema.parse({
            operationId: operationId(),
            dossierId: publicRecord.id,
            filename: confidential ? "SECRET.txt" : "absent-fictif.txt",
            mediaType: "text/plain",
            source: { kind: "manual", reference: "fictif", version: "1" },
            confidential,
          }),
          Buffer.from("Original fictif"),
        );
        try {
          const saved = await db.transaction((tx) =>
            store.commit(tx, actor, p, new Date()),
          );
          if (confidential) hidden = saved.id;
          else id = saved.id;
        } finally {
          await store.discard(p);
        }
      }
    });
    await rm(join(f.options.dataDirectory, "documents", id));
    const reader = (
      await f.request("POST", "/users", {
        operationId: operationId(),
        name: "Exporteur",
        email: "exporteur@example.test",
        password: "MotDePasseFictif123!",
        permissions: ["read", "export"].map((action) => ({
          action,
          kind: "*",
        })),
      })
    ).json();
    const login = await f.request(
      "POST",
      "/login",
      { email: reader.email, password: "MotDePasseFictif123!" },
      "",
    );
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const command = { operationId: operationId() };
    const queued = await f.request(
      "POST",
      "/administration/exports",
      command,
      cookie,
    );
    expect(queued.statusCode).toBe(202);
    const run = queued.json();
    for (let i = 0; i < 200; i++) {
      const state = (
        await f.request(
          "GET",
          `/administration/exports/${run.id}`,
          undefined,
          cookie,
        )
      ).json();
      if (state.job?.state === "completed") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(
      (
        await f.request("GET", "/administration/exports", undefined, cookie)
      ).json().items[0],
    ).toMatchObject({
      id: run.id,
      records: 2,
      documents: 1,
      job: { state: "completed" },
    });
    const response = await f.request(
      "GET",
      `/administration/exports/${run.id}/download`,
      undefined,
      cookie,
    );
    expect(response.statusCode).toBe(200);
    const manifest = response.json();
    expect(manifest.format).toBe("memlia-cabinet-manifest-1");
    expect(manifest.parts).toHaveLength(1);
    const partResponse = await f.request(
      "GET",
      `/administration/exports/${run.id}/parts/1`,
      undefined,
      cookie,
    );
    expect(partResponse.statusCode).toBe(200);
    const output = partResponse.json();
    expect(output.sourceInstallation.id).toBe(
      (await f.request("GET", "/administration/installation")).json().id,
    );
    expect(
      output.records.map((r: { title: string }) => r.title).sort(),
    ).toEqual(["Contact archivé", "Dossier exportable"]);
    expect(output.documents).toHaveLength(1);
    expect(output.documents[0]).toMatchObject({
      id,
      availability: "missing",
      downloadUrl: `/api/v1/documents/${id}/download`,
    });
    expect(output.errors).toEqual([
      {
        documentId: id,
        code: "DOCUMENT_MISSING",
        message: "Original absent du stockage local.",
      },
    ]);
    expect(partResponse.body).not.toContain("SECRET");
    expect(partResponse.body).not.toContain(hidden);
    await f.request("PUT", `/users/${reader.id}`, {
      operationId: operationId(),
      expectedVersion: reader.version,
      active: true,
      permissions: [
        { action: "read", kind: "*", dossierId: publicRecord.id },
        { action: "export", kind: "*", dossierId: publicRecord.id },
      ],
    });
    expect(
      (
        await f.request(
          "GET",
          `/administration/exports/${run.id}/download`,
          undefined,
          cookie,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await f.request(
          "GET",
          `/administration/exports/${run.id}`,
          undefined,
          cookie,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await f.request(
          "GET",
          `/administration/exports/${run.id}/parts/1`,
          undefined,
          cookie,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await f.request("POST", "/administration/exports", command, cookie))
        .statusCode,
    ).toBe(403);
    expect(
      (await f.request("GET", `/collections/${run.job.id}`, undefined, cookie))
        .statusCode,
    ).toBe(404);
    expect(
      (await f.request("GET", `/jobs/${run.job.id}`, undefined, cookie))
        .statusCode,
    ).toBe(404);
  } finally {
    await f.close();
  }
});

test("sortie par lots : reprise durable et journal compatible avec le corpus cible", async () => {
  const f = await fixture(undefined, { exportPartBytes: 32768 });
  try {
    const actor = await f.setup();
    const { saveRecord } = await import("../src/records/service.js");
    const { CreateRecordInputSchema } = await import("@memlia/contracts");
    await f.maintainDatabase(async (db) => {
      await db.transaction(async (tx) => {
        for (let i = 0; i < 1001; i++)
          await saveRecord(
            tx,
            actor,
            CreateRecordInputSchema.parse(dossier(`Export fictif ${i}`)),
            new Date(),
          );
      });
    });
    const command = { operationId: operationId() };
    const run = (
      await f.request("POST", "/administration/exports", command)
    ).json();
    await f.restart();
    let state = run;
    for (let i = 0; i < 1000; i++) {
      state = (
        await f.request("GET", `/administration/exports/${run.id}`)
      ).json();
      if (["completed", "failed"].includes(state.job?.state)) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(state.job.state).toBe("completed");
    expect(state.records).toBe(1001);
    // At least 1 000 objects per durable data unit: 110 000 target objects
    // require 110 units, leaving room in the existing 500-event journal.
    // Two additional bounded units traverse the fiscal and workflow phases.
    // The shared journal remains capped at 500 events.
    expect(
      state.job.events.filter(
        (e: { code: string }) => e.code === "export.batch",
      ).length,
    ).toBeLessThanOrEqual(6);
    const output = (
      await f.request("GET", `/administration/exports/${run.id}/download`)
    ).json();
    expect(output.parts.length).toBeGreaterThan(1);
    const ids = new Set<string>();
    for (const part of output.parts) {
      const response = await f.request(
        "GET",
        `/administration/exports/${run.id}/parts/${part.number}`,
      );
      expect(response.statusCode).toBe(200);
      expect(Buffer.byteLength(response.body)).toBeLessThanOrEqual(32768);
      for (const record of response.json().records) ids.add(record.id);
    }
    expect(ids.size).toBe(1001);
    expect(output.records).toBe(1001);
    expect(
      (await f.request("POST", "/administration/exports", command)).json().id,
    ).toBe(run.id);
    const query = {
      kind: "dossier",
      q: "Export fictif",
      columns: "title,siren,capital",
      sort: "title",
      direction: "desc",
      offset: 4,
      limit: 3,
    };
    expect(
      (await f.request("GET", "/records/export.csv?kind=dossier")).json().error
        .code,
    ).toBe("EXPORT_ASYNC_REQUIRED");
    const csvRun = (
      await f.request("POST", "/administration/exports", {
        operationId: operationId(),
        query,
      })
    ).json();
    for (let i = 0; i < 1000; i++) {
      const state = (
        await f.request("GET", `/administration/exports/${csvRun.id}`)
      ).json();
      if (state.job.state === "completed") break;
      if (state.job.state === "failed") throw Error(state.error);
      await new Promise((r) => setTimeout(r, 20));
    }
    const csvManifest = (
      await f.request("GET", `/administration/exports/${csvRun.id}/download`)
    ).json();
    expect(csvManifest.encoding).toBe("csv");
    expect(csvManifest.query).toMatchObject(query);
    expect(csvManifest.records).toBe(1001);
    const lines: string[] = [];
    for (const part of csvManifest.parts) {
      const response = await f.request(
        "GET",
        `/administration/exports/${csvRun.id}/parts/${part.number}`,
      );
      expect(response.headers["content-type"]).toContain("text/csv");
      expect(Buffer.byteLength(response.body)).toBeLessThanOrEqual(32768);
      const [header, ...rows] = response.body
        .replace(/^\uFEFF/, "")
        .trimEnd()
        .split("\r\n");
      expect(header).toBe('"title";"siren";"capital"');
      lines.push(...rows);
    }
    expect(lines).toHaveLength(1001);
    expect(lines).toEqual([...lines].sort().reverse());
    expect(lines[0]).toContain('"001234567";""');
  } finally {
    await f.close();
  }
}, 60000);
