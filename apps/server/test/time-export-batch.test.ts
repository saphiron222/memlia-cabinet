import { afterEach, expect, test } from "vitest";
import { fixture, dossier, task, operationId } from "./helpers.js";

let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
  f = undefined!;
});
const period = { from: "2026-10-01", to: "2026-10-31" };
async function save(
  data: Record<string, unknown>,
  old?: { id: string; version: number },
) {
  const response = await f.request("POST", "/time/entities", {
    id: old?.id ?? operationId(),
    expectedVersion: old?.version ?? 0,
    operationId: operationId(),
    data,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}
async function awaitJob(path: string) {
  for (let i = 0; i < 250; i++) {
    const response = await f.request("GET", path);
    expect(response.statusCode, response.body).toBe(200);
    if (["completed", "failed"].includes(response.json().job.state))
      return response;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Job incomplete: " + path);
}

test("prepared Time exit keeps snapshot export and current read distinct after a later target change", async () => {
  f = await fixture(() => new Date("2026-10-17T10:00:00Z"));
  const actor = await f.setup();
  const old = (
    await f.request("POST", "/records", dossier("Ancien dossier"))
  ).json();
  const nature = await save({ kind: "nature", name: "Contrôle", active: true });
  const entry = await save({
    kind: "entry",
    userId: actor.id,
    date: "2026-10-17",
    natureId: nature.id,
    link: { kind: "record", id: old.id },
    seconds: 60,
    source: "manual",
    timerId: null,
    rate: null,
  });
  const command = { operationId: operationId() };
  const started = await f.request("POST", "/administration/exports", command);
  expect(started.statusCode, started.body).toBe(202);
  const path = "/administration/exports/" + started.json().id;
  expect((await awaitJob(path)).json().job.state).toBe("completed");
  const manifest = await f.request("GET", path + "/download");
  expect(manifest.statusCode, manifest.body).toBe(200);
  const partPaths = manifest
    .json()
    .parts.map((part: { downloadUrl: string }) =>
      part.downloadUrl.replace("/api/v1", ""),
    );
  const snapshots = [];
  for (const partPath of partPaths) {
    const part = await f.request("GET", partPath);
    expect(part.statusCode, part.body).toBe(200);
    snapshots.push(...part.json().time);
  }
  expect(
    snapshots.find((e: any) => e.entity === "current" && e.data.id === entry.id)
      .data,
  ).toEqual(entry);

  // This dossier did not exist in the prepared record export. Its denial can
  // therefore only be detected by the Time current-entity authorization.
  const later = (
    await f.request("POST", "/records", dossier("Dossier ultérieur"))
  ).json();
  await save({ ...entry.data, link: { kind: "record", id: later.id } }, entry);
  expect((await f.request("GET", path + "/download")).statusCode).toBe(200);
  const setRead = async (dossierId: string | null) =>
    f.maintainDatabase((db) =>
      db.transaction(async (tx) => {
        await tx.query(
          "UPDATE cabinet_users SET permissions=(SELECT COALESCE(jsonb_agg(p),'[]'::jsonb) FROM jsonb_array_elements(permissions) p WHERE p->>'action'<>'read') || $2::jsonb WHERE id=$1",
          [
            actor.id,
            JSON.stringify([{ action: "read", kind: "*", dossierId }]),
          ],
        );
      }),
    );
  await setRead(old.id);
  expect((await f.request("GET", "/records/" + old.id)).statusCode).toBe(200);
  expect((await f.request("GET", "/records/" + later.id)).statusCode).toBe(404);
  expect((await f.request("GET", path + "/download")).statusCode).toBe(404);
  for (const partPath of partPaths)
    expect((await f.request("GET", partPath)).statusCode).toBe(404);
  expect(
    (await f.request("POST", "/administration/exports", command)).statusCode,
  ).toBe(404);
  await setRead(null);
  expect((await f.request("GET", path + "/download")).statusCode).toBe(200);
});

test("CSV revalidates the version of every prepared entry beyond its first 100-row page", async () => {
  f = await fixture(() => new Date("2026-10-17T10:00:00Z"));
  const actor = await f.setup();
  const nature = await save({
    kind: "nature",
    name: "Pagination",
    active: true,
  });
  const entry = await save({
    kind: "entry",
    userId: actor.id,
    date: "2026-10-17",
    natureId: nature.id,
    link: { kind: "free", label: "Lot fictif" },
    seconds: 60,
    source: "manual",
    timerId: null,
    rate: null,
  });
  // Grow the fictitious corpus at the fixture seam; keep both persisted versions
  // and current entities valid, then exercise preparation/restitution over HTTP.
  const copies = Array.from({ length: 100 }, () => ({
    ...entry,
    id: operationId(),
  }));
  await f.maintainDatabase((db) =>
    db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO cabinet_time(id,kind,content) SELECT (content->>'id')::uuid,content->'data'->>'kind',content FROM jsonb_array_elements($1::jsonb) rows(content)",
        [JSON.stringify(copies)],
      );
      await tx.query(
        "INSERT INTO cabinet_time_history(id,version,content) SELECT (content->>'id')::uuid,1,content FROM jsonb_array_elements($1::jsonb) rows(content)",
        [JSON.stringify(copies)],
      );
    }),
  );
  const all = [entry, ...copies].sort((a, b) => a.id.localeCompare(b.id));
  const last = all.at(-1)!;
  const report = await f.request(
    "GET",
    "/time/report?from=2026-10-01&to=2026-10-31",
  );
  expect(report.json()).toMatchObject({ total: 101, realizedSeconds: 6060 });
  const command = { operationId: operationId(), query: period };
  const started = await f.request("POST", "/time/exports", command);
  expect(started.statusCode, started.body).toBe(202);
  const path = "/time/exports/" + started.json().id;
  const completed = await awaitJob(path);
  expect(completed.json()).toMatchObject({
    job: { state: "completed" },
    parts: 2,
  });
  const first = await f.request("GET", path + "/parts/1");
  const second = await f.request("GET", path + "/parts/2");
  expect(first.statusCode, first.body).toBe(200);
  expect(second.statusCode, second.body).toBe(200);
  expect(first.body.trim().split("\r\n")).toHaveLength(101);
  expect(first.body).not.toContain(last.id);
  expect(second.body.trim().split("\r\n")).toHaveLength(2);
  expect(second.body).toContain(last.id);
  await save({ ...last.data, seconds: 61 }, last);
  for (const suffix of ["", "/parts/1", "/parts/2"]) {
    const denied = await f.request("GET", path + suffix);
    expect(denied.statusCode, denied.body).toBe(409);
    expect(denied.body).toContain("EXPORT_CHANGED");
  }
  expect((await f.request("POST", "/time/exports", command)).statusCode).toBe(
    409,
  );
});

