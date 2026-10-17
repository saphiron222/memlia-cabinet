import { expect, it } from "vitest";
import { z } from "zod";
import { fixture, dossier, operationId } from "./helpers.js";
import { JobRunner, type JobDefinition } from "../src/jobs/runner.js";
const Input = z
  .object({ dossierId: z.uuid(), value: z.string().max(100) })
  .strict();
const Checkpoint = z.object({ count: z.number().int().min(0).max(2) }).strict();
const Result = z.object({ value: z.string().max(100) }).strict();
type Definition = JobDefinition<
  z.infer<typeof Input>,
  z.infer<typeof Checkpoint>,
  z.infer<typeof Result>
>;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
it("file commune : reprise du checkpoint après nouvelle instance, arrêt propre et suspension des producteurs", async () => {
  const f = await fixture();
  try {
    const actor = await f.setup();
    const d = (await f.request("POST", "/records", dossier())).json();
    await f.maintainDatabase(async (db) => {
      const first = new JobRunner(db);
      const entered = deferred();
      const definition: Definition = {
        kind: "test-heavy-work",
        input: Input,
        checkpoint: Checkpoint,
        result: Result,
        initial: { count: 0 },
        scope: (i) => ({
          dossierId: i.dossierId,
          resourceKey: "fixture-shared-account",
        }),
        authorize: async () => {},
        execute: async (i, c) => {
          if (c.checkpoint.count === 0)
            await c.commit(
              { count: 1 },
              "unit",
              "Unité fictive durable.",
              async () => {},
            );
          entered.resolve();
          await new Promise<void>((_, reject) => {
            if (c.signal.aborted) reject(Error());
            else
              c.signal.addEventListener("abort", () => reject(Error()), {
                once: true,
              });
          });
          return { value: i.value };
        },
      };
      const queue = first.register(definition);
      const op = operationId();
      const id = await db.transaction((tx) =>
        queue.enqueue(tx, actor, op, { dossierId: d.id, value: "fictif" }),
      );
      const execution = first.tick();
      await entered.promise;
      await first.pause();
      await execution;
      const paused = await db.transaction((tx) => first.get(tx, id));
      expect(paused.checkpoint).toEqual({ count: 1 });
      expect(paused.job.state).toBe("queued");
      const second = new JobRunner(db);
      const q = second.register({
        ...definition,
        execute: async (i, c) => {
          expect(c.checkpoint.count).toBe(1);
          return { value: i.value };
        },
      });
      await expect(
        db.transaction((tx) =>
          q.enqueue(tx, actor, operationId(), {
            dossierId: d.id,
            value: "bloqué",
          }),
        ),
      ).rejects.toMatchObject({ code: "JOBS_PAUSED" });
      expect(await second.tick()).toBe(false);
      await second.resume();
      await second.tick();
      await second.stop();
      const result = await db.transaction((tx) => second.get(tx, id));
      expect(result.job.state).toBe("completed");
      expect(result.job.events.filter((e) => e.code === "unit")).toHaveLength(
        1,
      );
      expect(result.result).toEqual({ value: "fictif" });
    });
  } finally {
    await f.close();
  }
});
it("lease expirée : un ancien travailleur ne peut engager ni résultat ni checkpoint ; verrou de compte commun", async () => {
  const f = await fixture();
  try {
    const actor = await f.setup();
    const d = (await f.request("POST", "/records", dossier())).json();
    await f.maintainDatabase(async (db) => {
      let clock = new Date("2026-10-17T00:00:00Z");
      const now = () => clock;
      const first = new JobRunner(db, now, 60_000),
        second = new JobRunner(db, now, 60_000);
      const entered = deferred(),
        release = deferred();
      let fenced = false;
      const definition: Definition = {
        kind: "test-fence",
        input: Input,
        checkpoint: Checkpoint,
        result: Result,
        initial: { count: 0 },
        scope: (i) => ({ dossierId: i.dossierId, resourceKey: "account-A" }),
        authorize: async () => {},
        execute: async (i, c) => {
          entered.resolve();
          await release.promise;
          try {
            await c.commit(
              { count: 2 },
              "old",
              "Ancien travailleur.",
              async () => {},
            );
          } catch {
            fenced = true;
            throw Error("fenced");
          }
          return { value: i.value };
        },
      };
      const q = first.register(definition);
      second.register({
        ...definition,
        execute: async (i, c) => {
          await c.commit(
            { count: 1 },
            "new",
            "Reprise valide.",
            async () => {},
          );
          return { value: "reprise" };
        },
      });
      const id = await db.transaction((tx) =>
        q.enqueue(tx, actor, operationId(), {
          dossierId: d.id,
          value: "initial",
        }),
      );
      const old = first.tick();
      await entered.promise;
      expect(await second.tick()).toBe(false);
      clock = new Date(clock.getTime() + 61_000);
      expect(await second.tick()).toBe(true);
      release.resolve();
      await old;
      expect(fenced).toBe(true);
      const result = await db.transaction((tx) => first.get(tx, id));
      expect(result.result).toEqual({ value: "reprise" });
      expect(result.checkpoint).toEqual({ count: 1 });
      expect(result.job.attempts).toBe(2);
      expect(result.job.events.some((e) => e.code === "old")).toBe(false);
      await first.stop();
      await second.stop();
    });
  } finally {
    await f.close();
  }
});
it.each([
  { units: 498, expired: false, state: "completed", attempts: 1 },
  { units: 499, expired: false, state: "failed", attempts: 3 },
  { units: 498, expired: true, state: "completed", attempts: 2 },
] as const)(
  "journal saturé : $units unités, expiration=$expired, terminaison $state et ressource libérée",
  async ({ units, expired, state, attempts }) => {
    const f = await fixture();
    try {
      const actor = await f.setup();
      const d = (await f.request("POST", "/records", dossier())).json();
      await f.maintainDatabase(async (db) => {
        let clock = new Date("2026-10-17T00:00:00Z");
        const first = new JobRunner(db, () => clock);
        const second = new JobRunner(db, () => clock);
        const saturated = deferred(),
          release = deferred();
        await db.query(
          "CREATE TABLE fixture_job_units (unit integer PRIMARY KEY)",
        );
        const definition: JobDefinition<
          z.infer<typeof Input>,
          { count: number },
          z.infer<typeof Result>
        > = {
          kind: "test-event-limit",
          input: Input,
          checkpoint: z
            .object({ count: z.number().int().min(0).max(499) })
            .strict(),
          result: Result,
          initial: { count: 0 },
          scope: (i) => ({
            dossierId: i.dossierId,
            resourceKey: "saturated-account",
          }),
          authorize: async () => {},
          execute: async (i, c) => {
            if (i.value === "following") return { value: i.value };
            for (let count = c.checkpoint.count + 1; count <= units; count++) {
              await c.commit(
                { count },
                "unit",
                "Unité fictive durable.",
                async (tx) => {
                  await tx.query("INSERT INTO fixture_job_units VALUES($1)", [
                    count,
                  ]);
                },
              );
            }
            if (expired && c.attempt === 1) {
              saturated.resolve();
              await release.promise;
            }
            return { value: i.value };
          },
        };
        const queue = first.register(definition);
        second.register(definition);
        const id = await db.transaction((tx) =>
          queue.enqueue(tx, actor, operationId(), {
            dossierId: d.id,
            value: "full",
          }),
        );
        try {
          const execution = first.tick();
          if (expired) {
            await saturated.promise;
            clock = new Date(clock.getTime() + 61_000);
            try {
              expect(await second.tick()).toBe(true);
            } finally {
              release.resolve();
              await execution;
            }
          } else {
            await execution;
            for (let attempt = 1; attempt < attempts; attempt++)
              expect(await first.tick()).toBe(true);
          }
          const result = await db.transaction((tx) => first.get(tx, id));
          expect(result.job.state).toBe(state);
          expect(result.job.attempts).toBe(attempts);
          expect(result.checkpoint).toEqual({ count: 498 });
          expect(result.job.events).toHaveLength(500);
          expect(result.job.events.at(-1)?.code).toBe("unit");
          expect(result.result).toEqual(
            state === "completed" ? { value: "full" } : null,
          );
          expect(
            await db.query(
              "SELECT COUNT(*)::integer AS count, MAX(unit) AS last FROM fixture_job_units",
            ),
          ).toEqual([{ count: 498, last: 498 }]);
          const next = await db.transaction((tx) =>
            queue.enqueue(tx, actor, operationId(), {
              dossierId: d.id,
              value: "following",
            }),
          );
          expect(await first.tick()).toBe(true);
          expect(
            (await db.transaction((tx) => first.get(tx, next))).job.state,
          ).toBe("completed");
          clock = new Date(clock.getTime() + 61_000);
          expect(await first.tick()).toBe(false);
          expect(await second.tick()).toBe(false);
          expect((await db.transaction((tx) => first.get(tx, id))).job).toEqual(
            result.job,
          );
        } finally {
          release.resolve();
          await first.stop();
          await second.stop();
        }
      });
    } finally {
      await f.close();
    }
  },
);

