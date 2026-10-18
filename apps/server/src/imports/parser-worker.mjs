// Untrusted file processing only. This process never receives database credentials.
// Application quotas and a V8 heap cap are NOT an OS/RSS/network sandbox.
import { parse } from "csv-parse";
import { readSheet } from "read-excel-file/node";
import yauzl from "yauzl";
import { SaxesParser } from "saxes";
import { posix } from "node:path";
const MAX = 10 * 1024 * 1024,
  expandedMax = 50 * 1024 * 1024;
const reject = (code) => {
  throw new Error(code);
};
const decode = (b) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    reject("INVALID_UTF8");
  }
};
const cell = (value, type = "text") => ({
  value: value ?? null,
  type: value == null ? "blank" : type,
});
function table(sheet, sheets, rows) {
  if (!rows.length) reject("EMPTY_FILE");
  if (rows.length > 10001) reject("ROW_LIMIT");
  const headers = rows[0].map((c) =>
    typeof c.value === "string" ? c.value.trim() : "",
  );
  if (!headers.length || headers.length > 100) reject("COLUMN_LIMIT");
  if (
    headers.some((h) => !h || h.length > 300) ||
    new Set(headers).size !== headers.length
  )
    reject("INVALID_HEADERS");
  for (const row of rows) {
    if (row.length > headers.length) reject("COLUMN_MISMATCH");
    for (const c of row)
      if (typeof c.value === "string" && c.value.length > 32768)
        reject("CELL_LIMIT");
  }
  return {
    sheet,
    sheets,
    headers,
    rows: rows.slice(1).map((cells, i) => ({
      number: i + 2,
      cells: Array.from(
        { length: headers.length },
        (_, j) => cells[j] ?? cell(null),
      ),
    })),
  };
}
async function csv(bytes, delimiter) {
  const rows = [],
    parser = parse({
      bom: true,
      delimiter,
      cast: false,
      cast_date: false,
      max_record_size: 3300000,
      relax_column_count: true,
    });
  parser.end(decode(bytes));
  for await (const row of parser) {
    if (rows.length >= 10001) reject("ROW_LIMIT");
    if (row.length > 100) reject("COLUMN_LIMIT");
    rows.push(
      row.map((v) => {
        if (v.length > 32768) reject("CELL_LIMIT");
        return cell(v);
      }),
    );
  }
  return table("CSV", ["CSV"], rows);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
async function archive(bytes) {
  const zip = await new Promise((resolve, reject) =>
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (e, z) => (e ? reject(e) : resolve(z)),
    ),
  );
  const parts = new Map();
  let total = 0,
    count = 0;
  try {
    await new Promise((resolve, rejectPromise) => {
      zip.on("error", rejectPromise);
      zip.on("end", resolve);
      zip.on("entry", (entry) => {
        void (async () => {
          const name = entry.fileName;
          if (++count > 256) reject("ZIP_ENTRY_LIMIT");
          if (entry.generalPurposeBitFlag & 1) reject("ENCRYPTED_XLSX");
          if (
            !/^(\[Content_Types\]\.xml|_rels\/\.rels|docProps\/(core|app)\.xml|xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|styles\.xml|sharedStrings\.xml|theme\/theme\d+\.xml|worksheets\/sheet\d+\.xml|worksheets\/_rels\/sheet\d+\.xml\.rels))$/.test(
              name,
            ) ||
            name.includes("..") ||
            parts.has(name)
          )
            reject("UNSUPPORTED_XLSX_PART");
          if (
            entry.uncompressedSize > 20 * 1024 * 1024 ||
            total + entry.uncompressedSize > expandedMax
          )
            reject("ZIP_EXPANSION_LIMIT");
          const stream = await new Promise((resolve, reject) =>
            zip.openReadStream(entry, (e, s) => (e ? reject(e) : resolve(s))),
          );
          let size = 0;
          const chunks = [];
          for await (const chunk of stream) {
            size += chunk.length;
            if (size > 20 * 1024 * 1024 || total + size > expandedMax) {
              stream.destroy();
              reject("ZIP_EXPANSION_LIMIT");
            }
            chunks.push(chunk);
          }
          total += size;
          const content = Buffer.concat(chunks);
          if (crc32(content) !== entry.crc32) reject("INVALID_ZIP_CRC");
          parts.set(name, decode(content));
          zip.readEntry();
        })().catch((e) => {
          zip.close();
          rejectPromise(e);
        });
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  return parts;
}
const spreadsheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const relns = "http://schemas.openxmlformats.org/package/2006/relationships";
function inspect(parts) {
  if (
    !parts.has("[Content_Types].xml") ||
    !parts.has("xl/workbook.xml") ||
    !parts.has("_rels/.rels")
  )
    reject("INVALID_XLSX");
  const types = new Map(),
    rawValues = new Map(),
    sheets = [],
    relations = new Map();
  let totalCells = 0,
    epoch1904 = false;
  for (const [path, xml] of parts) {
    const p = new SaxesParser({ xmlns: true });
    let depth = 0,
      textSize = 0,
      reference = null,
      inValue = false;
    const seen = new Set(),
      cellTypes = new Map(),
      values = new Map();
    p.on("doctype", () => reject("XML_DTD_FORBIDDEN"));
    p.on("error", () => reject("INVALID_XML"));
    p.on("opentag", (n) => {
      if (++depth > 64) reject("XML_DEPTH_LIMIT");
      textSize = 0;
      const a = Object.fromEntries(
        Object.values(n.attributes).map((x) => [x.local, x.value]),
      );
      if (n.local === "f") reject("FORMULA_FORBIDDEN");
      if (["c", "row", "dimension"].includes(n.local) && n.uri !== spreadsheet)
        reject("INVALID_NAMESPACE");
      if (n.local === "workbookPr")
        epoch1904 = a.date1904 === "1" || a.date1904 === "true";
      if (n.local === "v") inValue = true;
      if (n.local === "Override" || n.local === "Default") {
        if (
          a.ContentType &&
          !/^application\/(vnd\.openxmlformats-(officedocument\.(spreadsheetml\.(sheet\.main|worksheet|styles|sharedStrings)|theme|extended-properties)|package\.(relationships|core-properties))\+xml|xml)$/.test(
            a.ContentType,
          )
        )
          reject("UNSUPPORTED_CONTENT_TYPE");
      }
      if (n.local === "Relationship" && n.uri === relns) {
        if (
          a.TargetMode === "External" ||
          !a.Target ||
          /^[a-z]+:|[\\?#%]/i.test(a.Target)
        )
          reject("EXTERNAL_RELATION_FORBIDDEN");
        const base =
          path === "_rels/.rels"
            ? ""
            : posix.dirname(path).replace(/\/?_rels$/, "");
        const target = posix.normalize(
          a.Target.startsWith("/")
            ? a.Target.slice(1)
            : posix.join(base, a.Target),
        );
        if (target.startsWith("../") || !parts.has(target))
          reject("INVALID_RELATION");
        if (
          !/\/(officeDocument|worksheet|styles|sharedStrings|theme|core-properties|extended-properties)$/.test(
            a.Type ?? "",
          )
        )
          reject("UNSUPPORTED_RELATION");
        if (path === "xl/_rels/workbook.xml.rels") {
          if (relations.has(a.Id)) reject("DUPLICATE_RELATION");
          relations.set(a.Id, target);
        }
      }
      if (n.local === "sheet" && n.uri === spreadsheet) {
        if (
          !a.name ||
          sheets.some((s) => s.name === a.name) ||
          sheets.length >= 20
        )
          reject("SHEET_LIMIT");
        sheets.push({ name: a.name, id: a.id });
      }
      if (n.local === "dimension" && n.uri === spreadsheet && a.ref)
        checkCoordinate(a.ref.split(":").at(-1));
      if (
        n.local === "row" &&
        n.uri === spreadsheet &&
        (!/^\d+$/.test(a.r) || Number(a.r) > 10001)
      )
        reject("ROW_LIMIT");
      if (n.local === "c" && n.uri === spreadsheet) {
        checkCoordinate(a.r);
        if (seen.has(a.r)) reject("DUPLICATE_CELL");
        seen.add(a.r);
        if (++totalCells > 1000100) reject("CELL_COUNT_LIMIT");
        cellTypes.set(a.r, a.t ?? "n");
        reference = a.r;
      }
    });
    p.on("closetag", (n) => {
      depth--;
      textSize = 0;
      if (n.local === "v") inValue = false;
      if (n.local === "c") reference = null;
    });
    p.on("text", (text) => {
      textSize += text.length;
      if (textSize > 32768) reject("CELL_LIMIT");
      if (inValue && reference)
        values.set(reference, (values.get(reference) ?? "") + text);
    });
    p.write(xml).close();
    types.set(path, cellTypes);
    rawValues.set(path, values);
  }
  if (!sheets.length || sheets.some((s) => !relations.has(s.id)))
    reject("INVALID_SHEETS");
  return {
    types,
    rawValues,
    epoch1904,
    sheets: sheets.map((s) => ({ ...s, path: relations.get(s.id) })),
  };
}
function checkCoordinate(ref) {
  const m = /^([A-Z]{1,3})([1-9]\d*)$/.exec(ref ?? "");
  if (!m) reject("INVALID_CELL_COORDINATE");
  let col = 0;
  for (const c of m[1]) col = col * 26 + c.charCodeAt(0) - 64;
  if (col > 100) reject("COLUMN_LIMIT");
  if (Number(m[2]) > 10001) reject("ROW_LIMIT");
}
function column(n) {
  let s = "";
  for (n++; n; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
async function xlsx(bytes, selected) {
  const parts = await archive(bytes),
    checked = inspect(parts),
    sheet = selected
      ? checked.sheets.find((s) => s.name === selected)
      : checked.sheets.length === 1
        ? checked.sheets[0]
        : null;
  if (!sheet) reject("SHEET_REQUIRED");
  const data = await readSheet(bytes, sheet.name, {
    trim: false,
    parseNumber: (value) => value,
  });
  const rows = data.map((row, r) =>
    row.map((value, c) => {
      const type = checked.types.get(sheet.path)?.get(column(c) + (r + 1));
      if (value instanceof Date) {
        const serial = Number(
          checked.rawValues.get(sheet.path)?.get(column(c) + (r + 1)),
        );
        if (!checked.epoch1904 && serial >= 60 && serial < 61)
          reject("INVALID_EXCEL_DATE");
        if (!Number.isFinite(value.getTime())) reject("INVALID_DATE");
        return cell(value.toISOString().slice(0, 10), "date");
      }
      if (type === "e") reject("EXCEL_ERROR");
      return cell(
        value,
        typeof value === "boolean"
          ? "boolean"
          : type === "n"
            ? "number"
            : "text",
      );
    }),
  );
  return table(
    sheet.name,
    checked.sheets.map((s) => s.name),
    rows,
  );
}
try {
  let size = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 14 * 1024 * 1024) reject("INPUT_LIMIT");
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8")),
    bytes = Buffer.from(input.bytes, "base64");
  if (bytes.length > MAX) reject("FILE_LIMIT");
  const result =
    input.format === "csv"
      ? await csv(bytes, input.delimiter)
      : await xlsx(bytes, input.sheet);
  const output = JSON.stringify(result);
  if (Buffer.byteLength(output) > 32 * 1024 * 1024) reject("RESULT_LIMIT");
  process.stdout.write(output);
} catch (e) {
  const code = /^[A-Z0-9_]{3,80}$/.test(e.message) ? e.message : "INVALID_FILE";
  process.stdout.write(JSON.stringify({ error: code }));
  process.exitCode = 1;
}