test.each(["recordId", "dossierId"] as const)(
  "empty prepared CSV still reauthorizes its stored %s filter",
  async (filter) => {
    f = await fixture(() => new Date("2026-10-17T10:00:00Z"));
    const actor = await f.setup();
    const parent = (await f.request("POST", "/records", dossier())).json();
    const linked = (
      await f.request("POST", "/records", task(parent.id))
    ).json();
    const command = {
      operationId: operationId(),
      query: {
        ...period,
        [filter]: filter === "recordId" ? linked.id : parent.id,
      },
    };
    const started = await f.request("POST", "/time/exports", command);
    expect(started.statusCode, started.body).toBe(202);
    const path = "/time/exports/" + started.json().id;
    expect((await awaitJob(path)).json().job.state).toBe("completed");
    const empty = await f.request("GET", path + "/parts/1");
    expect(empty.statusCode, empty.body).toBe(200);
    expect(empty.body.trim().split("\r\n")).toHaveLength(1);
    const changed = await f.request("PUT", "/records/" + parent.id, {
      operationId: operationId(),
      expectedVersion: parent.version,
      record: {
        kind: "dossier",
        title: parent.title,
        data: parent.data,
        confidential: true,
      },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    await f.maintainDatabase((db) =>
      db.transaction(async (tx) => {
        await tx.query(
          "UPDATE cabinet_users SET permissions=(SELECT jsonb_agg(p) FROM jsonb_array_elements(permissions) p WHERE p->>'action'<>'confidential') WHERE id=$1",
          [actor.id],
        );
      }),
    );
    expect((await f.request("GET", path)).statusCode).toBe(404);
    expect((await f.request("GET", path + "/parts/1")).statusCode).toBe(404);
    expect((await f.request("POST", "/time/exports", command)).statusCode).toBe(
      404,
    );
  },
);
