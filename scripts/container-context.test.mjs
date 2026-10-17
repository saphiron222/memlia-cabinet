import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  requiredFrontendDocs,
  verifyContainerContext,
} from "./verify-container-context.mjs";

test("container context requires every real frontend document and excludes unrelated private docs", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "memlia-context-fixture-"));
  const write = async (path, content) => {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await writeFile(resolve(root, path), content);
  };
  try {
    const required = await requiredFrontendDocs(process.cwd());
    assert.equal(required.length, 4);
    const ignore = (await readFile(".dockerignore", "utf8")).split("\n");
    assert.deepEqual(
      ignore
        .filter((line) => line.startsWith("!docs/") && line !== "!docs/")
        .map((line) => line.slice(1))
        .sort(),
      required,
    );
    assert.ok(ignore.indexOf("docs/**") > ignore.indexOf("!docs/"));
    const copy = (await readFile("Dockerfile", "utf8"))
      .split("\n")
      .find((line) => line.startsWith("COPY docs/"));
    assert.deepEqual(copy.split(/\s+/).slice(1, -1).sort(), required);
    await write(
      "apps/web/notices.ts",
      required.map((file) => JSON.stringify(file)).join("\n"),
    );
    await write("apps/web/source-distribution.ts", "");
    for (const file of required)
      await write(file, "FICTITIOUS PUBLIC DOCUMENT");
    assert.deepEqual(await verifyContainerContext(root), required);
    for (const file of required) {
      await rm(resolve(root, file));
      await assert.rejects(verifyContainerContext(root), /ENOENT/);
      await write(file, "FICTITIOUS PUBLIC DOCUMENT");
    }
    for (const path of [
      "docs/ordinary-unneeded.md",
      "docs/private/context-sentinel.md",
      "docs/evidence/context-sentinel.json",
      "docs/.env.local",
    ]) {
      await write(path, "FICTITIOUS PRIVATE CANARY");
      await assert.rejects(verifyContainerContext(root), /privé|non requis/);
      await rm(resolve(root, path));
      const parent = dirname(resolve(root, path));
      if (parent !== resolve(root, "docs"))
        await rm(parent, { recursive: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
