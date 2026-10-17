import { useEffect, useState } from "react";
import { Button } from "@memlia/ui";
import { z } from "zod";
import {
  SavedViewSchema,
  SavedViewListSchema,
  CustomFieldListSchema,
  RecordColumnKeys,
  type RecordListQuery,
  type SavedView,
} from "@memlia/contracts";
import { request, useScope, message } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
import { columnLabels } from "./columns";
import { ScopeFilters } from "./ScopeFilters";
export function ViewControls({
  query,
  onChange,
}: {
  query: RecordListQuery;
  onChange: (q: RecordListQuery) => void;
}) {
  const signal = useScope(),
    [views, setViews] = useState<SavedView[]>([]),
    [selected, setSelected] = useState(""),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [custom, setCustom] = useState<
      z.infer<typeof CustomFieldListSchema>["items"]
    >([]);
  async function load() {
    setViews(
      (
        await request("/administration/views", SavedViewListSchema, signal)
      ).items.filter((v) => v.query.kind === query.kind),
    );
  }
  useEffect(() => {
    void load().catch((e) => {
      if (!signal.aborted) setError(message(e));
    });
    void request("/administration/fields", CustomFieldListSchema, signal)
      .then((r) => setCustom(r.items.filter((f) => f.kind === query.kind)))
      .catch(() => {});
  }, [query.kind]);
  async function save(update: boolean) {
    setBusy(true);
    setError("");
    try {
      const prior = views.find((v) => v.id === selected);
      const result = await request(
        "/administration/views" + (update ? "/" + selected : ""),
        SavedViewSchema,
        signal,
        {
          method: update ? "PUT" : "POST",
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            expectedVersion: update ? prior?.version : undefined,
            name,
            query,
          }),
        },
      );
      await load();
      setSelected(result.id);
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  const patch = (values: Partial<RecordListQuery>) =>
    onChange({ ...query, ...values, offset: 0 });
  const columns = query.columns?.split(",") ?? ["title"];
  return (
    <details className="view-controls">
      <summary>Filtres, colonnes et vues enregistrées</summary>
      <ErrorSummary message={error || undefined} />
      <ScopeFilters query={query} onChange={patch} />
      <div className="admin-inline">
        <Select
          name="sort"
          label="Trier par"
          value={query.sort}
          onChange={(v) => patch({ sort: v as RecordListQuery["sort"] })}
        >
          <option value="title">Titre</option>
          <option value="updatedAt">Dernière modification</option>
          <option value="dueDate">Échéance</option>
          <option value="state">Étape</option>
        </Select>
        <Select
          name="direction"
          label="Ordre de tri"
          value={query.direction}
          onChange={(v) => patch({ direction: v as "asc" | "desc" })}
        >
          <option value="asc">Croissant</option>
          <option value="desc">Décroissant</option>
        </Select>
        <Select
          name="page-size"
          label="Lignes par page"
          value={String(query.limit)}
          onChange={(v) => patch({ limit: Number(v) })}
        >
          {[10, 25, 50, 100, 200].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </Select>
      </div>
      <fieldset>
        <legend>Colonnes affichées et exportées</legend>
        {[
          ...RecordColumnKeys.filter(
            (k) => !["fieldOrigins", "customFields"].includes(k),
          ),
          ...custom.map((f) => "custom." + f.id),
        ].map((key) => (
          <label className="check-row" key={key}>
            <input
              type="checkbox"
              aria-label={
                "Afficher la colonne " +
                (custom.find((f) => "custom." + f.id === key)?.name ??
                  columnLabels[key] ??
                  key)
              }
              checked={columns.includes(key)}
              disabled={key === "title" && columns.includes(key)}
              onChange={(e) =>
                patch({
                  columns: (e.target.checked
                    ? [...columns, key]
                    : columns.filter((c) => c !== key)
                  ).join(","),
                })
              }
            />
            {custom.find((f) => "custom." + f.id === key)?.name ??
              columnLabels[key] ??
              key}
          </label>
        ))}
      </fieldset>
      <Select
        name="saved-view"
        label="Mes vues"
        value={selected}
        onChange={(id) => {
          setSelected(id);
          const v = views.find((v) => v.id === id);
          if (v) {
            setName(v.name);
            onChange(v.query);
          }
        }}
      >
        <option value="">Vue courante</option>
        {views.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </Select>
      <Field
        name="view-name"
        label="Nom de la vue"
        value={name}
        onChange={setName}
      />
      <Button disabled={busy || !name.trim()} onClick={() => void save(false)}>
        Enregistrer une nouvelle vue
      </Button>
      <Button
        disabled={busy || !selected || !name.trim()}
        onClick={() => void save(true)}
      >
        Mettre à jour cette vue
      </Button>
      <Button
        disabled={busy || !selected}
        onClick={() => {
          void (async () => {
            setBusy(true);
            try {
              await request(
                `/administration/views/${selected}/remove`,
                z.object({ removed: z.boolean() }),
                signal,
                {
                  method: "POST",
                  body: JSON.stringify({
                    operationId: crypto.randomUUID(),
                    expectedVersion: views.find((v) => v.id === selected)
                      ?.version,
                  }),
                },
              );
              setSelected("");
              await load();
            } catch (e) {
              if (!signal.aborted) setError(message(e));
            } finally {
              if (!signal.aborted) setBusy(false);
            }
          })();
        }}
      >
        Supprimer cette vue
      </Button>
    </details>
  );
}
