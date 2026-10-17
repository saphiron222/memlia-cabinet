import {
  mkdirSync,
  copyFileSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { distributeSource } from "./source-distribution.ts";
const root = resolve(import.meta.dirname, "../..");
export function distributeNotices() {
  const output = resolve(import.meta.dirname, "dist/licenses");
  mkdirSync(output, { recursive: true });
  for (const source of ["plane", "cal", "twenty"])
    copyFileSync(
      resolve(root, "apps/web/src/upstream", source, "LICENSE"),
      resolve(output, source + ".txt"),
    );
  copyFileSync(
    resolve(root, "docs/frontend-licensing.md"),
    resolve(output, "frontend-licensing.md"),
  );
  copyFileSync(
    resolve(root, "packages/ui/LICENSE.twenty-ui"),
    resolve(output, "twenty-ui.txt"),
  );
  copyFileSync(
    resolve(root, "packages/ui/PROVENANCE.json"),
    resolve(output, "twenty-provenance.json"),
  );
  copyFileSync(
    resolve(root, "docs/design-interface-provenance.json"),
    resolve(output, "interface-provenance.json"),
  );
  for (const file of [
    "inter-OFL.txt",
    "ibm-plex-mono-OFL.txt",
    "provenance.json",
  ])
    copyFileSync(
      resolve(root, "apps/web/public/fonts", file),
      resolve(output, "fonts-" + file),
    );
  const seen = new Set<string>();
  const notices: {
    name: string;
    version: string;
    license: string;
    file: string;
  }[] = [];
  function visit(name: string) {
    if (seen.has(name) || name.startsWith("@memlia/")) return;
    seen.add(name);
    const directory = resolve(root, "node_modules", name);
    const pkg = JSON.parse(
      readFileSync(resolve(directory, "package.json"), "utf8"),
    );
    const license = readdirSync(directory).find((file) =>
      /^licen[sc]e(\.|$)/i.test(file),
    );
    if (!license) throw new Error("Notice absente : " + name);
    const file = name.replaceAll("/", "-") + ".txt";
    copyFileSync(resolve(directory, license), resolve(output, file));
    notices.push({ name, version: pkg.version, license: pkg.license, file });
    for (const dependency of Object.keys(pkg.dependencies ?? {}))
      visit(dependency);
  }
  for (const workspace of ["packages/ui", "packages/contracts", "apps/web"]) {
    const pkg = JSON.parse(
      readFileSync(resolve(root, workspace, "package.json"), "utf8"),
    );
    for (const name of Object.keys(pkg.dependencies ?? {})) visit(name);
  }
  writeFileSync(
    resolve(output, "index.json"),
    JSON.stringify(notices, null, 2) + "\n",
  );
  distributeSource(root, output);
}
