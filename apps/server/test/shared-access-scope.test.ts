import { afterEach, expect, test } from "vitest";
import type { SessionUser } from "@memlia/contracts";
import { recordAccessScope } from "../src/records/access-scope.js";
import { authorizedPredicate } from "../src/records/query.js";
import { fixture, dossier, task, operationId } from "./helpers.js";

let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
  f = undefined!;
});

test("shared membership keeps current identity, exact historical scope and confidential document parent distinct", async () => {
  f = await fixture();
  const admin = await f.setup();
  const parent = (await f.request("POST", "/records", dossier())).json();
  const model = (
    await f.request("POST", "/production/models", {
      operationId: operationId(),
      id: operationId(),
      expectedVersion: 0,
      model: { kind: "process", name: "Portée partagée", target: "dossier" },
    })
  ).json();
  const created = await f.request(
    "POST",
    `/production/models/${model.id}/rows`,
    {
      operationId: operationId(),
      expectedVersion: model.version,
      target: { kind: "dossier", id: parent.id, label: parent.title },
      period: "once",
    },
  );
  expect(created.statusCode, created.body).toBe(200);
  const row = created.json();
  const documentId = operationId(),
    missing = operationId();
  const privateSnapshot = { ...parent, confidential: true };
  const unknownSnapshot = { ...parent, kind: "unknown" };
  const reader: SessionUser = {
    ...admin,
    permissions: [
      { action: "read", kind: "*", dossierId: null },
      { action: "export", kind: "dossier", dossierId: parent.id },
    ],
  };
  await f.maintainDatabase((db) =>
    db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO cabinet_documents(id,dossier_id,logical_id,version,content,extracted_text,search_text) VALUES($1,$2,$1,1,$3::jsonb,'','')",
        [documentId, parent.id, JSON.stringify({ confidential: true })],
      );
      await tx.query(
        "UPDATE cabinet_production_row_versions SET content=$2::jsonb WHERE id=$1",
        [
          row.id,
          JSON.stringify({
            ...row,
            scope: privateSnapshot,
            documentIds: [documentId, missing],
          }),
        ],
      );
      const check = async (actor: SessionUser, action: "read" | "export") => {
        const args: unknown[] = [];
        const p = (value: unknown) => {
          args.push(value);
          return "$" + args.length;
        };
        const scope = await recordAccessScope(tx, actor, action, p, {
          records: [parent.id, missing],
          production: [row.id],
        });
        return (
          await tx.query(
            `WITH ${scope.ctes} SELECT ${scope.record(p(parent.id.toUpperCase()))} current, ${scope.record(p(missing))} missing, ${scope.snapshot(p(JSON.stringify(privateSnapshot)) + "::jsonb")} historic, ${scope.snapshot(p(JSON.stringify(unknownSnapshot)) + "::jsonb")} unknown, ${scope.document(p(documentId.toUpperCase()))} document, ${scope.document(p(missing))} missing_document`,
            args,
          )
        )[0];
      };
      expect(await check(reader, "export")).toEqual({
        current: true,
        missing: false,
        historic: false,
        unknown: false,
        document: false,
        missing_document: false,
      });
      const confidential: SessionUser = {
        ...reader,
        permissions: [
          ...reader.permissions,
          { action: "confidential", kind: "*", dossierId: null },
        ],
      };
      expect(await check(confidential, "export")).toEqual({
        current: true,
        missing: false,
        historic: true,
        unknown: false,
        document: true,
        missing_document: false,
      });
      // Document owners require READ; an export grant for the record is separate.
      const readOnly = {
        ...confidential,
        permissions: confidential.permissions.filter(
          (grant) => grant.action !== "export",
        ),
      };
      expect(await check(readOnly, "export")).toEqual({
        current: false,
        missing: false,
        historic: false,
        unknown: false,
        document: true,
        missing_document: false,
      });
      // No membership survives a write, even within the same transaction.
      await tx.query(
        "UPDATE cabinet_records SET content=jsonb_set(content,'{confidential}','true') WHERE id=$1",
        [parent.id],
      );
      expect(await check(reader, "read")).toEqual({
        current: false,
        missing: false,
        historic: false,
        unknown: false,
        document: false,
        missing_document: false,
      });
      await tx.query(
        "UPDATE cabinet_records SET content=jsonb_set(content,'{confidential}','false') WHERE id=$1",
        [parent.id],
      );
      expect((await check(reader, "read"))?.current).toBe(true);
      await tx.query(
        "UPDATE cabinet_production_row_versions SET content=jsonb_set(content,'{scope}',$2::jsonb) WHERE id=$1",
        [row.id, JSON.stringify(unknownSnapshot)],
      );
      expect((await check(confidential, "read"))?.unknown).toBe(false);
    }),
  );
});

