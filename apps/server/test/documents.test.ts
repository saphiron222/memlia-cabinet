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
it("returns structured 413 for a real oversized JSON request and multipart upload", async () => {
  const f = await fixture();
  try {
    await f.setup();
    const d = (await f.request("POST", "/records", dossier())).json();
    const address = await f.app.listen({ port: 0, host: "127.0.0.1" });
    const res = await fetch(address + "/api/v1/records", {
      method: "POST",
      headers: { origin, cookie: f.cookie, "content-type": "application/json" },
      body: JSON.stringify({ huge: "x".repeat(1024 * 1024 + 1) }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
    const large = await fetch(address + "/api/v1/documents", {
      method: "POST",
      headers: {
        origin,
        cookie: f.cookie,
        "content-type": "multipart/form-data; boundary=piece",
      },
      body: multipart(metadata(d.id), Buffer.alloc(10 * 1024 * 1024 + 1)),
    });
    expect(large.status).toBe(413);
    expect(await large.json()).toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
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
        await tx.query("DROP TABLE cabinet_documents");
        await tx.query("DELETE FROM schema_migrations WHERE version=2");
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
