import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import {
  readFileSync,
  readdirSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
const root = resolve(import.meta.dirname, ".."),
  output = resolve(root, "apps/server/dist/licenses");
mkdirSync(output, { recursive: true });
const seen = new Set(),
  notices = [];
function visit(directory) {
  const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  const key = pkg.name + "@" + pkg.version;
  if (seen.has(key)) return;
  seen.add(key);
  if (!pkg.name.startsWith("@memlia/")) {
    let files = readdirSync(directory).filter((name) =>
      /^(licen[sc]e|notice|copyright)(\.|$)/i.test(name),
    );
    if (pkg.name === "pdfjs-dist")
      for (const subdir of ["cmaps", "standard_fonts", "wasm"]) {
        files.push(
          ...readdirSync(join(directory, subdir))
            .filter((name) => /^(LICENSE|NOTICE)/.test(name))
            .map((name) => subdir + "/" + name),
        );
      }
    if (!files.length && ["pg-types@2.2.0", "pgpass@1.0.5"].includes(key))
      files = ["README.md"];
    if (!files.length && key === "abstract-logging@2.0.1") {
      const file = "abstract-logging-2.0.1-MIT.txt";
      copyFileSync(
        resolve(root, "apps/server/licenses", file),
        join(output, file),
      );
      notices.push({
        name: pkg.name,
        version: pkg.version,
        license: pkg.license,
        files: [file],
        source: "https://jsumners.mit-license.org/license.txt",
      });
    } else if (!files.length && key === "saxes@6.0.0") {
      const directorySource = resolve(root, "apps/server/licenses");
      const file = "saxes-6.0.0-LICENSE",
        provenanceFile = "saxes-6.0.0-provenance.json";
      const provenance = JSON.parse(
        readFileSync(join(directorySource, provenanceFile), "utf8"),
      );
      const hash = (path) =>
        createHash("sha256").update(readFileSync(path)).digest("hex");
      const locked = JSON.parse(
        readFileSync(join(root, "package-lock.json"), "utf8"),
      ).packages["node_modules/saxes"];
      if (
        hash(join(directory, "package.json")) !== provenance.metadataSha256 ||
        hash(join(directorySource, file)) !== provenance.licenseSha256 ||
        locked.integrity !== provenance.integrity
      )
        throw Error("Notice amont à requalifier : " + key);
      for (const name of [file, provenanceFile])
        copyFileSync(join(directorySource, name), join(output, name));
      notices.push({
        name: pkg.name,
        version: pkg.version,
        license: pkg.license,
        files: [file, provenanceFile],
        source: provenance.source,
      });
    } else if (!files.length && key === "worker-f@0.1.20") {
      const source = resolve(root, "apps/server/licenses/worker-f-0.1.20");
      const provenance = JSON.parse(
        readFileSync(join(source, "provenance.json"), "utf8"),
      );
      const hash = (path) =>
        createHash("sha256").update(readFileSync(path)).digest("hex");
      const locked = JSON.parse(
        readFileSync(join(root, "package-lock.json"), "utf8"),
      ).packages["node_modules/worker-f"];
      if (
        provenance.name !== pkg.name ||
        provenance.version !== pkg.version ||
        locked.integrity !== provenance.integrity ||
        locked.resolved !== provenance.tarball ||
        hash(join(directory, "package.json")) !== provenance.metadataSha256 ||
        hash(join(directory, provenance.embeddedSource)) !==
          provenance.embeddedSourceSha256
      )
        throw Error("Exception de notice périmée : " + key);
      const copied = [];
      for (const [file, expected] of Object.entries(provenance.files)) {
        if (hash(join(source, file)) !== expected)
          throw Error("Notice locale altérée : " + file);
        const target = key + "-" + file;
        copyFileSync(join(source, file), join(output, target));
        copied.push(target);
      }
      copyFileSync(
        join(source, "provenance.json"),
        join(output, key + "-provenance.json"),
      );
      copied.push(key + "-provenance.json");
      notices.push({
        name: pkg.name,
        version: pkg.version,
        license: pkg.license,
        files: copied,
        source: provenance.source,
        qualification: provenance.qualification,
      });
    } else if (!files.length && pkg.name.startsWith("@napi-rs/canvas-")) {
      const file = key.replaceAll("/", "-") + "-LICENSE";
      copyFileSync(
        resolve(root, "node_modules/@napi-rs/canvas/LICENSE"),
        join(output, file),
      );
      notices.push({
        name: pkg.name,
        version: pkg.version,
        license: pkg.license,
        files: [file],
        source: "@napi-rs/canvas/LICENSE (same upstream package)",
      });
    } else if (!files.length) throw Error("Notice absente : " + key);
    const copied = files.map((name) => {
      const target = key.replaceAll("/", "-") + "-" + name.replaceAll("/", "-");
      copyFileSync(join(directory, name), join(output, target));
      return target;
    });
    if (files.length)
      notices.push({
        name: pkg.name,
        version: pkg.version,
        license: pkg.license,
        files: copied,
      });
  }
  const require = createRequire(join(directory, "package.json"));
  for (const name of new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ])) {
    let target;
    try {
      target = dirname(require.resolve(name + "/package.json"));
    } catch {
      try {
        target = dirname(require.resolve(name));
        while (
          !existsSync(join(target, "package.json")) ||
          JSON.parse(readFileSync(join(target, "package.json"), "utf8"))
            .name !== name
        ) {
          const parent = dirname(target);
          if (parent === target) throw Error("Paquet introuvable : " + name);
          target = parent;
        }
      } catch (error) {
        if (pkg.optionalDependencies?.[name]) continue;
        throw error;
      }
    }
    visit(target);
  }
}
visit(resolve(root, "apps/server"));
writeFileSync(
  join(output, "index.json"),
  JSON.stringify(notices, null, 2) + "\n",
);
console.log(
  notices.length + " notices serveur distribuées depuis les paquets installés.",
);
