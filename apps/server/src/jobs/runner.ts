import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  JobSchema,
  JobEventSchema,
  type Job,
  type SessionUser,
} from "@memlia/contracts";
import type {
  Connection,
  Database,
  TransactionOptions,
} from "../storage/database.js";
import { idempotent } from "../storage/operations.js";
import { effectiveUser } from "../identity/service.js";
import { fail } from "../errors.js";
export interface JobContext<C> {
  id: string;
  attempt: number;
  checkpoint: C;
  signal: AbortSignal;
  commit<T>(
    checkpoint: C | ((result: T) => C),
    code: string | null,
    message: string,
    work: (tx: Connection, actor: SessionUser) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;
}
export interface JobDefinition<I, C, R> {
  kind: string;
  input: z.ZodType<I>;
  checkpoint: z.ZodType<C>;
  result: z.ZodType<R>;
  initial: C;
  scope(input: I): { dossierId: string | null; resourceKey: string };
  authorize(tx: Connection, actor: SessionUser, input: I): Promise<void>;
  execute(input: I, context: JobContext<C>): Promise<R>;
}
interface StoredJob extends Record<string, unknown> {
  id: string;
  kind: string;
  actor_id: string;
  input: unknown;
  checkpoint: unknown;
  result: unknown;
  state: Job["state"];
  attempts: number;
  owner: string | null;
  lease_until: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  error: string | null;
}
const bounded = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const parsed = schema.parse(value);
  if (Buffer.byteLength(JSON.stringify(parsed)) > 512 * 1024)
    fail(413, "JOB_TOO_LARGE", "Le traitement dépasse la taille autorisée.");
  return parsed;
};
const iso = (date: Date | string) => new Date(date).toISOString();
export class JobRunner {
  private definitions = new Map<
    string,
    {
      execute: (
        job: StoredJob,
        owner: string,
        signal: AbortSignal,
      ) => Promise<void>;
    }
  >();
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<boolean>;
  private controller?: AbortController;
  private stopped = false;
  constructor(
    private db: Database,
    private now: () => Date = () => new Date(),
    private leaseMs = 60_000,
  ) {}
  register<I, C, R>(definition: JobDefinition<I, C, R>) {
    if (this.definitions.has(definition.kind))
      throw new Error("Traitement déjà enregistré.");
    const validated = async (tx: Connection, job: StoredJob, owner: string) => {
      const rows = await tx.query<StoredJob>(
        "SELECT * FROM cabinet_jobs WHERE id=$1 AND owner=$2 AND state='running' AND lease_until>$3",
        [job.id, owner, this.now()],
      );
      if (!rows[0])
        fail(409, "LEASE_LOST", "Exécution reprise par un autre travailleur.");
      const users = await tx.query(
        "SELECT * FROM cabinet_users WHERE id=$1 AND active=true",
        [job.actor_id],
      );
      if (!users[0]) fail(403, "FORBIDDEN", "Utilisateur désactivé.");
      const actor = await effectiveUser(tx, users[0]);
      const input = bounded(definition.input, job.input);
      await definition.authorize(tx, actor, input);
      return actor;
    };
    this.definitions.set(definition.kind, {
      execute: async (job, owner, signal) => {
        const input = bounded(definition.input, job.input);
        await this.db.transaction((tx) => validated(tx, job, owner));
        const context: JobContext<C> = {
          id: job.id,
          attempt: job.attempts,
          checkpoint: bounded(definition.checkpoint, job.checkpoint),
          signal,
          commit: async (checkpoint, code, message, work, options) => {
            signal.throwIfAborted();
            let parsed: C;
            const value = await this.db.transaction(async (tx) => {
              signal.throwIfAborted();
              const actor = await validated(tx, job, owner);
              const result = await work(tx, actor);
              parsed = bounded(
                definition.checkpoint,
                typeof checkpoint === "function"
                  ? (checkpoint as (result: unknown) => C)(result)
                  : checkpoint,
              );
              await tx.query(
                "UPDATE cabinet_jobs SET checkpoint=$1::jsonb,updated_at=$2,lease_until=$3 WHERE id=$4",
                [
                  JSON.stringify(parsed),
                  this.now(),
                  new Date(this.now().getTime() + this.leaseMs),
                  job.id,
                ],
              );
              if (code !== null) await this.event(tx, job.id, code, message);
              return result;
            }, options);
            context.checkpoint = parsed!;
            return value;
          },
        };
        const result = bounded(
          definition.result,
          await definition.execute(input, context),
        );
        signal.throwIfAborted();
        await this.db.transaction(async (tx) => {
          await validated(tx, job, owner);
          await tx.query(
            "UPDATE cabinet_jobs SET result=$1::jsonb,state='completed',owner=NULL,lease_until=NULL,updated_at=$2,error=NULL WHERE id=$3",
            [JSON.stringify(result), this.now(), job.id],
          );
          await this.event(
            tx,
            job.id,
            "completed",
            "Traitement terminé.",
            "omit",
          );
        });
      },
    });
    return {
      enqueue: async (
        tx: Connection,
        actor: SessionUser,
        operationId: string,
        raw: I,
      ): Promise<string> => {
        const input = bounded(definition.input, raw);
        const users = await tx.query(
          "SELECT * FROM cabinet_users WHERE id=$1 AND active=true",
          [actor.id],
        );
        if (!users[0]) fail(403, "FORBIDDEN", "Utilisateur désactivé.");
        await definition.authorize(
          tx,
          await effectiveUser(tx, users[0]),
          input,
        );
        const gates = await tx.query(
          "SELECT paused FROM cabinet_job_gate WHERE id=1",
        );
        if (gates[0]?.paused || this.stopped)
          fail(503, "JOBS_PAUSED", "Les traitements sont suspendus.");
        return idempotent(
          tx,
          actor,
          operationId,
          { jobKind: definition.kind, input },
          async () => {
            const id = randomUUID(),
              scope = definition.scope(input);
            if (scope.resourceKey.length > 500)
              throw new Error("Clé de ressource trop longue.");
            await tx.query(
              "INSERT INTO cabinet_jobs(id,kind,actor_id,dossier_id,resource_key,input,checkpoint,state,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,'queued',$8,$8)",
              [
                id,
                definition.kind,
                actor.id,
                scope.dossierId,
                scope.resourceKey,
                JSON.stringify(input),
                JSON.stringify(definition.checkpoint.parse(definition.initial)),
                this.now(),
              ],
            );
            await this.event(tx, id, "planned", "Traitement mis en attente.");
            return id;
          },
        );
      },
    };
  }
  private async event(
    tx: Connection,
    id: string,
    code: string | null,
    message: string,
    onFull: "reject" | "omit" = "reject",
  ) {
    const rows = await tx.query(
      "SELECT COALESCE(MAX(sequence),0)+1 AS next FROM cabinet_job_events WHERE job_id=$1",
      [id],
    );
    const sequence = Number(rows[0]!.next);
    if (sequence > 500) {
      // Control transitions must remain durable when the bounded journal is full.
      // Business commits still reject, rolling back work and checkpoint together.
      if (onFull === "omit") return;
      fail(409, "EVENT_LIMIT", "Limite du journal atteinte.");
    }
    const event = JobEventSchema.parse({
      sequence,
      at: this.now().toISOString(),
      code,
      message,
    });
    await tx.query("INSERT INTO cabinet_job_events VALUES($1,$2,$3::jsonb)", [
      id,
      sequence,
      JSON.stringify(event),
    ]);
  }
  async get(
    tx: Connection,
    id: string,
  ): Promise<{
    job: Job;
    input: unknown;
    result: unknown;
    checkpoint: unknown;
    actorId: string;
  }> {
    const rows = await tx.query<StoredJob>(
      "SELECT * FROM cabinet_jobs WHERE id=$1",
      [id],
    );
    const row = rows[0];
    if (!row) fail(404, "NOT_FOUND", "Ressource inaccessible.");
    const events = await tx.query(
      "SELECT event FROM cabinet_job_events WHERE job_id=$1 ORDER BY sequence LIMIT 500",
      [id],
    );
    return {
      job: JobSchema.parse({
        id: row.id,
        kind: row.kind,
        state: row.state,
        attempts: row.attempts,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        events: events.map((r) => r.event),
        error: row.error,
      }),
      input: row.input,
      result: row.result,
      checkpoint: row.checkpoint,
      actorId: row.actor_id,
    };
  }
  start() {
    this.stopped = false;
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.tick().catch(() => {
          /* Durable state is retried on the next tick. */
        });
      }, 100);
      this.timer.unref();
    }
  }
  async tick(): Promise<boolean> {
    if (this.active) return this.active;
    if (this.stopped) return false;
    this.active = this.executeNext();
    try {
      return await this.active;
    } finally {
      this.active = undefined;
    }
  }
  private async executeNext(): Promise<boolean> {
    const owner = randomUUID();
    const job = await this.db.transaction(async (tx) => {
      if (this.stopped) return undefined;
      const gates = await tx.query(
        "SELECT paused FROM cabinet_job_gate WHERE id=1",
      );
      if (gates[0]?.paused) return undefined;
      await tx.query(
        "UPDATE cabinet_jobs SET state='failed',error='Reprises épuisées après interruption.',owner=NULL,lease_until=NULL,updated_at=$1 WHERE state='running' AND lease_until<=$1 AND attempts>=3",
        [this.now()],
      );
      const rows = await tx.query<StoredJob>(
        "SELECT j.* FROM cabinet_jobs j WHERE (j.state='queued' OR (j.state='running' AND j.lease_until<=$1)) AND j.attempts<3 AND j.kind=ANY($2::text[]) AND NOT EXISTS(SELECT 1 FROM cabinet_jobs busy WHERE busy.resource_key=j.resource_key AND busy.state='running' AND busy.lease_until>$1) ORDER BY j.created_at,j.id LIMIT 1",
        [this.now(), [...this.definitions.keys()]],
      );
      const row = rows[0];
      if (!row) return undefined;
      await tx.query(
        "UPDATE cabinet_jobs SET state='running',attempts=attempts+1,owner=$1,lease_until=$2,updated_at=$3 WHERE id=$4",
        [
          owner,
          new Date(this.now().getTime() + this.leaseMs),
          this.now(),
          row.id,
        ],
      );
      await this.event(
        tx,
        row.id,
        row.attempts ? "resumed" : "started",
        row.attempts
          ? "Reprise au dernier point durable."
          : "Exécution démarrée.",
        "omit",
      );
      return { ...row, attempts: row.attempts + 1 };
    });
    if (!job) return false;
    const controller = new AbortController();
    this.controller = controller;
    if (this.stopped) controller.abort();
    const heartbeat = setInterval(
      () => {
        void this.db
          .transaction(async (tx) => {
            const rows = await tx.query(
              "UPDATE cabinet_jobs SET lease_until=$1 WHERE id=$2 AND owner=$3 AND state='running' AND lease_until>$4 RETURNING id",
              [
                new Date(this.now().getTime() + this.leaseMs),
                job.id,
                owner,
                this.now(),
              ],
            );
            if (!rows.length) controller.abort();
          })
          .catch(() => controller.abort());
      },
      Math.max(10, Math.floor(this.leaseMs / 3)),
    );
    heartbeat.unref();
    try {
      await this.definitions
        .get(job.kind)!
        .execute(job, owner, controller.signal);
    } catch {
      await this.db.transaction(async (tx) => {
        const rows = await tx.query(
          "SELECT id FROM cabinet_jobs WHERE id=$1 AND owner=$2 AND state='running'",
          [job.id, owner],
        );
        if (!rows.length) return;
        const stopped = this.stopped,
          retry = stopped || job.attempts < 3;
        await tx.query(
          "UPDATE cabinet_jobs SET state=$1,owner=NULL,lease_until=NULL,updated_at=$2,error=$3,attempts=attempts-$4 WHERE id=$5",
          [
            retry ? "queued" : "failed",
            this.now(),
            stopped ? null : "Exécution interrompue ; reprise bornée.",
            stopped ? 1 : 0,
            job.id,
          ],
        );
        await this.event(
          tx,
          job.id,
          stopped ? "stopped" : retry ? "retry" : "failed",
          stopped
            ? "Arrêt propre au dernier point durable."
            : retry
              ? "Interruption ; nouvelle tentative prévue."
              : "Échec après trois tentatives.",
          "omit",
        );
      });
    } finally {
      clearInterval(heartbeat);
      this.controller = undefined;
    }
    return true;
  }
  /** Stops this consumer and waits for it; persisted jobs remain resumable. */
  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    await this.active;
  }
  /** Installation gate blocks producers and new leases. Call on every worker, then await all stops. */
  async pause() {
    await this.db.transaction(async (tx) => {
      await tx.query("UPDATE cabinet_job_gate SET paused=true WHERE id=1");
    });
    await this.stop();
  }
  async resume() {
    await this.db.transaction(async (tx) => {
      await tx.query("UPDATE cabinet_job_gate SET paused=false WHERE id=1");
    });
    this.start();
  }
}
