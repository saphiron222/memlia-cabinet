import { readFile, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";

// Derive the required documents from the real consumers, so new inputs fail
// the context receipt until explicitly added to Dockerfile/.dockerignore.
export async function requiredFrontendDocs(root) {
  const consumers = await Promise.all([
    readFile(resolve(root, "apps/web/notices.ts"), "utf8"),
    readFile(resolve(root, "apps/web/source-distribution.ts"), "utf8"),
  ]);
  return [
    ...new Set(
      consumers.flatMap((source) =>
        [...source.matchAll(/"(docs\/[^"]+)"/g)].map((match) => match[1]),
      ),
    ),
  ].sort();
}
export async function verifyContainerContext(root) {
  const required = await requiredFrontendDocs(root);
  if (!required.length) throw Error("Aucun document de build détecté.");
  for (const file of required) {
    if (!(await readFile(resolve(root, file))).length)
      throw Error("Document de build vide : " + file);
  }
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name),
        path = relative(root, file);
      if (
        [
          "evidence",
          "var",
          ".git",
          ".superpowers",
          "node_modules",
          "private",
          "secrets",
        ].includes(entry.name) ||
        entry.name.startsWith(".env") ||
        entry.name.includes("context-sentinel")
      )
        throw Error("Fichier privé dans le contexte : " + path);
      if (entry.isSymbolicLink())
        throw Error("Lien dans le contexte de recette : " + path);
      if (entry.isDirectory()) await walk(file);
      else if (path.startsWith("docs/") && !required.includes(path))
        throw Error("Document non requis dans le contexte : " + path);
    }
  }
  await walk(root);
  return required;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const docs = await verifyContainerContext(resolve(process.argv[2] ?? "."));
  console.log(
    `Contexte vérifié : ${docs.length} documents frontend requis, aucun document supplémentaire ou canari privé.`,
  );
}
