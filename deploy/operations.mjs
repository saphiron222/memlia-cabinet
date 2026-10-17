import { Client } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (message) => {
  throw new Error(message);
};
export async function safePath(
  path,
  { directory = true, privateMode = true } = {},
) {
  if (!isAbsolute(path) || resolve(path) !== path)
    fail("Chemin absolu canonique requis.");
  let cursor = sep;
  for (const part of path.split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink()) fail("Lien symbolique refusé.");
  }
  const info = await lstat(path);
  if (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)
    fail("Type de fichier refusé.");
  if (privateMode && info.mode & 0o077)
    fail("Droits privés requis (0700/0600).");
  await access(path, constants.R_OK | (directory ? constants.W_OK : 0));
}
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function validateCabinetTimeZone(value = "Europe/Paris") {
  try {
    if (typeof value !== "string" || !value) throw new Error();
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    fail("Fuseau du cabinet invalide.");
  }
}
async function config(path) {
  await safePath(path, { directory: false });
  const value = JSON.parse(await readFile(path, "utf8"));
  if (
    ![
      "allowHttpLoopback,publicOrigin",
      "allowHttpLoopback,cabinetTimeZone,publicOrigin",
    ].includes(Object.keys(value).sort().join(",")) ||
    typeof value.allowHttpLoopback !== "boolean"
  )
    fail("Configuration non reconnue.");
  validateCabinetTimeZone(value.cabinetTimeZone);
  const url = new URL(value.publicOrigin);
  if (
    url.origin !== value.publicOrigin ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        value.allowHttpLoopback &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    fail("Origine HTTPS requise.");
  return value;
}
async function run(command, args, env, capture = false) {
  return new Promise((accept, reject) => {
    let output = "";
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", capture ? "pipe" : "ignore", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 120_000);
    if (capture)
      child.stdout.on("data", (bytes) => {
        if (output.length < 8192) output += bytes;
      });
    // Never forward database stderr: libpq diagnostics can contain credentials.
    child.stderr.resume();
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("Outil PostgreSQL indisponible."));
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0
        ? accept(output.trim())
        : reject(new Error("Outil PostgreSQL en échec."));
    });
  });
}
async function clientVersion(command) {
  const version = await run(command, ["--version"], process.env, true);
  if (!/\(PostgreSQL\) 17\./.test(version))
    fail("Client PostgreSQL 17 requis.");
  return version;
}
async function durable(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await durable(path);
    else {
      const file = await open(path, "r");
      try {
        await file.sync();
      } finally {
        await file.close();
      }
    }
  }
  const directory = await open(root, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function connect(options) {
  await safePath(options.urlFile, { directory: false });
  const url = new URL((await readFile(options.urlFile, "utf8")).trim());
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:")
    fail("Connexion PostgreSQL requise.");
  if (url.search || url.hash) fail("Connexion dédiée sans options requise.");
  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  try {
    const version = Number(
      (await db.query("SHOW server_version_num")).rows[0].server_version_num,
    );
    if (Math.floor(version / 10000) !== 17) fail("PostgreSQL 17 requis.");
    if (
      !(await db.query("SELECT pg_try_advisory_lock(72461018) AS acquired"))
        .rows[0].acquired
    )
      fail(
        "Arrêter et drainer tous les services applicatifs avant la sauvegarde/restauration.",
      );
    return { db, url, version };
  } catch (error) {
    await db.end();
    throw error;
  }
}
async function pgEnvironment(url, staging) {
  const escape = (s) =>
    decodeURIComponent(s).replaceAll("\\", "\\\\").replaceAll(":", "\\:");
  const passwordFile = join(staging, ".pgpass");
  await writeFile(
    passwordFile,
    [
      url.hostname,
      url.port || "5432",
      url.pathname.slice(1),
      url.username,
      url.password,
    ]
      .map(escape)
      .join(":") + "\n",
    { mode: 0o600, flag: "wx" },
  );
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (
      key.startsWith("PG") ||
      ["DATABASE_URL", "DATABASE_URL_FILE", "BOOTSTRAP_TOKEN"].includes(key)
    )
      delete env[key];
  Object.assign(env, {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSFILE: passwordFile,
  });
  return { env, passwordFile };
}
async function entries(root) {
  const out = [];
  async function visit(relative) {
    const path = join(root, relative),
      info = await lstat(path);
    if (
      info.isSymbolicLink() ||
      (!info.isDirectory() && (!info.isFile() || info.nlink !== 1))
    )
      fail("Lien ou type spécial refusé.");
    if (info.mode & 0o7000) fail("Modes spéciaux refusés.");
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort())
        await visit(relative ? relative + "/" + name : name);
    } else {
      if (info.size > 1024 * 1024 * 1024)
        fail("Fichier de sauvegarde trop volumineux.");
      out.push({
        path: relative,
        size: info.size,
        sha256: sha(await readFile(path)),
      });
    }
  }
  await visit("");
  return out;
}
function allowed(path) {
  return (
    path === "database.dump" ||
    path === "config.json" ||
    (/^documents\/[0-9a-f-]+$/.test(path) && uuid.test(path.slice(10)))
  );
}
export async function backup(options) {
  await safePath(options.dataDirectory);
  await config(options.configFile);
  await safePath(dirname(options.backupDirectory));
  if (resolve(options.backupDirectory).startsWith(options.dataDirectory + sep))
    fail("Sauvegarde hors volume de données requise.");
  try {
    await lstat(options.backupDirectory);
    fail("La destination existe déjà.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const { db, url, version } = await connect(options);
  const staging = options.backupDirectory + ".incomplete-" + randomUUID();
  await mkdir(staging, { mode: 0o700 });
  try {
    const migrations = (
      await db.query("SELECT version FROM schema_migrations ORDER BY version")
    ).rows.map((r) => r.version);
    if (
      ![
        "1,2,3,4",
        "1,2,3,4,5",
        "1,2,3,4,5,6",
        "1,2,3,4,5,6,7",
        "1,2,3,4,5,6,7,8",
        "1,2,3,4,5,6,7,8,9",
        "1,2,3,4,5,6,7,8,9,10",
      ].includes(migrations.join(","))
    )
      fail("Version de schéma non prise en charge.");
    const documents = (
      await db.query("SELECT id,content FROM cabinet_documents ORDER BY id")
    ).rows;
    const pgClientVersion = await clientVersion(options.pgDump ?? "pg_dump");
    const env = await pgEnvironment(url, staging);
    try {
      await run(
        options.pgDump ?? "pg_dump",
        [
          "--format=custom",
          "--no-owner",
          "--no-acl",
          "--file",
          join(staging, "database.dump"),
        ],
        env.env,
      );
    } finally {
      await rm(env.passwordFile);
    }
    await chmod(join(staging, "database.dump"), 0o600);
    await mkdir(join(staging, "documents"), { mode: 0o700 });
    for (const document of documents) {
      if (!uuid.test(document.id)) fail("Identifiant documentaire invalide.");
      const source = join(options.dataDirectory, "documents", document.id);
      await safePath(source, { directory: false });
      const bytes = await readFile(source);
      if (
        sha(bytes) !== document.content.sha256 ||
        bytes.length !== document.content.size
      )
        fail("Original GED absent ou altéré.");
      await writeFile(join(staging, "documents", document.id), bytes, {
        mode: 0o600,
        flag: "wx",
      });
    }
    await copyFile(options.configFile, join(staging, "config.json"));
    await chmod(join(staging, "config.json"), 0o600);
    const manifest = {
      format: 1,
      application: "0.1.0",
      schema: migrations.at(-1),
      postgresMajor: 17,
      serverVersion: version,
      pgClientVersion,
      architecture: process.arch,
      platform: process.platform,
      createdAt: new Date().toISOString(),
      id: randomUUID(),
      documents: documents.map((d) => d.id),
      files: await entries(staging),
    };
    await writeFile(
      join(staging, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    await validateBackup(staging);
    await db.query("SELECT 1");
    await durable(staging);
    await rename(staging, options.backupDirectory);
    const parent = await open(dirname(options.backupDirectory), "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
    return manifest;
  } finally {
    await db.end();
  }
}
export async function validateBackup(root) {
  await safePath(root);
  await safePath(join(root, "manifest.json"), { directory: false });
  if ((await stat(join(root, "manifest.json"))).size > 10 * 1024 * 1024)
    fail("Manifeste trop volumineux.");
  const manifest = JSON.parse(
    await readFile(join(root, "manifest.json"), "utf8"),
  );
  if (
    manifest.format !== 1 ||
    ![4, 5, 6, 7, 8, 9, 10].includes(manifest.schema) ||
    manifest.application !== "0.1.0" ||
    manifest.postgresMajor !== 17 ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.documents)
  )
    fail("Sauvegarde incompatible.");
  if (manifest.files.length > 100000 || manifest.documents.length > 100000)
    fail("Inventaire trop volumineux.");
  const paths = new Set();
  for (const file of manifest.files) {
    if (
      typeof file.path !== "string" ||
      !allowed(file.path) ||
      paths.has(file.path) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      !/^[0-9a-f]{64}$/.test(file.sha256)
    )
      fail("Inventaire invalide.");
    paths.add(file.path);
  }
  if (
    !paths.has("database.dump") ||
    !paths.has("config.json") ||
    new Set(manifest.documents).size !== manifest.documents.length ||
    manifest.documents.some(
      (id) => !uuid.test(id) || !paths.has("documents/" + id),
    ) ||
    paths.size !== manifest.documents.length + 2
  )
    fail("Inventaire incomplet.");
  const actual = (await entries(root)).filter(
    (f) => f.path !== "manifest.json",
  );
  if (actual.length !== manifest.files.length)
    fail("Fichier absent ou supplémentaire.");
  for (const file of actual) {
    const expected = manifest.files.find((f) => f.path === file.path);
    if (
      !expected ||
      expected.size !== file.size ||
      expected.sha256 !== file.sha256
    )
      fail("Empreinte de sauvegarde incorrecte.");
  }
  await config(join(root, "config.json"));
  return manifest;
}
export async function restore(options) {
  const manifest = await validateBackup(options.backupDirectory);
  await safePath(options.dataDirectory);
  await safePath(dirname(options.configFile));
  if ((await readdir(options.dataDirectory)).length)
    fail("Volume GED cible non vide.");
  try {
    await lstat(options.configFile);
    fail("Configuration cible déjà présente.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const { db, url } = await connect(options);
  const staging = join(options.dataDirectory, ".restore-incomplete");
  try {
    // A template0 database contains no user schemas/relations/functions/extensions beyond plpgsql.
    const occupied = await db.query(
      `SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname NOT LIKE 'pg_%' UNION ALL SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' UNION ALL SELECT 1 FROM pg_depend WHERE refclassid='pg_namespace'::regclass AND refobjid=(SELECT oid FROM pg_namespace WHERE nspname='public') UNION ALL SELECT 1 FROM pg_extension WHERE extname<>'plpgsql'`,
    );
    if (occupied.rowCount)
      fail("Base cible non vierge ; aucune suppression automatique.");
    await clientVersion(options.pgRestore ?? "pg_restore");
    await mkdir(staging, { mode: 0o700 });
    const env = await pgEnvironment(url, staging);
    try {
      await run(
        options.pgRestore ?? "pg_restore",
        [
          "--single-transaction",
          "--exit-on-error",
          "--no-owner",
          "--no-acl",
          "--dbname",
          decodeURIComponent(url.pathname.slice(1)),
          join(options.backupDirectory, "database.dump"),
        ],
        env.env,
      );
    } finally {
      await rm(env.passwordFile);
    }
    const rows = (
      await db.query("SELECT id,content FROM cabinet_documents ORDER BY id")
    ).rows;
    if (
      rows.length !== manifest.documents.length ||
      rows.some((d) => !manifest.documents.includes(d.id))
    )
      fail("Références restaurées différentes.");
    await mkdir(join(staging, "documents"), { mode: 0o700 });
    for (const row of rows) {
      const bytes = await readFile(
        join(options.backupDirectory, "documents", row.id),
      );
      if (
        sha(bytes) !== row.content.sha256 ||
        bytes.length !== row.content.size
      )
        fail("Original restauré incohérent.");
      await writeFile(join(staging, "documents", row.id), bytes, {
        mode: 0o600,
        flag: "wx",
      });
    }
    let analysisWarning = false;
    const observeAnalysis = (notice) => {
      if (notice.severity === "WARNING") analysisWarning = true;
    };
    db.on("notice", observeAnalysis);
    try {
      const tables = (
        await db.query(`
        SELECT format('%I.%I', n.nspname, c.relname) AS qualified_name
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relnamespace=(SELECT relnamespace FROM pg_class WHERE oid='cabinet_documents'::regclass)
          AND c.relowner=current_user::regrole AND c.relkind IN ('r','p')
          AND n.nspname NOT IN ('pg_catalog','information_schema')
          AND n.nspname NOT LIKE 'pg_%'
        ORDER BY c.relname
      `)
      ).rows;
      if (!tables.length) fail("Tables applicatives restaurées absentes.");
      for (const table of tables)
        await db.query("ANALYZE " + table.qualified_name);
      if (analysisWarning) fail("Analyse des tables restaurées incomplète.");
    } finally {
      db.off("notice", observeAnalysis);
    }
    await rename(
      join(staging, "documents"),
      join(options.dataDirectory, "documents"),
    );
    await copyFile(
      join(options.backupDirectory, "config.json"),
      options.configFile,
      constants.COPYFILE_EXCL,
    );
    await chmod(options.configFile, 0o600);
    await rm(staging, { recursive: true });
    return manifest;
  } finally {
    await db.end();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [mode, backupDirectory] = process.argv.slice(2);
  try {
    if (!["backup", "restore", "verify"].includes(mode) || !backupDirectory)
      fail("Usage : operations.mjs backup|restore|verify chemin-absolu");
    const options = {
      backupDirectory,
      urlFile: process.env.DATABASE_URL_FILE,
      dataDirectory: process.env.DATA_DIRECTORY,
      configFile: process.env.CONFIG_FILE,
    };
    await (mode === "verify"
      ? validateBackup(backupDirectory)
      : mode === "backup"
        ? backup(options)
        : restore(options));
    console.log("Opération vérifiée : " + mode + ".");
  } catch {
    console.error(
      "Opération refusée ou incomplète. Conserver la cible isolée ; consulter la procédure de reprise.",
    );
    process.exitCode = 1;
  }
}
