import { deflateRawSync } from "node:zlib";
// Independent deterministic OOXML fixture builder. No Excel automation or real data.
const xml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
export type FixtureCell =
  | string
  | { value: string; type: "number" | "date" | "boolean" | "formula" };
export function xlsxFixture(
  rows: FixtureCell[][],
  options: {
    epoch1904?: boolean;
    external?: boolean;
    extra?: Record<string, string>;
    dimension?: string;
  } = {},
) {
  const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    rel = "http://schemas.openxmlformats.org/package/2006/relationships",
    office =
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const cells = rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row
          .map((c, i) => {
            const ref = String.fromCharCode(65 + i) + (r + 1);
            return typeof c === "string"
              ? `<c r="${ref}" t="inlineStr"><is><t>${xml(c)}</t></is></c>`
              : c.type === "formula"
                ? `<c r="${ref}"><f>1+1</f><v>2</v></c>`
                : `<c r="${ref}"${c.type === "boolean" ? ' t="b"' : c.type === "date" ? ' s="1"' : ""}><v>${xml(c.value)}</v></c>`;
          })
          .join("")}</row>`,
    )
    .join("");
  return zipFixture({
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${main}" xmlns:r="${office}"><workbookPr date1904="${options.epoch1904 ? 1 : 0}"/><sheets><sheet name="Reprise fictive" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${office}/styles" Target="styles.xml"/>${options.external ? `<Relationship Id="rId3" Type="${office}/hyperlink" Target="https://example.test/never-called" TargetMode="External"/>` : ""}</Relationships>`,
    "xl/styles.xml": `<styleSheet xmlns="${main}"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${main}">${options.dimension ? `<dimension ref="${options.dimension}"/>` : ""}<sheetData>${cells}</sheetData></worksheet>`,
    ...options.extra,
  });
}
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function zipFixture(files: Record<string, string>) {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const filename = Buffer.from(name),
      bytes = Buffer.from(text),
      compressed = deflateRawSync(bytes),
      crc = crc32(bytes),
      header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(bytes.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(header, filename, compressed);
    central.push(directory, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
