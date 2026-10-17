import type { CabinetRecord, RecordListQuery } from "@memlia/contracts";
export function csvColumns(query: RecordListQuery) {
  return (
    query.columns?.split(",") ?? [
      "id",
      "kind",
      "title",
      "dossierId",
      "dueDate",
      "state",
      "amount",
      "version",
      "data",
    ]
  );
}
function cell(value: unknown) {
  let s =
    value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}
export function csvHeader(query: RecordListQuery) {
  return "\uFEFF" + csvColumns(query).map(cell).join(";") + "\r\n";
}
export function csvRow(record: CabinetRecord, query: RecordListQuery) {
  return (
    csvColumns(query)
      .map((key) =>
        cell(
          key.startsWith("custom.")
            ? record.data.customFields[key.slice(7)]
            : key in record
              ? (record as unknown as Record<string, unknown>)[key]
              : (record.data as unknown as Record<string, unknown>)[key],
        ),
      )
      .join(";") + "\r\n"
  );
}