it("durable silent checkpoints exceed 500 units while coalesced progress stays within the existing journal bound", async () => {
  const f = await fixture();
  try {
    const actor = await f.setup();
    await f.maintainDatabase(async (db) => {
      const jobs = new JobRunner(db);
      const queue = jobs.register({
        kind: "bounded-progress-fixture",
        input: z.object({}),
        checkpoint: z.object({ count: z.number().int() }),
        initial: { count: 0 },
        result: z.object({ count: z.number().int() }),
        scope: () => ({
          dossierId: null,
          resourceKey: "bounded-progress-fixture",
        }),
        authorize: async () => {},
        execute: async (_i, c) => {
          for (let n = c.checkpoint.count + 1; n <= 510; n++)
            await c.commit(
              { count: n },
              n % 100 === 0 || n === 510 ? "progress" : null,
              "Progression durable.",
              async () => {},
            );
          return { count: c.checkpoint.count };
        },
      });
      const id = await db.transaction((tx) =>
        queue.enqueue(tx, actor, operationId(), {}),
      );
      await jobs.tick();
      const run = await db.transaction((tx) => jobs.get(tx, id));
      expect(run.job.state).toBe("completed");
      expect(run.checkpoint).toEqual({ count: 510 });
      expect(run.result).toEqual({ count: 510 });
      expect(run.job.events.filter((e) => e.code === "progress")).toHaveLength(
        6,
      );
      await jobs.stop();
    });
  } finally {
    await f.close();
  }
});
