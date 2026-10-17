import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const marker = "FICTITIOUS-STARTUP-SECRET-DO-NOT-LOG";
const invalid = spawnSync(process.execPath, ["apps/server/dist/index.js"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    PUBLIC_ORIGIN: "https://cabinet.example.test",
    DATABASE_URL_FILE: "",
    CONFIG_FILE: "",
    DATABASE_URL: "postgresql://user:" + marker + "@%%invalid",
  },
  encoding: "utf8",
});
if (invalid.status !== 1 || (invalid.stdout + invalid.stderr).includes(marker))
  throw Error("Diagnostic de démarrage non protégé.");
const directory = await mkdtemp(join(tmpdir(), "memlia-compiled-"));
const origin = "http://127.0.0.1:4327";
const child = spawn(process.execPath, ["apps/server/dist/index.js"], {
  env: {
    ...process.env,
    DATABASE_URL: "",
    DATABASE_URL_FILE: "",
    BOOTSTRAP_TOKEN_FILE: "",
    BOOTSTRAP_TOKEN: "",
    CONFIG_FILE: "",
    DATA_DIRECTORY: directory,
    WEB_DIRECTORY: resolve("apps/web/dist"),
    PUBLIC_ORIGIN: origin,
    ALLOW_HTTP_LOOPBACK: "true",
    ALLOW_EMBEDDED_DATABASE: "true",
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "4327",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.resume();
child.stderr.resume();
const exit = new Promise((accept) =>
  child.once("exit", (code) => accept(code)),
);
try {
  let ready = false;
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(origin + "/api/v1/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw Error("Serveur compilé indisponible.");
  const html = await (await fetch(origin)).text(),
    asset = html.match(/src="([^"]+\.js)"/)?.[1];
  if (
    !asset ||
    !(await fetch(origin + asset)).headers
      .get("content-type")
      ?.includes("javascript")
  )
    throw Error("Interface compilée absente.");
  for (const name of ["twenty-ui.txt", "twenty-provenance.json", "index.json"])
    if (!(await fetch(origin + "/licenses/" + name)).ok)
      throw Error("Notice absente.");
  const response = await fetch(origin + "/api/v1/setup", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({
      email: "compiled@example.test",
      name: "Compilation fictive",
      password: "Mot-de-passe-compile-2026!",
    }),
  });
  if (response.status !== 201) throw Error("Setup compilé refusé.");
  console.log(
    "Serveur compilé : UI, JavaScript, notices, santé et setup HTTP loopback vérifiés.",
  );
} finally {
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 30000);
  const code = await exit;
  clearTimeout(timeout);
  await rm(directory, { recursive: true, force: true });
  if (code !== 0) throw Error("Arrêt du serveur compilé non confirmé.");
}
