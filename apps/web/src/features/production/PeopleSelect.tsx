import { useEffect, useState } from "react";
import { Button } from "@memlia/ui";
import { ProductionPeopleSchema } from "@memlia/contracts";
import { request, message } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
export function PeopleSelect({
  name,
  value,
  onChange,
  disabled = false,
}: {
  name: string;
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState(""),
    [offset, setOffset] = useState(0),
    [people, setPeople] = useState<{ id: string; name: string }[]>([]),
    [total, setTotal] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    void request(
      "/production/people?" +
        new URLSearchParams({ q, offset: String(offset) }),
      ProductionPeopleSchema,
      c.signal,
    )
      .then((r) => {
        setPeople(r.items);
        setTotal(r.total);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(message(e));
      });
    return () => c.abort();
  }, [q, offset]);
  return (
    <details className="production-assignee">
      <summary>
        Responsable :{" "}
        {people.find((p) => p.id === value)?.name ??
          (value ? "Utilisateur affecté" : "Non affecté")}
      </summary>
      <ErrorSummary message={error || undefined} />
      <Field
        name={name + "-search"}
        label="Rechercher un responsable"
        value={q}
        onChange={(v) => {
          setQ(v);
          setOffset(0);
        }}
        disabled={disabled}
      />
      <Select
        name={name}
        label="Responsable"
        value={value ?? ""}
        onChange={(v) => onChange(v || null)}
        disabled={disabled}
      >
        <option value="">Non affecté</option>
        {value && !people.some((p) => p.id === value) && (
          <option value={value}>Utilisateur affecté</option>
        )}
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Button disabled={!offset} onClick={() => setOffset((v) => v - 100)}>
        Précédents
      </Button>
      <Button
        disabled={offset + 100 >= total}
        onClick={() => setOffset((v) => v + 100)}
      >
        Suivants
      </Button>
    </details>
  );
}
