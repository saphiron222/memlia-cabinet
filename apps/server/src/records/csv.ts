import { deriveSourceFreshness } from "@memlia/contracts";
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
export function csvCell(value: unknown) {
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
  return "\uFEFF" + csvColumns(query).map(csvCell).join(";") + "\r\n";
}
export function csvRow(
  record: CabinetRecord,
  query: RecordListQuery,
  now = new Date(),
  today = now.toISOString().slice(0, 10),
) {
  const freshness =
    record.kind === "obligation"
      ? deriveSourceFreshness(record.data.sourceEvidence, now, today)
      : null;
  const profile = record.kind === "obligation" ? record.data.fiscal : null;
  const derived: Record<string, unknown> = {
    fiscalGross: profile?.observedValues.gross,
    fiscalNet: profile?.observedValues.net,
    fiscalEstimate: profile?.observedValues.estimate,
    fiscalReferenceTurnover: profile?.observedValues.referenceTurnover,
    ...(profile ? { financialYearEnd: profile.financialYearEnd } : {}),
    fiscalCampaign: profile?.period.campaign,
    fiscalStart: profile?.period.start,
    fiscalEnd: profile?.period.end,
    fiscalSubtype: profile?.period.subtype,
    fiscalClassification: profile?.classification,
    fiscalRegime: profile?.regime,
    fiscalContact: profile?.contactId,
    fiscalResponsibles: profile?.responsibleIds,
    freshnessState: freshness?.state,
    sourceUpdatedAt: freshness?.sourceUpdatedAt,
    observedAt: freshness?.observedAt,
    cadenceVersion: freshness?.policyVersion,
  };
  return (
    csvColumns(query)
      .map((key) =>
        csvCell(
          key in derived
            ? derived[key]
            : key.startsWith("custom.")
              ? record.data.customFields[key.slice(7)]
              : key in record
                ? (record as unknown as Record<string, unknown>)[key]
                : (record.data as unknown as Record<string, unknown>)[key],
        ),
      )
      .join(";") + "\r\n"
  );
}
