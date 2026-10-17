import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { createApplication } from "../../apps/server/src/app.js";
const webPort = Number(process.env.MEMLIA_TEST_WEB_PORT ?? 4173);
const apiPort = Number(process.env.MEMLIA_TEST_API_PORT ?? 4174);
const directory = await mkdtemp(join(tmpdir(), "memlia-browser-"));
const api = await createApplication({
  dataDirectory: directory,
  publicOrigin: `http://127.0.0.1:${webPort}`,
  allowEmbeddedDatabase: true,
});
await api.listen({ port: apiPort, host: "127.0.0.1" });
const web = await createServer({
  configFile: "apps/web/vite.config.ts",
  server: { port: webPort, proxy: { "/api": `http://127.0.0.1:${apiPort}` } },
});
await web.listen();
console.log(`Installation fictive isolée : http://127.0.0.1:${webPort}`);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await web.close();
  await api.close();
  await rm(directory, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
