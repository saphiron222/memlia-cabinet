import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createApplication } from "./app.js";
const app = await createApplication({
  dataDirectory: resolve(process.env.DATA_DIRECTORY ?? "var"),
  publicOrigin: process.env.PUBLIC_ORIGIN ?? "http://localhost:3000",
  databaseUrl: process.env.DATABASE_URL,
  bootstrapToken: process.env.BOOTSTRAP_TOKEN_FILE
    ? (await readFile(process.env.BOOTSTRAP_TOKEN_FILE, "utf8")).trim()
    : process.env.BOOTSTRAP_TOKEN,
  allowEmbeddedDatabase: process.env.ALLOW_EMBEDDED_DATABASE === "true",
});
const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
try {
  await app.listen({
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? "127.0.0.1",
  });
  console.log("Memlia Cabinet prêt.");
} catch (error) {
  await app.close();
  throw error;
}
