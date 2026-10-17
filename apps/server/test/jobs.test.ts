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
