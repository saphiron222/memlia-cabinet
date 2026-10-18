import { request as httpRequest } from "node:http";
import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  fixture,
  dossier,
  operationId,
  origin,
  credentials,
} from "./helpers.js";

// A genuine, completely fictitious PDF with a computed cross-reference table.
function pdf(text = "Document fictif orchidée") {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(output, "latin1"));
    output += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const start = Buffer.byteLength(output, "latin1");
  output += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(output, "latin1");
}
function multipart(
  meta: Record<string, unknown>,
  bytes: Buffer,
  filename = "original.pdf",
  mediaType = "application/pdf",
  end = true,
) {
  return Buffer.concat([
    Buffer.from(
      `--piece\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(meta)}\r\n--piece\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mediaType}\r\n\r\n`,
    ),
    bytes,
    Buffer.from(end ? "\r\n--piece--\r\n" : ""),
  ]);
}
async function upload(
  f: Awaited<ReturnType<typeof fixture>>,
  meta: Record<string, unknown>,
  bytes = pdf(),
  name = "original.pdf",
  type = "application/pdf",
  cookie = f.cookie,
  end = true,
) {
  return f.app.inject({
    method: "POST",
    url: "/api/v1/documents",
    headers: {
      origin,
      cookie,
      "content-type": "multipart/form-data; boundary=piece",
    },
    payload: multipart(meta, bytes, name, type, end),
  });
}
const metadata = (dossierId: string, extra = {}) => ({
  operationId: operationId(),
  dossierId,
  filename: "original.pdf",
  mediaType: "application/pdf",
  source: { kind: "manual", reference: "fictif", version: "1" },
  ...extra,
});
it("uploads a genuine PDF, preserves explicit versions and independent same-name originals across restart", async () => {
  const f = await fixture();
  try {
    await f.setup();
    expect((await f.request("GET", "/documents/catalogue")).json()).toEqual({
      maxBytes: 10485760,
      formats: [
        {
          mediaType: "application/pdf",
          label: "PDF (non protégé)",
          extraction: true,
        },
        { mediaType: "text/plain", label: "Texte UTF-8", extraction: true },
        {
          mediaType: "application/octet-stream",
          label: "Original binaire (sans extraction)",
          extraction: false,
        },
      ],
    });
    const d = (await f.request("POST", "/records", dossier())).json();
    const input = metadata(d.id),
      bytes = pdf();
    const first = await upload(f, input, bytes);
    expect(first.statusCode).toBe(201);
    const a = first.json();
    expect(a).toMatchObject({
      version: 1,
      previousVersionId: null,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      extraction: { status: "complete" },
      availability: "available",
    });
    expect((await upload(f, input, bytes)).json().id).toBe(a.id);
    const second = await upload(
      f,
      metadata(d.id, {
        previousVersionId: a.id,
        source: { kind: "manual", reference: "fictif", version: "2" },
      }),
      bytes,
    );
    expect(second.statusCode).toBe(201);
    const b = second.json();
    expect(b).toMatchObject({
      logicalId: a.logicalId,
      previousVersionId: a.id,
      version: 2,
      sha256: a.sha256,
    });
    expect(b.id).not.toBe(a.id);
    expect((await upload(f, metadata(d.id))).json().logicalId).not.toBe(
      a.logicalId,
    );
    expect(
      (await upload(f, metadata(d.id, { previousVersionId: a.id }))).statusCode,
    ).toBe(409);
    await f.restart();
    const downloaded = await f.request("GET", `/documents/${b.id}/download`);
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.rawPayload).toEqual(bytes);
    expect(
      (await f.request("GET", `/documents?logicalId=${a.logicalId}`))
        .json()
        .items.map((x: { id: string }) => x.id),
    ).toEqual([a.id, b.id]);
  } finally {
    await f.close();
  }
});
it("rejects disguised HTML, corrupt PDF, traversal, unsupported types and interrupted multipart without definitive documents", async () => {
  const f = await fixture();
  try {
    await f.setup();
    const d = (await f.request("POST", "/records", dossier())).json();
    for (const [bytes, name, type, end] of [
      [
        Buffer.from("<html>Connexion</html>"),
        "original.pdf",
        "application/pdf",
        true,
      ],
      [
        Buffer.from("%PDF-1.4\nbroken\n%%EOF"),
        "original.pdf",
        "application/pdf",
        true,
      ],
      [pdf(), "../escape.pdf", "application/pdf", true],
      [Buffer.from("zip"), "x.zip", "application/zip", true],
      [pdf(), "original.pdf", "application/pdf", false],
    ] as const) {
      const res = await upload(
        f,
        metadata(d.id, { filename: name, mediaType: type }),
        bytes,
        name,
        type,
        f.cookie,
        end,
      );
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
    }
    expect((await f.request("GET", "/documents")).json()).toMatchObject({
      items: [],
      total: 0,
    });
  } finally {
    await f.close();
  }
});
it("searches extracted text only in authorized documents and keeps missing/corrupt originals distinct from metadata", async () => {
  const f = await fixture();
  try {
    await f.setup();
    const a = (await f.request("POST", "/records", dossier("A"))).json(),
      b = (await f.request("POST", "/records", dossier("B"))).json();
    const one = (
      await upload(f, metadata(a.id), pdf("orchidee fictive"))
    ).json();
    const two = (
      await upload(
        f,
        metadata(b.id, { filename: "notes.txt", mediaType: "text/plain" }),
        Buffer.from("tulipe fictive"),
        "notes.txt",
        "text/plain",
      )
    ).json();
    const secret = (
      await upload(
        f,
        metadata(a.id, { confidential: true }),
        pdf("secret orchidee"),
      )
    ).json();
    const user = (
      await f.request("POST", "/users", {
        operationId: operationId(),
        ...credentials,
        email: "reader@example.test",
        permissions: [
          { action: "read", kind: "dossier", dossierId: a.id },
          { action: "export", kind: "dossier", dossierId: a.id },
        ],
      })
    ).json();
    const login = await f.request(
      "POST",
      "/login",
      { email: user.email, password: credentials.password },
      "",
    );
    const token = String(login.headers["set-cookie"]).split(";")[0]!;
    expect(
      (
        await f.request("GET", "/documents?q=orchidee", undefined, token)
      ).json(),
    ).toMatchObject({ total: 1, items: [{ id: one.id }] });
    expect(
      (await f.request("GET", "/documents?q=tulipe", undefined, token)).json()
        .total,
    ).toBe(0);
    for (const id of [two.id, secret.id]) {
      for (const suffix of ["", "/download"])
        expect(
          (
            await f.request(
              "GET",
              `/documents/${id}${suffix}`,
              undefined,
              token,
            )
          ).statusCode,
        ).toBe(404);
      expect(
        (
          await f.request("GET", `/documents?logicalId=${id}`, undefined, token)
        ).json().total,
      ).toBe(0);
    }
    expect(
      (
        await upload(
          f,
          metadata(b.id),
          pdf(),
          "original.pdf",
          "application/pdf",
          token,
        )
      ).statusCode,
    ).toBe(404);
    await unlink(join(f.options.dataDirectory, "documents", one.id));
    expect(
      (await f.request("GET", `/documents/${one.id}`)).json().availability,
    ).toBe("missing");
    expect(
      (await f.request("GET", `/documents/${one.id}/download`)).statusCode,
    ).toBe(410);
    await writeFile(
      join(f.options.dataDirectory, "documents", two.id),
      Buffer.alloc(two.size, 120),
    );
    expect(
      (await f.request("GET", `/documents/${two.id}`)).json().availability,
    ).toBe("corrupt");
    expect(
      (await f.request("GET", `/documents/${two.id}/download`)).statusCode,
    ).toBe(422);
  } finally {
    await f.close();
  }
});
// Core HTTP retains a complete early error response even when the request body is
// still being written. Undici fetch can instead reject that exchange with EPIPE.
async function postLarge(
  url: string,
  headers: Record<string, string>,
  content: Uint8Array | string,
) {
  const bytes = Buffer.from(content);
  return new Promise<{ status: number; body: unknown; bytesSent: number }>(
    (resolve, reject) => {
      let responseStarted = false,
        complete = false,
        offset = 0,
        writeError: Error | undefined;
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error("Réponse HTTP complète absente."));
      }, 5000);
      const req = httpRequest(
        url,
        {
          method: "POST",
          headers: {
            ...headers,
            "content-length": String(bytes.length),
            expect: "100-continue",
          },
        },
        (response) => {
          responseStarted = true;
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          response.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
          response.on("end", () => {
            clearTimeout(timer);
            if (!response.complete) {
              reject(new Error("Réponse HTTP tronquée."));
              return;
            }
            complete = true;
            try {
              resolve({
                status: response.statusCode!,
                body: JSON.parse(Buffer.concat(chunks).toString()),
                bytesSent: offset,
              });
            } catch (error) {
              reject(error);
            }
          });
          req.end();
        },
      );
      req.on("error", (error) => {
        writeError = error;
      });
      req.on("close", () => {
        if (!complete && !responseStarted) {
          clearTimeout(timer);
          reject(
            writeError ?? new Error("Connexion fermée sans réponse HTTP."),
          );
        }
      });
      const send = () => {
        if (responseStarted || req.destroyed) return;
        if (offset === bytes.length) {
          req.end();
          return;
        }
        const end = Math.min(offset + 16384, bytes.length),
          chunk = bytes.subarray(offset, end);
        offset = end;
        if (req.write(chunk)) setImmediate(send);
        else req.once("drain", send);
      };
      req.once("continue", () => setImmediate(send));
      req.flushHeaders();
    },
  );
}
it("returns structured 413 for a real oversized JSON request and multipart upload", async () => {
  const f = await fixture();
  try {
    await f.setup();
    const d = (await f.request("POST", "/records", dossier())).json();
    const address = await f.app.listen({ port: 0, host: "127.0.0.1" });
    const oversizedJson = JSON.stringify({ huge: "x".repeat(1024 * 1024 + 1) });
    const res = await postLarge(
      address + "/api/v1/records",
      { origin, cookie: f.cookie, "content-type": "application/json" },
      oversizedJson,
    );
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
    expect(res.bytesSent).toBeLessThan(Buffer.byteLength(oversizedJson));
    const large = await postLarge(
      address + "/api/v1/documents",
      {
        origin,
        cookie: f.cookie,
        "content-type": "multipart/form-data; boundary=piece",
      },
      multipart(metadata(d.id), Buffer.alloc(10 * 1024 * 1024 + 1)),
    );
    expect(large.status).toBe(413);
    expect(large.body).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
    expect((await f.request("GET", "/documents")).json().total).toBe(0);
  } finally {
    await f.close();
  }
});

