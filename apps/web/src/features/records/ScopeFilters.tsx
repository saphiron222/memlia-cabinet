import { useEffect, useState } from "react";
import { Button } from "@memlia/ui";
import { RecordScopesSchema, type RecordListQuery } from "@memlia/contracts";
import { z } from "zod";
import { request, message } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
export function ScopeFilters({
  query,
  onChange,
}: {
  query: RecordListQuery;
  onChange: (q: Partial<RecordListQuery>) => void;
}) {
  const [q, setQ] = useState(""),
    [mode, setMode] = useState<"dossier" | "group">(
      query.groupId ? "group" : "dossier",
    ),
    [offset, setOffset] = useState(0),
    [scope, setScope] = useState<z.infer<typeof RecordScopesSchema>>({
      items: [],
      total: 0,
      offset: 0,
    }),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController(),
      timer = setTimeout(() => {
        void request(
          `/administration/scopes?kind=${mode}&q=${encodeURIComponent(q)}&offset=${offset}`,
          RecordScopesSchema,
          controller.signal,
        )
          .then(setScope)
          .catch((e) => {
            if (!controller.signal.aborted) setError(message(e));
          });
      }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, mode, offset]);
  return (
    <fieldset>
      <legend>Période et périmètre</legend>
      <ErrorSummary message={error || undefined} />
      <div className="admin-inline">
        <Field
          name="filter-from"
          label="Du"
          type="date"
          value={query.from ?? ""}
          onChange={(v) => onChange({ from: v || undefined })}
        />
        <Field
          name="filter-to"
          label="Au"
          type="date"
          value={query.to ?? ""}
          onChange={(v) => onChange({ to: v || undefined })}
        />
      </div>
      <p className="muted">
        La période porte sur l’échéance des tâches et obligations, le
        début/création du dossier ou la naissance du contact. Les dates
        inconnues sont exclues d’une période filtrée.
      </p>
      <Select
        name="scope-mode"
        label="Choisir un périmètre"
        value={mode}
        onChange={(v) => {
          setMode(v as typeof mode);
          setOffset(0);
          setQ("");
        }}
      >
        <option value="dossier">Dossier</option>
        <option value="group">Équipe ou site</option>
      </Select>
      <Field
        name="scope-query"
        label="Rechercher un périmètre autorisé"
        value={q}
        onChange={(v) => {
          setQ(v);
          setOffset(0);
        }}
      />
      <Select
        name="scope-id"
        label={
          mode === "dossier" ? "Dossier du filtre" : "Équipe ou site du filtre"
        }
        value={(mode === "dossier" ? query.dossierId : query.groupId) ?? ""}
        onChange={(v) =>
          onChange(
            mode === "dossier"
              ? { dossierId: v || undefined }
              : { groupId: v || undefined },
          )
        }
      >
        <option value="">Tous les périmètres autorisés</option>
        {(mode === "dossier" ? query.dossierId : query.groupId) &&
          !scope.items.some(
            (s) =>
              s.id === (mode === "dossier" ? query.dossierId : query.groupId),
          ) && (
            <option
              value={mode === "dossier" ? query.dossierId : query.groupId}
            >
              Périmètre sélectionné
            </option>
          )}
        {scope.items.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </Select>
      <div className="pagination">
        <Button
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 100))}
        >
          Périmètres précédents
        </Button>
        <span>{scope.total} périmètres autorisés</span>
        <Button
          disabled={offset + 100 >= scope.total}
          onClick={() => setOffset(offset + 100)}
        >
          Périmètres suivants
        </Button>
      </div>
      {query.kind === "tache" && (
        <Select
          name="filter-state"
          label="Étape filtrée"
          value={query.state ?? ""}
          onChange={(v) =>
            onChange({ state: (v || undefined) as RecordListQuery["state"] })
          }
        >
          <option value="">Toutes les étapes</option>
          <option value="a_faire">À faire</option>
          <option value="en_cours">En cours</option>
          <option value="terminee">Terminée</option>
        </Select>
      )}
      {query.kind === "obligation" && (
        <Select
          name="filter-preparation"
          label="Préparation filtrée"
          value={query.preparation ?? ""}
          onChange={(v) =>
            onChange({
              preparation: (v || undefined) as RecordListQuery["preparation"],
            })
          }
        >
          <option value="">Toutes les préparations</option>
          <option value="a_preparer">À préparer</option>
          <option value="en_cours">En cours</option>
          <option value="preparee">Préparée</option>
        </Select>
      )}
      {query.kind === "obligation" && (
        <Select
          name="filter-source"
          label="Origine des obligations"
          value={query.source ?? ""}
          onChange={(v) =>
            onChange({ source: (v || undefined) as RecordListQuery["source"] })
          }
        >
          <option value="">Toutes les origines</option>
          <option value="manuelle">Saisie manuelle</option>
          <option value="simulee">Simulation</option>
        </Select>
      )}
      <Button
        onClick={() =>
          onChange({
            from: undefined,
            to: undefined,
            dossierId: undefined,
            groupId: undefined,
            state: undefined,
            preparation: undefined,
            assigneeId: undefined,
            source: undefined,
          })
        }
      >
        Effacer les filtres de périmètre
      </Button>
    </fieldset>
  );
}
