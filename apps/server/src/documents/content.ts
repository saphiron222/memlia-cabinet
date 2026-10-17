import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import type { DocumentInput } from "@memlia/contracts";
import { fail } from "../errors.js";
const execute = promisify(execFile);
export async function extract(
  path: string,
  mediaType: DocumentInput["mediaType"],
) {
  const bytes = await readFile(path);
  if (mediaType === "application/octet-stream")
    return {
      text: "",
      pages: 0,
      status: "unsupported" as const,
      engine: "none",
    };
  if (mediaType === "text/plain") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      fail(422, "INVALID_TEXT", "Texte UTF-8 attendu.");
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))
      fail(422, "INVALID_TEXT", "Contenu binaire interdit dans un texte.");
    return { text, pages: 0, status: "complete" as const, engine: "utf-8" };
  }
  if (
    !bytes
      .subarray(0, 8)
      .toString("ascii")
      .match(/^%PDF-\d\.\d/) ||
    !/%%EOF\s*$/.test(bytes.subarray(-1024).toString("ascii"))
  )
    fail(
      422,
      "INVALID_PDF",
      "PDF incomplet ou contenu différent du format annoncé.",
    );
  let stdout: string;
  try {
    ({ stdout } = await execute(
      process.execPath,
      [
        "--max-old-space-size=128",
        fileURLToPath(new URL("./pdf-worker.mjs", import.meta.url)),
        path,
      ],
      { timeout: 30000, maxBuffer: 25 * 1024 * 1024, encoding: "utf8" },
    ));
  } catch (error) {
    const output = String((error as { stdout?: string }).stdout ?? "");
    if (output.includes("PASSWORD_REQUIRED"))
      fail(
        422,
        "PASSWORD_REQUIRED",
        "Ce PDF nécessite un mot de passe. Importez une copie déverrouillée.",
      );
    fail(
      422,
      "INVALID_PDF",
      "PDF illisible ou limite d’extraction dépassée. Aucun original enregistré.",
    );
  }
  const result = JSON.parse(stdout) as { text: string; pages: number };
  return {
    ...result,
    status: result.text.trim() ? ("complete" as const) : ("needs_ocr" as const),
    engine: "pdfjs-dist@6.4.299",
  };
}