it("prepares streams outside transactions, rejects interruption and revoked rights, and keeps a rolled-back original private", async () => {
  const f = await fixture();
  try {
    const actor = await f.setup();
    const d = (await f.request("POST", "/records", dossier())).json();
    const { DocumentStore } = await import("../src/documents/store.js");
    const { DocumentInputSchema } = await import("@memlia/contracts");
    const store = new DocumentStore(f.options.dataDirectory);
    const input = DocumentInputSchema.parse(
      metadata(d.id, {
        filename: "fixture.bin",
        mediaType: "application/octet-stream",
      }),
    );
    async function* interrupted() {
      yield Buffer.from("fictif");
      throw Error("interruption fictive");
    }
    await expect(store.prepare(input, interrupted())).rejects.toThrow(
      "interruption fictive",
    );
    expect(
      await readdir(join(f.options.dataDirectory, "documents", "temporary")),
    ).toEqual([]);
    const prepared = await store.prepare(input, Buffer.from("original fictif"));
    await f.maintainDatabase(async (db) => {
      await expect(
        db.transaction(async (tx) => {
          await store.commit(tx, actor, prepared, new Date());
          throw Error("panne après pièce");
        }),
      ).rejects.toThrow("panne après pièce");
      expect(await db.query("SELECT id FROM cabinet_documents")).toEqual([]);
      expect(
        await db.query(
          "SELECT operation_id FROM cabinet_operations WHERE operation_id=$1",
          [input.operationId],
        ),
      ).toEqual([]);
    });
    expect(
      await readFile(
        join(f.options.dataDirectory, "documents", prepared.id),
        "utf8",
      ),
    ).toBe("original fictif");
    await store.discard(prepared);
    expect(
      (await f.request("GET", `/documents/${prepared.id}`)).statusCode,
    ).toBe(404);
    const retried = await upload(
      f,
      input,
      Buffer.from("original fictif"),
      "fixture.bin",
      "application/octet-stream",
    );
    expect(retried.statusCode).toBe(201);
    expect(retried.json().extraction.status).toBe("unsupported");
    const another = await store.prepare(
      DocumentInputSchema.parse(metadata(d.id)),
      pdf(),
    );
    await f.maintainDatabase(async (db) => {
      await db.query(
        "UPDATE cabinet_users SET permissions=$1::jsonb WHERE id=$2",
        [
          JSON.stringify([
            { action: "read", kind: "dossier", dossierId: d.id },
          ]),
          actor.id,
        ],
      );
      await expect(
        db.transaction((tx) => store.commit(tx, actor, another, new Date())),
      ).rejects.toMatchObject({ status: 404 });
    });
    await store.discard(another);
    expect(
      await readdir(join(f.options.dataDirectory, "documents", "temporary")),
    ).toEqual([]);
    expect(
      (await f.request("GET", `/documents/${retried.json().id}/download`))
        .statusCode,
    ).toBe(404);
  } finally {
    await f.close();
  }
});
it("keeps confidential chains inaccessible and rejects changing scope, invalid UTF-8 and conflicting operation reuse", async () => {
  const f = await fixture();
  try {
    await f.setup();
    const a = (await f.request("POST", "/records", dossier("A"))).json(),
      b = (await f.request("POST", "/records", dossier("B"))).json();
    const input = metadata(a.id, { confidential: true }),
      first = (await upload(f, input)).json();
    expect(
      (
        await upload(
          f,
          metadata(a.id, { previousVersionId: first.id, confidential: false }),
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await upload(
          f,
          metadata(b.id, { previousVersionId: first.id, confidential: true }),
        )
      ).statusCode,
    ).toBe(409);
    expect((await upload(f, input, pdf("autre original"))).statusCode).toBe(
      409,
    );
    expect(
      (
        await upload(
          f,
          metadata(a.id, { filename: "texte.txt", mediaType: "text/plain" }),
          Buffer.from([0xff]),
          "texte.txt",
          "text/plain",
        )
      ).statusCode,
    ).toBe(422);
    const user = (
      await f.request("POST", "/users", {
        operationId: operationId(),
        ...credentials,
        email: "confidential-reader@example.test",
        permissions: [
          { action: "read", kind: "dossier", dossierId: a.id },
          { action: "update", kind: "dossier", dossierId: a.id },
        ],
      })
    ).json();
    const login = await f.request(
      "POST",
      "/login",
      { email: user.email, password: credentials.password },
      "",
    );
    const token = String(login.headers["set-cookie"]).split(";")[0]!;
    expect(
      (
        await f.request(
          "GET",
          `/documents?logicalId=${first.logicalId}`,
          undefined,
          token,
        )
      ).json(),
    ).toEqual({ items: [], total: 0 });
    expect(
      (
        await upload(
          f,
          metadata(a.id, { previousVersionId: first.id }),
          pdf(),
          "original.pdf",
          "application/pdf",
          token,
        )
      ).statusCode,
    ).toBe(404);
    const { id, version, createdAt, updatedAt, ...record } = a;
    await f.request("PUT", "/records/" + id, {
      operationId: operationId(),
      expectedVersion: version,
      record: { ...record, confidential: true },
    });
    expect(
      (await f.request("GET", "/documents", undefined, token)).json(),
    ).toEqual({ items: [], total: 0 });
  } finally {
    await f.close();
  }
});

it("upgrades a version-one database without losing cabinet records and reports a textless PDF explicitly", async () => {
  const f = await fixture();
  try {
    await f.setup();
    const d = (
      await f.request("POST", "/records", dossier("Migration fictive"))
    ).json();
    await f.maintainDatabase(async (db) => {
      await db.transaction(async (tx) => {
        await tx.query(
          "DROP TABLE cabinet_relationship_imports, cabinet_relationship_events, cabinet_relationship_history, cabinet_relationship, cabinet_time_csv_rows, cabinet_time_csv, cabinet_time_history, cabinet_time, cabinet_production_export_rows, cabinet_production_exports, cabinet_production_generation_results, cabinet_production_imports, cabinet_production_row_versions, cabinet_production_rows, cabinet_production_model_versions, cabinet_production_models, cabinet_reminder_preparation, cabinet_workflow_imports, cabinet_notification_preferences, cabinet_notifications, cabinet_work_events, cabinet_work, cabinet_workflow_model_versions, cabinet_workflow_models",
        );
        await tx.query("DROP INDEX cabinet_task_occurrence");
        await tx.query("DROP TABLE cabinet_fiscal_events");
        await tx.query("DROP INDEX cabinet_fiscal_occurrence");
        await tx.query(
          "DROP TABLE cabinet_export_plan, cabinet_export_rows, cabinet_exports",
        );
        await tx.query(
          "DROP TABLE cabinet_collection_snapshots, cabinet_collection_links, cabinet_collection_observations, cabinet_job_events, cabinet_jobs, cabinet_job_gate",
        );
        await tx.query("DROP TABLE cabinet_documents");
        await tx.query(
          "DROP TABLE cabinet_import_rows, cabinet_import_previews, cabinet_company_candidates, cabinet_detections, cabinet_saved_views, cabinet_preferences, cabinet_installation, cabinet_custom_fields, cabinet_assignment_versions, cabinet_assignments, cabinet_user_roles, cabinet_memberships, cabinet_groups, cabinet_roles",
        );
        await tx.query("ALTER TABLE cabinet_records DROP COLUMN search_title");
        await tx.query("DELETE FROM schema_migrations WHERE version>=2");
      });
    });
    expect((await f.request("GET", "/records/" + d.id)).json().title).toBe(
      "Migration fictive",
    );
    const uploaded = await upload(f, metadata(d.id), pdf(""));
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json().extraction.status).toBe("needs_ocr");
    await f.restart();
    expect((await f.request("GET", "/documents")).json().total).toBe(1);
  } finally {
    await f.close();
  }
});

