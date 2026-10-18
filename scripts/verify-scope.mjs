import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const scope = JSON.parse(await readFile("docs/exigences.json", "utf8"));
const identities = scope.requirements
  .map((r) => [r.id, r.scope])
  .sort((a, b) => a[0].localeCompare(b[0]));
const expected = JSON.parse(await readFile("docs/scope-baseline.json", "utf8"));
if (
  identities.length !== 171 ||
  new Set(identities.map((r) => r[0])).size !== 171 ||
  JSON.stringify(identities) !== JSON.stringify(expected)
)
  throw Error("Périmètre modifié : décision explicite et réception requises.");
for (const [scope, count] of Object.entries({
  required: 160,
  excluded: 10,
  "proposed-extension": 1,
}))
  if (identities.filter((r) => r[1] === scope).length !== count)
    throw Error("Répartition du périmètre altérée.");
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
for (const path of tracked) {
  if (
    /(^|\/)(\.superpowers|var|node_modules|\.data|test-results|playwright-report|secrets)(\/|$)|^evidence\/private\/|(^|\/)\.env($|\.(?!example$))|\.(pem|key|p12|pfx|log)$|(^|\/)(cookies|storageState|credentials|database-url|bootstrap-token)(\.|$)/i.test(
      path,
    )
  )
    throw Error("Chemin privé suivi : " + path);
}
const mapping = JSON.parse(await readFile("docs/http-test-map.json", "utf8"));
const routes = [];
async function visit(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = dir + "/" + e.name;
    if (e.isDirectory()) await visit(path);
    else if (path.endsWith(".ts")) {
      const text = await readFile(path, "utf8");
      for (const m of text.matchAll(
        /app\.(get|post|put|delete|patch)\(\s*"([^"]+)"/g,
      ))
        routes.push(m[1].toUpperCase() + " " + m[2]);
    }
  }
}
await visit("apps/server/src");
for (const route of routes) {
  const item = mapping[route];
  if (!item) throw Error("Route sans test associé : " + route);
  const source = await readFile(item.file, "utf8");
  if (!source.includes(item.test)) throw Error("Test absent : " + route);
}
if (Object.keys(mapping).some((route) => !routes.includes(route)))
  throw Error("Correspondance route obsolète.");
for (const requirement of scope.requirements)
  for (const file of [
    ...(requirement.implementation?.files ?? []),
    ...(requirement.implementation?.tests ?? []),
  ])
    await readFile(file);
console.log(
  `171 exigences conservées (160 requises, 10 exclusions, 1 proposition), ${routes.length} routes reliées à leurs tests ; chemins privés absents de l’index.`,
);
