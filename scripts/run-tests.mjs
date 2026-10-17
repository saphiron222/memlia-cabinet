import { spawn } from "node:child_process";
// Playwright injects FORCE_COLOR into workers. Translate NO_COLOR once into
// FORCE_COLOR=0 so parent and children agree without conflicting variables.
if ("NO_COLOR" in process.env) {
  delete process.env.NO_COLOR;
  process.env.FORCE_COLOR = "0";
}
const [tool, ...args] = process.argv.slice(2);
const entry =
  tool === "playwright"
    ? "../node_modules/@playwright/test/cli.js"
    : "../node_modules/vitest/vitest.mjs";
const child = spawn(
  process.execPath,
  [new URL(entry, import.meta.url).pathname, ...args],
  { stdio: "inherit", env: process.env },
);
child.on("exit", (code) => (process.exitCode = code ?? 1));