test("kind-directed roots retain other related kinds, scoped grants and Production proof ownership for every kind", async () => {
  f = await fixture();
  const admin = await f.setup();
  const a = (await f.request("POST", "/records", dossier("Dossier A"))).json();
  const b = (await f.request("POST", "/records", dossier("Dossier B"))).json();
  const contact = (
    await f.request("POST", "/records", {
      operationId: operationId(),
      record: {
        kind: "contact",
        title: "Contact lié",
        dossierId: b.id,
        data: { contactType: "personne" },
      },
    })
  ).json();
  const input = task(a.id);
  const work = (
    await f.request("POST", "/records", {
      ...input,
      record: {
        ...input.record,
        data: { ...input.record.data, prospectId: contact.id },
      },
    })
  ).json();
  expect(work.id).toBeTruthy();
  const reader: SessionUser = {
    ...admin,
    permissions: [{ action: "read", kind: "*", dossierId: null }],
  };
  await f.maintainDatabase((db) =>
    db.transaction(async (tx) => {
      const visible = async (actor: SessionUser, ids = [a.id, work.id]) => {
        const params: unknown[] = [],
          p = (value: unknown) => {
            params.push(value);
            return "$" + params.length;
          };
        const scope = await recordAccessScope(tx, actor, "read", p, {
          records: ids,
          production: [],
        });
        return (
          await tx.query(
            `WITH ${scope.ctes} SELECT ${scope.record(p(a.id))} dossier, ${scope.record(p(work.id))} work`,
            params,
          )
        )[0];
      };
      expect(await visible(reader)).toEqual({ dossier: true, work: true });
      await tx.query(
        "UPDATE cabinet_records SET content=jsonb_set(content,'{confidential}','true') WHERE id=$1",
        [contact.id],
      );
      expect(await visible(reader)).toEqual({ dossier: true, work: false });
      const confidential: SessionUser = {
        ...reader,
        permissions: [
          ...reader.permissions,
          { action: "confidential", kind: "contact", dossierId: b.id },
        ],
      };
      expect(await visible(confidential)).toEqual({
        dossier: true,
        work: true,
      });
      expect(
        await visible({
          ...reader,
          permissions: [
            ...reader.permissions,
            { action: "confidential", kind: "contact", dossierId: a.id },
          ],
        }),
      ).toEqual({ dossier: true, work: false });
      await tx.query(
        "UPDATE cabinet_records SET content=jsonb_set(content,'{dossierId}',to_jsonb($2::text)) WHERE id=$1",
        [contact.id, operationId()],
      );
      expect(await visible(admin)).toEqual({ dossier: true, work: false });
      await tx.query(
        "UPDATE cabinet_records SET content=$2::jsonb WHERE id=$1",
        [contact.id, JSON.stringify(contact)],
      );
      expect(await visible(reader, [work.id])).toEqual({
        dossier: false,
        work: true,
      });
      await tx.query(
        "UPDATE cabinet_records SET content=jsonb_set(content,'{data,prospectId}',to_jsonb($2::text)) WHERE id=$1",
        [work.id, work.id.toUpperCase()],
      );
      expect((await visible(reader, [work.id]))?.work).toBe(true);
      await tx.query(
        "UPDATE cabinet_records SET content=$2::jsonb WHERE id=$1",
        [work.id, JSON.stringify(work)],
      );
      for (const missing of [operationId(), null]) {
        await tx.query(
          "UPDATE cabinet_records SET content=jsonb_set(content,'{data,fiscal}',jsonb_build_object('relatedRecordIds',$2::jsonb)) WHERE id=$1",
          [work.id, JSON.stringify([missing])],
        );
        const args: unknown[] = [work.id];
        const canonical = authorizedPredicate(reader, "read", (value) => {
          args.push(value);
          return "$" + args.length;
        });
        // An absent UUID or a legacy JSON null is denied by the original join.
        expect(
          (
            await tx.query(
              `SELECT ${canonical} allowed FROM cabinet_records r WHERE r.id=$1`,
              args,
            )
          )[0]?.allowed,
        ).toBe(false);
        expect((await visible(reader, [work.id]))?.work).toBe(false);
      }
      await tx.query(
        "UPDATE cabinet_records SET content=$2::jsonb WHERE id=$1",
        [work.id, JSON.stringify(work)],
      );
      await tx.query(
        "UPDATE cabinet_records SET content=jsonb_set(jsonb_set(content,'{dossierId}','null'),'{data,relatedDossierIds}',$2::jsonb) WHERE id=$1",
        [contact.id, JSON.stringify([b.id])],
      );
      const scoped: SessionUser = {
        ...reader,
        permissions: [
          { action: "read", kind: "dossier", dossierId: a.id },
          { action: "read", kind: "dossier", dossierId: b.id },
          { action: "read", kind: "tache", dossierId: a.id },
          { action: "read", kind: "contact", dossierId: b.id },
        ],
      };
      expect((await visible(scoped))?.work).toBe(false);
      expect(
        (
          await visible({
            ...scoped,
            permissions: [
              ...scoped.permissions,
              { action: "read", kind: "contact", dossierId: null },
            ],
          })
        )?.work,
      ).toBe(true);
      await tx.query(
        "UPDATE cabinet_records SET content=$2::jsonb WHERE id=$1",
        [contact.id, JSON.stringify(contact)],
      );
      // The canonical dossier policy also checks Production proof ownership.
      // Kind specialization must retain this check even for a dossier root.
      const modelId = operationId(),
        documentId = operationId();
      await tx.query(
        "INSERT INTO cabinet_production_models(id,content) VALUES($1,'{}')",
        [modelId],
      );
      await tx.query(
        "INSERT INTO cabinet_documents(id,dossier_id,logical_id,version,content,extracted_text,search_text) VALUES($1,$2,$1,1,'{\"confidential\":false}','', '')",
        [documentId, a.id],
      );
      await tx.query(
        "INSERT INTO cabinet_production_rows(id,model_id,occurrence_key,content) VALUES($1::uuid,$2,$1::text,$3::jsonb)",
        [
          a.id,
          modelId,
          JSON.stringify({ id: a.id, documentIds: [documentId] }),
        ],
      );
      await tx.query(
        "INSERT INTO cabinet_production_row_versions(id,version,content) SELECT id,1,content FROM cabinet_production_rows WHERE id=$1",
        [a.id],
      );
      expect((await visible(admin, [a.id]))?.dossier).toBe(false);
    }),
  );
});

