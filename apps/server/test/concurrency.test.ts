import { expect, it } from "vitest";
import { fixture, dossier, task, operationId } from "./helpers.js";
it("replays commands once and resolves concurrent versions without losing history", async () => {
  const f = await fixture();
  try {
    await f.setup();
    const create = dossier();
    const created = await Promise.all([
      f.request("POST", "/records", create),
      f.request("POST", "/records", create),
    ]);
    expect(created.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(created[0]!.json()).toEqual(created[1]!.json());
    const record = created[0]!.json();
    expect(
      (
        await f.request("POST", "/records", {
          ...create,
          record: { ...create.record, title: "Autre" },
        })
      ).statusCode,
    ).toBe(409);
    const update = (title: string) => ({
      operationId: operationId(),
      expectedVersion: 1,
      record: { ...create.record, title },
    });
    const results = await Promise.all([
      f.request("PUT", `/records/${record.id}`, update("Version A")),
      f.request("PUT", `/records/${record.id}`, update("Version B")),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(
      (await f.request("GET", `/records/${record.id}/history`)).json().items,
    ).toHaveLength(2);
    expect((await f.request("GET", "/records?kind=dossier")).json().total).toBe(
      1,
    );
    await f.restart();
    const durableReplay = await f.request("POST", "/records", create);
    expect(durableReplay.statusCode).toBe(201);
    expect(durableReplay.json()).toEqual(record);
    expect(
      (await f.request("GET", `/records/${record.id}`)).json().version,
    ).toBe(2);
    const t = (await f.request("POST", "/records", task(record.id))).json();
    const transition = {
      operationId: operationId(),
      expectedVersion: 1,
      state: "en_cours",
    };
    const moved = await f.request(
      "POST",
      `/records/${t.id}/transition`,
      transition,
    );
    expect(moved.statusCode).toBe(200);
    const current = moved.json();
    const { id, version, createdAt, updatedAt, ...content } = current;
    expect(
      (
        await f.request("PUT", `/records/${id}`, {
          operationId: operationId(),
          expectedVersion: version,
          record: { ...content, title: "Titre modifié après transition" },
        })
      ).statusCode,
    ).toBe(200);
    const replay = await f.request(
      "POST",
      `/records/${id}/transition`,
      transition,
    );
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(current);
    expect(
      (await f.request("GET", `/records/${id}/history`)).json().items,
    ).toHaveLength(3);
  } finally {
    await f.close();
  }
});

it("scopes operation identity consistently to its authenticated actor", async () => {
  const f = await fixture();
  try {
    await f.setup();
    const command = dossier();
    const record = (await f.request("POST", "/records", command)).json();
    const editor = (
      await f.request("POST", "/users", {
        operationId: operationId(),
        email: "edition@example.test",
        name: "Éditeur fictif",
        password: "UnMotDePasseFictif123!",
        permissions: ["read", "update"].map((action) => ({
          action,
          kind: "*",
        })),
      })
    ).json();
    const login = await f.request(
      "POST",
      "/login",
      { email: editor.email, password: "UnMotDePasseFictif123!" },
      "",
    );
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const sharedId = operationId();
    const update = (expectedVersion: number, title: string) => ({
      operationId: sharedId,
      expectedVersion,
      record: { ...command.record, title },
    });
    expect(
      (
        await f.request(
          "PUT",
          `/records/${record.id}`,
          update(1, "Édition administrateur"),
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await f.request(
          "PUT",
          `/records/${record.id}`,
          update(2, "Édition collaborateur"),
          cookie,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await f.request("GET", `/records/${record.id}/history`)).json().items,
    ).toHaveLength(3);
  } finally {
    await f.close();
  }
});