it("bounds SQL reads before pagination and searches large originals across authorized dossier scopes with a real index", async () => {
  const f = await fixture();
  try {
    const admin = await f.setup();
    const a = (
        await f.request("POST", "/records", dossier("A recherche"))
      ).json(),
      b = (await f.request("POST", "/records", dossier("B recherche"))).json(),
      c = (
        await f.request("POST", "/records", {
          ...dossier("C privé"),
          record: { ...dossier().record, confidential: true },
        })
      ).json();
    const reader = (
      await f.request("POST", "/users", {
        operationId: operationId(),
        ...credentials,
        email: "large-reader@example.test",
        permissions: [
          { action: "read", kind: "dossier", dossierId: a.id },
          { action: "read", kind: "dossier", dossierId: c.id },
        ],
      })
    ).json();
    const { DocumentStore } = await import("../src/documents/store.js");
    const { DocumentInputSchema, DocumentQuerySchema } =
      await import("@memlia/contracts");
    const store = new DocumentStore(f.options.dataDirectory);
    const visible: string[] = [];
    const large =
      "remplissage fictif ".repeat(120_000) + " ORCHIDÉE 100%_\\ fin";
    for (let i = 0; i < 8; i++) {
      const scope = i < 5 ? a.id : i < 7 ? b.id : c.id;
      const confidential = i === 4;
      const prepared = await store.prepare(
        DocumentInputSchema.parse(
          metadata(scope, {
            filename: `nom-${i}-fictif.txt`,
            mediaType: "text/plain",
            confidential,
          }),
        ),
        Buffer.from(large),
      );
      await f.maintainDatabase(async (db) => {
        const ref = await db.transaction((tx) =>
          store.commit(tx, admin, prepared, new Date()),
        );
        if (i < 4) visible.push(ref.id);
      });
      await store.discard(prepared);
    }
    visible.sort();
    await f.maintainDatabase(async (db) => {
      await db.transaction(async (tx) => {
        const transfers: {
          sql: string;
          params: unknown[];
          rows: Record<string, unknown>[];
          bytes: number;
        }[] = [];
        const measured: import("../src/storage/database.js").Connection = {
          async query(sql, params = []) {
            const rows = await tx.query(sql, params);
            transfers.push({
              sql,
              params: [...params],
              rows,
              bytes: Buffer.byteLength(JSON.stringify(rows)),
            });
            return rows as never;
          },
        };
        const result = await store.list(
          measured,
          reader,
          DocumentQuerySchema.parse({ dossierId: a.id, offset: 1, limit: 2 }),
        );
        expect(result.total).toBe(4);
        expect(result.items.map((d) => d.id)).toEqual(visible.slice(1, 3));
        expect(
          transfers
            .flatMap((x) => x.rows)
            .some((row) => "extracted_text" in row || "search_text" in row),
        ).toBe(false);
        expect(transfers.reduce((n, x) => n + x.bytes, 0)).toBeLessThan(12000);
        expect(
          transfers
            .filter((x) => x.rows.some((row) => "content" in row))
            .flatMap((x) => x.rows),
        ).toHaveLength(2);
        const listing = transfers.find((x) =>
          x.rows.some((row) => "content" in row),
        )!;
        const listingBytes = transfers.reduce((n, x) => n + x.bytes, 0);
        expect(
          (
            await store.list(
              tx,
              reader,
              DocumentQuerySchema.parse({ dossierId: b.id, q: "chidée" }),
            )
          ).total,
        ).toBe(0);
        for (const q of [
          "chidée",
          "CHIDÉE",
          "100%_\\",
          "é",
          "nom-2-fictif",
          "absent-marker",
        ]) {
          transfers.length = 0;
          const found = await store.list(
            measured,
            reader,
            DocumentQuerySchema.parse({
              q,
              limit: 1,
              offset: q === "absent-marker" ? 0 : 1,
            }),
          );
          const total =
            q === "absent-marker" ? 0 : q === "nom-2-fictif" ? 1 : 4;
          expect(found.total).toBe(total);
          expect(found.items.map((d) => d.id)).toEqual(
            total === 4 ? visible.slice(1, 2) : [],
          );
          expect(transfers.reduce((n, x) => n + x.bytes, 0)).toBeLessThan(
            12000,
          );
          expect(
            transfers
              .flatMap((x) => x.rows)
              .some((row) => "extracted_text" in row || "search_text" in row),
          ).toBe(false);
        }
        transfers.length = 0;
        await store.list(
          measured,
          admin,
          DocumentQuerySchema.parse({ q: "chidée", limit: 2 }),
        );
        const search = transfers.find((x) =>
          x.rows.some((row) => "content" in row),
        )!;
        // A small fixture may naturally favor sequential scans. This diagnostic proves
        // the actual production query can execute using the installed index.
        await tx.query("SET LOCAL enable_seqscan=off");
        await tx.query("SET LOCAL enable_indexscan=off");
        await tx.query("SET LOCAL enable_nestloop=off");
        const plan = await tx.query(
          "EXPLAIN (ANALYZE, FORMAT JSON) " + search.sql,
          search.params,
        );
        const planText = JSON.stringify(plan);
        expect(planText).toContain("cabinet_documents_search");
        await tx.query("SET LOCAL enable_nestloop=on");
        const listingPlan = await tx.query(
          "EXPLAIN (ANALYZE, FORMAT JSON) " + listing.sql,
          listing.params,
        );
        expect(JSON.stringify(listingPlan)).toContain(
          "cabinet_documents_dossier",
        );
        if (process.env.MEMLIA_GED_EVIDENCE_PATH)
          await writeFile(
            process.env.MEMLIA_GED_EVIDENCE_PATH,
            JSON.stringify(
              {
                sourceBytes: Buffer.byteLength(large) * 8,
                listingBytes,
                searchBytes: transfers.reduce((n, x) => n + x.bytes, 0),
                listingSQL: listing.sql,
                searchSQL: search.sql,
                listingPlan,
                searchPlan: plan,
              },
              null,
              2,
            ),
          );
        await tx.query(
          "UPDATE cabinet_users SET permissions=$1::jsonb WHERE id=$2",
          [
            JSON.stringify([
              ...reader.permissions,
              { action: "confidential", kind: "dossier", dossierId: a.id },
            ]),
            reader.id,
          ],
        );
        expect(
          (
            await store.list(
              tx,
              reader,
              DocumentQuerySchema.parse({ q: "chidée" }),
            )
          ).total,
        ).toBe(5);
        await tx.query(
          "UPDATE cabinet_users SET permissions=$1::jsonb WHERE id=$2",
          [
            JSON.stringify([
              { action: "read", kind: "dossier", dossierId: c.id },
            ]),
            reader.id,
          ],
        );
        expect(
          (
            await store.list(
              tx,
              reader,
              DocumentQuerySchema.parse({ q: "chidée" }),
            )
          ).total,
        ).toBe(0);
        console.log(
          "GED bounded SQL: " +
            transfers.reduce((n, x) => n + x.bytes, 0) +
            " bytes for two results over " +
            Buffer.byteLength(large) * 8 +
            " source bytes; search index cabinet_documents_search used.",
        );
      });
    });
  } finally {
    await f.close();
  }
});

