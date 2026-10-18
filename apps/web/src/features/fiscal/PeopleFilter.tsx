import { useEffect, useState } from "react";
import { Button } from "@memlia/ui";
import {
  FiscalResponsiblesSchema,
  RecordListSchema,
  type RecordListQuery,
} from "@memlia/contracts";
import { request, message } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
export function PeopleFilter({
  query,
  onChange,
}: {
  query: RecordListQuery;
  onChange: (q: Partial<RecordListQuery>) => void;
}) {
  const [mode, setMode] = useState("responsible"),
    [q, setQ] = useState(""),
    [offset, setOffset] = useState(0),
    [items, setItems] = useState<{ id: string; name: string }[]>([]),
    [total, setTotal] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    const timer = setTimeout(() => {
      const path = `?q=${encodeURIComponent(q)}&offset=${offset}`;
      void (
        mode === "responsible"
          ? request(
              "/fiscal/responsibles" + path,
              FiscalResponsiblesSchema,
              controller.signal,
            )
          : request(
              "/records" + path + "&kind=contact&limit=100",
              RecordListSchema,
              controller.signal,
            ).then((r) => ({
              items: r.items.map((i) => ({ id: i.id, name: i.title })),
              total: r.total,
            }))
      )
        .then((r) => {
          setItems(r.items);
          setTotal(r.total);
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setItems([]);
            setError(message(e));
          }
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [mode, q, offset]);
  return (
    <fieldset>
      <legend>Personnes</legend>
      <ErrorSummary message={error || undefined} />
      <div className="admin-inline">
        <Select
          name="fiscal-person-mode"
          label="Rôle de la personne"
          value={mode}
          onChange={(v) => {
            setMode(v);
            setQ("");
            setOffset(0);
          }}
        >
          <option value="responsible">Intervenant affecté</option>
          <option value="contact">Contact fiscal</option>
        </Select>
        <Field
          name="fiscal-person-search"
          label="Rechercher une personne"
          value={q}
          onChange={(v) => {
            setQ(v);
            setOffset(0);
          }}
        />
        <Select
          name="fiscal-person"
          label={
            mode === "responsible"
              ? "Intervenant du filtre"
              : "Contact du filtre"
          }
          value={
            (mode === "responsible" ? query.assigneeId : query.contactId) ?? ""
          }
          onChange={(v) =>
            onChange(
              mode === "responsible"
                ? { assigneeId: v || undefined }
                : { contactId: v || undefined },
            )
          }
        >
          <option value="">Toutes les personnes autorisées</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="pagination">
        <Button disabled={offset === 0} onClick={() => setOffset(offset - 100)}>
          Personnes précédentes
        </Button>
        <span>{total} personnes accessibles</span>
        <Button
          disabled={offset + 100 >= total}
          onClick={() => setOffset(offset + 100)}
        >
          Personnes suivantes
        </Button>
        <Button
          onClick={() =>
            onChange({ assigneeId: undefined, contactId: undefined })
          }
        >
          Effacer les filtres de personne
        </Button>
      </div>
    </fieldset>
  );
}
