import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ImportTableSchema,
  ImportParseOptionsSchema,
  type ImportTable,
  IMPORT_MAX_BYTES,
} from "@memlia/contracts";
import { z } from "zod";
import { fail } from "../errors.js";
const refusals: Record<string, string> = {
  ROW_LIMIT: "Le fichier dépasse 10 000 lignes.",
  COLUMN_LIMIT: "Le fichier dépasse 100 colonnes.",
  CELL_LIMIT: "Une cellule dépasse 32 768 caractères.",
  INVALID_HEADERS:
    "Les en-têtes doivent être renseignés, distincts et inférieurs à 301 caractères.",
  COLUMN_MISMATCH: "Une ligne contient plus de cellules que les en-têtes.",
  ZIP_EXPANSION_LIMIT:
    "Le classeur dépasse les limites de décompression (20 Mio par entrée, 50 Mio au total).",
  ZIP_ENTRY_LIMIT: "Le classeur dépasse 256 entrées.",
  UNSUPPORTED_XLSX_PART:
    "Ce classeur contient une partie non prise en charge : retirer macros, dessins ou pièces intégrées.",
  EXTERNAL_RELATION_FORBIDDEN:
    "Les relations externes du classeur sont refusées.",
  FORMULA_FORBIDDEN:
    "Les formules sont refusées : exporter les valeurs explicites.",
  INVALID_FILE:
    "Le fichier est illisible ou ne correspond pas au format annoncé.",
  INVALID_UTF8: "Le CSV doit être encodé en UTF-8.",
  INVALID_ZIP_CRC: "L’intégrité d’une entrée du classeur est incorrecte.",
  PARSER_EXIT:
    "Le lecteur a été interrompu avant de rendre un résultat valide.",
};
export class ImportParser {
  constructor(private readonly timeoutMs = 10000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000)
      throw new Error("Délai de lecture invalide");
  }
  private active: Promise<ImportTable> | null = null;
  private child: ChildProcess | null = null;
  private stopped = false;
  async parse(
    bytes: Buffer,
    options: z.infer<typeof ImportParseOptionsSchema>,
  ): Promise<ImportTable> {
    if (this.stopped) fail(503, "IMPORT_STOPPED", "Lecteur suspendu.");
    if (this.active)
      fail(409, "IMPORT_BUSY", "Un fichier est déjà en cours de lecture.");
    if (bytes.length > IMPORT_MAX_BYTES)
      fail(413, "FILE_LIMIT", "Fichier supérieur à 10 Mio.");
    this.active = new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--max-old-space-size=192",
          fileURLToPath(new URL("./parser-worker.mjs", import.meta.url)),
        ],
        {
          env: { NODE_ENV: "production", TZ: "UTC" },
          stdio: ["pipe", "pipe", "ignore"],
        },
      );
      this.child = child;
      const chunks: Buffer[] = [];
      let size = 0,
        reason = "";
      const timer = setTimeout(() => {
        reason = "PARSER_TIMEOUT";
        child.kill("SIGKILL");
      }, this.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 32 * 1024 * 1024) {
          reason = "RESULT_LIMIT";
          child.kill("SIGKILL");
        } else chunks.push(chunk);
      });
      child.on("error", reject);
      child.stdin.on("error", () => undefined);
      child.on("close", (code) => {
        clearTimeout(timer);
        try {
          if (reason)
            fail(
              422,
              reason,
              "Lecture interrompue : limite du traitement dépassée.",
            );
          let value;
          try {
            value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            fail(422, "PARSER_EXIT", refusals.PARSER_EXIT!);
          }
          if (code !== 0 || value.error)
            fail(
              422,
              typeof value.error === "string" ? value.error : "INVALID_FILE",
              refusals[value.error] ??
                "Fichier refusé par les contrôles de lecture (" +
                  String(value.error ?? "INVALID_FILE") +
                  ").",
            );
          resolve(ImportTableSchema.parse(value));
        } catch (e) {
          reject(e);
        }
      });
      child.stdin.end(
        JSON.stringify({ ...options, bytes: bytes.toString("base64") }),
      );
    });
    try {
      return await this.active;
    } finally {
      this.active = null;
      this.child = null;
    }
  }
  async stop() {
    this.stopped = true;
    this.child?.kill("SIGKILL");
    await this.active?.catch(() => undefined);
  }
}
