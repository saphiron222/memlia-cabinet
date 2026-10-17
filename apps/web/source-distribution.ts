import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";

/** Public, build-local corresponding source. No git archive or private workspace data. */
export function distributeSource(root: string, output: string) {
  const temporary = mkdtempSync(resolve(tmpdir(), "memlia-frontend-source-"));
  const destination = resolve(temporary, "memlia-frontend-source");
  mkdirSync(destination);
  const inputRoots = [
    "apps/web/src",
    "apps/web/public",
    "apps/web/LICENSE",
    "apps/web/index.html",
    "apps/web/package.json",
    "apps/web/notices.ts",
    "apps/web/source-distribution.ts",
    "apps/web/vite.config.ts",
    "packages/contracts",
    "packages/ui",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "docs/design-interface-provenance.json",
    "docs/frontend-licensing.md",
    "docs/interface-source-map.md",
    "scripts/verify-ui.mjs",
    "scripts/prepare-propel-source.mjs",
    "docs/propel-source-rebuild.md",
  ];
  try {
    for (const path of inputRoots) {
      const target = resolve(destination, path);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(resolve(root, path), target, {
        recursive: true,
        filter: (source) => {
          if (lstatSync(source).isSymbolicLink())
            throw new Error(
              "Lien symbolique interdit dans le source distribué : " +
                relative(root, source),
            );
          return !relative(root, source)
            .split("/")
            .some(
              (part) =>
                part.startsWith(".env") ||
                /^(credentials|cookies|storageState|database-url|bootstrap-token)(\.|$)/i.test(
                  part,
                ) ||
                /\.(pem|key|p12|pfx|log)$/i.test(part) ||
                [
                  "private",
                  "secrets",
                  "test-results",
                  "playwright-report",
                  "node_modules",
                  "dist",
                  ".data",
                  "var",
                  "evidence",
                  ".git",
                ].includes(part),
            );
        },
      });
    }
    // Keep the original workspace lock resolution, without distributing an unrelated backend.
    mkdirSync(resolve(destination, "apps/server"), { recursive: true });
    cpSync(
      resolve(root, "apps/server/package.json"),
      resolve(destination, "apps/server/package.json"),
    );
    const propel = resolve(root, "node_modules/@makeplane/propel");
    const bundled = resolve(destination, "third-party/propel-0.7.3");
    cpSync(propel, bundled, { recursive: true });
    // An editable-source build must distribute those exact edited sources as well.
    const editable = resolve(root, "third-party/propel-0.7.3/editable-source");
    if (existsSync(editable)) {
      cpSync(editable, resolve(bundled, "editable-source"), {
        recursive: true,
        filter: (path) => {
          if (lstatSync(path).isSymbolicLink())
            throw new Error(
              "Lien symbolique interdit dans le source Propel édité",
            );
          return !relative(editable, path)
            .split("/")
            .some(
              (part) =>
                part.startsWith(".env") ||
                /^(private|secrets|credentials|cookies|storageState)(\.|$)/i.test(
                  part,
                ),
            );
        },
      });
      cpSync(
        resolve(root, "apps/web/vite.propel-source.config.ts"),
        resolve(destination, "apps/web/vite.propel-source.config.ts"),
      );
    }
    let recovered = 0;
    function recoverMaps(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) recoverMaps(path);
        else if (entry.name.endsWith(".map")) {
          const map = JSON.parse(readFileSync(path, "utf8"));
          for (const [index, name] of (map.sources ?? []).entries()) {
            const content = map.sourcesContent?.[index];
            const nameParts = String(name)
              .split("/")
              .filter((part) => part !== ".." && part !== ".");
            if (typeof content !== "string" || !nameParts.length) continue;
            const target = resolve(bundled, "recovered-source", ...nameParts);
            if (!target.startsWith(resolve(bundled, "recovered-source") + "/"))
              throw new Error("Chemin source tiers invalide");
            mkdirSync(dirname(target), { recursive: true });
            if (existsSync(target) && readFileSync(target, "utf8") !== content)
              throw new Error("Sources tiers contradictoires : " + name);
            writeFileSync(target, content);
            recovered++;
          }
        }
      }
    }
    recoverMaps(resolve(propel, "dist"));
    const manifest: { path: string; sha256: string }[] = [];
    function inventory(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
        (a, b) => a.name.localeCompare(b.name),
      )) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) inventory(path);
        else
          manifest.push({
            path: relative(destination, path),
            sha256: createHash("sha256")
              .update(readFileSync(path))
              .digest("hex"),
          });
      }
    }
    writeFileSync(
      resolve(destination, "README.md"),
      `# Memlia — source correspondant du frontend\n\nCe paquet contient les sources exactes du frontend fourni avec cette archive, les composants modifiés Plane, cal.diy et Twenty, leurs licences, les polices locales et le verrou des dépendances. Lire docs/frontend-licensing.md. Le backend n'est pas inclus : seul son manifeste conserve la résolution originale du workspace.\n\nConstruction : Node >=22.22 ; npm ci --ignore-scripts puis npm run build --workspace @memlia/web. Le résultat est apps/web/dist. L'application consomme le contrat HTTP /api/v1 ; le serveur métier est un processus séparé. Aucun compte Plane/cal/Twenty requis.\n\nLe paquet Propel0.7.3 exact, ses CSS, cartes de sources et ${recovered} entrées de sources originales récupérées sont fournis sous third-party/propel-0.7.3. Les archives originales du registre restent identifiées par leurs intégrités dans package-lock.json. Les scripts de construction nécessaires du frontend sont inclus. Pour modifier puis compiler les modules Propel récupérés, voir docs/propel-source-rebuild.md et scripts/prepare-propel-source.mjs : adaptateur Vite fourni, distinct de la construction tsdown amont absente du tarball.\n`,
    );
    inventory(destination);
    writeFileSync(
      resolve(destination, "source-manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    execFileSync(
      "tar",
      [
        "-czf",
        resolve(output, "source.tar.gz"),
        "-C",
        temporary,
        "memlia-frontend-source",
      ],
      { env: { ...process.env, COPYFILE_DISABLE: "1" } },
    );
    writeFileSync(
      resolve(output, "source-build.json"),
      JSON.stringify(
        {
          sourceSha256: createHash("sha256")
            .update(readFileSync(resolve(output, "source.tar.gz")))
            .digest("hex"),
          files: manifest.length,
          recoveredPropelSources: recovered,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
