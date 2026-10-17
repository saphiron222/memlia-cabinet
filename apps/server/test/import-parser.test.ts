import { expect, test } from "vitest";
import { ImportParser } from "../src/imports/parser.js";
import { ImportParseOptionsSchema } from "@memlia/contracts";
import { xlsxFixture, zipFixture } from "./xlsx-fixture.js";
const csv = ImportParseOptionsSchema.parse({ format: "csv" }),
  xlsx = ImportParseOptionsSchema.parse({ format: "xlsx" });
test("lecteur isolé réel : limites CSV, ZIP, intégrité et fermeture effective du processus", async () => {
  const parser = new ImportParser();
  for (const [bytes, options, code] of [
    [Buffer.alloc(10 * 1024 * 1024 + 1), csv, "FILE_LIMIT"],
    [Buffer.from([0xc3, 0x28]), csv, "INVALID_UTF8"],
    [Buffer.from("Nom;Nom\na;b"), csv, "INVALID_HEADERS"],
    [
      Buffer.from(Array.from({ length: 101 }, (_, i) => "c" + i).join(";")),
      csv,
      "COLUMN_LIMIT",
    ],
    [Buffer.from("Nom\n" + "a\n".repeat(10001)), csv, "ROW_LIMIT"],
    [Buffer.from("Nom\n" + "a".repeat(32769)), csv, "CELL_LIMIT"],
    [
      zipFixture({ "xl/sharedStrings.xml": "x".repeat(20 * 1024 * 1024 + 1) }),
      xlsx,
      "ZIP_EXPANSION_LIMIT",
    ],
  ] as const) {
    await expect(parser.parse(bytes, options)).rejects.toMatchObject({ code });
  }
  const badCrc = xlsxFixture([["Nom"], ["Fictif"]]);
  const central = badCrc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  badCrc.writeUInt32LE(0, central + 16);
  await expect(parser.parse(badCrc, xlsx)).rejects.toMatchObject({
    code: "INVALID_ZIP_CRC",
  });
  const real = await parser.parse(
    Buffer.from("Nom;Code\nFictif;001234567\n"),
    csv,
  );
  expect(real.rows[0]!.cells[1]!.value).toBe("001234567");
  const active = parser.parse(
    Buffer.from("Nom\n" + "fictif\n".repeat(10000)),
    csv,
  );
  await expect(parser.parse(Buffer.from("Nom\nx"), csv)).rejects.toMatchObject({
    code: "IMPORT_BUSY",
  });
  const rejection = expect(active).rejects.toBeDefined();
  await parser.stop();
  await rejection;
  await expect(parser.parse(Buffer.from("Nom\nx"), csv)).rejects.toMatchObject({
    code: "IMPORT_STOPPED",
  });
});
test("lecteur isolé réel : délai plafonné et enfant terminé avant retour", async () => {
  const parser = new ImportParser(1),
    start = performance.now();
  await expect(
    parser.parse(xlsxFixture([["Nom"], ["Fictif"]]), xlsx),
  ).rejects.toMatchObject({ code: "PARSER_TIMEOUT" });
  await parser.stop();
  expect(performance.now() - start).toBeLessThan(2000);
});
