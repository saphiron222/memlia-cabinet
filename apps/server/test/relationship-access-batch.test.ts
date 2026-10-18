import { afterEach, expect, test } from "vitest";
import { load } from "../src/relationship/service.js";
import { fixture, dossier, operationId } from "./helpers.js";

let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
  f = undefined!;
});

test("LAB shares identical proof checks within bounded history pages and refuses a differing historical version or hash", async () => {
  f = await fixture();
  const admin = await f.setup();
  const parent = (await f.request("POST", "/records", dossier())).json();
  const meta = {
    operationId: operationId(),
    dossierId: parent.id,
    filename: "preuve.txt",
    mediaType: "text/plain",
    source: { kind: "manual", reference: "fictif", version: "1" },
  };
  const uploaded = await f.app.inject({
    method: "POST",
    url: "/api/v1/documents",
    headers: {
      origin: "http://localhost:3000",
      cookie: f.cookie,
      "content-type": "multipart/form-data; boundary=piece",
    },
    payload: Buffer.from(
      `--piece\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(meta)}\r\n--piece\r\nContent-Disposition: form-data; name="file"; filename="preuve.txt"\r\nContent-Type: text/plain\r\n\r\nPreuve fictive\r\n--piece--\r\n`,
    ),
  });
  expect(uploaded.statusCode, uploaded.body).toBe(201);
  const document = uploaded.json();
  const save = (data: unknown) =>
    f.request("POST", "/relationship/entities", {
      operationId: operationId(),
      id: operationId(),
      expectedVersion: 0,
      data,
    });
  const policy = (
    await save({
      kind: "lab_policy",
      name: "Revue",
      periodDays: 90,
      reason: "Cabinet",
    })
  ).json();
  const created = await save({
    kind: "lab",
    dossierId: parent.id,
    level: "standard",
    reason: "Justificatif",
    role: "Responsable",
    observedOn: "2026-10-18",
    decisionOn: "2026-10-18",
    nextReviewOn: "2027-01-18",
    policyId: policy.id,
    policyVersion: 1,
    evidence: [
      {
        documentId: document.id,
        version: document.version,
        sha256: document.sha256,
        origin: "manual",
        reference: "Fictif",
        acquiredOn: "2026-10-18",
        scope: "Identité",
        result: "examined",
      },
    ],
  });
  expect(created.statusCode, created.body).toBe(200);
  const review = created.json();
  await f.maintainDatabase((db) =>
    db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO cabinet_relationship_history(id,version,content) SELECT $1,n,jsonb_set($2::jsonb,'{version}',to_jsonb(n)) FROM generate_series(2,105) n",
        [review.id, JSON.stringify(review)],
      );
      await tx.query(
        "UPDATE cabinet_relationship_history SET content=jsonb_set(content,'{data,evidence,0,documentId}',to_jsonb($2::text)) WHERE id=$1 AND version=103",
        [review.id, document.id.toUpperCase()],
      );
      let reads = 0;
      const counted: typeof tx = {
        query: async (...args) => {
          reads++;
          return tx.query(...args);
        },
      };
      expect((await load(counted, admin, review.id)).id).toBe(review.id);
      expect(reads).toBeLessThanOrEqual(30);
      for (const [path, invalid] of [
        ["version", 9],
        ["sha256", "0".repeat(64)],
      ] as const) {
        await tx.query(
          "UPDATE cabinet_relationship_history SET content=jsonb_set(content,ARRAY['data','evidence','0',$2],$3::jsonb) WHERE id=$1 AND version=104",
          [review.id, path, JSON.stringify(invalid)],
        );
        await expect(load(tx, admin, review.id)).rejects.toMatchObject({
          status: 409,
          code: "EVIDENCE_CHANGED",
        });
        await tx.query(
          "UPDATE cabinet_relationship_history SET content=jsonb_set($2::jsonb,'{version}','104') WHERE id=$1 AND version=104",
          [review.id, JSON.stringify(review)],
        );
        expect((await load(tx, admin, review.id)).id).toBe(review.id);
      }
    }),
  );
  expect(
    (await f.request("GET", `/relationship/entities/${review.id}`)).statusCode,
  ).toBe(200);
});
