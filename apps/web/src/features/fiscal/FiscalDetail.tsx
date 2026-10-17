import { useEffect, useState } from "react";
import { Button } from "@memlia/ui";
import {
  FiscalDetailSchema,
  FiscalPreparationDocumentSchema,
  type FiscalDetail as Detail,
  type FiscalEvent,
} from "@memlia/contracts";
import { Field, ErrorSummary } from "../../forms";
import { request, message, useScope } from "../../api";
import { useModuleEnabled } from "../administration/preferences";
import { CommandPanel } from "./CommandPanel";
import {
  moneyLabel,
  fiscalAttemptLabel,
  actionLabels,
  eventLabels,
  labelValue,
  natureLabels,
} from "./labels";
const tabActions: Record<
  string,
  { label: string; button: string; kinds: FiscalEvent["kind"][] }
> = {
  overview: {
    label: "Vue d’ensemble",
    button: "Modifier le suivi",
    kinds: [
      "revision",
      "manual_mark",
      "cancel_mark",
      "classification",
      "responsibility",
      "deadlines",
    ],
  },
  deposits: {
    label: "Dépôts et retours",
    button: "Consigner un dépôt ou retour",
    kinds: ["attempt", "return"],
  },
  debts: {
    label: "Dettes et règlements",
    button: "Ajouter un constat financier",
    kinds: ["debt", "payment", "apurement", "schedule", "bank_candidate"],
  },
  sources: {
    label: "Sources et écarts",
    button: "Renseigner une source",
    kinds: ["observation", "resolution", "source_freshness"],
  },
  documents: {
    label: "Pièces et tâches",
    button: "Lier une pièce ou une tâche",
    kinds: ["evidence", "notice", "link_task"],
  },
  incomes: {
    label: "Revenus et IFU",
    button: "Préparer les revenus",
    kinds: ["income", "ifu_prepare"],
  },
  history: { label: "Historique", button: "", kinds: [] },
};
export function FiscalDetail({
  id,
  onChange,
}: {
  id: string;
  onChange: () => void;
}) {
  const [tab, setTab] = useState("overview"),
    [commandKind, setCommandKind] = useState<FiscalEvent["kind"] | null>(null);
  const signal = useScope(),
    enabled = useModuleEnabled("fiscal"),
    [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState("");
  async function load() {
    setError("");
    try {
      setDetail(await request(`/fiscal/${id}`, FiscalDetailSchema, signal));
    } catch (e) {
      if (!signal.aborted) {
        setDetail(null);
        setError(message(e));
      }
    }
  }
  useEffect(() => {
    setDetail(null);
    void load();
  }, [id]);
  async function command(event: FiscalEvent) {
    if (!detail) return false;
    setBusy(true);
    setError("");
    try {
      setDetail(
        await request(`/fiscal/${id}/commands`, FiscalDetailSchema, signal, {
          method: "POST",
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            expectedVersion: detail.record.version,
            event,
          }),
        }),
      );
      onChange();
      return true;
    } catch (e) {
      if (!signal.aborted)
        setError(
          message(e) +
            " Rechargez la fiche avant de renouveler une action en conflit.",
        );
    } finally {
      if (!signal.aborted) setBusy(false);
    }
    return false;
  }
  if (!detail)
    return (
      <section>
        <ErrorSummary message={error || undefined} />
        {error ? (
          <Button onClick={() => void load()}>Réessayer</Button>
        ) : (
          <p role="status">Chargement de la fiche fiscale…</p>
        )}
      </section>
    );
  const s = detail.situation,
    p = detail.record.data.fiscal!,
    can = (action: "update" | "approve" | "transmit") =>
      enabled && detail.capabilities.actions.includes(action) && !busy;
  return (
    <section>
      <a href="#fiscal">Revenir à la grille fiscale</a>
      <header className="fiscal-record-header">
        <div>
          <h2>{detail.record.title}</h2>
          <span className="badge">
            {natureLabels[detail.record.data.nature]}
          </span>{" "}
          <span className="muted">
            Campagne {p.period.campaign} · version {detail.record.version}
          </span>
        </div>
        <div className="actions">
          <Button disabled={busy} onClick={() => void load()}>
            Actualiser
          </Button>
          {tabActions[tab]!.kinds.slice(0, 1).map((kind) => (
            <Button
              key={kind}
              variant="solid"
              disabled={!enabled || busy}
              onClick={() => setCommandKind(kind)}
            >
              {actionLabels[kind]}
            </Button>
          ))}
        </div>
      </header>
      <a
        className="fiscal-parent"
        href={`#dossier?id=${detail.record.dossierId}`}
      >
        Ouvrir le dossier lié
      </a>
      <ErrorSummary message={error || undefined} />
      {!enabled && (
        <p role="status">
          Module fiscal désactivé : consultation conservée, actions suspendues.
        </p>
      )}
      <section aria-label="Situation fiscale">
        <h3>Situation fiscale</h3>
        <div className="summary-grid fiscal-overview">
          <div>
            Préparation<strong>{labelValue(s.preparation)}</strong>
          </div>
          <div>
            Approbation<strong>{labelValue(s.approval)}</strong>
          </div>
          <div>
            Version acceptée applicable
            <strong>
              {s.applicableAcceptedVersion ?? "Aucune version acceptée"}
            </strong>
            <span>
              Montant accepté : {moneyLabel(s.applicableAcceptedAmount)}
            </span>
          </div>
          <div>
            Montant suivi<strong>{moneyLabel(s.amount)}</strong>
          </div>
          <div>
            Règlements acquis<strong>{moneyLabel(s.paid)}</strong>
          </div>
          <div>
            Reste suivi<strong>{moneyLabel(s.remaining)}</strong>
          </div>
        </div>
        <p>
          Classement : {labelValue(p.classification)}. Les montants suivis
          proviennent des observations ; ils ne constituent pas un calcul
          officiel de l’impôt.
        </p>
        {s.ambiguities.map((a, i) => (
          <p role="status" key={i}>
            {a}
          </p>
        ))}
      </section>
      <div
        className="fiscal-tabs"
        role="tablist"
        aria-label="Rubriques de l’obligation"
      >
        {Object.entries(tabActions)
          .filter(
            ([key]) =>
              key !== "incomes" ||
              ["RCM_2777", "IFU_2561"].includes(detail.record.data.nature),
          )
          .map(([key, entry]) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`fiscal-tab-${key}`}
              aria-controls="fiscal-tab-content"
              aria-selected={tab === key}
              tabIndex={tab === key ? 0 : -1}
              onClick={() => setTab(key)}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const siblings = Array.from(
                    event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                      '[role="tab"]',
                    ),
                  ),
                  index = siblings.indexOf(event.currentTarget),
                  next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? siblings.length - 1
                        : (index +
                            (event.key === "ArrowRight" ? 1 : -1) +
                            siblings.length) %
                          siblings.length;
                siblings[next]!.click();
                siblings[next]!.focus();
              }}
            >
              {entry.label}
            </button>
          ))}
      </div>
      {tabActions[tab]!.kinds.length > 1 && (
        <div
          className="fiscal-context-actions"
          aria-label="Actions de la rubrique"
        >
          {tabActions[tab]!.kinds.slice(1).map((kind) => (
            <Button
              key={kind}
              size="sm"
              disabled={!enabled || busy}
              onClick={() => setCommandKind(kind)}
            >
              {actionLabels[kind]}
            </Button>
          ))}
        </div>
      )}
      <div
        role="tabpanel"
        id="fiscal-tab-content"
        aria-labelledby={`fiscal-tab-${tab}`}
        className="fiscal-tab-content"
      >
        {tab === "overview" && (
          <dl className="fiscal-properties">
            <div>
              <dt>Période</dt>
              <dd>
                {p.period.start} au {p.period.end}
              </dd>
            </div>
            <div>
              <dt>Déclaration</dt>
              <dd>{labelValue(p.period.subtype)}</dd>
            </div>
            <div>
              <dt>Régime fiscal</dt>
              <dd>{p.regime ? labelValue(p.regime) : "Non renseigné"}</dd>
            </div>
            <div>
              <dt>Clôture</dt>
              <dd>{p.financialYearEnd ?? "Non renseignée"}</dd>
            </div>
            <div>
              <dt>Classement</dt>
              <dd>{labelValue(p.classification)}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{labelValue(detail.freshness.state)}</dd>
            </div>
          </dl>
        )}
        {tab === "overview" &&
          ["IS", "CVAE"].includes(detail.record.data.nature) && (
            <dl className="fiscal-properties">
              {Object.entries(p.observedValues).map(([field, value]) => (
                <div key={field}>
                  <dt>{labelValue(field)}</dt>
                  <dd>{moneyLabel(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        <section hidden={tab !== "sources"}>
          <h3>Valeurs observées</h3>
          <ul>
            {detail.timeline
              .filter((e) => e.event.kind === "observation")
              .map(
                (e) =>
                  e.event.kind === "observation" && (
                    <li key={e.id}>
                      {labelValue(e.event.field)} :{" "}
                      {e.event.value ?? "Inconnue"} ·{" "}
                      {e.event.provenance.source} · version{" "}
                      {e.event.provenance.version}
                    </li>
                  ),
              )}
          </ul>
          <p>
            Clôture : {p.financialYearEnd ?? "inconnue"} · Régime :{" "}
            {p.regime ? labelValue(p.regime) : "inconnu"}
          </p>
        </section>
        <section hidden={tab !== "sources"}>
          <h3>Actualité de la source</h3>
          <p>
            {labelValue(detail.freshness.state)} · {detail.freshness.reason}
          </p>
          <p>
            Mise à jour réelle :{" "}
            {detail.freshness.sourceUpdatedAt ?? "inconnue"} · Collecte :{" "}
            {detail.freshness.observedAt ?? "inconnue"} · Politique :{" "}
            {detail.freshness.policyVersion ?? "absente"}. Source fournisseur
            vérifiée : non.
          </p>
        </section>
        {p.deadlines && (
          <section hidden={tab !== "overview"}>
            <h3>Dates distinctes</h3>
            <p>
              Échéance observée : {p.deadlines.observed ?? "inconnue"} ·
              Campagne : {p.deadlines.campaignDate ?? "inconnue"} · Cible
              interne : {p.deadlines.internalTarget ?? "non fixée"}
            </p>
          </section>
        )}
        <section hidden={tab !== "overview"}>
          <h3>Préparation et décision locale</h3>
          {detail.record.data.nature === "IRPP" && (
            <div>
              <p>Validation du client : {labelValue(s.clientValidation)}</p>
              <Button
                disabled={!can("update")}
                onClick={() => setCommandKind("client_validation")}
              >
                Renseigner la réponse du client
              </Button>
            </div>
          )}
          <Button
            disabled={!can("update") || s.approval === "approved"}
            onClick={() =>
              void command({ kind: "preparation", state: "preparee" })
            }
          >
            Marquer préparée
          </Button>
          <Button
            disabled={
              !can("update") ||
              s.approval === "approved" ||
              s.preparation !== "preparee"
            }
            onClick={() =>
              void command({ kind: "preparation", state: "a_preparer" })
            }
          >
            Reprendre la préparation
          </Button>
          <Button
            disabled={
              !can("update") ||
              s.preparation !== "preparee" ||
              !["not_requested", "rejected"].includes(s.approval)
            }
            onClick={() => void command({ kind: "approval_request" })}
          >
            Demander l’approbation
          </Button>
          {s.approval === "requested" && (
            <>
              <Field
                name="fiscal-decision-reason"
                label="Motif de décision"
                value={reason}
                onChange={setReason}
              />
              <Button
                disabled={
                  !can("approve") ||
                  s.approval !== "requested" ||
                  !reason.trim()
                }
                onClick={() =>
                  void command({
                    kind: "approval",
                    decision: "approved",
                    reason,
                  })
                }
              >
                Approuver localement
              </Button>
              <Button
                disabled={
                  !can("approve") ||
                  s.approval !== "requested" ||
                  !reason.trim()
                }
                onClick={() =>
                  void command({
                    kind: "approval",
                    decision: "rejected",
                    reason,
                  })
                }
              >
                Refuser localement
              </Button>
            </>
          )}
        </section>
        {s.attempts.length > 0 && (
          <section hidden={tab !== "deposits"}>
            <h3>Dépôts et retours</h3>
            {s.attempts.map((a) => (
              <div key={a.id}>
                <p>
                  Tentative · déclaration {a.declarationVersion} · Plateforme :{" "}
                  {labelValue(a.platform)} ·{" "}
                  {a.accepted
                    ? "Tous les destinataires ont accepté"
                    : "Acceptation non acquise"}
                </p>
                <ul>
                  {Object.entries(a.recipients).map(([r, state]) => (
                    <li key={r}>
                      {r} : {labelValue(state)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}
        {s.debts.length > 0 && (
          <section hidden={tab !== "debts"}>
            <h3>Dettes et apurements</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Dette</th>
                    <th>Montant</th>
                    <th>Payé</th>
                    <th>Autres apurements</th>
                    <th>Reste</th>
                    <th>Solde source</th>
                  </tr>
                </thead>
                <tbody>
                  {s.debts.map((d) => (
                    <tr key={d.id}>
                      <td>
                        {(
                          detail.timeline.findLast(
                            (e) =>
                              e.event.kind === "debt" && e.event.id === d.id,
                          )?.event as
                            | Extract<FiscalEvent, { kind: "debt" }>
                            | undefined
                        )?.reference ?? d.id}
                      </td>
                      <td>{moneyLabel(d.amount)}</td>
                      <td>{moneyLabel(d.paid)}</td>
                      <td>{moneyLabel(d.otherApurements)}</td>
                      <td>{moneyLabel(d.remaining)}</td>
                      <td>
                        {moneyLabel(d.sourceBalance)}
                        {d.conflict && " · Divergence"}
                        {d.sourceConfirmedZero &&
                          " · Zéro confirmé par la source déclarée"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        <section hidden={tab !== "debts"}>
          <h3>Règlements, apurements et échéanciers</h3>
          {!detail.timeline.some((e) =>
            ["payment", "apurement", "schedule"].includes(e.event.kind),
          ) && (
            <p className="muted">
              Aucun règlement, apurement ou échéancier renseigné.
            </p>
          )}
          {detail.timeline
            .filter((e) =>
              ["payment", "apurement", "schedule"].includes(e.event.kind),
            )
            .map((entry) => {
              const event = entry.event;
              if (
                event.kind !== "payment" &&
                event.kind !== "apurement" &&
                event.kind !== "schedule"
              )
                return null;
              return (
                <article key={entry.id} className="fiscal-financial-entry">
                  <strong>{eventLabels[event.kind]}</strong>
                  <p>
                    {event.kind === "schedule"
                      ? labelValue(event.decision)
                      : `${moneyLabel(event.amount)} · ${event.date} · ${labelValue(event.kind === "payment" ? event.state : event.nature)}`}
                  </p>
                  <p>{event.reason}</p>
                  {event.kind === "payment" && (
                    <p>
                      {event.attemptId
                        ? fiscalAttemptLabel(
                            detail,
                            event.attemptId,
                            event.declarationVersion,
                          )
                        : "Tentative et version non renseignées"}
                    </p>
                  )}
                  {event.kind === "schedule" && (
                    <ul>
                      {event.instalments.map((i, index) => (
                        <li key={index}>
                          {i.date} · {moneyLabel(i.amount)}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="muted">
                    {event.provenance.source} · {event.provenance.reference} ·
                    version {event.provenance.version} · collecte{" "}
                    {new Date(event.provenance.observedAt).toLocaleString(
                      "fr-FR",
                    )}
                  </p>
                </article>
              );
            })}
        </section>
        {s.bankCandidates.length > 0 && (
          <section hidden={tab !== "debts"}>
            <h3>Candidats bancaires</h3>
            {s.bankCandidates.map((c) => (
              <p key={c.id}>
                {c.eligible ? "Candidat admissible" : "Candidat écarté"} ·
                Confiance {labelValue(c.confidence)} ·{" "}
                {c.reasons
                  .map(
                    (r) =>
                      ({
                        account_absent: "Compte absent",
                        pdf_unparsed: "PDF non analysé",
                        iban_absent: "IBAN absent",
                        iban_ambiguous: "IBAN masqué ambigu",
                        order_date_unknown: "Date d’ordre inconnue",
                        order_outside_window: "Ordre hors ancienneté permise",
                        rule_not_yet_applicable: "Règle non applicable",
                      })[r] ?? r,
                  )
                  .join(", ")}{" "}
                · Aucun paiement confirmé par ce rapprochement.
              </p>
            ))}
          </section>
        )}
        {s.anomalies.length > 0 && (
          <section hidden={tab !== "sources"}>
            <h3>Divergences de sources</h3>
            {s.anomalies.map((a) => (
              <div key={a.field}>
                <h4>
                  {labelValue(a.field)} · {labelValue(a.state)}
                </h4>
                <p>Valeur retenue : {a.retainedValue ?? "inconnue"}</p>
                <ul>
                  {a.observations.map((o) => (
                    <li key={o.id}>
                      {o.value ?? "Inconnue"} · {o.provenance.source} · version{" "}
                      {o.provenance.version} · mise à jour{" "}
                      {o.provenance.sourceUpdatedAt ?? "inconnue"} · collecte{" "}
                      {o.provenance.observedAt}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}
        {s.ifu && (
          <section hidden={tab !== "incomes"}>
            <h3>Préparation IFU</h3>
            <Button
              disabled={
                !can("update") ||
                !detail.capabilities.actions.includes("export")
              }
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const result = await request(
                    `/fiscal/${id}/preparation-document`,
                    FiscalPreparationDocumentSchema,
                    signal,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        operationId: crypto.randomUUID(),
                        expectedVersion: detail.record.version,
                      }),
                    },
                  );
                  setDetail(result.detail);
                  onChange();
                } catch (e) {
                  if (!signal.aborted) setError(message(e));
                } finally {
                  if (!signal.aborted) setBusy(false);
                }
              }}
            >
              Conserver une pièce de préparation dans la GED
            </Button>
            <p>
              {s.ifu.complete
                ? "Couverture complète"
                : "Préparation incomplète"}{" "}
              ·{" "}
              {s.ifu.stale
                ? "Périmée : une source a changé"
                : "Versions sources conservées"}{" "}
              · Brut : {moneyLabel(s.ifu.grossTotal)} ·{" "}
              {labelValue(s.ifu.rule.status)}. Export certifié : non.
            </p>
            <p>
              Mois manquants :{" "}
              {s.ifu.coverage.missingMonths.join(", ") || "aucun"} · incomplets
              : {s.ifu.coverage.incompleteMonths.join(", ") || "aucun"} · zéro
              confirmé : {s.ifu.coverage.zeroMonths.join(", ") || "aucun"} ·
              doublons : {s.ifu.coverage.duplicateMonths.join(", ") || "aucun"}
            </p>
            <ul>
              {s.ifu.sourceVersions.map((v) => (
                <li key={v.id}>
                  <a href={`#fiscal?id=${v.id}`}>
                    RCM source · version {v.version}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        {s.notices.map((n) => (
          <section key={n.id} hidden={tab !== "documents"}>
            <h3>
              Avis {n.reference} · {n.year}
            </h3>
            <p>
              Rôle {n.role || "inconnu"} · {n.properties.join(", ")} ·{" "}
              {n.municipalities.join(", ")} · {moneyLabel(n.amount)} · Échéance{" "}
              {n.dueDate ?? "inconnue"} · Prélèvement{" "}
              {labelValue(n.directDebit)}
            </p>
            <p>
              {n.suiteIds.length} suites reliées / {n.expectedSuites} attendues
            </p>
            {[n.originalId, ...n.suiteIds].filter(Boolean).map((id, index) => (
              <p key={id}>
                <a href={`/api/v1/documents/${id}/download`}>
                  Télécharger{" "}
                  {index === 0 ? "l’avis principal" : `la suite ${index}`}
                </a>
              </p>
            ))}
          </section>
        ))}
        {s.manualMarks.map((m) => (
          <p key={m.id} hidden={tab !== "overview"}>
            {labelValue(m.state)} · {m.reason} ·{" "}
            {m.cancelled ? "Mention annulée" : "Mention manuelle active"}
          </p>
        ))}
        <section hidden={tab !== "documents"}>
          <h3>Pièces et travail lié</h3>
          <a href="#documents">Ouvrir la GED pour ajouter un original</a>
          <ul>
            {p.documentIds.map((id, index) => (
              <li key={id}>
                <a href={`/api/v1/documents/${id}/download`}>
                  Pièce liée {index + 1}
                </a>
              </li>
            ))}
            {detail.timeline
              .filter((e) => e.event.kind === "link_task")
              .map((e) => (
                <li key={e.id}>
                  <a
                    href={`#tache?id=${e.event.kind === "link_task" ? e.event.taskId : ""}`}
                  >
                    Tâche liée
                  </a>
                </li>
              ))}
          </ul>
        </section>
        {tab === "deposits" && !s.attempts.length && (
          <div className="fiscal-empty">
            <h3>Aucun dépôt constaté</h3>
            <p>
              Les tentatives et retours apparaîtront ici avec leurs
              destinataires et preuves.
            </p>
          </div>
        )}
        {tab === "debts" && !s.debts.length && (
          <div className="fiscal-empty">
            <h3>Aucune dette observée</h3>
            <p>
              Consignez une photographie de dette, un règlement ou un candidat
              bancaire.
            </p>
          </div>
        )}
        <section aria-label="Chronologie fiscale" hidden={tab !== "history"}>
          <h3>Chronologie fiscale</h3>
          <ol>
            {detail.timeline.map((e) => (
              <li key={e.id}>
                <strong>{eventLabels[e.event.kind]}</strong> ·{" "}
                {new Date(e.at).toLocaleString("fr-FR")} · version {e.version}
                {"reason" in e.event && <p>{e.event.reason}</p>}
                {e.event.kind === "payment" && (
                  <p>
                    {e.event.attemptId
                      ? fiscalAttemptLabel(
                          detail,
                          e.event.attemptId,
                          e.event.declarationVersion,
                        )
                      : "Tentative et version non renseignées"}
                  </p>
                )}
                {"provenance" in e.event && (
                  <p>
                    {labelValue(e.event.provenance.kind)} ·{" "}
                    {e.event.provenance.source} · {e.event.provenance.reference}{" "}
                    · version {e.event.provenance.version} ·{" "}
                    {e.event.provenance.rawState}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      </div>
      {commandKind && (
        <CommandPanel
          detail={detail}
          busy={busy}
          disabled={!enabled}
          error={error}
          allowedKinds={[commandKind]}
          onCommand={command}
          onClose={() => setCommandKind(null)}
        />
      )}
    </section>
  );
}
