import { useEffect, useState, type ReactNode } from "react";
import { z } from "zod";
import { Button, Checkbox } from "@memlia/ui";
import {
  ProductionModelSchema,
  RecordListSchema,
  CabinetRecordSchema,
  RelationshipPageSchema,
  RelationshipEntitySchema,
  DocumentListSchema,
  DocumentReferenceSchema,
  type RelationshipEntity,
  type RelationshipData,
  type CabinetRecord,
  type EvidenceSchema,
} from "@memlia/contracts";
import { Field, Select, ErrorSummary } from "../../forms";
import { NativeTextArea } from "../../upstream/plane/controls";
import { request, message, useScope } from "../../api";
export const kindLabels: Record<RelationshipData["kind"], string> = {
  prospect: "Prospect",
  pipeline: "Pipeline",
  mission: "Mission",
  onboarding_model: "Modèle d’accueil",
  onboarding: "Accueil client",
  identity: "Examen d’identité",
  lab_policy: "Politique de vigilance",
  lab: "Revue LAB",
};
export function Area({
  name,
  label,
  value,
  onChange,
  disabled = false,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <NativeTextArea
        id={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  );
}
export function Choice({
  name,
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Record<string, string>;
  disabled?: boolean;
}) {
  return (
    <Select
      name={name}
      label={label}
      value={value}
      onChange={onChange}
      disabled={disabled}
    >
      {Object.entries(options).map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </Select>
  );
}
export function Pager({
  offset,
  total,
  change,
  size = 50,
}: {
  offset: number;
  total: number;
  change: (n: number) => void;
  size?: number;
}) {
  return (
    <div className="actions">
      <Button
        disabled={!offset}
        onClick={() => change(Math.max(0, offset - size))}
      >
        Précédents
      </Button>
      <span>
        {total ? offset + 1 : 0}–{Math.min(offset + size, total)} / {total}
      </span>
      <Button
        disabled={offset + size >= total}
        onClick={() => change(offset + size)}
      >
        Suivants
      </Button>
    </div>
  );
}
export function RecordChoice({
  name,
  label,
  kind,
  value,
  onChange,
  disabled = false,
}: {
  name: string;
  label: string;
  kind: "contact" | "dossier";
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [q, Q] = useState(""),
    [offset, O] = useState(0),
    [items, I] = useState<CabinetRecord[]>([]),
    [chosen, C] = useState<CabinetRecord | null>(null),
    [total, T] = useState(0),
    [error, E] = useState("");
  useEffect(() => {
    const c = new AbortController();
    void request(
      "/records?" +
        new URLSearchParams({ kind, q, offset: String(offset), limit: "50" }),
      RecordListSchema,
      c.signal,
    )
      .then((r) => {
        I(r.items);
        T(r.total);
        E("");
      })
      .catch((e) => {
        if (!c.signal.aborted) E(message(e));
      });
    return () => c.abort();
  }, [kind, q, offset]);
  useEffect(() => {
    if (!value) {
      C(null);
      return;
    }
    const c = new AbortController();
    void request("/records/" + value, CabinetRecordSchema, c.signal)
      .then(C)
      .catch((e) => {
        if (!c.signal.aborted) {
          C(null);
          E(message(e));
        }
      });
    return () => c.abort();
  }, [value]);
  return (
    <div className="relationship-picker">
      <ErrorSummary message={error || undefined} />
      <Field
        name={name + "-search"}
        label={"Rechercher : " + label}
        value={q}
        onChange={(v) => {
          Q(v);
          O(0);
        }}
        disabled={disabled}
      />
      <Select
        name={name}
        label={label}
        value={value}
        onChange={onChange}
        disabled={disabled}
      >
        <option value="">Non renseigné</option>
        {value && !chosen && !items.some((i) => i.id === value) && (
          <option value={value}>Chargement du libellé…</option>
        )}
        {chosen && !items.some((i) => i.id === chosen.id) && (
          <option value={chosen.id}>{chosen.title}</option>
        )}
        {items.map((i) => (
          <option key={i.id} value={i.id}>
            {i.title}
          </option>
        ))}
      </Select>
      {!disabled && total > 50 && (
        <Pager offset={offset} total={total} change={O} />
      )}
    </div>
  );
}
export function ModelChoice({
  name,
  label,
  kind,
  value,
  onChange,
  disabled = false,
}: {
  name: string;
  label: string;
  kind: RelationshipData["kind"];
  value: string;
  onChange: (id: string, e: RelationshipEntity | null) => void;
  disabled?: boolean;
}) {
  const [q, Q] = useState(""),
    [offset, O] = useState(0),
    [items, I] = useState<RelationshipEntity[]>([]),
    [chosen, C] = useState<RelationshipEntity | null>(null),
    [total, T] = useState(0),
    [error, E] = useState("");
  useEffect(() => {
    const c = new AbortController();
    void request(
      "/relationship/entities?" +
        new URLSearchParams({
          kind,
          active: "true",
          q,
          offset: String(offset),
          limit: "50",
        }),
      RelationshipPageSchema,
      c.signal,
    )
      .then((r) => {
        I(r.items);
        T(r.total);
        E("");
      })
      .catch((e) => {
        if (!c.signal.aborted) E(message(e));
      });
    return () => c.abort();
  }, [kind, q, offset]);
  useEffect(() => {
    if (!value) {
      C(null);
      return;
    }
    const c = new AbortController();
    void request(
      "/relationship/entities/" + value,
      RelationshipEntitySchema,
      c.signal,
    )
      .then(C)
      .catch((e) => {
        if (!c.signal.aborted) E(message(e));
      });
    return () => c.abort();
  }, [value]);
  return (
    <div className="relationship-picker">
      <ErrorSummary message={error || undefined} />
      <Field
        name={name + "-search"}
        label={"Rechercher : " + label}
        value={q}
        onChange={(v) => {
          Q(v);
          O(0);
        }}
        disabled={disabled}
      />
      <Select
        name={name}
        label={label}
        value={value}
        onChange={(v) => onChange(v, items.find((i) => i.id === v) ?? chosen)}
        disabled={disabled}
      >
        <option value="">Choisir…</option>
        {chosen && !items.some((i) => i.id === chosen.id) && (
          <option value={chosen.id}>
            {"name" in chosen.data ? chosen.data.name : "Sélection conservée"}{" "}
            (historique)
          </option>
        )}
        {items.map((i) => (
          <option key={i.id} value={i.id}>
            {"name" in i.data ? i.data.name : i.id}
          </option>
        ))}
      </Select>
      {!disabled && total > 50 && (
        <Pager offset={offset} total={total} change={O} />
      )}
    </div>
  );
}
export function EvidenceEditor({
  dossierId,
  value,
  onChange,
  disabled = false,
}: {
  dossierId: string;
  value: z.infer<typeof EvidenceSchema>[];
  onChange: (v: z.infer<typeof EvidenceSchema>[]) => void;
  disabled?: boolean;
}) {
  const signal = useScope(),
    [q, Q] = useState(""),
    [offset, O] = useState(0),
    [docs, D] = useState<z.infer<typeof DocumentListSchema>>({
      items: [],
      total: 0,
    }),
    [selected, S] = useState(""),
    [error, E] = useState(""),
    [scope, Scope] = useState(""),
    [ref, Ref] = useState(""),
    [date, DateValue] = useState(""),
    [origin, Origin] =
      useState<z.infer<typeof EvidenceSchema>["origin"]>("manual"),
    [revision, Revision] = useState(0);
  useEffect(() => {
    if (!dossierId) return;
    const c = new AbortController();
    void request(
      "/documents?" +
        new URLSearchParams({
          dossierId,
          q,
          offset: String(offset),
          limit: "50",
        }),
      DocumentListSchema,
      c.signal,
    )
      .then(D)
      .catch((e) => {
        if (!c.signal.aborted) E(message(e));
      });
    return () => c.abort();
  }, [dossierId, q, offset, revision]);
  async function upload(file: File) {
    try {
      const form = new FormData();
      form.append(
        "metadata",
        JSON.stringify({
          operationId: crypto.randomUUID(),
          dossierId,
          filename: file.name,
          mediaType:
            file.type === "application/pdf"
              ? "application/pdf"
              : file.type === "text/plain"
                ? "text/plain"
                : "application/octet-stream",
          confidential: true,
          source: { kind: "manual", reference: "Examen humain", version: "1" },
        }),
      );
      form.append("file", file);
      const d = await request("/documents", DocumentReferenceSchema, signal, {
        method: "POST",
        body: form,
      });
      Revision((v) => v + 1);
      S(d.id);
    } catch (e) {
      E(message(e));
    }
  }
  return (
    <div className="relationship-evidence">
      <ErrorSummary message={error || undefined} />
      {value.map((p, index) => (
        <div className="relationship-proof" key={p.documentId + index}>
          <a href={"/api/v1/documents/" + p.documentId + "/download"}>
            Original v{p.version}
          </a>
          <span>
            {p.scope} · {p.acquiredOn} · {p.origin}
          </span>
          <Choice
            name={"proof-result-" + index}
            label="Résultat de l’examen"
            value={p.result}
            onChange={(v) =>
              onChange(
                value.map((x, i) =>
                  i === index ? { ...x, result: v as typeof x.result } : x,
                ),
              )
            }
            options={{
              to_review: "À examiner",
              examined: "Examiné humainement",
              insufficient: "Insuffisant",
            }}
            disabled={disabled}
          />
          {!disabled && (
            <Button
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              Retirer de cette révision
            </Button>
          )}
        </div>
      ))}
      {!disabled && dossierId && (
        <details>
          <summary>Ajouter un justificatif GED</summary>
          <div className="relationship-fields">
            <Field
              name="proof-search"
              label="Rechercher une pièce"
              value={q}
              onChange={(v) => {
                Q(v);
                O(0);
              }}
            />
            <Select
              name="proof-document"
              label="Original conservé"
              value={selected}
              onChange={S}
            >
              <option value="">Choisir…</option>
              {docs.items.map((d) => (
                <option value={d.id} key={d.id}>
                  {d.filename} · v{d.version}
                </option>
              ))}
            </Select>
            <Field
              name="proof-scope"
              label="Portée de l’examen"
              value={scope}
              onChange={Scope}
            />
            <Field
              name="proof-reference"
              label="Référence source"
              value={ref}
              onChange={Ref}
            />
            <Field
              name="proof-date"
              label="Date d’acquisition"
              type="date"
              value={date}
              onChange={DateValue}
            />
            <Choice
              name="proof-origin"
              label="Origine documentaire"
              value={origin}
              onChange={(v) => Origin(v as typeof origin)}
              options={{
                manual: "Saisie du cabinet",
                client: "Client",
                import: "Import",
                registry: "Registre",
              }}
            />
          </div>
          <Pager offset={offset} total={docs.total} change={O} />
          <label className="field">
            Conserver un nouvel original
            <input
              type="file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
          </label>
          <Button
            disabled={!selected || !scope || !ref || !date}
            onClick={() => {
              const doc = docs.items.find((d) => d.id === selected);
              if (!doc) return;
              onChange([
                ...value,
                {
                  documentId: doc.id,
                  version: doc.version,
                  sha256: doc.sha256,
                  origin,
                  reference: ref,
                  acquiredOn: date,
                  scope,
                  result: "to_review",
                },
              ]);
              S("");
            }}
          >
            Joindre à l’examen
          </Button>
        </details>
      )}
    </div>
  );
}
export function FormActions({
  busy,
  readonly = false,
  onCancel,
}: {
  busy: boolean;
  readonly?: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="relationship-form-actions">
      {readonly ? (
        <span>Lecture seule</span>
      ) : (
        <Button type="submit" variant="solid" disabled={busy}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </Button>
      )}
      <Button onClick={onCancel}>Fermer</Button>
    </div>
  );
}

export function Check({
  label,
  hideLabel = false,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  hideLabel?: boolean;
  checked: boolean;
  onChange: (e: { target: { checked: boolean } }) => void;
  disabled?: boolean;
}) {
  return (
    <label className="relationship-check">
      <Checkbox
        checked={checked}
        onCheckedChange={(checked) => onChange({ target: { checked } })}
        disabled={disabled}
        aria-label={label}
      />
      {!hideLabel && <span>{label}</span>}
    </label>
  );
}

export function StageTypeChoice({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: z.infer<typeof ProductionModelSchema> | null) => void;
}) {
  const [models, M] = useState<z.infer<typeof ProductionModelSchema>[]>([]),
    [after, A] = useState<string | null>(null),
    [cursor, C] = useState<string | null>(null),
    [error, E] = useState("");
  useEffect(() => {
    const c = new AbortController();
    void request(
      "/production/models" + (cursor ? "?after=" + cursor : ""),
      z.object({
        items: z.array(ProductionModelSchema),
        nextCursor: z.string().nullable(),
      }),
      c.signal,
    )
      .then((r) => {
        M(r.items.filter((m) => m.model.kind === "stage_type"));
        A(r.nextCursor);
      })
      .catch((e) => {
        if (!c.signal.aborted) E(message(e));
      });
    return () => c.abort();
  }, [cursor]);
  return (
    <div className="relationship-picker">
      <ErrorSummary message={error || undefined} />
      <Select
        name="canonical-stage-type"
        label="Type de statut réutilisable"
        value={value}
        onChange={(id) => onChange(models.find((m) => m.id === id) ?? null)}
      >
        <option value="">Statuts propres à cette étape</option>
        {value && !models.some((m) => m.id === value) && (
          <option value={value}>Type conservé dans cette version</option>
        )}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.model.name} · v{m.version}
          </option>
        ))}
      </Select>
      <Button disabled={!cursor} onClick={() => C(null)}>
        Première page
      </Button>
      <Button disabled={!after} onClick={() => C(after)}>
        Types suivants
      </Button>
      <a href="#production">Configurer les types communs dans Production</a>
    </div>
  );
}
export function useRelationshipTab(
  key: string,
  fallback: string,
): [string, (value: string) => void] {
  const read = () =>
    new URLSearchParams(location.hash.split("?")[1]).get(key) ?? fallback;
  const [value, V] = useState(read);
  useEffect(() => {
    const change = () => V(read());
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
  }, [key]);
  return [
    value,
    (v) => {
      const p = new URLSearchParams(location.hash.split("?")[1]);
      p.set(key, v);
      history.replaceState(null, "", "#relationship?" + p);
      V(v);
    },
  ];
}

