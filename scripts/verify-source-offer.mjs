import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { requiredFrontendDocs } from "./verify-container-context.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** Exercise the actual anonymous HTTP offer of the built package, not a local file-only assertion. */
export async function verifySourceOffer(origin, root = process.cwd()) {
  const get = async (path) => {
    const response = await fetch(origin + "/licenses/" + path);
    if (!response.ok) throw Error("Source/notice HTTP absent : " + path);
    return Buffer.from(await response.arrayBuffer());
  };
  const expected = {
    "plane.txt": "apps/web/src/upstream/plane/LICENSE",
    "cal.txt": "apps/web/src/upstream/cal/LICENSE",
    "twenty.txt": "apps/web/src/upstream/twenty/LICENSE",
    "twenty-ui.txt": "packages/ui/LICENSE.twenty-ui",
    "twenty-provenance.json": "packages/ui/PROVENANCE.json",
    "frontend-licensing.md": "docs/frontend-licensing.md",
    "interface-provenance.json": "docs/design-interface-provenance.json",
    "fonts-inter-OFL.txt": "apps/web/public/fonts/inter-OFL.txt",
    "fonts-ibm-plex-mono-OFL.txt":
      "apps/web/public/fonts/ibm-plex-mono-OFL.txt",
  };
  for (const [name, path] of Object.entries(expected)) {
    if (sha256(await get(name)) !== sha256(await readFile(resolve(root, path))))
      throw Error("Notice HTTP différente du source construit : " + name);
  }
  for (const name of ["index.json", "server/index.json"]) {
    if (!Array.isArray(JSON.parse(await get(name))))
      throw Error("Index de notices invalide : " + name);
  }
  const receipt = JSON.parse(await get("source-build.json"));
  const archive = await get("source.tar.gz");
  if (sha256(archive) !== receipt.sourceSha256)
    throw Error("Identité de l’archive HTTP différente du reçu.");
  const temporary = await mkdtemp(resolve(tmpdir(), "memlia-http-source-"));
  try {
    const path = resolve(temporary, "source.tar.gz");
    await writeFile(path, archive);
    // Read only exact named members to stdout; no archive-controlled filesystem extraction.
    const member = (name) =>
      execFileSync("tar", ["-xOzf", path, "memlia-frontend-source/" + name], {
        maxBuffer: 8 * 1024 * 1024,
      });
    const manifest = JSON.parse(member("source-manifest.json"));
    if (manifest.length !== receipt.files)
      throw Error("Nombre de sources différent du reçu.");
    const docs = await requiredFrontendDocs(root);
    for (const name of docs) {
      const entry = manifest.find((item) => item.path === name);
      const hash = sha256(member(name));
      if (
        !entry ||
        entry.sha256 !== hash ||
        hash !== sha256(await readFile(resolve(root, name)))
      )
        throw Error(
          "Document normatif absent ou différent dans l’archive HTTP : " + name,
        );
    }
    return {
      sourceSha256: receipt.sourceSha256,
      files: receipt.files,
      normativeDocsVerified: docs.length,
      anonymousResources: Object.keys(expected).length + 4,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
