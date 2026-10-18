import { useEffect, useState } from "react";
import { Button, Checkbox } from "@memlia/ui";
import {
  CabinetRecordSchema,
  DocumentListSchema,
  type ProductionTemplate,
} from "@memlia/contracts";
import { request, message, useScope } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
import { TargetPicker } from "./TargetPicker";
export function PopulationEditor({
  model,
  onChange,
}: {
  model: ProductionTemplate;
  onChange: (change: Partial<ProductionTemplate>) => void;
}) {
  const signal = useScope(),
    [labels, setLabels] = useState<Record<string, string>>({}),
    [offset, setOffset] = useState(0),
    [dossierId, setDossierId] = useState(""),
    [q, setQ] = useState(""),
    [docOffset, setDocOffset] = useState(0),
    [docs, setDocs] = useState<{
      items: typeof DocumentListSchema._output.items;
      total: number;
    }>({ items: [], total: 0 }),
    [error, setError] = useState("");
  useEffect(() => {
    if (model.target === "dossier" || model.target === "contact")
      void Promise.all(
        model.population.slice(offset, offset + 20).map(async (id) => {
          const record = await request(
            "/records/" + id,
            CabinetRecordSchema,
            signal,
          );
          return [id, record.title] as const;
        }),
      )
        .then((entries) =>
          setLabels((old) => ({ ...old, ...Object.fromEntries(entries) })),
        )
        .catch((e) => setError(message(e)));
  }, [model.population, offset]);
  useEffect(() => {
    if (!dossierId) return;
    const c = new AbortController();
    void request(
      "/documents?" +
        new URLSearchParams({
          dossierId,
          q,
          offset: String(docOffset),
          limit: "20",
        }),
      DocumentListSchema,
      c.signal,
    )
      .then(setDocs)
      .catch((e) => {
        if (!c.signal.aborted) setError(message(e));
      });
    return () => c.abort();
  }, [dossierId, q, docOffset]);
  return (
    <>
      <ErrorSummary message={error || undefined} />
      <TargetPicker
        kind={model.target}
        onSelect={(target) => {
          if (target.id) {
            setLabels((old) => ({ ...old, [target.id!]: target.label }));
            onChange({
              population: [...new Set([...model.population, target.id])],
            });
          }
        }}
      />
      <ul className="production-population">
        {model.population.slice(offset, offset + 20).map((id) => (
          <li key={id}>
            <span>{labels[id] ?? "Cible configurée"}</span>
            <Button
              onClick={() =>
                onChange({
                  population: model.population.filter((x) => x !== id),
                })
              }
            >
              Retirer
            </Button>
          </li>
        ))}
      </ul>
      <div className="actions">
        <Button
          disabled={!offset}
          onClick={() => setOffset((v) => Math.max(0, v - 20))}
        >
          Cibles précédentes
        </Button>
        <Button
          disabled={offset + 20 >= model.population.length}
          onClick={() => setOffset((v) => v + 20)}
        >
          Cibles suivantes
        </Button>
      </div>
      {model.target === "dossier" && (
        <fieldset className="production-documents">
          <legend>Pièces des occurrences</legend>
          <p className="muted">
            Chaque pièce est liée uniquement aux occurrences de son dossier.
          </p>
          <Select
            name="population-doc-dossier"
            label="Dossier des pièces"
            value={dossierId}
            onChange={(v) => {
              setDossierId(v);
              setDocOffset(0);
            }}
          >
            <option value="">Choisir dans cette page de cibles</option>
            {model.population.slice(offset, offset + 20).map((id) => (
              <option key={id} value={id}>
                {labels[id] ?? "Cible configurée"}
              </option>
            ))}
          </Select>
          {dossierId && (
            <>
              <Field
                name="population-doc-query"
                label="Rechercher un original"
                value={q}
                onChange={(v) => {
                  setQ(v);
                  setDocOffset(0);
                }}
              />
              {docs.items.map((d) => (
                <label className="check" key={d.id}>
                  <Checkbox
                    checked={model.documentIds.includes(d.id)}
                    onCheckedChange={(checked) =>
                      onChange({
                        documentIds: checked
                          ? [...model.documentIds, d.id]
                          : model.documentIds.filter((x) => x !== d.id),
                      })
                    }
                  />
                  {d.filename}
                </label>
              ))}
              <div className="actions">
                <Button
                  disabled={!docOffset}
                  onClick={() => setDocOffset((v) => Math.max(0, v - 20))}
                >
                  Pièces précédentes
                </Button>
                <Button
                  disabled={docOffset + 20 >= docs.total}
                  onClick={() => setDocOffset((v) => v + 20)}
                >
                  Pièces suivantes
                </Button>
              </div>
            </>
          )}
          <p>{model.documentIds.length} pièces liées au modèle</p>
        </fieldset>
      )}
    </>
  );
}
