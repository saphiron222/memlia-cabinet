import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createApplication } from "./app.js";
async function start() {
  const configuration = process.env.CONFIG_FILE
    ? (JSON.parse(await readFile(process.env.CONFIG_FILE, "utf8")) as {
        publicOrigin: string;
        allowHttpLoopback: boolean;
      })
    : undefined;
  const origin =
    configuration?.publicOrigin ??
    process.env.PUBLIC_ORIGIN ??
    "http://localhost:3000";
  if (process.env.NODE_ENV === "production") {
    const url = new URL(origin);
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        (configuration?.allowHttpLoopback ??
          process.env.ALLOW_HTTP_LOOPBACK === "true") &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
    )
      throw new Error(
        "HTTPS requis ; HTTP loopback exige une autorisation explicite de test.",
      );
  }
  const app = await createApplication({
    dataDirectory: resolve(process.env.DATA_DIRECTORY ?? "var"),
    publicOrigin: origin,
    databaseUrl: process.env.DATABASE_URL_FILE
      ? (await readFile(process.env.DATABASE_URL_FILE, "utf8")).trim()
      : process.env.DATABASE_URL,
    webDirectory: process.env.WEB_DIRECTORY
      ? resolve(process.env.WEB_DIRECTORY)
      : undefined,
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
}
try {
  await start();
} catch {
  console.error(
    "Démarrage refusé : vérifier la configuration locale et les dépendances.",
  );
  process.exitCode = 1;
}
