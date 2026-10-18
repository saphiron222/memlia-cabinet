import { verifySourceOffer } from "./verify-source-offer.mjs";
import { fictitiousPdf } from "../apps/server/fixtures/collections.ts";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  cp,
  rm,
  realpath,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
const root = await realpath(
  await mkdtemp(join(homedir(), ".memlia-container-")),
);
const source = join(root, "source"),
  target = join(root, "target");
for (const path of [source, target]) await mkdir(path, { mode: 0o700 });
const origin = "https://cabinet.example.test";
const envFor = (directory, port) => ({
  ...process.env,
  INSTALL_DIRECTORY: directory,
  PUBLIC_ORIGIN: origin,
  HTTP_PORT: String(port),
  BIND_ADDRESS: "127.0.0.1",
});
async function run(command, args, env = process.env) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (b) => (output += b));
    let diagnostic = "";
    child.stderr.on("data", (bytes) => {
      diagnostic = (diagnostic + bytes).slice(-32768);
    });
    child.on("error", () => reject(Error("Commande indisponible.")));
    child.on("exit", (code) =>
      code === 0
        ? accept(output.trim())
        : reject(
            Error(
              "Commande de recette en échec : " +
                command +
                " " +
                args.slice(0, 2).join(" ") +
                "\n" +
                (output.slice(-32768) + "\n" + diagnostic)
                  .split("\n")
                  .filter(
                    (line) =>
                      !/postgres(?:ql)?:|password|token|secret|cookie|authorization/i.test(
                        line,
                      ),
                  )
                  .filter(
                    (line, index, lines) =>
                      /error|failed|cannot|not found|non-zero/i.test(line) ||
                      index >= lines.length - 15,
                  )
                  .join("\n"),
            ),
          ),
    );
  });
}
const compose = (directory, args) =>
  run("docker", [
    "compose",
    "--env-file",
    join(directory, "compose.env"),
    "-f",
    "deploy/compose.yaml",
    ...args,
  ]);
