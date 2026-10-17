import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
it("public scope guard rejects private evidence, volumes, secrets and coordination journals in an isolated Git index", async () => {
  const directory = await mkdtemp(join(tmpdir(), "memlia-index-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(directory, "index") };
  try {
    const object = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      input: "fictitious scope guard fixture",
      encoding: "utf8",
    }).trim();
    for (const path of [
      "evidence/private/probe.txt",
      "var/probe.txt",
      ".env",
      ".superpowers/probe.md",
    ]) {
      execFileSync("git", ["read-tree", "HEAD"], { env });
      execFileSync(
        "git",
        ["update-index", "--add", "--cacheinfo", `100644,${object},${path}`],
        { env },
      );
      const result = spawnSync(process.execPath, ["scripts/verify-scope.mjs"], {
        env,
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Chemin privé suivi : " + path);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
