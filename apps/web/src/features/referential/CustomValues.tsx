import { useEffect, useState } from "react";
import {
  CustomFieldListSchema,
  type CustomField,
  type CabinetRecord,
} from "@memlia/contracts";
import { request, message, RequestError } from "../../api";
import { Button } from "@memlia/ui";
import { Field, Select, ErrorSummary } from "../../forms";
export function useCustomFields(kind: CabinetRecord["kind"]) {
  const [fields, setFields] = useState<CustomField[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setFields([]);
    void request(
      "/administration/fields",
      CustomFieldListSchema,
      controller.signal,
    )
      .then((r) => {
        if (!controller.signal.aborted)
          setFields(r.items.filter((f) => f.kind === kind));
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof RequestError && e.status === 403
              ? "Champs personnalisés : accès refusé."
              : "Champs personnalisés indisponibles : " + message(e),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [kind, revision]);
  return {
    fields,
    error,
    loading,
    retry: () => setRevision((value) => value + 1),
  };
}
export function CustomFieldsStatus({
  state,
}: {
  state: ReturnType<typeof useCustomFields>;
}) {
  if (state.loading)
    return <p role="status">Chargement des champs personnalisés…</p>;
  if (state.error)
    return (
      <div>
        <ErrorSummary message={state.error} />
        <Button onClick={state.retry}>
          Réessayer les champs personnalisés
        </Button>
      </div>
    );
  return state.fields.length ? null : (
    <p>Aucun champ personnalisé pour ce type de fiche.</p>
  );
}

export function CustomValues({
  fields,
  placement,
  values,
  onChange,
}: {
  fields: CustomField[];
  placement: CustomField["placement"];
  values: CabinetRecord["data"]["customFields"];
  onChange: (v: CabinetRecord["data"]["customFields"]) => void;
}) {
  return (
    <>
      {[placement].map(
        (placement) =>
          fields.some((f) => f.placement === placement) && (
            <fieldset key={placement}>
              <legend>
                Champs personnalisés ·{" "}
                {
                  {
                    header: "En-tête",
                    information: "Informations",
                    parameters: "Paramètres",
                  }[placement]
                }
              </legend>
              {fields
                .filter((f) => f.placement === placement)
                .map((f) => {
                  const v = values[f.id],
                    set = (value: string | boolean | null) =>
                      onChange({ ...values, [f.id]: value });
                  return f.type === "boolean" ? (
                    <Select
                      key={f.id}
                      name={f.id}
                      label={f.name}
                      value={v === null || v === undefined ? "" : String(v)}
                      onChange={(value) =>
                        set(value === "" ? null : value === "true")
                      }
                    >
                      <option value="">Inconnu</option>
                      <option value="true">Oui</option>
                      <option value="false">Non</option>
                    </Select>
                  ) : f.type === "choice" ? (
                    <Select
                      key={f.id}
                      name={f.id}
                      label={f.name}
                      value={typeof v === "string" ? v : ""}
                      onChange={(v) => set(v || null)}
                    >
                      <option value="">Inconnu</option>
                      {f.choices.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  ) : f.type === "long_text" ? (
                    <div className="field" key={f.id}>
                      <label htmlFor={f.id}>{f.name}</label>
                      <textarea
                        id={f.id}
                        maxLength={10000}
                        value={typeof v === "string" ? v : ""}
                        onChange={(e) => set(e.target.value || null)}
                      />
                    </div>
                  ) : (
                    <Field
                      key={f.id}
                      name={f.id}
                      label={f.name}
                      type={f.type === "date" ? "date" : "text"}
                      value={typeof v === "string" ? v : ""}
                      onChange={(value) => set(value === "" ? null : value)}
                      hint={
                        f.type === "number"
                          ? "Nombre exact, point décimal. Vide = inconnu, 0 = zéro confirmé."
                          : "Vide = inconnu."
                      }
                    />
                  );
                })}
            </fieldset>
          ),
      )}
    </>
  );
}
