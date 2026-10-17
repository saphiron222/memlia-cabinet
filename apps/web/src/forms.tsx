import { Alert } from "./upstream/cal/Alert";
import { NativeSelect } from "./upstream/plane/controls";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { Input } from "./upstream/cal/Input";
export type Errors = Record<string, string>;
export function validationErrors(error: z.ZodError): Errors {
  return Object.fromEntries(
    error.issues.map((issue) => [
      String(
        issue.path.filter((p) => p !== "record" && p !== "data")[0] ?? "title",
      ),
      issue.code === "too_small"
        ? "Ce champ est requis ou trop court."
        : issue.code === "too_big"
          ? "Cette valeur est trop longue."
          : "Vérifiez le format de ce champ.",
    ]),
  );
}
export function ErrorSummary({
  errors,
  message,
}: {
  errors?: Errors;
  message?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [errors, message]);
  if (!message && !Object.keys(errors ?? {}).length) return null;
  return (
    <Alert
      severity="error"
      className="error-summary"
      role="alert"
      tabIndex={-1}
      ref={ref}
      title={message ?? "Vérifiez les champs du formulaire."}
      message={
        errors &&
        Object.keys(errors).length > 0 && (
          <ul>
            {Object.entries(errors).map(([field, error]) => (
              <li key={field}>
                <a
                  href={"#" + field}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(field)?.focus();
                  }}
                >
                  {fieldLabels[field] ?? "Champ à corriger"} : {error}
                </a>
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}
const fieldLabels: Record<string, string> = {
  "task-title": "Titre de la tâche",
  "task-dossier": "Dossier de la tâche",
  "task-date": "Échéance de la tâche",
  "task-tags": "Étiquettes",
  piece: "Fichier original",
  scope: "Dossier de la collecte",
  filename: "Nom de fichier",
  title: "Titre",
  name: "Nom complet",
  email: "Adresse email",
  password: "Mot de passe",
  siren: "SIREN",
  dueDate: "Échéance",
  amount: "Montant",
  nature: "Nature",
  period: "Période",
  dossierId: "Dossier lié",
  bootstrap: "Jeton local",
  checkLabel: "Élément de checklist",
  tags: "Étiquettes",
  phone: "Téléphone",
  legalForm: "Forme juridique",
};
export function Field({
  name,
  label,
  value,
  onChange,
  type = "text",
  errors = {},
  required = false,
  hint,
  disabled = false,
  onFocus,
  onBlur,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  errors?: Errors;
  required?: boolean;
  hint?: string;
  disabled?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <Input
        id={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-required={required}
        aria-invalid={!!errors[name]}
        aria-describedby={
          errors[name] ? name + "-error" : hint ? name + "-hint" : undefined
        }
        disabled={disabled}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      {hint && <small id={name + "-hint"}>{hint}</small>}
      {errors[name] && (
        <small className="field-error" id={name + "-error"}>
          {errors[name]}
        </small>
      )}
    </div>
  );
}
export function Select({
  name,
  label,
  value,
  onChange,
  children,
  disabled = false,
  errors = {},
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  errors?: Errors;
}) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <NativeSelect
        id={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={!!errors[name]}
        aria-describedby={errors[name] ? name + "-error" : undefined}
      >
        {children}
      </NativeSelect>
      {errors[name] && (
        <small className="field-error" id={name + "-error"}>
          {errors[name]}
        </small>
      )}
    </div>
  );
}

export function TagsField({
  tags,
  onChange,
  errors,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  errors: Errors;
}) {
  const [editing, setEditing] = useState(false),
    [text, setText] = useState("");
  return (
    <Field
      name="tags"
      label="Étiquettes"
      value={editing ? text : tags.join(", ")}
      onFocus={() => {
        setText(tags.join(", "));
        setEditing(true);
      }}
      onBlur={() => setEditing(false)}
      onChange={(value) => {
        setText(value);
        onChange(
          value
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        );
      }}
      hint="Séparées par des virgules."
      errors={errors}
    />
  );
}
