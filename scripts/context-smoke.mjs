import { writeFile, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const locations = [
  "evidence/context-sentinel",
  "var/context-sentinel",
  ".superpowers/context-sentinel",
  "apps/web/node_modules/context-sentinel",
  "packages/ui/evidence/context-sentinel",
  "apps/server/var/context-sentinel",
  ".env.context-sentinel",
  "docs/context-sentinel.md",
  "docs/private/context-sentinel.md",
  "docs/evidence/context-sentinel.json",
];
const dockerfile = "Dockerfile.context-test";
const created = [];
try {
  const coverage = spawnSync(
    process.execPath,
    ["--test", "scripts/container-context.test.mjs"],
    { stdio: "inherit" },
  );
  if (coverage.status !== 0)
    throw Error("Contrat des entrées Docker incorrect.");
  for (const file of locations) {
    const parent = file.slice(0, file.lastIndexOf("/"));
    if (parent) await mkdir(parent, { recursive: true });
    await writeFile(file, "PRIVATE-CONTEXT-SENTINEL", { flag: "wx" });
    created.push(file);
  }
  await writeFile(
    dockerfile,
    `FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752\nCOPY . /context\nRUN node /context/scripts/verify-container-context.mjs /context\n`,
    { flag: "wx" },
  );
  created.push(dockerfile);
  const result = spawnSync(
    "docker",
    ["build", "--file", dockerfile, "--tag", "memlia-context-check", "."],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw Error("Contexte Docker incorrect.");
  console.log(
    "Contexte Docker réellement construit : sentinelles privées exclues.",
  );
} finally {
  for (const file of created) await rm(file, { force: true });
}
