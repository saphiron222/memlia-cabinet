import { useEffect, useState } from "react";
import { Button } from "@memlia/ui";
import { RecordListSchema, type CabinetRecord } from "@memlia/contracts";
import { request, message } from "../../api";
import { Field, ErrorSummary } from "../../forms";
export function useDossierChoices(enabled = true) {
  const [q, setQ] = useState(""),
    [offset, setOffset] = useState(0),
    [items, setItems] = useState<CabinetRecord[]>([]),
    [total, setTotal] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void request(
        `/records?kind=dossier&limit=100&offset=${offset}&q=${encodeURIComponent(q)}`,
        RecordListSchema,
        controller.signal,
      )
        .then((r) => {
          setItems(r.items);
          setTotal(r.total);
          setError("");
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(message(e));
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, offset, enabled]);
  return { q, setQ, offset, setOffset, items, total, error };
}
export function DossierChoices({
  choices,
}: {
  choices: ReturnType<typeof useDossierChoices>;
}) {
  return (
    <div className="dossier-choices">
      <ErrorSummary message={choices.error || undefined} />
      <Field
        name="relation-search"
        label="Rechercher un dossier lié"
        value={choices.q}
        onChange={(v) => {
          choices.setQ(v);
          choices.setOffset(0);
        }}
      />
      <div className="pagination">
        <Button
          disabled={!choices.offset}
          onClick={() => choices.setOffset(Math.max(0, choices.offset - 100))}
        >
          Dossiers précédents
        </Button>
        <span>
          {choices.total} dossiers autorisés · page{" "}
          {Math.floor(choices.offset / 100) + 1}
        </span>
        <Button
          disabled={choices.offset + 100 >= choices.total}
          onClick={() => choices.setOffset(choices.offset + 100)}
        >
          Dossiers suivants
        </Button>
      </div>
    </div>
  );
}
