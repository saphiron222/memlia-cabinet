import { useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@memlia/ui";
import { RecordListSchema, ProductionTargetSchema } from "@memlia/contracts";
import { request, message, useScope } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
export function TargetPicker({
  kind,
  onSelect,
}: {
  kind: z.infer<typeof ProductionTargetSchema>["kind"];
  onSelect: (t: z.infer<typeof ProductionTargetSchema>) => void;
}) {
  const signal = useScope(),
    [q, setQ] = useState(""),
    [offset, setOffset] = useState(0),
    [items, setItems] = useState<{ id: string; title: string }[]>([]),
    [more, setMore] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState("");
  useEffect(() => {
    if (kind === "libre") return;
    const controller = new AbortController();
    void (
      kind === "utilisateur"
        ? request(
            "/production/people?" +
              new URLSearchParams({ q, offset: String(offset) }),
            z.object({
              items: z.array(z.object({ id: z.string(), name: z.string() })),
              total: z.number(),
            }),
            controller.signal,
          ).then((r) => ({
            items: r.items.map((x) => ({ id: x.id, title: x.name })),
            total: r.total,
          }))
        : request(
            "/records?" +
              new URLSearchParams({
                kind,
                q,
                offset: String(offset),
                limit: "100",
              }),
            RecordListSchema,
            controller.signal,
          )
    )
      .then((r) => {
        setItems(r.items);
        setMore(offset + 100 < r.total);
        setError("");
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setItems([]);
          setError(message(e));
        }
      });
    return () => controller.abort();
  }, [kind, q, offset]);
  return (
    <div className="production-picker">
      <ErrorSummary message={error || undefined} />
      <Field
        name="target-search"
        label={
          kind === "libre" ? "Libellé de la ligne" : "Rechercher une cible"
        }
        value={q}
        onChange={(v) => {
          setQ(v);
          setOffset(0);
        }}
      />
      {kind !== "libre" && (
        <>
          <Select
            name="target-choice"
            label="Cible"
            value={selected}
            onChange={setSelected}
          >
            <option value="">Choisir…</option>
            {items.map((x) => (
              <option value={x.id} key={x.id}>
                {x.title}
              </option>
            ))}
          </Select>
          <div className="actions">
            <Button
              disabled={offset === 0}
              onClick={() => setOffset((v) => Math.max(0, v - 100))}
            >
              Précédentes
            </Button>
            <Button disabled={!more} onClick={() => setOffset((v) => v + 100)}>
              Suivantes
            </Button>
          </div>
        </>
      )}
      <Button
        disabled={kind === "libre" ? !q : !selected}
        onClick={() => {
          const item = items.find((x) => x.id === selected);
          onSelect({
            kind,
            id: kind === "libre" ? null : selected,
            label: kind === "libre" ? q : (item?.title ?? ""),
          });
        }}
      >
        Ajouter cette cible
      </Button>
    </div>
  );
}
