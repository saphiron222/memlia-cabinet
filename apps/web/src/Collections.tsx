import { DossierChoices, useDossierChoices } from "./features/referential/DossierChoices";
import { useModuleEnabled } from "./features/administration/preferences";
import { useRecordCapabilities } from "./features/administration/capabilities";
import { useEffect, useState, useRef } from "react";
import { Button } from "@memlia/ui";
import {
  CollectionCatalogueSchema,
  CollectionInputSchema,
  CollectionRunSchema,
  CabinetRecordSchema,
  type CabinetRecord,
  type CollectionRun,
  type SessionUser,
  type ConnectorId,
  type CollectionInput,
  type ObservationData,
} from "@memlia/contracts";
import { request, useScope, message, downloadDocument } from "./api";
import {
  Field,
  Select,
  ErrorSummary,
  validationErrors,
  type Errors,
} from "./forms";
import type { z } from "zod";
const statuses = {
  complete: "Complet dans le périmètre demandé",
  partial: "Partiel",
  "empty-observed": "Vide explicitement observé",
  "not-available": "Non disponible",
  "needs-human": "Intervention requise",
  failed: "Échec",
};
const observationLabels = {
  "tax-notice": "Avis fiscal",
  certificate: "Attestation",
  debt: "Dette",
  settlement: "Apurement",
  payment: "Paiement observé",
  "tax-document": "Document fiscal",
  message: "Message",
  entitlement: "Habilitation",
  schedule: "Échéancier",
  "registry-event": "Événement RNE public",
  "registry-document": "Document RNE public",
  "recipient-return": "Retour par destinataire",
  company: "Société du portefeuille",
  "tax-source": "Observation fiscale source",
};
function observationSummary(data: ObservationData): string {
  const euros = (cents: number | null) =>
    cents === null
      ? "Montant inconnu"
      : (cents / 100).toLocaleString("fr-FR", {
          style: "currency",
          currency: "EUR",
        });
  const state = (value: string) =>
    (
      ({
        available: "disponible",
        pending: "en attente",
        refused: "refusé",
        ineligible: "non éligible",
        accepted: "accepté",
        rejected: "rejeté",
        unknown: "inconnu",
        observed: "observé",
        prepared: "préparé",
        filed: "déposé",
        active: "actif",
        dormant: "en veille",
        deleted: "supprimé",
        public: "public",
        confidential: "confidentiel",
        unavailable: "indisponible",
        creation: "création",
        modification: "modification",
        cessation: "cessation",
        provisional: "prévisionnel",
        called: "appelé",
        definitive: "définitif",
        regularisation: "régularisation",
        "accepted-debt-plan": "plan de dette accepté",
        remission: "remise",
        reallocation: "réimputation",
        payment: "paiement",
        done: "pointé terminé",
      }) as Record<string, string>
    )[value] ?? value;
  switch (data.kind) {
    case "tax-notice":
      return `${data.tax} · ${euros(data.amountCents)} · échéance ${data.dueDate ?? "inconnue"} · paiement non observé`;
    case "certificate":
      return `${data.type} · ${state(data.state)} · émission ${data.issuedAt ?? "inconnue"}`;
    case "debt":
      return `${data.tax} · solde ${euros(data.balanceCents)} sur ${euros(data.amountCents)}`;
    case "settlement":
      return `${state(data.nature)} · ${euros(data.amountCents)} · ${data.paymentReference ?? "sans référence de paiement"}`;
    case "payment":
      return `${euros(data.amountCents)} · ${state(data.state)}`;
    case "tax-document":
      return `${data.tax} · ${data.form} · ${state(data.state)} · paiement ${state(data.paymentState)}`;
    case "message":
      return `${data.subject} · ${data.attachmentsMissing} PJ manquante(s) · ${data.portfolios.length} portefeuille(s)`;
    case "entitlement":
      return `${data.service} · ${data.role} · ${state(data.state)}`;
    case "schedule":
      return `${data.profile} · ${state(data.axis)} · cotisations ${data.contributionYear} / revenus ${data.incomeYear} · ${euros(data.amountCents)}`;
    case "registry-event":
      return `${state(data.event)} · registre public uniquement`;
    case "registry-document":
      return `${data.type === "act" ? "Acte" : "Comptes annuels"} · dépôt ${data.depositedAt} · ${state(data.access)}`;
    case "recipient-return":
      return `${data.recipient} · ${data.stage} · ${state(data.state)}`;
    case "company":
      return `${data.externalCompanyId} · portefeuille cabinet`;
    case "tax-source":
      return `${data.externalCompanyId} · partage fiscal · ${state(data.state)} · acceptation ${data.accepted === null ? "inconnue" : data.accepted ? "observée" : "non observée"} · paiement bancaire non observé`;
  }
}
const scenarios: Record<CollectionInput["scenario"], string> = {
  nominal: "Nominal fictif",
  variation: "Variante métier",
  "wrong-identity": "Identité inattendue",
  "missing-page": "Page manquante",
  "html-login": "Connexion HTML à la place du PDF",
  empty: "Vide explicite",
  unavailable: "Source absente",
  interrupted: "Interruption puis reprise",
  challenge: "Challenge de connexion",
  "source-failure": "Échec source",
};
export function Collections({ user }: { user: SessionUser }) {
  const moduleEnabled = useModuleEnabled("collectes");
  const signal = useScope();
  const operationId = useRef(crypto.randomUUID());
  const [catalogue, setCatalogue] = useState<z.infer<
      typeof CollectionCatalogueSchema
    > | null>(null),
    [dossierId, setDossierId] = useState(""),
    [connectorId, setConnectorId] = useState<ConnectorId>("dgfip-cfe"),
    [scenario, setScenario] = useState<CollectionInput["scenario"]>("nominal"),
    [profile, setProfile] =
      useState<CollectionInput["scope"]["profile"]>("employeur"),
    [from, setFrom] = useState("2026-01-01"),
    [to, setTo] = useState("2026-12-31"),
    [error, setError] = useState(""),
    [errors, setErrors] = useState<Errors>({}),
    [run, setRun] = useState<CollectionRun | null>(null),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [runId, setRunId] = useState(() =>
      sessionStorage.getItem("memlia-collection-" + user.id),
    );
  const choices = useDossierChoices();
  const dossiers = choices.items;
  const rights = useRecordCapabilities([...dossiers.map(d=>d.id),...(dossierId ? [dossierId] : [])]);
  useEffect(() => {
    void request("/collections/catalogue", CollectionCatalogueSchema, signal)
      .then(setCatalogue)
      .catch((e) => {
        if (!signal.aborted) setError(message(e));
      });

  }, [signal, revision]);
  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort);
    const poll = async () => {
      try {
        const next = await request(
          "/collections/" + runId,
          CollectionRunSchema,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setRun(next);
        if (["queued", "running"].includes(next.job.state))
          timer = setTimeout(() => void poll(), 350);
      } catch (e) {
        if (!controller.signal.aborted) setError(message(e));
      }
    };
    void poll();
    return () => {
      controller.abort();
      signal.removeEventListener("abort", abort);
      clearTimeout(timer);
    };
  }, [runId, signal, revision]);
  async function submit() {
    if (!catalogue) return;
    setError("");
    setErrors({});
    let selected = dossiers.find((d) => d.id === dossierId);
    if (!selected && dossierId) {
      try { selected = await request("/records/"+dossierId,CabinetRecordSchema,signal); }
      catch(e) { if(!signal.aborted)setError(message(e)); return; }
    }
    const parsed = CollectionInputSchema.safeParse({
      operationId: operationId.current,
      connectorId,
      mode: "simulation",
      credentialRef: "fixture-account",
      cabinetRef: "cabinet-fictif",
      scope: {
        ...catalogue.fixture.identity,
        dossierId,
        companyId:
          selected?.kind === "dossier"
            ? selected.data.siren || catalogue.fixture.identity.companyId
            : catalogue.fixture.identity.companyId,
        profile,
      },
      period: { from, to },
      scenario,
    });
    if (!parsed.success) {
      const fields = validationErrors(parsed.error);
      if (fields.scope) {
        fields.dossierId = fields.scope;
        delete fields.scope;
      }
      setErrors(fields);
      return;
    }
    setBusy(true);
    try {
      const next = await request("/collections", CollectionRunSchema, signal, {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      if (signal.aborted) return;
      setRun(next);
      sessionStorage.setItem("memlia-collection-" + user.id, next.job.id);
      setRunId(next.job.id);
      operationId.current = crypto.randomUUID();
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  const running = run && ["queued", "running"].includes(run.job.state);
  return (
    <section className="records collections" aria-label="Collectes simulées">
      <p>
        <strong>Simulation — pièces fictives, sans valeur fiscale.</strong> Les
        connexions réelles sont désactivées.
      </p>
      {catalogue && (
        <p>
          Portée fictive : SIREN {catalogue.fixture.identity.companyId} · compte{" "}
          {catalogue.fixture.identity.accountId} · établissement{" "}
          {catalogue.fixture.identity.establishmentId} · cotisant{" "}
          {catalogue.fixture.identity.contributorId} · service{" "}
          {catalogue.fixture.identity.service}.
        </p>
      )}
      <ErrorSummary
        errors={errors}
        message={error || rights.error || undefined}
      />
      {error && (
        <Button
          onClick={() => {
            setError("");
            setRevision((n) => n + 1);
          }}
        >
          Actualiser
        </Button>
      )}
      {!catalogue ? (
        <p role="status">Chargement des collecteurs…</p>
      ) : (
        <form
          className="document-upload"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Select
            name="connectorId"
            label="Collecteur"
            value={connectorId}
            onChange={(v) => setConnectorId(v as ConnectorId)}
          >
            <>
              {catalogue.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} — simulation
                </option>
              ))}
            </>
          </Select>
          <DossierChoices choices={choices}/>
          <Select
            name="dossierId"
            label="Dossier de la collecte"
            value={dossierId}
            onChange={setDossierId}
            errors={errors}
          >
            <option value="">Choisir un dossier</option>
            {dossierId && !dossiers.some(d=>d.id===dossierId) && <option value={dossierId}>Dossier actuellement choisi</option>}
            {dossiers
              .filter((d) => rights.grants[d.id]?.includes("update"))
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
          </Select>
          <Select
            name="scenario"
            label="Scénario fictif"
            value={scenario}
            onChange={(v) => setScenario(v as CollectionInput["scenario"])}
          >
            {catalogue.scenarios.map((s) => (
              <option key={s} value={s}>
                {scenarios[s]}
              </option>
            ))}
          </Select>
          <Select
            name="profile"
            label="Profil source"
            value={profile}
            onChange={(v) =>
              setProfile(v as CollectionInput["scope"]["profile"])
            }
          >
            <option value="employeur">Employeur fictif</option>
            <option value="TI">TI fictif — échéancier Urssaf</option>
            <option value="PAM">PAM fictif — échéancier Urssaf</option>
          </Select>
          <div id="period" tabIndex={-1}>
            <Field
              name="from"
              label="Début de période"
              type="date"
              value={from}
              onChange={setFrom}
              errors={errors}
            />
            <Field
              name="to"
              label="Fin de période"
              type="date"
              value={to}
              onChange={setTo}
              errors={errors}
            />
            {errors.period && (
              <small className="field-error">{errors.period}</small>
            )}
          </div>
          <Button
            type="submit"
            variant="solid"
            loading={busy}
            disabled={
              !moduleEnabled ||
              !!running ||
              (!!dossierId && !rights.grants[dossierId]?.includes("update"))
            }
          >
            Lancer la simulation
          </Button>
        </form>
      )}
      {run && (
        <section
          className="document-section"
          aria-label="Résultat de la collecte"
        >
          <h2>Collecte simulée</h2>
          <p role="status">
            {run.result
              ? statuses[run.result.status]
              : run.job.state === "failed"
                ? "Échec du traitement"
                : run.job.state === "queued"
                  ? "En attente"
                  : "Collecte en cours"}{" "}
            · Tentatives : {run.job.attempts} · Pages conservées :{" "}
            {run.checkpoint.page}
          </p>
          {run.job.error && <p>{run.job.error}</p>}
          <p>
            Source : {run.input.connectorId} · Compte :{" "}
            {run.input.scope.accountId} · Période : {run.input.period.from} au{" "}
            {run.input.period.to}
          </p>
          {run.result && (
            <>
              <p>
                {run.result.coverage.observed.length} page observée ·{" "}
                {run.result.records.length} observations ·{" "}
                {run.result.artifacts.length} pièces fictives.{" "}
                {run.result.coverage.boundaryVerified
                  ? "Frontière vérifiée."
                  : "Frontière non démontrée."}
              </p>
              {run.result.errors.length > 0 && (
                <ul>
                  {run.result.errors.map((e, i) => (
                    <li key={i}>
                      {e.scope} : {e.cause}
                    </li>
                  ))}
                </ul>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Référence</th>
                      <th>Observation source</th>
                      <th>Valeurs observées</th>
                      <th>Provenance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.result.records.map((r) => (
                      <tr key={r.id}>
                        <td>{r.reference}</td>
                        <td>{observationLabels[r.data.kind]}</td>
                        <td title={observationSummary(r.data)}>
                          {observationSummary(r.data)}
                        </td>
                        <td>Simulation · version {r.version}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3>Originaux fictifs conservés</h3>
              {run.result.artifacts.length === 0 ? (
                <p>Aucun original conservé.</p>
              ) : (
                <ul>
                  {run.result.artifacts.map((a) => (
                    <li key={a.id}>
                      <Button
                        onClick={async () => {
                          try {
                            await downloadDocument(a.id, a.filename, signal);
                          } catch (e) {
                            if (!signal.aborted) setError(message(e));
                          }
                        }}
                      >
                        Télécharger {a.filename}
                      </Button>{" "}
                      · Simulation · SHA-256 {a.sha256.slice(0, 12)}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <details>
            <summary>Journal de progression et reprise</summary>
            <ol>
              {run.job.events.map((e) => (
                <li key={e.sequence}>{e.message}</li>
              ))}
            </ol>
          </details>
        </section>
      )}
    </section>
  );
}