test("Time HTTP membership follows live team withdrawal and restoration with an uppercase link before count and pagination", async () => {
  f = await fixture();
  const admin = await f.setup();
  const parent = (await f.request("POST", "/records", dossier())).json();
  const email = "scope-team@example.test";
  const user = (
    await f.request("POST", "/users", {
      operationId: operationId(),
      email,
      name: "Équipe fictive",
      password: "UnMotDePasseFictif123!",
      permissions: [{ action: "time_read", kind: "*", dossierId: null }],
    })
  ).json();
  const login = await f.request(
    "POST",
    "/login",
    { email, password: "UnMotDePasseFictif123!" },
    "",
  );
  expect(login.statusCode, login.body).toBe(200);
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const role = (
    await f.request("POST", "/administration/roles", {
      operationId: operationId(),
      name: "Lecture affectée",
      order: 0,
      permissions: [{ action: "read", kind: "*", dossierId: null }],
    })
  ).json();
  let group = (
    await f.request("POST", "/administration/groups", {
      operationId: operationId(),
      kind: "team",
      name: "Équipe",
      memberIds: [user.id],
    })
  ).json();
  const assigned = await f.request("POST", "/administration/assignments", {
    operationId: operationId(),
    rows: [
      {
        dossierId: parent.id,
        expectedVersion: parent.version,
        subject: { kind: "team", id: group.id },
        roleId: role.id,
        remove: false,
      },
    ],
  });
  expect(assigned.statusCode, assigned.body).toBe(200);
  const save = async (data: unknown) => {
    const response = await f.request("POST", "/time/entities", {
      id: operationId(),
      operationId: operationId(),
      expectedVersion: 0,
      data,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  };
  const nature = await save({ kind: "nature", name: "Révision", active: true });
  const entry = await save({
    kind: "entry",
    userId: admin.id,
    date: "2026-10-18",
    natureId: nature.id,
    link: { kind: "record", id: parent.id.toUpperCase() },
    seconds: 60,
    source: "manual",
    timerId: null,
    rate: null,
  });
  const check = async (visible: boolean) => {
    const history = await f.request(
      "GET",
      `/time/${entry.id}/history`,
      undefined,
      cookie,
    );
    expect(history.statusCode, history.body).toBe(visible ? 200 : 404);
    for (const offset of [0, 100]) {
      const report = await f.request(
        "GET",
        `/time/report?from=2026-10-01&to=2026-10-31&offset=${offset}`,
        undefined,
        cookie,
      );
      expect(report.statusCode, report.body).toBe(200);
      expect(report.json().total).toBe(visible ? 1 : 0);
      expect(
        report.json().entries.map((item: { id: string }) => item.id),
      ).toEqual(visible && offset === 0 ? [entry.id] : []);
    }
  };
  await check(true);
  for (const joined of [false, true]) {
    const changed = await f.request(
      "PUT",
      `/administration/groups/${group.id}`,
      {
        operationId: operationId(),
        expectedVersion: group.version,
        kind: "team",
        name: group.name,
        memberIds: joined ? [user.id] : [],
      },
    );
    expect(changed.statusCode, changed.body).toBe(200);
    group = changed.json();
    await check(joined);
  }
});
