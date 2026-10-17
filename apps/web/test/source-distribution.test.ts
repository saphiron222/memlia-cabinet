import { afterEach, expect, test } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { distributeSource } from "../source-distribution.ts";
const fixtures: string[] = [];
afterEach(() =>
  fixtures
    .splice(0)
    .forEach((p) => rmSync(p, { recursive: true, force: true })),
);
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "source-distribution-test-"));
  fixtures.push(root);
  const write = (path: string, content = "fictitious source") => {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), content);
  };
  for (const path of [
    "apps/web/src/index.ts",
    "apps/web/public/asset.txt",
    "apps/web/LICENSE",
    "apps/web/index.html",
    "apps/web/package.json",
    "apps/web/notices.ts",
    "apps/web/source-distribution.ts",
    "apps/web/vite.config.ts",
    "packages/contracts/index.ts",
    "packages/ui/index.ts",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "docs/design-interface-provenance.json",
    "docs/frontend-licensing.md",
    "docs/interface-source-map.md",
    "scripts/verify-ui.mjs",
    "scripts/prepare-propel-source.mjs",
    "docs/propel-source-rebuild.md",
    "apps/server/package.json",
    "node_modules/@makeplane/propel/LICENSE",
  ])
    write(path);
  write(
    "node_modules/@makeplane/propel/dist/component.js.map",
    JSON.stringify({
      sources: ["../src/component.tsx"],
      sourcesContent: ["export const Fictitious = 1;"],
    }),
  );
  const output = resolve(root, "output");
  mkdirSync(output);
  return { root, output, write };
}
test("corresponding source excludes private variants and verifies every archived source hash", () => {
  const { root, output, write } = fixture();
  for (const path of [
    "apps/web/src/.env.production.local",
    "apps/web/public/.env.test",
    "packages/contracts/.env",
    "packages/ui/credentials.json",
    "apps/web/src/private/identity.json",
    "apps/web/src/cookies.json",
    "apps/web/public/test-results/private.png",
  ])
    write(path, "PRIVATE-CANARY");
  distributeSource(root, output);
  const archive = resolve(output, "source.tar.gz");
  const receipt = JSON.parse(
    readFileSync(resolve(output, "source-build.json"), "utf8"),
  );
  expect(receipt.sourceSha256).toBe(
    createHash("sha256").update(readFileSync(archive)).digest("hex"),
  );
  const extracted = resolve(root, "extracted");
  mkdirSync(extracted);
  execFileSync("tar", ["-xzf", archive, "-C", extracted]);
  const source = resolve(extracted, "memlia-frontend-source");
  const manifest = JSON.parse(
    readFileSync(resolve(source, "source-manifest.json"), "utf8"),
  ) as { path: string; sha256: string }[];
  expect(manifest.length).toBe(receipt.files);
  for (const item of manifest) {
    const data = readFileSync(resolve(source, item.path));
    expect(data.toString()).not.toContain("PRIVATE-CANARY");
    expect(createHash("sha256").update(data).digest("hex")).toBe(item.sha256);
  }
  expect(
    readFileSync(
      resolve(
        source,
        "third-party/propel-0.7.3/recovered-source/src/component.tsx",
      ),
      "utf8",
    ),
  ).toBe("export const Fictitious = 1;");
});
test("corresponding source rejects symlinks before reading a file outside its roots", () => {
  const { root, output, write } = fixture();
  write("outside.txt", "PRIVATE-CANARY");
  symlinkSync(
    resolve(root, "outside.txt"),
    resolve(root, "apps/web/src/linked.ts"),
  );
  expect(() => distributeSource(root, output)).toThrow(
    "Lien symbolique interdit",
  );
});
