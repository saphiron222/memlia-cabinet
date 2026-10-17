import { expect, it } from "vitest";
import { CabinetRecordSchema } from "@memlia/contracts";
import { fixture, dossier, task, operationId } from "./helpers.js";
import type { Connection } from "../src/storage/database.js";
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

it("fails the whole history request when reading an older dossier encounters a storage error", async () => {
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
          title: "Historique fictif",
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
    await f.maintainDatabase(async (database) => {
      await database.transaction(async (tx) => {
        await tx.query(
          "ALTER TABLE cabinet_records RENAME TO cabinet_records_storage",
        );
        await tx.query(
          "CREATE FUNCTION test_old_parent_failure() RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fictitious historical parent storage failure'; END $$",
        );
        await tx.query(
          `CREATE VIEW cabinet_records AS SELECT id,kind,CASE WHEN id='${b.id}'::uuid THEN test_old_parent_failure() ELSE content END AS content FROM cabinet_records_storage`,
        );
      });
    });
    expect((await f.request("GET", `/records/${id}`)).statusCode).toBe(200);
    const history = await f.request("GET", `/records/${id}/history`);
    expect(history.statusCode).toBe(500);
    expect(history.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Erreur interne." },
    });
  } finally {
    await f.close();
  }
});

it.skipIf(!process.env.DATABASE_URL)(
  "PostgreSQL transaction JIT policy resets after commit and rollback on the same connection and preserves the fixture schema",
  async () => {
    const f = await fixture();
    try {
      await f.maintainDatabase(async (database) => {
        const inspect = async (tx: Connection) =>
          (
            await tx.query<{
              pid: number;
              jit: string;
              schema: string;
              search_path: string;
            }>(
              "SELECT pg_backend_pid() AS pid,current_setting('jit') AS jit,current_schema() AS schema,current_setting('search_path') AS search_path",
            )
          )[0]!;
        const original = await database.transaction(async (tx) => {
          const state = await inspect(tx);
          // Exercise reset even when the operator's default is already off.
          await tx.query("SET jit = on");
          return state;
        });
        const baseline = { ...original, jit: "on" };
        expect(baseline.schema).toMatch(/^test_[a-f0-9]+$/);
        try {
          expect(await database.transaction(inspect)).toEqual(baseline);
          const committed = await database.transaction(
            async (tx) => {
              const state = await inspect(tx);
              expect(state).toEqual({ ...baseline, jit: "off" });
              await tx.query("CREATE TABLE jit_policy_probe (value integer)");
              await tx.query("INSERT INTO jit_policy_probe VALUES (1)");
              return state;
            },
            { jit: false },
          );
          const afterCommit = await database.transaction(inspect);
          expect(afterCommit).toEqual(baseline);
          let rolledBack: typeof baseline | undefined;
          await expect(
            database.transaction(
              async (tx) => {
                rolledBack = await inspect(tx);
                expect(rolledBack).toEqual({ ...baseline, jit: "off" });
                await tx.query("INSERT INTO jit_policy_probe VALUES (2)");
                throw new Error("Fictitious transaction rollback");
              },
              { jit: false },
            ),
          ).rejects.toThrow("Fictitious transaction rollback");
          const afterRollback = await database.transaction(inspect);
          expect(afterRollback).toEqual(baseline);
          expect(
            await database.query("SELECT value FROM jit_policy_probe"),
          ).toEqual([{ value: 1 }]);
          console.info("PostgreSQL transaction JIT isolation", {
            connectionDefault: original.jit,
            baseline,
            committed,
            afterCommit,
            rolledBack,
            afterRollback,
          });
        } finally {
          await database.transaction((tx) =>
            tx.query("SELECT set_config('jit',$1,false)", [original.jit]),
          );
        }
      });
    } finally {
      await f.close();
    }
  },
);
