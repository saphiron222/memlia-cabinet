import { it, expect } from "vitest";
import { Client } from "pg";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  cp,
  symlink,
  readdir,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backup,
  restore,
  validateBackup,
} from "../../../deploy/operations.mjs";
import { createApplication } from "../src/app.js";
import { credentials, origin, dossier, task } from "./helpers.js";
it.skipIf(!process.env.DATABASE_URL).each(["public", "cabinet_fixture"])(
  "PostgreSQL 17: offline backup restores linked records, exact bytes and configuration; unsafe targets never change (%s)",
  async (schema) => {
    const base = new URL(process.env.DATABASE_URL!);
    const admin = new Client({ connectionString: base.toString() });
    await admin.connect();
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "memlia-backup-")),
    );
    const names = ["source_", "target_", "occupied_"].map(
      (prefix) => prefix + randomUUID().replaceAll("-", ""),
    );
    const urls: string[] = [];
    const runtimeRole = "runtime_" + randomUUID().replaceAll("-", ""),
      runtimePassword = randomUUID();
    let app: Awaited<ReturnType<typeof createApplication>> | undefined;
    try {
      await admin.query(
        `CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${runtimePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
      );
      for (const name of names) {
        await admin.query(
          `CREATE DATABASE ${name} OWNER ${runtimeRole} TEMPLATE template0`,
        );
        const url = new URL(base);
        url.pathname = "/" + name;
        url.username = runtimeRole;
        url.password = runtimePassword;
        urls.push(url.toString());
      }
      for (const [index, url] of urls.entries()) {
        const connection = new Client({ connectionString: url });
        await connection.connect();
        try {
          if (index === 0 && schema !== "public")
            await connection.query(`CREATE SCHEMA ${schema}`);
          await connection.query(
            `ALTER ROLE ${runtimeRole} IN DATABASE ${new URL(url).pathname.slice(1)} SET search_path TO ${schema}, public`,
          );
        } finally {
          await connection.end();
        }
      }
      for (const dir of [
        "data",
        "restored",
        "occupied",
        "config-target",
        "config-occupied",
      ])
        await mkdir(join(root, dir), { mode: 0o700 });
      for (let n = 0; n < 3; n++)
        await writeFile(join(root, `url-${n}`), urls[n]!, { mode: 0o600 });
      const configuration = {
        publicOrigin: origin,
        allowHttpLoopback: true,
        ...(schema === "public" ? {} : { cabinetTimeZone: "America/New_York" }),
      };
      await writeFile(
        join(root, "config.json"),
        JSON.stringify(configuration),
        { mode: 0o600 },
      );
      const source = {
        dataDirectory: join(root, "data"),
        databaseUrl: urls[0]!,
        publicOrigin: origin,
      };
      app = await createApplication(source);
      const setup = await app.inject({
        method: "POST",
        url: "/api/v1/setup",
        headers: { origin },
        payload: credentials,
      });
      expect(setup.statusCode).toBe(201);
      let cookie = String(setup.headers["set-cookie"]).split(";")[0]!;
      const record = (
        await app.inject({
          method: "POST",
          url: "/api/v1/records",
          headers: { origin, cookie },
          payload: dossier("Dossier à restaurer"),
        })
      ).json();
      const linked = (
        await app.inject({
          method: "POST",
          url: "/api/v1/records",
          headers: { origin, cookie },
          payload: task(record.id),
        })
      ).json();
      const bytes = Buffer.from(
        "Original fictif — montant 1234,56 — échéance 2026-10-31.",
      );
      const metadata = {
        operationId: randomUUID(),
        dossierId: record.id,
        filename: "preuve.txt",
        mediaType: "text/plain",
        source: { kind: "manual", reference: "fixture-backup", version: "1" },
      };
      const payload = Buffer.concat([
        Buffer.from(
          `--piece\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n--piece\r\nContent-Disposition: form-data; name="file"; filename="preuve.txt"\r\nContent-Type: text/plain\r\n\r\n`,
        ),
        bytes,
        Buffer.from("\r\n--piece--\r\n"),
      ]);
      const upload = await app.inject({
        method: "POST",
        url: "/api/v1/documents",
        headers: {
          origin,
          cookie,
          "content-type": "multipart/form-data; boundary=piece",
        },
        payload,
      });
      expect(upload.statusCode).toBe(201);
      const document = upload.json();
      const options = {
        dataDirectory: source.dataDirectory,
        configFile: join(root, "config.json"),
        urlFile: join(root, "url-0"),
        backupDirectory: join(root, "backup"),
      };
      const invalidConfig = join(root, "invalid-config.json");
      await writeFile(
        invalidConfig,
        JSON.stringify({ ...configuration, cabinetTimeZone: "Invalid/Zone" }),
        { mode: 0o600 },
      );
      await expect(
        backup({ ...options, configFile: invalidConfig }),
      ).rejects.toThrow("Fuseau du cabinet invalide");
      await expect(backup(options)).rejects.toThrow("Arrêter et drainer");
      expect(await readdir(root)).not.toContain("backup");
      await app.close();
      app = undefined;
      await expect(
        backup({ ...options, pgDump: "/missing/pg_dump" }),
      ).rejects.toThrow("indisponible");
      expect(await readdir(root)).not.toContain("backup");
      await backup(options);
      await validateBackup(options.backupDirectory);
      const target = {
        ...options,
        dataDirectory: join(root, "restored"),
        configFile: join(root, "config-target", "installation.json"),
        urlFile: join(root, "url-1"),
      };
      await writeFile(join(target.dataDirectory, "sentinel"), "untouched", {
        mode: 0o600,
      });
      await expect(restore(target)).rejects.toThrow("non vide");
      expect(
        await readFile(join(target.dataDirectory, "sentinel"), "utf8"),
      ).toBe("untouched");
      await rm(join(target.dataDirectory, "sentinel"));
      const occupied = new Client({ connectionString: urls[2] });
      await occupied.connect();
      await occupied.query("SET search_path TO public");
      await occupied.query("CREATE TABLE sentinel(value text)");
      await occupied.query("INSERT INTO sentinel VALUES('untouched')");
      try {
        await expect(
          restore({
            ...target,
            dataDirectory: join(root, "occupied"),
            configFile: join(root, "config-occupied", "installation.json"),
            urlFile: join(root, "url-2"),
          }),
        ).rejects.toThrow("non vierge");
        expect((await occupied.query("SELECT * FROM sentinel")).rows).toEqual([
          { value: "untouched" },
        ]);
        await occupied.query("DROP TABLE sentinel");
        await occupied.query("CREATE TYPE sentinel_type AS ENUM ('untouched')");
        await expect(
          restore({
            ...target,
            dataDirectory: join(root, "occupied"),
            configFile: join(root, "config-occupied", "installation.json"),
            urlFile: join(root, "url-2"),
          }),
        ).rejects.toThrow("non vierge");
        expect(
          (await occupied.query("SELECT 'untouched'::sentinel_type AS value"))
            .rows,
        ).toEqual([{ value: "untouched" }]);
      } finally {
        await occupied.end();
      }
      for (const mutation of [
        "hash",
        "parent",
        "symlink",
        "extra",
        "duplicate",
        "version",
      ]) {
        const corrupted = join(root, "bad-" + mutation);
        await cp(options.backupDirectory, corrupted, { recursive: true });
        const file = join(corrupted, "manifest.json"),
          manifest = JSON.parse(await readFile(file, "utf8"));
        if (mutation === "hash")
          await writeFile(join(corrupted, "documents", document.id), "altered");
        if (mutation === "parent") manifest.files[0].path = "../escape";
        if (mutation === "symlink") {
          await rm(join(corrupted, "documents", document.id));
          await symlink(
            join(root, "config.json"),
            join(corrupted, "documents", document.id),
          );
        }
        if (mutation === "extra")
          await writeFile(join(corrupted, "extra"), "extra");
        if (mutation === "duplicate") manifest.files.push(manifest.files[0]);
        if (mutation === "version") manifest.schema = 999;
        await writeFile(file, JSON.stringify(manifest));
        await expect(
          restore({ ...target, backupDirectory: corrupted }),
        ).rejects.toThrow();
        expect(await readdir(target.dataDirectory)).toEqual([]);
      }
      const catalogQuery =
        "SELECT schemaname,relname,last_analyze FROM pg_stat_all_tables WHERE schemaname IN ('pg_catalog','information_schema') ORDER BY schemaname,relname";
      const before = new Client({ connectionString: urls[1] });
      await before.connect();
      const catalogBefore = (await before.query(catalogQuery)).rows;
      await before.end();
      const restored = spawnSync(
        process.execPath,
        ["deploy/operations.mjs", "restore", target.backupDirectory],
        {
          env: {
            ...process.env,
            DATABASE_URL_FILE: target.urlFile,
            DATA_DIRECTORY: target.dataDirectory,
            CONFIG_FILE: target.configFile,
          },
          encoding: "utf8",
        },
      );
      expect(restored.status, restored.stderr).toBe(0);
      expect(restored.stdout + restored.stderr).not.toMatch(
        /warning|permission denied|pg_catalog/i,
      );
      const verification = new Client({ connectionString: urls[1] });
      await verification.connect();
      try {
        expect(
          (
            await verification.query(
              "SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user",
            )
          ).rows,
        ).toEqual([
          { rolsuper: false, rolcreatedb: false, rolcreaterole: false },
        ]);
        const analyzed = (
          await verification.query(
            "SELECT schemaname,relname,last_analyze IS NOT NULL AS analyzed FROM pg_stat_all_tables WHERE schemaname=$1",
            [schema],
          )
        ).rows;
        expect(analyzed.length).toBeGreaterThan(0);
        expect(analyzed.every((row) => row.analyzed)).toBe(true);
        expect((await verification.query(catalogQuery)).rows).toEqual(
          catalogBefore,
        );
      } finally {
        await verification.end();
      }
      expect(JSON.parse(await readFile(target.configFile, "utf8"))).toEqual(
        configuration,
      );
      app = await createApplication({
        dataDirectory: target.dataDirectory,
        databaseUrl: urls[1]!,
        publicOrigin: origin,
      });
      const logged = await app.inject({
        method: "POST",
        url: "/api/v1/login",
        headers: { origin },
        payload: { email: credentials.email, password: credentials.password },
      });
      expect(logged.statusCode).toBe(200);
      cookie = String(logged.headers["set-cookie"]).split(";")[0]!;
      expect(
        (
          await app.inject({
            url: "/api/v1/records/" + record.id,
            headers: { cookie },
          })
        ).json(),
      ).toMatchObject({
        title: "Dossier à restaurer",
        data: { siren: "001234567" },
      });
      expect(
        (
          await app.inject({
            url: "/api/v1/records/" + linked.id,
            headers: { cookie },
          })
        ).json(),
      ).toMatchObject({
        dossierId: record.id,
        data: { dueDate: "2026-10-31" },
      });
      const download = await app.inject({
        url: "/api/v1/documents/" + document.id + "/download",
        headers: { cookie },
      });
      expect(download.statusCode).toBe(200);
      expect(download.rawPayload).toEqual(bytes);
      expect(
        (await app.inject("/api/v1/documents/" + document.id + "/download"))
          .statusCode,
      ).toBe(401);
      await app.close();
      app = undefined;
      await expect(restore(target)).rejects.toThrow("non vide");
      expect(
        await readFile(join(source.dataDirectory, "documents", document.id)),
      ).toEqual(bytes);
    } finally {
      if (app) await app.close();
      for (const name of names)
        await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS ${runtimeRole}`);
      await admin.end();
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);
