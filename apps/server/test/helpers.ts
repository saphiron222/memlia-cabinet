import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect } from "vitest";
import { createApplication, type ApplicationOptions } from "../src/app.js";
import { openDatabase, type Database } from "../src/storage/database.js";
export const origin = "http://localhost:3000";
export const credentials = {
  email: "admin@example.test",
  name: "Admin fictif",
  password: "UnMotDePasseFictif123!",
};
export const operationId = () => randomUUID();
export async function fixture(clock?: () => Date) {
  const dataDirectory = await mkdtemp(join(tmpdir(), "memlia-"));
  const options: ApplicationOptions = {
    dataDirectory,
    publicOrigin: origin,
    allowEmbeddedDatabase: true,
    clock,
    ...(process.env.DATABASE_URL
      ? { databaseUrl: process.env.DATABASE_URL }
      : {}),
  };
  let cleanup = async () => {};
  if (options.databaseUrl) {
    const pool = new Pool({ connectionString: options.databaseUrl });
    const schema = "test_" + randomUUID().replaceAll("-", "");
    await pool.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(options.databaseUrl);
    url.searchParams.set("options", `-csearch_path=${schema}`);
    options.databaseUrl = url.toString();
    cleanup = async () => {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    };
  }
  let app = await createApplication(options);
  let cookie = "";
  return {
    options,
    get app() {
      return app;
    },
    get cookie() {
      return cookie;
    },
    async setup() {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/setup",
        headers: { origin },
        payload: credentials,
      });
      expect(res.statusCode).toBe(201);
      cookie = String(res.headers["set-cookie"]).split(";")[0]!;
      return res.json().user;
    },
    async restart() {
      await app.close();
      app = await createApplication(options);
    },
    async maintainDatabase(run: (database: Database) => Promise<void>) {
      await app.close();
      const database = await openDatabase(options);
      try {
        await run(database);
      } finally {
        await database.close();
        app = await createApplication(options);
      }
    },
    async request(
      method: "GET" | "POST" | "PUT",
      path: string,
      payload?: Record<string, unknown>,
      token = cookie,
    ) {
      return app.inject({
        method,
        url: `/api/v1${path}`,
        headers: { origin, cookie: token },
        payload,
      });
    },
    async close() {
      await app.close();
      await cleanup();
      await rm(dataDirectory, { recursive: true, force: true });
    },
  };
}
export const dossier = (title = "Dossier fictif") => ({
  operationId: operationId(),
  record: { kind: "dossier", title, data: { siren: "001234567" } },
});
export const task = (dossierId: string) => ({
  operationId: operationId(),
  record: {
    kind: "tache",
    title: "Bilan fictif",
    dossierId,
    data: {
      dueDate: "2026-10-31",
      checklist: [
        {
          id: randomUUID(),
          label: "Vérifier les pièces fictives",
          done: false,
        },
      ],
    },
  },
});