export function PartyChoice({
  name,
  label,
  kind,
  value,
  onChange,
}: {
  name: string;
  label: string;
  kind: "people" | "teams";
  value: string;
  onChange: (v: string) => void;
}) {
  const [q, Q] = useState(""),
    [offset, O] = useState(0),
    [items, I] = useState<{ id: string; name: string }[]>([]),
    [selected, S] = useState<{ id: string; name: string } | null>(null),
    [total, T] = useState(0),
    [error, E] = useState("");
  const schema = z.object({
    items: z.array(z.object({ id: z.string(), name: z.string() })),
    total: z.number(),
  });
  useEffect(() => {
    const c = new AbortController();
    void request(
      `/relationship/catalog/${kind}?q=${encodeURIComponent(q)}&offset=${offset}`,
      schema,
      c.signal,
    )
      .then((r) => {
        I(r.items);
        T(r.total);
      })
      .catch((e) => {
        if (!c.signal.aborted) E(message(e));
      });
    return () => c.abort();
  }, [kind, q, offset]);
  useEffect(() => {
    if (!value) {
      S(null);
      return;
    }
    const c = new AbortController();
    void request(`/relationship/catalog/${kind}?id=${value}`, schema, c.signal)
      .then((r) => S(r.items[0] ?? null))
      .catch((e) => {
        if (!c.signal.aborted) E(message(e));
      });
    return () => c.abort();
  }, [kind, value]);
  return (
    <div className="relationship-picker">
      <ErrorSummary message={error || undefined} />
      <Field
        name={name + "-search"}
        label={"Rechercher : " + label}
        value={q}
        onChange={(v) => {
          Q(v);
          O(0);
        }}
      />
      <Select name={name} label={label} value={value} onChange={onChange}>
        <option value="">Aucun</option>
        {selected && !items.some((x) => x.id === selected.id) && (
          <option value={selected.id}>{selected.name}</option>
        )}
        {items.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </Select>
      <Pager size={100} offset={offset} total={total} change={O} />
    </div>
  );
}
export function Parties({
  kind,
  values,
  onChange,
}: {
  kind: "people" | "teams";
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const label = kind === "people" ? "Collaborateur" : "Équipe";
  return (
    <div className="relationship-stack">
      {values.map((id, index) => (
        <div key={id}>
          <PartyChoice
            kind={kind}
            name={kind + index}
            label={label + " " + (index + 1)}
            value={id}
            onChange={(v) =>
              onChange(
                v
                  ? [...new Set(values.map((x) => (x === id ? v : x)))]
                  : values.filter((x) => x !== id),
              )
            }
          />
        </div>
      ))}
      <PartyChoice
        kind={kind}
        name={kind + "-add"}
        label={
          kind === "people" ? "Ajouter un collaborateur" : "Ajouter une équipe"
        }
        value=""
        onChange={(v) => {
          if (v && !values.includes(v)) onChange([...values, v]);
        }}
      />
    </div>
  );
}
