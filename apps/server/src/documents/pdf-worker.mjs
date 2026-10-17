import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const bytes = await readFile(process.argv[2]);
const assets = dirname(
  fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")),
);
const task = getDocument({
  cMapUrl: join(assets, "cmaps/"),
  cMapPacked: true,
  standardFontDataUrl: join(assets, "standard_fonts/"),
  wasmUrl: join(assets, "wasm/"),
  data: new Uint8Array(bytes),
  stopAtErrors: true,
  enableXfa: false,
  useWorkerFetch: false,
  isEvalSupported: false,
  disableFontFace: true,
  useSystemFonts: false,
  verbosity: 0,
});
try {
  const pdf = await task.promise;
  if (pdf.numPages > 500) throw Error("EXTRACTION_LIMIT");
  let text = "";
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    // Search text only; no claim of visual reading order or table reconstruction.
    text +=
      content.items
        .map((item) =>
          "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
        )
        .join("") + "\n";
    if (text.length > 5_000_000) throw Error("EXTRACTION_LIMIT");
    page.cleanup();
  }
  process.stdout.write(JSON.stringify({ text, pages: pdf.numPages }));
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      error:
        error.name === "PasswordException"
          ? "PASSWORD_REQUIRED"
          : "INVALID_PDF",
    }),
  );
  process.exitCode = 1;
} finally {
  await task.destroy();
}
