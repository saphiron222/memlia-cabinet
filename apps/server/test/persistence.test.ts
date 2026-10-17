import { expect, it } from "vitest";
import { CabinetRecordSchema } from "@memlia/contracts";
import { fixture, dossier, task, operationId } from "./helpers.js";
it("persists dossier/task date, checklist, transitions and CSV through a fresh application", async () => {
  const f = await fixture();
  try {
    await f.setup();
    const d = await f.request("POST", "/records", dossier());
    expect(d.statusCode).toBe(201);
    const record = CabinetRecordSchema.parse(d.json());
    const t = await f.request("POST", "/records", task(record.id));
    expect(t.statusCode).toBe(201);
    const first = CabinetRecordSchema.parse(t.json());
    expect(
      (
        await f.request("POST", `/records/${first.id}/transition`, {
          operationId: operationId(),
          expectedVersion: 1,
          state: "terminee",
        })
      ).statusCode,
    ).toBe(409);
    expect(first.kind).toBe("tache");
    if (first.kind !== "tache") throw Error();
    const edited = await f.request("PUT", `/records/${first.id}`, {
      operationId: operationId(),
      expectedVersion: 1,
      record: {
        ...task(record.id).record,
        data: {
          ...first.data,
          checklist: first.data.checklist.map((i) => ({ ...i, done: true })),
        },
      },
    });
    expect(edited.statusCode).toBe(200);
    expect(
      (
        await f.request("POST", `/records/${first.id}/transition`, {
          operationId: operationId(),
          expectedVersion: 2,
          state: "terminee",
        })
      ).json().data.state,
    ).toBe("terminee");
    await f.restart();
    const reloaded = (await f.request("GET", `/records/${first.id}`)).json();
    expect(reloaded.data).toMatchObject({
      dueDate: "2026-10-31",
      state: "terminee",
      checklist: [{ done: true }],
    });
    expect(
      (await f.request("GET", "/records?kind=tache")).json().items,
    ).toHaveLength(1);
    expect(
      (await f.request("GET", "/records/export.csv?kind=tache")).body,
    ).toContain("2026-10-31");
    expect(
      (await f.request("GET", `/records/${first.id}/history`)).json().items,
    ).toHaveLength(3);
    expect((await f.request("GET", "/dashboard")).json()).toMatchObject({
      counts: { dossier: 1, tache: 1, contact: 0, obligation: 0 },
      openTasks: 0,
    });
    expect(
      (
        await f.request("POST", "/records", {
          ...task(record.id),
          record: {
            ...task(record.id).record,
            data: { dueDate: "2026-02-30" },
          },
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await f.close();
  }
});
