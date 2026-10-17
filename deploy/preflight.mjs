import { mkdir, readdir, writeFile, readFile, statfs } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { resolve, dirname } from "node:path";
import { safePath } from "./operations.mjs";
try {
  const version = process.versions.node.split(".").map(Number);
  if (version[0] < 22 || (version[0] === 22 && version[1] < 22)) throw Error();
  const root = process.env.INSTALL_DIRECTORY;
  if (
    !root ||
    resolve(root) !== root ||
    /[\s#$'"\\]/.test(root) ||
    root === process.cwd() ||
    root.startsWith(process.cwd() + "/")
  )
    throw Error(
      "Choisir un chemin absolu hors dépôt, sans espaces ni caractères spéciaux.",
    );
  await safePath(dirname(root), { privateMode: false });
  if (process.argv[2] === "init") {
    await safePath(root);
    if ((await readdir(root)).length)
      throw Error("Installation non vide : initialisation refusée.");
    const free = await statfs(root);
    if (free.bavail * free.bsize < 1024 ** 3)
      throw Error("Au moins 1 Gio libre requis pour le préflight.");
    const publicOrigin = process.env.PUBLIC_ORIGIN,
      allowHttpLoopback = process.env.ALLOW_HTTP_LOOPBACK === "true";
    const url = new URL(publicOrigin);
    if (
      url.origin !== publicOrigin ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          allowHttpLoopback &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    )
      throw Error("Origine HTTPS requise.");
    const host = process.env.BIND_ADDRESS ?? "127.0.0.1",
      port = Number(process.env.HTTP_PORT ?? 3000);
    if (
      !["127.0.0.1", "::1"].includes(host) ||
      !Number.isInteger(port) ||
      port < 1024 ||
      port > 65535
    )
      throw Error("Proxy local requis : écoute loopback, port 1024–65535.");
    await new Promise((accept, reject) => {
      const server = createServer();
      server.once("error", () => reject(Error("Port indisponible.")));
      server.listen(port, host, () => server.close(accept));
    });
    for (const directory of [
      "postgres",
      "data",
      "config",
      "secrets",
      "backups",
    ])
      await mkdir(root + "/" + directory, { mode: 0o700 });
    const password = randomBytes(32).toString("hex"),
      adminPassword = randomBytes(32).toString("hex");
    for (const [name, value] of Object.entries({
      "database-password": adminPassword,
      "application-password": password,
      "database-url": `postgresql://memlia:${password}@postgres:5432/memlia`,
      "bootstrap-token": randomBytes(32).toString("hex"),
    }))
      await writeFile(root + "/secrets/" + name, value + "\n", {
        mode: 0o600,
        flag: "wx",
      });
    await writeFile(
      root + "/config/installation.json",
      JSON.stringify({ publicOrigin, allowHttpLoopback }, null, 2) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    await writeFile(
      root + "/compose.env",
      `INSTALL_DIRECTORY=${root}\nMEMLIA_UID=${process.getuid()}\nMEMLIA_GID=${process.getgid()}\nBIND_ADDRESS=${host}\nHTTP_PORT=${port}\nCOMPOSE_PROJECT_NAME=memlia-${randomBytes(6).toString("hex")}\n`,
      { mode: 0o600, flag: "wx" },
    );
    console.log(
      "Installation préparée. Premier mot de passe choisi dans le navigateur ; jeton local dans secrets/bootstrap-token.",
    );
  } else {
    await safePath(root);
    for (const directory of [
      "postgres",
      "data",
      "config",
      "secrets",
      "backups",
    ])
      await safePath(root + "/" + directory);
    for (const file of [
      "compose.env",
      "config/installation.json",
      "secrets/database-password",
      "secrets/application-password",
      "secrets/database-url",
      "secrets/bootstrap-token",
    ])
      await safePath(root + "/" + file, { directory: false });
    JSON.parse(await readFile(root + "/config/installation.json", "utf8"));
    console.log("Chemins et fichiers privés vérifiés.");
  }
} catch (error) {
  console.error(error.message || "Préflight refusé.");
  process.exitCode = 1;
}