const credentials = {
  email: "installation@example.test",
  name: "Installation fictive",
  password: "Mot-de-passe-fictif-2026!",
};
const check = (condition, message) => {
  if (!condition) throw Error(message);
};
async function request(port, path, body, cookie, token) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: origin,
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(token ? { "x-bootstrap-token": token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function hostReady(port) {
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok && (await response.json()).ready === true) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw Error("Application inaccessible depuis l’hôte après attente bornée.");
}
try {
  await run("bash", ["deploy/install.sh", "init"], envFor(source, 4311));
  await compose(source, ["config", "--quiet"]);
  await run("bash", ["deploy/install.sh", "start"], envFor(source, 4311));
  await hostReady(4311);
  check(
    (await fetch("http://127.0.0.1:4311/")).headers
      .get("content-type")
      ?.includes("text/html"),
    "Interface compilée absente.",
  );
  const sourceOffer = await verifySourceOffer("http://127.0.0.1:4311");
  console.log(
    "Offre source/licences anonyme du conteneur : " +
      JSON.stringify(sourceOffer),
  );
  check(
    (await request(4311, "/api/v1/setup", credentials)).status === 403,
    "Setup réseau sans jeton accepté.",
  );
  const bootstrap = (
    await readFile(join(source, "secrets/bootstrap-token"), "utf8")
  ).trim();
  const setup = await request(
    4311,
    "/api/v1/setup",
    credentials,
    undefined,
    bootstrap,
  );
  check(setup.status === 201, "Setup refusé.");
  let cookie = setup.headers.get("set-cookie").split(";")[0];
  const record = await request(
    4311,
    "/api/v1/records",
    {
      operationId: randomUUID(),
      record: {
        kind: "dossier",
        title: "Persistance conteneur",
        data: { siren: "001234567" },
      },
    },
    cookie,
  );
  check(record.status === 201, "Dossier absent.");
  const id = (await record.json()).id;
  const original = fictitiousPdf("preuve.pdf", {
    reference: "PDF-FICTIF-RESTORATION",
    data: { kind: "tax-notice", amountCents: 125000, dueDate: "2026-10-31" },
  });
  const metadata = {
    operationId: randomUUID(),
    dossierId: id,
    filename: "preuve.pdf",
    mediaType: "application/pdf",
    source: { kind: "manual", reference: "container-smoke", version: "1" },
  };
  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata));
  form.append(
    "file",
    new Blob([original], {
      type: "application/pdf",
    }),
    "preuve.pdf",
  );
  const uploaded = await fetch("http://127.0.0.1:4311/api/v1/documents", {
    method: "POST",
    headers: { Origin: origin, cookie },
    body: form,
  });
  check(uploaded.status === 201, "Pièce refusée.");
  const stored = await uploaded.json();
  check(
    stored.extraction.status === "complete",
    "Extraction PDF indisponible dans le paquet.",
  );
  const document = stored.id;
  const role = await compose(source, [
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "memlia",
    "-d",
    "memlia",
    "-Atc",
    "SELECT rolsuper::text || ',' || rolcreaterole::text || ',' || rolcreatedb::text FROM pg_roles WHERE rolname=current_user",
  ]);
  check(role === "false,false,false", "Rôle applicatif privilégié.");
  const db = await compose(source, ["ps", "-q", "postgres"]);
  const ports = JSON.parse(
    await run("docker", [
      "inspect",
      "--format",
      "{{json .HostConfig.PortBindings}}",
      db,
    ]),
  );
  check(!ports || Object.keys(ports).length === 0, "PostgreSQL publié.");
  await compose(source, ["up", "-d", "--force-recreate", "--wait", "app"]);
  const assertData = async (port) => {
    await hostReady(port);
    const login = await request(port, "/api/v1/login", {
      email: credentials.email,
      password: credentials.password,
    });
    check(login.status === 200, "Connexion après recréation refusée.");
    cookie = login.headers.get("set-cookie").split(";")[0];
    check(
      (
        await (
          await request(port, "/api/v1/records/" + id, undefined, cookie)
        ).json()
      ).title === "Persistance conteneur",
      "Dossier perdu.",
    );
    const downloaded = await request(
      port,
      "/api/v1/documents/" + document + "/download",
      undefined,
      cookie,
    );
    check(
      downloaded.status === 200 &&
        Buffer.from(await downloaded.arrayBuffer()).equals(original),
      "Original PDF perdu.",
    );
    check(
      (await (await request(port, "/api/v1/setup")).json()).requiresToken ===
        false,
      "Bootstrap demandé après rechargement.",
    );
  };
  await assertData(4311);
  const app = await compose(source, ["ps", "-q", "app"]);
  await run("docker", ["kill", app]);
  await compose(source, ["up", "-d", "--wait", "app"]);
  await assertData(4311);
  await run("bash", ["deploy/backup.sh", "reception"], envFor(source, 4311));
  await run("bash", ["deploy/install.sh", "init"], envFor(target, 4312));
  await cp(
    join(source, "backups/reception"),
    join(target, "backups/reception"),
    { recursive: true },
  );
  await run("bash", ["deploy/restore.sh", "reception"], envFor(target, 4312));
  await run("bash", ["deploy/install.sh", "start"], envFor(target, 4312));
  await assertData(4312);
  // A second restore must refuse without modifying either installation.
  let refused = false;
  try {
    await run("bash", ["deploy/restore.sh", "reception"], envFor(target, 4312));
  } catch {
    refused = true;
  }
  check(refused, "Restauration destructive acceptée.");
  await assertData(4311);
  await assertData(4312);
  console.log(
    "Conteneur Linux : interface/notices/PDF, setup réseau, persistance recréation/crash, sauvegarde/restauration et refus non destructif vérifiés.",
  );
} finally {
  for (const directory of [source, target]) {
    try {
      await compose(directory, ["down", "--remove-orphans"]);
    } catch {}
  }
  // Keep fixture directories private for local diagnosis; CI runner is ephemeral. Never upload them.
}
