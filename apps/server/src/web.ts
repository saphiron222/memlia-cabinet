import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import type { FastifyInstance } from "fastify";
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
};
export async function registerWeb(app: FastifyInstance, directory: string) {
  const root = await realpath(directory);
  await stat(resolve(root, "index.html"));
  app.get("/*", async (request, reply) => {
    let path: string;
    try {
      path = decodeURIComponent(request.url.split("?")[0]!);
    } catch {
      return reply.code(400).send();
    }
    if (
      path.startsWith("/api/") ||
      path.includes("\\") ||
      path.split("/").some((part) => part === ".." || part.startsWith("."))
    )
      return reply.code(404).send();
    const candidate = resolve(
      root,
      "." + (path === "/" ? "/index.html" : path),
    );
    try {
      const actual = await realpath(candidate);
      if (!actual.startsWith(root + sep) || !(await stat(actual)).isFile())
        return reply.code(404).send();
      return reply
        .type(types[extname(actual)] ?? "application/octet-stream")
        .header("x-content-type-options", "nosniff")
        .send(await readFile(actual));
    } catch {
      return reply.code(404).send();
    }
  });
}
