import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  TimeEntitySchema,
  TimerStartSchema,
  TimerStopSchema,
  type SessionUser,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { idempotent } from "../storage/operations.js";
import { fail } from "../errors.js";
import {
  activeNature,
  authorize,
  load,
  store,
  openPeriod,
  rateAt,
} from "./service.js";
export async function startTimer(
  tx: Connection,
  actor: SessionUser,
  i: z.infer<typeof TimerStartSchema>,
  now: Date,
) {
  const candidate = TimeEntitySchema.parse({
    id: randomUUID(),
    version: 1,
    actorId: actor.id,
    updatedAt: now.toISOString(),
    data: {
      kind: "timer",
      userId: actor.id,
      date: i.date,
      natureId: i.natureId,
      link: i.link,
      startedAt: now.toISOString(),
      stoppedAt: null,
      entryId: null,
    },
  });
  await authorize(tx, actor, candidate);
  const result = await idempotent(
    tx,
    actor,
    i.operationId,
    { startTimer: i },
    async () => {
      await activeNature(tx, actor, i.natureId);
      await openPeriod(tx, candidate.data);
      const rows = await tx.query(
        "SELECT id FROM cabinet_time WHERE kind='timer' AND content->'data'->>'userId'=$1 AND content->'data'->>'stoppedAt' IS NULL",
        [actor.id],
      );
      if (rows.length)
        fail(409, "ACTIVE_TIMER", "Un chronomètre est déjà actif.");
      return store(tx, candidate);
    },
  );
  await load(tx, actor, result.id);
  await authorize(tx, actor, result);
  return result;
}
export async function stopTimer(
  tx: Connection,
  actor: SessionUser,
  id: string,
  i: z.infer<typeof TimerStopSchema>,
  now: Date,
) {
  const timer = await load(tx, actor, id);
  if (timer.data.kind !== "timer" || timer.data.userId !== actor.id)
    fail(404, "NOT_FOUND", "Chronomètre inaccessible.");
  const result = await idempotent(
    tx,
    actor,
    i.operationId,
    { stopTimer: id, ...i },
    async () => {
      if (
        timer.version !== i.expectedVersion ||
        timer.data.kind !== "timer" ||
        timer.data.stoppedAt
      )
        fail(
          409,
          "TIMER_STOPPED",
          "Ce chronomètre a déjà changé ou est arrêté.",
        );
      await openPeriod(tx, timer.data);
      const seconds = Math.floor(
        (now.getTime() - Date.parse(timer.data.startedAt)) / 1000,
      );
      if (seconds < 1 || seconds > 604800)
        fail(
          409,
          "TIMER_DURATION",
          "Durée attendue entre une seconde et sept jours.",
        );
      const entry = TimeEntitySchema.parse({
        id: randomUUID(),
        version: 1,
        actorId: actor.id,
        updatedAt: now.toISOString(),
        data: {
          kind: "entry",
          userId: actor.id,
          date: timer.data.date,
          natureId: timer.data.natureId,
          link: timer.data.link,
          seconds,
          source: "timer",
          timerId: id,
          rate: await rateAt(tx, actor, actor.id, timer.data.date),
        },
      });
      await store(tx, entry);
      return store(tx, {
        ...timer,
        version: timer.version + 1,
        updatedAt: now.toISOString(),
        data: {
          ...timer.data,
          stoppedAt: now.toISOString(),
          entryId: entry.id,
        },
      });
    },
  );
  await authorize(tx, actor, result);
  if (result.data.kind === "timer" && result.data.entryId)
    await load(tx, actor, result.data.entryId);
  return result;
}
