import { NativeTextArea } from "../../upstream/plane/controls";
import { useEffect, useState } from "react";
import { Button } from "@memlia/ui";
import {
  CustomFieldSchema,
  CustomFieldListSchema,
  CustomFieldValuesSchema,
  type CustomField,
} from "@memlia/contracts";
import { z } from "zod";
import { request, useScope, message } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
const blank = {
  kind: "dossier" as const,
  name: "",
  type: "text" as const,
  placement: "information" as const,
  choices: [],
};
export function CustomFieldAdministration() {
  const signal = useScope(),
    [fields, setFields] = useState<CustomField[]>([]),
    [draft, setDraft] = useState<Partial<CustomField>>(blank),
    [choices, setChoices] = useState(""),
    [values, setValues] = useState<z.infer<typeof CustomFieldValuesSchema>>({
      items: [],
      total: 0,
      offset: 0,
    }),
    [migration, setMigration] = useState<
      Record<string, { value: string; expectedVersion: number }>
    >({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  async function load() {
    try {
      setFields(
        (await request("/administration/fields", CustomFieldListSchema, signal))
          .items,
      );
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function pageValues(id: string, offset: number) {
    try {
      setValues(
        await request(
          `/administration/fields/${id}/values?offset=${offset}`,
          CustomFieldValuesSchema,
          signal,
        ),
      );
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    }
  }
  async function select(f: CustomField) {
    setDraft(f);
    setChoices(f.choices.join("\n"));
    setMigration({});
    setError("");
    try {
      setValues(
        await request(
          `/administration/fields/${f.id}/values`,
          CustomFieldValuesSchema,
          signal,
        ),
      );
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const entries = Object.entries(migration).map(([recordId, selected]) => ({
        recordId,
        expectedVersion: selected.expectedVersion,
        value:
          selected.value === ""
            ? null
            : draft.type === "boolean"
              ? selected.value === "true"
              : selected.value,
      }));
      const result = await request(
        `/administration/fields${draft.id ? "/" + draft.id : ""}`,
        CustomFieldSchema,
        signal,
        {
          method: draft.id ? "PUT" : "POST",
          body: JSON.stringify({
            ...draft,
            id: undefined,
            version: undefined,
            expectedVersion: draft.version,
            operationId: crypto.randomUUID(),
            choices: choices
              .split("\n")
              .map((v) => v.trim())
              .filter(Boolean),
            ...(entries.length ? { migration: entries } : {}),
          }),
        },
      );
      await load();
      await select(result);
      setNotice(
        "Champ enregistré ; les identités et les valeurs compatibles sont conservées.",
      );
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <section>
      <h2>Champs personnalisés</h2>
      <ErrorSummary message={error || undefined} />
      {notice && <p role="status">{notice}</p>}
      <div className="admin-layout">
        <div>
          {fields.map((f) => (
            <Button key={f.id} onClick={() => void select(f)}>
              {f.name} · {f.kind}
            </Button>
          ))}
          <Button
            onClick={() => {
              setDraft(blank);
              setChoices("");
              setValues({ items: [], total: 0, offset: 0 });
              setMigration({});
            }}
          >
            Nouveau champ
          </Button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field
            name="field-name"
            label="Libellé du champ"
            value={draft.name ?? ""}
            onChange={(name) => setDraft({ ...draft, name })}
          />
          <Select
            name="field-kind"
            label="Objet concerné"
            value={draft.kind ?? "dossier"}
            disabled={!!draft.id}
            onChange={(kind) =>
              setDraft({ ...draft, kind: kind as CustomField["kind"] })
            }
          >
            {["dossier", "contact", "tache", "obligation"].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </Select>
          <Select
            name="field-type"
            label="Type de valeur"
            value={draft.type ?? "text"}
            onChange={(type) =>
              setDraft({ ...draft, type: type as CustomField["type"] })
            }
          >
            {[
              ["text", "Texte court"],
              ["long_text", "Texte long"],
              ["number", "Nombre exact"],
              ["date", "Date civile"],
              ["boolean", "Oui / non / inconnu"],
              ["choice", "Liste de choix"],
            ].map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </Select>
          <Select
            name="field-placement"
            label="Emplacement"
            value={draft.placement ?? "information"}
            onChange={(placement) =>
              setDraft({
                ...draft,
                placement: placement as CustomField["placement"],
              })
            }
          >
            <option value="header">En-tête</option>
            <option value="information">Informations</option>
            <option value="parameters">Paramètres</option>
          </Select>
          {draft.type === "choice" && (
            <label>
              Choix (un par ligne)
              <NativeTextArea
                aria-label="Choix (un par ligne)"
                value={choices}
                onChange={(e) => setChoices(e.target.value)}
              />
            </label>
          )}
          {!!values.total && (
            <fieldset>
              <legend>Migration explicite des valeurs</legend>
              <p>
                Ne cochez que les valeurs à convertir. Une valeur incompatible
                bloque tout changement de type.
              </p>
              {values.items.map((v) => (
                <div key={v.recordId}>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={Object.hasOwn(migration, v.recordId)}
                      onChange={(e) =>
                        setMigration((previous) => {
                          const next = { ...previous };
                          if (e.target.checked)
                            next[v.recordId] = {
                              value: v.value === null ? "" : String(v.value),
                              expectedVersion: v.expectedVersion,
                            };
                          else delete next[v.recordId];
                          return next;
                        })
                      }
                    />
                    Convertir {v.title} · actuel :{" "}
                    {v.value === null ? "inconnu" : String(v.value)}
                  </label>
                  {Object.hasOwn(migration, v.recordId) &&
                    (draft.type === "boolean" ? (
                      <Select
                        name={v.recordId}
                        label={`Nouvelle valeur pour ${v.title}`}
                        value={migration[v.recordId]!.value}
                        onChange={(value) =>
                          setMigration({
                            ...migration,
                            [v.recordId]: {
                              value,
                              expectedVersion:
                                migration[v.recordId]!.expectedVersion,
                            },
                          })
                        }
                      >
                        <option value="">Inconnu</option>
                        <option value="true">Oui</option>
                        <option value="false">Non</option>
                      </Select>
                    ) : (
                      <Field
                        name={v.recordId}
                        label={`Nouvelle valeur pour ${v.title}`}
                        value={migration[v.recordId]!.value}
                        onChange={(value) =>
                          setMigration({
                            ...migration,
                            [v.recordId]: {
                              value,
                              expectedVersion:
                                migration[v.recordId]!.expectedVersion,
                            },
                          })
                        }
                      />
                    ))}
                </div>
              ))}
              <p>
                {Object.keys(migration).length} conversions retenues sur{" "}
                {values.total} valeurs autorisées. Les choix sont conservés
                entre les pages jusqu’à l’enregistrement.
              </p>
              <div className="pagination">
                <Button
                  disabled={busy || !values.offset}
                  onClick={() =>
                    void pageValues(draft.id!, Math.max(0, values.offset - 200))
                  }
                >
                  Valeurs précédentes
                </Button>
                <span>
                  {values.offset + 1}–
                  {Math.min(values.offset + 200, values.total)}
                </span>
                <Button
                  disabled={busy || values.offset + 200 >= values.total}
                  onClick={() =>
                    void pageValues(draft.id!, values.offset + 200)
                  }
                >
                  Valeurs suivantes
                </Button>
              </div>
            </fieldset>
          )}
          <Button type="submit" loading={busy}>
            Enregistrer le champ
          </Button>
        </form>
      </div>
    </section>
  );
}
