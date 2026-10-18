import { useEffect, useState } from "react";
import { TimeCatalogSchema } from "@memlia/contracts";
import { z } from "zod";
import { request, message } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
import { Button } from "@memlia/ui";
type Kind = "users" | "natures" | "roles" | "groups";
type Item = z.infer<typeof TimeCatalogSchema>["items"][number];
function useCatalog(kind: Kind, query: string) {
  const [data, setData] = useState<z.infer<typeof TimeCatalogSchema> | null>(
      null,
    ),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    void request(`/time/catalog/${kind}?${query}`, TimeCatalogSchema, c.signal)
      .then((r) => {
        setData(r);
        setError("");
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(message(e));
      });
    return () => c.abort();
  }, [kind, query]);
  return { data, error };
}
export function CatalogName({ kind, id }: { kind: Kind; id: string | null }) {
  const { data, error } = useCatalog(
    kind,
    new URLSearchParams({ ids: id ?? "" }).toString(),
  );
  if (!id) return <>Non affecté</>;
  const item = data?.items.find((i) => i.id === id);
  return (
    <span title={error || undefined}>
      {item
        ? item.name + (!item.active ? " · Inactif" : "")
        : error
          ? "Identité inaccessible"
          : "Chargement…"}
    </span>
  );
}
export function CatalogSelect({
  kind,
  name,
  label,
  value,
  onChange,
  active = false,
  empty = "Choisir…",
}: {
  kind: Kind;
  name: string;
  label: string;
  value: string;
  onChange: (id: string) => void;
  active?: boolean;
  empty?: string;
}) {
  const [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0);
  const { data, error } = useCatalog(
    kind,
    new URLSearchParams({
      q: query,
      offset: String(offset),
      ...(active ? { active: "true" } : {}),
    }).toString(),
  );
  const selected = useCatalog(
    kind,
    new URLSearchParams({ ids: value }).toString(),
  );
  const items: Item[] = [...(data?.items ?? [])];
  for (const i of selected.data?.items ?? [])
    if (!items.some((x) => x.id === i.id)) items.unshift(i);
  return (
    <div className="time-catalog">
      <Field
        name={name + "-search"}
        label={
          {
            users: "Rechercher une personne",
            natures: "Rechercher une nature",
            roles: "Rechercher un rôle",
            groups: "Rechercher un pôle ou site",
          }[kind]
        }
        value={query}
        onChange={(q) => {
          setQuery(q);
          setOffset(0);
        }}
      />
      <Select name={name} label={label} value={value} onChange={onChange}>
        <option value="">{empty}</option>
        {items.map((i) => (
          <option key={i.id} value={i.id} disabled={active && !i.active}>
            {i.name}
            {!i.active ? " · Inactif" : ""}
          </option>
        ))}
      </Select>
      <ErrorSummary message={error || selected.error} />
      {(offset > 0 || data?.hasMore) && (
        <div className="actions">
          <Button
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 100))}
          >
            Options précédentes
          </Button>
          <Button
            disabled={!data?.hasMore}
            onClick={() => setOffset(offset + 100)}
          >
            Options suivantes
          </Button>
        </div>
      )}
    </div>
  );
}
export function WeightEditor({
  weights,
  onChange,
  prefix,
}: {
  weights: { userId: string; weight: number }[];
  onChange: (w: { userId: string; weight: number }[]) => void;
  prefix: string;
}) {
  const [selected, setSelected] = useState("");
  return (
    <div>
      <CatalogSelect
        kind="users"
        name={prefix + "-add"}
        label="Ajouter un porteur"
        value={selected}
        active
        onChange={(id) => {
          setSelected(id);
          if (id && !weights.some((w) => w.userId === id))
            onChange([...weights, { userId: id, weight: 1 }]);
        }}
      />
      {weights.map((w) => (
        <div key={w.userId}>
          <CatalogName kind="users" id={w.userId} />
          <Field
            name={prefix + "-" + w.userId}
            label="Poids du porteur"
            type="number"
            value={String(w.weight)}
            onChange={(v) =>
              onChange(
                weights.map((x) =>
                  x.userId === w.userId ? { ...x, weight: Number(v) } : x,
                ),
              )
            }
          />
          <Button
            onClick={() =>
              onChange(weights.filter((x) => x.userId !== w.userId))
            }
          >
            Retirer ce porteur
          </Button>
        </div>
      ))}
    </div>
  );
}
