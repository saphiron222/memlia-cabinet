import { it, expect } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "../src/app.js";
it("serves compiled UI and notices from one origin without exposing files or API fallbacks", async () => {
  const root = await mkdtemp(join(tmpdir(), "memlia-web-"));
  const web = join(root, "web");
  await mkdir(join(web, "licenses"), { recursive: true });
  await writeFile(
    join(web, "index.html"),
    '<html><script src="/app.js"></script></html>',
  );
  await writeFile(join(web, "app.js"), 'console.log("fixture")');
  await writeFile(join(web, "licenses", "twenty.txt"), "MIT fixture");
  await writeFile(join(root, "private.txt"), "private fixture");
  const app = await createApplication({
    dataDirectory: join(root, "data"),
    publicOrigin: "http://localhost:3000",
    allowEmbeddedDatabase: true,
    webDirectory: web,
  });
  try {
    expect((await app.inject("/")).body).toContain("/app.js");
    expect((await app.inject("/app.js")).headers["content-type"]).toContain(
      "javascript",
    );
    expect((await app.inject("/licenses/twenty.txt")).body).toBe("MIT fixture");
    expect((await app.inject("/api/v1/health")).json()).toEqual({
      ready: true,
    });
    for (const path of [
      "/api/v1/missing",
      "/.env",
      "/%2e%2e/private.txt",
      "/private.txt",
      "/documents",
    ])
      expect((await app.inject(path)).statusCode).toBe(404);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
