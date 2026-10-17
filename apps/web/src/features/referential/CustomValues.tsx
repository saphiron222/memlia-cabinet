import { useEffect, useState } from "react";
import {
  CustomFieldListSchema,
  type CustomField,
  type CabinetRecord,
} from "@memlia/contracts";
import { request, useScope, message } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
export function useCustomFields(kind: CabinetRecord["kind"]) {
  const signal = useScope(),
    [fields, setFields] = useState<CustomField[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    void request("/administration/fields", CustomFieldListSchema, signal)
      .then((r) => setFields(r.items.filter((f) => f.kind === kind)))
      .catch((e) => {
        if (!signal.aborted) setError(message(e));
      });
  }, [kind]);
  return { fields, error };
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