it("backfills indexed search from schema two and keeps a shared extension outside disposable installation schemas", async () => {
  const f = await fixture();
  try {
    await f.setup();
    const d = (
      await f.request("POST", "/records", dossier("Migration recherche"))
    ).json();
    const content = "İ ORCHIDÉE 100%_\\ ancien original";
    const original = (
      await upload(
        f,
        metadata(d.id, { filename: "HOMONYME.txt", mediaType: "text/plain" }),
        Buffer.from(content),
        "HOMONYME.txt",
        "text/plain",
      )
    ).json();
    await f.maintainDatabase(async (db) => {
      await db.transaction(async (tx) => {
        await tx.query("DROP INDEX IF EXISTS cabinet_documents_search");
        await tx.query(
          "ALTER TABLE cabinet_documents DROP COLUMN IF EXISTS search_text",
        );
        await tx.query(
          "DROP TABLE cabinet_relationship_imports, cabinet_relationship_events, cabinet_relationship_history, cabinet_relationship, cabinet_time_csv_rows, cabinet_time_csv, cabinet_time_history, cabinet_time, cabinet_production_export_rows, cabinet_production_exports, cabinet_production_generation_results, cabinet_production_imports, cabinet_production_row_versions, cabinet_production_rows, cabinet_production_model_versions, cabinet_production_models, cabinet_reminder_preparation, cabinet_workflow_imports, cabinet_notification_preferences, cabinet_notifications, cabinet_work_events, cabinet_work, cabinet_workflow_model_versions, cabinet_workflow_models",
        );
        await tx.query("DROP INDEX cabinet_task_occurrence");
        await tx.query("DROP TABLE cabinet_fiscal_events");
        await tx.query("DROP INDEX cabinet_fiscal_occurrence");
        await tx.query(
          "DROP TABLE cabinet_export_plan, cabinet_export_rows, cabinet_exports",
        );
        await tx.query(
          "DROP TABLE cabinet_collection_snapshots, cabinet_collection_links, cabinet_collection_observations, cabinet_job_events, cabinet_jobs, cabinet_job_gate",
        );
        await tx.query(
          "DROP TABLE cabinet_import_rows, cabinet_import_previews, cabinet_company_candidates, cabinet_detections, cabinet_saved_views, cabinet_preferences, cabinet_installation, cabinet_custom_fields, cabinet_assignment_versions, cabinet_assignments, cabinet_user_roles, cabinet_memberships, cabinet_groups, cabinet_roles",
        );
        await tx.query("ALTER TABLE cabinet_records DROP COLUMN search_title");
        await tx.query("DELETE FROM schema_migrations WHERE version>=3");
      });
    });
    expect(
      (
        await f.request("GET", "/documents?q=" + encodeURIComponent("i\u0307"))
      ).json(),
    ).toMatchObject({ total: 1, items: [{ id: original.id }] });
    expect(
      (
        await f.request(
          "GET",
          "/documents?q=" + encodeURIComponent("chidée 100%_\\"),
        )
      ).json(),
    ).toMatchObject({ total: 1, items: [{ id: original.id }] });
    await f.maintainDatabase(async (db) => {
      const namespaces = await db.query(
        "SELECT n.nspname,e.extversion FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_trgm'",
      );
      expect(namespaces).toEqual([{ nspname: "public", extversion: "1.6" }]);
    });
    const other = await fixture();
    try {
      await other.setup();
    } finally {
      await other.close();
    }
    expect(
      (await f.request("GET", "/documents?q=chidée")).json().items[0].id,
    ).toBe(original.id);
    await f.maintainDatabase(async (db) =>
      expect(
        await db.query(
          "SELECT indexname FROM pg_indexes WHERE schemaname=current_schema() AND indexname='cabinet_documents_search'",
        ),
      ).toHaveLength(1),
    );
  } finally {
    await f.close();
  }
});
