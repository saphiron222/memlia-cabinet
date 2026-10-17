import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { migrate } from "./migrations.js";
export interface Connection {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
}
export interface Database extends Connection {
  transaction<T>(run: (tx: Connection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function openDatabase(options: {
  dataDirectory: string;
  databaseUrl?: string;
  allowEmbeddedDatabase?: boolean;
}): Promise<Database> {
  if (options.databaseUrl) {
    const pool = new Pool({ connectionString: options.databaseUrl });
    const query: Connection["query"] = async (sql, params) =>
      (await pool.query(sql, params)).rows;
    const db: Database = {
      query,
      async transaction(run) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(72461017)");
          const result = await run({
            query: async (sql, params) =>
              (await client.query(sql, params)).rows,
          });
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
      async close() {
        await pool.end();
      },
    };
    try {
      await db.transaction(migrate);
    } catch (error) {
      await db.close();
      throw error;
    }
    return db;
  }
  if (!options.allowEmbeddedDatabase)
    throw new Error(
      "DATABASE_URL requis ; PGlite exige allowEmbeddedDatabase explicite.",
    );
  await mkdir(options.dataDirectory, { recursive: true, mode: 0o700 });
  const pg = new PGlite(join(options.dataDirectory, "postgres"), {
    extensions: { pg_trgm },
  });
  await pg.waitReady;
  try {
    await pg.transaction((tx) =>
      migrate({
        query: async (sql, params) =>
          (await tx.query(sql, params)).rows as never,
      }),
    );
  } catch (error) {
    await pg.close();
    throw error;
  }
  // Serialize complete transactions, including idempotence and authorization checks.
  let tail: Promise<unknown> = Promise.resolve();
  return {
    query: async (sql, params) => (await pg.query(sql, params)).rows as never,
    transaction<T>(run: (tx: Connection) => Promise<T>): Promise<T> {
      const next = tail.then(() =>
        pg.transaction(async (tx) =>
          run({
            query: async (sql, params) =>
              (await tx.query(sql, params)).rows as never,
          }),
        ),
      );
      tail = next.catch(() => undefined);
      return next;
    },
    async close() {
      await tail;
      await pg.close();
    },
  };
}
