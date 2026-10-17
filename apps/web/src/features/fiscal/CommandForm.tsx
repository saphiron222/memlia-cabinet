import { useEffect, useState } from "react";
import { Button } from "@memlia/ui";
import {
  FiscalEventSchema,
  FiscalResponsiblesSchema,
  DocumentListSchema,
  RecordListSchema,
  type FiscalDetail,
  type FiscalEvent,
} from "@memlia/contracts";
import { Field, Select, ErrorSummary } from "../../forms";
import { request, message } from "../../api";
import { eventLabels, labelValue } from "./labels";
type Value =
  | string
  | number
  | boolean
  | null
  | Value[]
  | { [key: string]: Value };
const provenance = () => ({
  kind: "manual",
  source: "Saisie cabinet",
  account: "cabinet",
  reference: "",
  version: "1",
  observedAt: new Date().toISOString(),
  sourceUpdatedAt: null,
  coverage: "unknown",
  rawState: "",
  rawAmount: null,
  amountPrecision: "unknown",
  rawSourceUpdatedAt: null,
  sourceTimeZone: null,
  documentIds: [],
});
const beneficiary = () => ({
  beneficiary: {
    identity: null,
    address: null,
    type: "personne",
    siret: null,
    birthDate: null,
  },
  category: null,
  gross: null,
  withheld: null,
});
function template(kind: string, detail: FiscalDetail): Record<string, Value> {
  const p = provenance(),
    date = new Date().toISOString().slice(0, 10);
  const items: Record<string, Record<string, Value>> = {
    client_validation: { state: "requested", reason: "", provenance: p },
    responsibility: {
      responsibleIds: detail.record.data.fiscal!.responsibleIds,
      reason: "",
    },
    revision: { amount: detail.situation.amount, reason: "" },
    attempt: {
      id: crypto.randomUUID(),
      declarationVersion: detail.situation.declarationVersion,
      recipients: [""],
      productionReference: "",
      provenance: p,
    },
    return: {
      attemptId: "",
      target: "recipient",
      recipient: null,
      state: "pending",
      reason: "",
      provenance: p,
    },
    debt: {
      id: crypto.randomUUID(),
      amount: null,
      sourceBalance: null,
      tax: detail.record.data.nature,
      period: detail.record.data.period,
      reference: "",
      provenance: p,
    },
    payment: {
      id: crypto.randomUUID(),
      debtId: null,
      amount: "",
      date,
      state: "unknown",
      reason: "",
      provenance: p,
    },
    apurement: {
      id: crypto.randomUUID(),
      debtId: "",
      paymentId: null,
      amount: "",
      date,
      nature: "remission",
      reason: "",
      confirmed: false,
      provenance: p,
    },
    schedule: {
      debtId: "",
      instalments: [{ date, amount: "" }],
      decision: "requested",
      reason: "",
      provenance: p,
    },
    bank_candidate: {
      id: crypto.randomUUID(),
      debtId: null,
      accountPresent: false,
      pdfParsed: false,
      iban: "absent",
      orderDate: null,
      evaluatedOn: date,
      rule: { id: "", version: "1", datedOn: date, maximumMonths: 12 },
      confidence: "low",
      provenance: p,
    },
    manual_mark: {
      id: crypto.randomUUID(),
      state: "done",
      reason: "",
      documentIds: [],
    },
    cancel_mark: { markId: "", reason: "" },
    classification: { state: "active", reason: "" },
    observation: {
      id: crypto.randomUUID(),
      field: "amount",
      value: null,
      provenance: p,
    },
    resolution: {
      field: "amount",
      observationIds: [],
      value: null,
      reason: "",
    },
    source_freshness: { provenance: p, policy: null },
    income: { coverage: "partial", lines: [beneficiary()], provenance: p },
    ifu_prepare: {
      sourceIds: [],
      payer: { identity: null, address: null, siret: null },
      rule: {
        id: "compatible-income-sum",
        version: "1",
        campaign: detail.record.data.fiscal!.period.campaign,
        source: "",
        datedOn: date,
        status: "draft",
      },
    },
    deadlines: {
      observed: null,
      internalTarget: null,
      campaignDate: null,
      provenance: p,
    },
    notice: {
      id: crypto.randomUUID(),
      reference: "",
      role: "",
      year: Number(detail.record.data.fiscal!.period.start.slice(0, 4)),
      establishmentId: detail.record.data.fiscal!.establishmentId,
      properties: [],
      municipalities: [],
      amount: null,
      dueDate: null,
      directDebit: "unknown",
      originalId: null,
      suiteIds: [],
      expectedSuites: 0,
      provenance: p,
    },
    evidence: { documentIds: [], purpose: "support", reason: "" },
    link_task: { taskId: "", reason: "" },
  };
  return { kind, ...items[kind] };
}
const labels: Record<string, string> = {
  responsibleIds: "Intervenants et responsables",
  rawAmount: "Montant brut fourni par la source",
  amountPrecision: "Précision du montant source",
  rawSourceUpdatedAt: "Date brute de mise à jour source",
  sourceTimeZone: "Fuseau horaire de la source",
  beneficiaryLine: "Revenu individuel",
  instalment: "Échéance",
  amount: "Montant",
  reason: "Motif de l’action",
  provenance: "Origine de l’observation",
  source: "Source",
  account: "Compte de la source",
  reference: "Référence externe",
  version: "Version de la source ou règle",
  observedAt: "Date et heure de collecte",
  sourceUpdatedAt: "Date et heure réelle de mise à jour source",
  coverage: "Couverture",
  rawState: "État brut de la source",
  documentIds: "Pièces justificatives",
  declarationVersion: "Version de déclaration déposée",
  recipients: "Destinataires attendus",
  productionReference: "Référence de production",
  attemptId: "Tentative concernée",
  target: "Origine du retour",
  recipient: "Destinataire du retour",
  state: "État constaté",
  debtId: "Dette concernée",
  sourceBalance: "Solde observé dans la source",
  tax: "Impôt",
  period: "Période",
  paymentId: "Paiement concerné",
  date: "Date",
  nature: "Nature",
  confirmed: "Apurement confirmé",
  instalments: "Échéances de l’échéancier",
  decision: "Décision",
  accountPresent: "Compte bancaire présent",
  pdfParsed: "PDF effectivement analysé",
  iban: "Correspondance IBAN",
  orderDate: "Date de l’ordre",
  evaluatedOn: "Date d’évaluation",
  rule: "Règle datée",
  datedOn: "Date de la règle",
  maximumMonths: "Ancienneté maximale en mois",
  confidence: "Confiance",
  markId: "Mention à annuler",
  field: "Champ comparé",
  value: "Valeur retenue ou observée",
  observationIds: "Observations prises en compte",
  policy: "Politique opérationnelle de fraîcheur",
  maximumAgeHours: "Ancienneté maximale en heures",
  validFrom: "Applicable du",
  validTo: "Applicable au",
  lines: "Lignes individuelles",
  beneficiary: "Bénéficiaire",
  identity: "Identité",
  address: "Adresse",
  type: "Nature du bénéficiaire",
  siret: "SIRET",
  birthDate: "Naissance",
  category: "Catégorie de revenu",
  gross: "Montant brut",
  withheld: "Prélèvement constaté",
  sourceIds: "RCM sources de l’année",
  payer: "Payeur",
  campaign: "Campagne",
  status: "Statut de la spécification",
  observed: "Échéance individuelle observée",
  internalTarget: "Cible interne",
  campaignDate: "Échéance de campagne sourcée",
  role: "Rôle",
  year: "Année de l’avis",
  establishmentId: "Établissement de l’avis",
  properties: "Biens concernés",
  municipalities: "Communes",
  dueDate: "Échéance de l’avis",
  directDebit: "Prélèvement automatique",
  originalId: "Original principal",
  suiteIds: "Suites de l’avis",
  expectedSuites: "Nombre de suites attendues",
  purpose: "Usage de la pièce",
  taskId: "Tâche liée",
  kind: "Type de source",
  id: "Identifiant de la règle",
};
function enums(kind: string, key: string, path: string): string[] | undefined {
  if (kind === "client_validation" && key === "state")
    return ["requested", "accepted", "rejected"];
  if (path.endsWith("provenance.kind"))
    return ["manual", "simulated", "supplier"];
  const common: Record<string, string[]> = {
    amountPrecision: ["exact", "approximate", "unknown"],
    coverage:
      kind === "income" && !path.includes("provenance")
        ? ["complete", "partial", "confirmed_zero"]
        : [
            "complete",
            "partial",
            "unknown",
            "unavailable",
            "unauthorized",
            "not_published",
          ],
    target: ["platform", "recipient"],
    iban: ["absent", "exact", "masked_unique", "masked_ambiguous"],
    confidence: ["low", "medium", "high"],
    field: [
      "amount",
      "gross",
      "net",
      "estimate",
      "referenceTurnover",
      "regime",
      "observedDueDate",
    ],
    type: ["personne", "organisation"],
    status: ["draft", "released"],
    directDebit: ["active", "inactive", "unknown"],
    purpose: ["prefilled", "receipt", "support", "generated_preparation"],
    decision: ["requested", "accepted", "rejected"],
  };
  if (key === "state")
    return kind === "payment"
      ? [
          "order",
          "validated",
          "presented",
          "debit_confirmed",
          "settled_source",
          "unknown",
          "cancelled",
        ]
      : kind === "return"
        ? ["pending", "accepted", "rejected"]
        : kind === "manual_mark"
          ? ["done", "client_validated"]
          : ["active", "archived", "hidden", "nil", "not_applicable"];
  if (key === "nature" && kind === "apurement")
    return ["payment", "remission", "relief", "allocation"];
  return common[key];
}
export function CommandForm({
  detail,
  busy,
  disabled,
  onCommand,
  allowedKinds,
}: {
  allowedKinds: FiscalEvent["kind"][];
  detail: FiscalDetail;
  busy: boolean;
  disabled: boolean;
  onCommand: (event: FiscalEvent) => Promise<void>;
}) {
  const [responsibles, setResponsibles] = useState<
    { id: string; title: string }[]
  >([]);
  const [kind, setKind] = useState<string>(allowedKinds[0]!),
    [value, setValue] = useState(() => template(allowedKinds[0]!, detail)),
    [error, setError] = useState(""),
    [q, setQ] = useState(""),
    [offset, setOffset] = useState(0),
    [choices, setChoices] = useState<{
      documents: { id: string; title: string }[];
      records: { id: string; title: string; kind: string; nature?: string }[];
      more: boolean;
    }>({ documents: [], records: [], more: false });
  useEffect(() => {
    const ctrl = new AbortController();
    void Promise.all([
      request(
        `/documents?dossierId=${detail.record.dossierId}&q=${encodeURIComponent(q)}&offset=${offset}&limit=100`,
        DocumentListSchema,
        ctrl.signal,
      ),
      request(
        `/records?dossierId=${detail.record.dossierId}&q=${encodeURIComponent(q)}&offset=${offset}&limit=100`,
        RecordListSchema,
        ctrl.signal,
      ),
    ])
      .then(([docs, recs]) => {
        setChoices({
          documents: docs.items.map((d) => ({
            id: d.id,
            title: `${d.filename} · version ${d.version} · ${d.availability}`,
          })),
          records: recs.items.map((r) => ({
            id: r.id,
            title: r.title,
            kind: r.kind,
            nature: r.kind === "obligation" ? r.data.nature : undefined,
          })),
          more: offset + 100 < Math.max(docs.total, recs.total),
        });
        setError("");
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(message(e));
      });
    return () => ctrl.abort();
  }, [detail.record.id, q, offset]);
  useEffect(() => {
    if (!detail.capabilities.actions.includes("assign")) return;
    const ctrl = new AbortController();
    void request(
      `/fiscal/${detail.record.id}/responsibles?q=${encodeURIComponent(q)}&offset=${offset}`,
      FiscalResponsiblesSchema,
      ctrl.signal,
    )
      .then((r) =>
        setResponsibles(r.items.map((u) => ({ id: u.id, title: u.name }))),
      )
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(message(e));
      });
    return () => ctrl.abort();
  }, [detail.record.id, q, offset]);
  function render(
    v: Value,
    key: string,
    path: string,
    change: (next: Value) => void,
  ): React.ReactNode {
    const label =
      kind === "revision" && key === "amount"
        ? "Montant de la révision"
        : (labels[key] ?? key);
    if ((key === "kind" && path === "kind") || (key === "id" && path === "id"))
      return null;
    if (key === "policy" && v === null)
      return (
        <Button
          type="button"
          onClick={() =>
            change({
              id: "",
              version: "1",
              source: "",
              maximumAgeHours: 0,
              validFrom: "",
              validTo: "",
              reason: "",
            })
          }
        >
          Définir une politique datée
        </Button>
      );
    if (Array.isArray(v)) {
      const relation =
        key === "responsibleIds"
          ? responsibles
          : key === "documentIds" || key === "suiteIds"
            ? choices.documents
            : key === "sourceIds"
              ? choices.records.filter((r) => r.nature === "RCM_2777")
              : key === "observationIds"
                ? detail.timeline
                    .filter(
                      (e) =>
                        e.event.kind === "observation" ||
                        e.event.kind === "revision",
                    )
                    .map((e) => ({
                      id: e.event.kind === "observation" ? e.event.id : e.id,
                      title: `${labelValue(e.event.kind === "observation" ? e.event.field : "amount")} · ${e.at}`,
                    }))
                : null;
      return (
        <fieldset key={path}>
          <legend>{label}</legend>
          {relation ? (
            <>
              {relation.map((o) => (
                <label key={o.id} className="check">
                  <input
                    type="checkbox"
                    checked={v.includes(o.id)}
                    onChange={(e) =>
                      change(
                        e.target.checked
                          ? [...v, o.id]
                          : v.filter((id) => id !== o.id),
                      )
                    }
                  />
                  {o.title}
                </label>
              ))}
              {v
                .filter((id) => !relation.some((o) => o.id === id))
                .map((id) => (
                  <label key={String(id)} className="check">
                    <input
                      type="checkbox"
                      checked
                      onChange={() => change(v.filter((i) => i !== id))}
                    />
                    Pièce ou source sélectionnée · {String(id)}
                  </label>
                ))}
            </>
          ) : (
            <>
              {v.map((item, i) => (
                <div key={i}>
                  {render(
                    item,
                    key === "lines"
                      ? "beneficiaryLine"
                      : key === "instalments"
                        ? "instalment"
                        : key,
                    `${path}.${i}`,
                    (next) => change(v.map((old, j) => (j === i ? next : old))),
                  )}
                  <Button
                    type="button"
                    onClick={() => change(v.filter((_, j) => j !== i))}
                  >
                    Retirer la ligne {i + 1}
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                onClick={() =>
                  change([
                    ...v,
                    key === "lines"
                      ? beneficiary()
                      : key === "instalments"
                        ? { date: "", amount: "" }
                        : "",
                  ])
                }
              >
                Ajouter {label.toLowerCase()}
              </Button>
            </>
          )}
        </fieldset>
      );
    }
    if (v !== null && typeof v === "object")
      return (
        <fieldset key={path}>
          <legend>{label}</legend>
          {Object.entries(v).map(([k, x]) => (
            <div key={k}>
              {render(x, k, `${path}.${k}`, (next) =>
                change({ ...v, [k]: next }),
              )}
            </div>
          ))}
          {key === "policy" && (
            <Button type="button" onClick={() => change(null)}>
              Ne pas appliquer de politique
            </Button>
          )}
        </fieldset>
      );
    if (typeof v === "boolean")
      return (
        <label className="check">
          <input
            type="checkbox"
            checked={v}
            onChange={(e) => change(e.target.checked)}
          />
          {label}
        </label>
      );
    const options = enums(kind, key, path);
    if (options)
      return (
        <Select
          name={`action-${path}`}
          label={label}
          value={String(v ?? "")}
          onChange={change}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {labelValue(o)}
            </option>
          ))}
        </Select>
      );
    let relation: { id: string; title: string }[] | null = null;
    if (key === "attemptId")
      relation = detail.situation.attempts.map((a) => ({
        id: a.id,
        title: `Version ${a.declarationVersion} · ${a.id}`,
      }));
    if (key === "debtId")
      relation = detail.timeline
        .filter((e) => e.event.kind === "debt")
        .map((e) => ({
          id: (e.event as Extract<FiscalEvent, { kind: "debt" }>).id,
          title: (e.event as Extract<FiscalEvent, { kind: "debt" }>).reference,
        }));
    if (key === "paymentId")
      relation = detail.timeline
        .filter((e) => e.event.kind === "payment")
        .map((e) => ({
          id: (e.event as Extract<FiscalEvent, { kind: "payment" }>).id,
          title: `${(e.event as Extract<FiscalEvent, { kind: "payment" }>).amount} · ${e.at}`,
        }));
    if (key === "markId")
      relation = detail.situation.manualMarks
        .filter((m) => !m.cancelled)
        .map((m) => ({
          id: m.id,
          title: labelValue(m.state) + " · " + m.reason,
        }));
    if (key === "originalId") relation = choices.documents;
    if (key === "taskId")
      relation = choices.records.filter((r) => r.kind === "tache");
    if (relation)
      return (
        <Select
          name={`action-${path}`}
          label={label}
          value={String(v ?? "")}
          onChange={(next) => change(next || null)}
        >
          <option value="">Non renseigné</option>
          {[...new Map(relation.map((o) => [o.id, o])).values()].map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
        </Select>
      );
    if (["observedAt", "sourceUpdatedAt"].includes(key)) {
      const instant = v ? new Date(String(v)) : null;
      const local = instant
        ? new Date(instant.getTime() - instant.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16)
        : "";
      return (
        <Field
          name={`action-${path}`}
          label={label}
          value={local}
          type="datetime-local"
          hint={`Heure de votre poste (${Intl.DateTimeFormat().resolvedOptions().timeZone}). Laisser vide si la date source est inconnue.`}
          onChange={(next) =>
            change(next ? new Date(next).toISOString() : null)
          }
        />
      );
    }
    const date =
      /^(date|birthDate|orderDate|evaluatedOn|datedOn|validFrom|validTo|observed|internalTarget|campaignDate|dueDate)$/.test(
        key,
      );
    return (
      <Field
        name={`action-${path}`}
        label={label}
        value={String(v ?? "")}
        type={typeof v === "number" ? "number" : date ? "date" : "text"}
        onChange={(next) =>
          change(
            typeof v === "number" ? Number(next) : next === "" ? null : next,
          )
        }
        disabled={kind === "ifu_prepare" && ["id", "version"].includes(key)}
        hint={
          v === null ? "Non renseigné : inconnu, distinct de zéro." : undefined
        }
      />
    );
  }
  async function submit() {
    setError("");
    const parsed = FiscalEventSchema.safeParse(value);
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map(
            (i) =>
              `${i.path.map((p) => labels[String(p)] ?? p).join(" / ")} : ${i.message}`,
          )
          .join(" · "),
      );
      return;
    }
    await onCommand(parsed.data);
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p>
        Les dépôts, envois et paiements effectifs restent réalisés et validés
        par le cabinet. Cette fiche conserve leurs observations et
        justificatifs.
      </p>
      <ErrorSummary message={error || undefined} />
      {allowedKinds.length > 1 && (
        <Select
          name="fiscal-action"
          label="Action fiscale"
          value={kind}
          onChange={(next) => {
            setKind(next);
            setValue(template(next, detail));
            setError("");
          }}
        >
          {allowedKinds.map((k) => (
            <option key={k} value={k}>
              {eventLabels[k as FiscalEvent["kind"]]}
            </option>
          ))}
        </Select>
      )}
      <fieldset
        disabled={
          disabled ||
          busy ||
          !detail.capabilities.actions.includes(
            kind === "attempt"
              ? "transmit"
              : kind === "responsibility"
                ? "assign"
                : "update",
          )
        }
      >
        {Object.entries(value).map(([key, v]) => (
          <div key={key}>
            {render(v, key, key, (next) => setValue({ ...value, [key]: next }))}
          </div>
        ))}
        <details>
          <summary>Rechercher les pièces et objets à lier</summary>
          <Field
            name="fiscal-link-search"
            label="Rechercher une pièce ou un objet du dossier"
            value={q}
            onChange={(v) => {
              setQ(v);
              setOffset(0);
            }}
          />
          <Button
            type="button"
            disabled={!offset}
            onClick={() => setOffset(offset - 100)}
          >
            Liens précédents
          </Button>
          <Button
            type="button"
            disabled={!choices.more}
            onClick={() => setOffset(offset + 100)}
          >
            Liens suivants
          </Button>
          <a href="#documents">Ouvrir la GED</a>
        </details>
        <Button type="submit" loading={busy}>
          Enregistrer l’action fiscale
        </Button>
      </fieldset>
    </form>
  );
}
