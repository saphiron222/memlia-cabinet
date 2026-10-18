import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve, dirname, extname } from "node:path";
const root = process.cwd(),
  source = resolve(root, "third-party/propel-0.7.3"),
  output = resolve(source, "editable-source");
if (existsSync(output))
  throw Error(
    "Editable source already exists; preserve edits and use its generated Vite config.",
  );
cpSync(resolve(source, "dist"), output, { recursive: true });
let originalModules = 0;
function recover(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) recover(p);
    else if (e.name.endsWith(".js.map")) {
      const m = JSON.parse(readFileSync(p, "utf8"));
      if (m.sources?.length !== 1 || typeof m.sourcesContent?.[0] !== "string")
        throw Error("Source map cannot be mapped one-to-one: " + p);
      const ext = extname(m.sources[0]);
      if (![".ts", ".tsx", ".js", ".jsx"].includes(ext))
        throw Error("Unexpected source extension");
      const emitted = p.slice(0, -4),
        target = emitted.slice(0, -3) + ext;
      rmSync(emitted);
      writeFileSync(target, m.sourcesContent[0]);
      originalModules++;
    }
  }
}
recover(output);
writeFileSync(
  resolve(root, "apps/web/vite.propel-source.config.ts"),
  `// Generated Memlia adapter. Uses original published Propel sources; no claim to original tsdown build.\nimport {mergeConfig} from 'vite';\nimport {resolve} from 'node:path';\nimport base from './vite.config.ts';\nconst source=resolve(import.meta.dirname,'../../third-party/propel-0.7.3/editable-source');\nexport default mergeConfig(base,{resolve:{alias:[{find:/^@makeplane\\/propel\\/styles$/,replacement:source+'/styles/propel.css'},{find:/^@makeplane\\/propel\\/(.+)$/,replacement:source+'/$1'}]}});\n`,
);
console.log(
  `${originalModules} original modules restored; generated barrel JS, CSS and assets retained from exact package. Run: npm exec --workspace @memlia/web -- vite build --configLoader native --config vite.propel-source.config.ts`,
);
