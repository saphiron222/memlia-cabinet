import { useState } from "react";
import { Button } from "@memlia/ui";
import type { RecordListQuery } from "@memlia/contracts";
import { useScope, queryString, message } from "../../api";
import { ErrorSummary } from "../../forms";
import { ExportData } from "../administration/ExportData";
export function CsvExport({
  query,
  label = "Exporter en CSV",
  link = false,
}: {
  query: RecordListQuery;
  label?: string;
  link?: boolean;
}) {
  const signal = useScope(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [large, setLarge] = useState<RecordListQuery | null>(null);
  async function download() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/v1/records/export.csv?" + queryString(query),
        { signal },
      );
      if (!response.ok) {
        const failure = await response.json();
        if (failure.error?.code === "EXPORT_ASYNC_REQUIRED") {
          setLarge({ ...query });
          return;
        }
        throw Error(failure.error?.message ?? "Export impossible.");
      }
      const url = URL.createObjectURL(await response.blob()),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "memlia.csv";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <div className="csv-export">
      {link ? (
        <a
          href={"/api/v1/records/export.csv?" + queryString(query)}
          aria-disabled={busy}
          onClick={(e) => {
            e.preventDefault();
            void download();
          }}
        >
          {label}
        </a>
      ) : (
        <Button loading={busy} onClick={() => void download()}>
          {label}
        </Button>
      )}
      <ErrorSummary message={error || undefined} />
      {large && <ExportData query={large} />}
    </div>
  );
}
