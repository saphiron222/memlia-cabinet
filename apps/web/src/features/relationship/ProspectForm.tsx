import { Parties } from "./shared";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@memlia/ui";
import { Check as Checkbox } from "./shared";
import {
  ProspectSchema,
  RelationshipEntitySchema,
  CabinetRecordSchema,
  type RelationshipEntity,
  type CabinetRecord,
  type SessionUser,
} from "@memlia/contracts";
import { request, message, useScope } from "../../api";
import { Field, ErrorSummary, TagsField } from "../../forms";
import { PanelCard } from "../../upstream/cal/PanelCard";
import { TabButton } from "../../upstream/plane/controls";
import {
  useRelationshipTab,
  Choice,
  Area,
  RecordChoice,
  ModelChoice,
  FormActions,
} from "./shared";
type Prospect = z.infer<typeof ProspectSchema>;
export function ProspectForm({
  entity,
  onSaved,
  onClose,
  readonly = false,
}: {
  entity?: RelationshipEntity;
  onSaved: (e: RelationshipEntity) => void;
  onClose: () => void;
  readonly?: boolean;
}) {
  const signal = useScope(),
    [d, D] = useState<Prospect>(() =>
      entity?.data.kind === "prospect"
        ? entity.data
        : {
            kind: "prospect",
            contactId: "",
            mainContactId: null,
            pipelineId: "",
            stageId: "",
            identity: "company",
            source: "",
            temperature: "unknown",
            manualRisk: "unknown",
            calculatedScore: null,
            riskFlags: [],
            riskNotes: "",
            proposedFee: null,
            notes: "",
            interactions: [],
            missions: [],
            origin: "creation",
            repriseDate: null,
            formerCabinet: "",
            createdOn: null,
            headcount: null,
            purpose: "",
            sector: "",
            closingMonth: null,
            activity: "",
            monthlyPieces: null,
            bankAccounts: null,
            vatFrequency: null,
            pieceSources: "",
            banks: "",
            tools: "",
            missingInformation: "",
            hypotheses: "",
            assigneeIds: [],
            teamIds: [],
            tags: [],
            dossierId: null,
          },
    ),
    [section, S] = useRelationshipTab("formSection", "identity"),
    [create, C] = useState(!entity),
    [title, T] = useState(""),
    [siren, Siren] = useState(""),
    [legal, Legal] = useState(""),
    [capital, Capital] = useState(""),
    [confidential, Confidential] = useState(false),
    [error, E] = useState(""),
    [busy, B] = useState(false),
    [pipeline, P] = useState<RelationshipEntity | null>(null),
    [mission, M] = useState<RelationshipEntity | null>(null),
    [missionId, MId] = useState(""),
    [contact, Contact] = useState<CabinetRecord | null>(null),
    [interactionDate, IDate] = useState(""),
    [interactionText, IText] = useState("");
  useEffect(() => {
    if (!d.contactId) return;
    const c = new AbortController();
    void request("/records/" + d.contactId, CabinetRecordSchema, c.signal)
      .then(Contact)
      .catch((e) => {
        if (!c.signal.aborted) E(message(e));
      });
    return () => c.abort();
  }, [d.contactId]);
  useEffect(() => {
    if (!d.pipelineId) return;
    const c = new AbortController();
    void request(
      "/relationship/entities/" + d.pipelineId,
      RelationshipEntitySchema,
      c.signal,
    )
      .then(P)
      .catch((e) => {
        if (!c.signal.aborted) E(message(e));
      });
    return () => c.abort();
  }, [d.pipelineId]);
  const set = <K extends keyof Prospect>(key: K, value: Prospect[K]) =>
    D({ ...d, [key]: value });
  const f = (key: keyof Prospect, label: string, type = "text") => (
    <Field
      key={key}
      name={"prospect-" + key}
      label={label}
      type={type}
      value={String(d[key] ?? "")}
      onChange={(v) =>
        set(
          key,
          ([
            "headcount",
            "closingMonth",
            "monthlyPieces",
            "bankAccounts",
          ].includes(key)
            ? v === ""
              ? null
              : Number(v)
            : ["proposedFee", "createdOn", "repriseDate"].includes(key)
              ? v || null
              : v) as never,
        )
      }
    />
  );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    B(true);
    E("");
    try {
      let contactId = d.contactId;
      if (!d.pipelineId || !d.stageId)
        throw Error("Choisissez un pipeline et son étape.");
      if (create && !contactId) {
        if (!title.trim()) throw Error("Le nom du prospect est requis.");
        const c = await request("/records", CabinetRecordSchema, signal, {
          method: "POST",
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            record: {
              kind: "contact",
              title,
              confidential,
              data: {
                contactType:
                  d.identity === "person" ? "personne" : "organisation",
                siren: siren || null,
                legalForm: legal,
                capital: capital || null,
              },
            },
          }),
        });
        contactId = c.id;
        set("contactId", contactId);
        C(false);
      }
      const data = ProspectSchema.parse({ ...d, contactId });
      const r = await request(
        "/relationship/entities",
        RelationshipEntitySchema,
        signal,
        {
          method: "POST",
          body: JSON.stringify({
            id: entity?.id ?? crypto.randomUUID(),
            expectedVersion: entity?.version ?? 0,
            operationId: crypto.randomUUID(),
            data,
          }),
        },
      );
      onSaved(r);
    } catch (e) {
      E(
        e instanceof z.ZodError
          ? "Vérifiez les champs requis, montants exacts et dates civiles."
          : message(e),
      );
    } finally {
      B(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="relationship-form">
      <h2>{entity ? (contact?.title ?? "Prospect") : "Nouveau prospect"}</h2>
      <ErrorSummary message={error || undefined} />
      <div
        className="relationship-tabs"
        role="tablist"
        aria-label="Sections du prospect"
      >
        {Object.entries({
          identity: "Identité",
          commercial: "Relation",
          activity: "Activité",
          reprise: "Reprise",
          missions: "Missions",
          risk: "Risque manuel",
        }).map(([k, l]) => (
          <TabButton
            key={k}
            type="button"
            role="tab"
            aria-selected={section === k}
            onClick={() => S(k)}
          >
            {l}
          </TabButton>
        ))}
      </div>
      <fieldset disabled={readonly || busy}>
        {section === "identity" && (
          <PanelCard title="Identité et contacts">
            <div className="relationship-fields">
              <Choice
                name="prospect-identity"
                label="Nature du prospect"
                value={d.identity}
                onChange={(v) => set("identity", v as Prospect["identity"])}
                options={{
                  company: "Entreprise existante",
                  person: "Personne",
                  future_company: "Entreprise pas encore créée",
                }}
              />
              {!entity && (
                <Checkbox
                  label="Créer un nouveau contact canonique"
                  checked={create}
                  onChange={(e) => C(e.target.checked)}
                />
              )}{" "}
              {create ? (
                <>
                  <Field
                    name="prospect-title"
                    label="Nom du prospect"
                    value={title}
                    onChange={T}
                    required
                  />
                  <Field
                    name="prospect-siren"
                    label="SIREN"
                    value={siren}
                    onChange={Siren}
                  />
                  <Field
                    name="prospect-legal"
                    label="Catégorie juridique"
                    value={legal}
                    onChange={Legal}
                  />
                  <Field
                    name="prospect-capital"
                    label="Capital (€)"
                    value={capital}
                    onChange={Capital}
                  />
                  <Checkbox
                    label="Confidentiel"
                    checked={confidential}
                    onChange={(e) => Confidential(e.target.checked)}
                  />
                </>
              ) : (
                <RecordChoice
                  name="prospect-contact"
                  label="Contact du prospect"
                  kind="contact"
                  value={d.contactId}
                  onChange={(v) => set("contactId", v)}
                  disabled={!!entity}
                />
              )}
              <RecordChoice
                name="prospect-main-contact"
                label="Interlocuteur principal"
                kind="contact"
                value={d.mainContactId ?? ""}
                onChange={(v) => set("mainContactId", v || null)}
              />
              {f("createdOn", "Date de création", "date")}
              {f("headcount", "Effectif", "number")}
            </div>
            {contact && (
              <p>
                <a href={"#contact?id=" + contact.id}>
                  Fiche contact, identité légale et rapprochement public
                </a>{" "}
                ·{" "}
                {contact.kind === "contact"
                  ? (contact.data.siren ?? "SIREN inconnu")
                  : ""}
              </p>
            )}
            {d.dossierId && (
              <a href={"#dossier?id=" + d.dossierId}>
                Ouvrir le dossier converti
              </a>
            )}
          </PanelCard>
        )}
        {section === "commercial" && (
          <PanelCard title="Relation commerciale">
            <div className="relationship-fields">
              <ModelChoice
                name="prospect-pipeline"
                label="Pipeline"
                kind="pipeline"
                value={d.pipelineId}
                onChange={(id, m) => {
                  P(m);
                  D({
                    ...d,
                    pipelineId: id,
                    stageId:
                      m?.data.kind === "pipeline" ? m.data.stages[0]!.id : "",
                  });
                }}
                disabled={!!entity}
              />
              <Choice
                name="prospect-stage"
                label="Étape"
                value={d.stageId}
                onChange={(v) => set("stageId", v)}
                options={Object.fromEntries(
                  pipeline?.data.kind === "pipeline"
                    ? pipeline.data.stages.map((s) => [s.id, s.name])
                    : [["", "Choisir le pipeline"]],
                )}
                disabled={!!entity}
              />
              {f("source", "Source d’acquisition")}
              {f("proposedFee", "Honoraires proposés (€)")}
              <Choice
                name="prospect-temperature"
                label="Température manuelle"
                value={d.temperature}
                onChange={(v) =>
                  set("temperature", v as Prospect["temperature"])
                }
                options={{
                  unknown: "Inconnue",
                  cold: "Froide",
                  warm: "Tiède",
                  hot: "Chaude",
                }}
              />
              <Parties
                kind="people"
                values={d.assigneeIds}
                onChange={(v) => set("assigneeIds", v)}
              />
              <Parties
                kind="teams"
                values={d.teamIds}
                onChange={(v) => set("teamIds", v)}
              />
              <TagsField
                tags={d.tags}
                onChange={(v) => set("tags", v)}
                errors={{}}
              />
            </div>
            <Area
              name="prospect-notes"
              label="Notes de relation"
              value={d.notes}
              onChange={(v) => set("notes", v)}
            />
            <h3>Interactions datées</h3>
            <ul>
              {d.interactions.map((i) => (
                <li key={i.id}>
                  {i.date} · {i.description}
                </li>
              ))}
            </ul>
            <div className="relationship-fields">
              <Field
                name="interaction-date"
                label="Date de l’interaction"
                type="date"
                value={interactionDate}
                onChange={IDate}
              />
              <Field
                name="interaction-text"
                label="Interaction"
                value={interactionText}
                onChange={IText}
              />
            </div>
            <Button
              disabled={!interactionDate || !interactionText}
              onClick={() => {
                set("interactions", [
                  ...d.interactions,
                  {
                    id: crypto.randomUUID(),
                    date: interactionDate,
                    description: interactionText,
                  },
                ]);
                IText("");
              }}
            >
              Ajouter l’interaction
            </Button>
          </PanelCard>
        )}
        {section === "activity" && (
          <PanelCard title="Activité et hypothèses">
            <div className="relationship-fields">
              {f("sector", "Secteur")}
              {f("closingMonth", "Mois de clôture", "number")}
              {f("monthlyPieces", "Pièces par mois", "number")}
              {f("bankAccounts", "Comptes bancaires", "number")}
              <Choice
                name="prospect-vat"
                label="Fréquence TVA"
                value={d.vatFrequency ?? ""}
                onChange={(v) =>
                  set("vatFrequency", (v as Prospect["vatFrequency"]) || null)
                }
                options={{
                  "": "Inconnue",
                  monthly: "Mensuelle",
                  quarterly: "Trimestrielle",
                  annual: "Annuelle",
                }}
              />
            </div>
            {(
              [
                ["purpose", "Objet social"],
                ["activity", "Détails d’activité"],
                ["pieceSources", "Sources des pièces"],
                ["banks", "Banques"],
                ["tools", "Outils"],
                ["missingInformation", "Informations manquantes"],
                ["hypotheses", "Hypothèses de travail"],
              ] as const
            ).map(([k, l]) => (
              <Area
                key={k}
                name={"prospect-" + k}
                label={l}
                value={d[k]}
                onChange={(v) => set(k, v)}
              />
            ))}
          </PanelCard>
        )}
        {section === "reprise" && (
          <PanelCard title="Origine et ancien cabinet">
            <div className="relationship-fields">
              <Choice
                name="prospect-origin"
                label="Origine de la relation"
                value={d.origin}
                onChange={(v) => set("origin", v as Prospect["origin"])}
                options={{
                  creation: "Création",
                  reprise_without_cabinet: "Reprise sans expert-comptable",
                  reprise_with_cabinet: "Reprise avec expert-comptable",
                }}
              />
              {f("repriseDate", "Date de reprise", "date")}
              {f("formerCabinet", "Ancien cabinet")}
            </div>
          </PanelCard>
        )}
        {section === "missions" && (
          <PanelCard title="Missions chiffrées">
            <p>
              Montants et quantités exacts ; une mission désactivée reste
              identifiable dans cette fiche.
            </p>
            {d.missions.map((m, i) => (
              <div className="relationship-mission" key={i}>
                <ModelChoice
                  name={"mission-" + i}
                  label="Mission retenue"
                  kind="mission"
                  value={m.missionId}
                  onChange={() => {}}
                  disabled
                />
                <Field
                  name={"quantity-" + i}
                  label="Quantité"
                  value={m.quantity}
                  onChange={(v) =>
                    set(
                      "missions",
                      d.missions.map((x, j) =>
                        j === i ? { ...x, quantity: v } : x,
                      ),
                    )
                  }
                />
                <Field
                  name={"amount-" + i}
                  label="Montant de la mission (€)"
                  value={m.amount ?? ""}
                  onChange={(v) =>
                    set(
                      "missions",
                      d.missions.map((x, j) =>
                        j === i ? { ...x, amount: v || null } : x,
                      ),
                    )
                  }
                />
                <Button
                  onClick={() =>
                    set(
                      "missions",
                      d.missions.filter((_, j) => j !== i),
                    )
                  }
                >
                  Retirer la mission
                </Button>
              </div>
            ))}
            <ModelChoice
              name="mission-add"
              label="Nouvelle mission active"
              kind="mission"
              value={missionId}
              onChange={(id, m) => {
                MId(id);
                M(m);
              }}
            />
            <Button
              disabled={!mission}
              onClick={() => {
                if (mission) {
                  set("missions", [
                    ...d.missions,
                    {
                      missionId: mission.id,
                      missionVersion: mission.version,
                      quantity: "1",
                      amount: null,
                    },
                  ]);
                  M(null);
                  MId("");
                }
              }}
            >
              Ajouter la mission
            </Button>
          </PanelCard>
        )}
        {section === "risk" && (
          <PanelCard title="Appréciation commerciale manuelle">
            <Choice
              name="prospect-risk"
              label="Risque manuel CRM"
              value={d.manualRisk}
              onChange={(v) => set("manualRisk", v as Prospect["manualRisk"])}
              options={{
                unknown: "Inconnu",
                low: "Faible",
                medium: "Moyen",
                high: "Élevé",
              }}
            />
            <Field
              name="risk-flags"
              label="Indicateurs manuels (séparés par des virgules)"
              value={d.riskFlags.join(", ")}
              onChange={(v) =>
                set(
                  "riskFlags",
                  v
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
            />
            <Area
              name="prospect-risk-notes"
              label="Notes de risque commercial"
              value={d.riskNotes}
              onChange={(v) => set("riskNotes", v)}
            />
            <p>
              Score calculé : inconnu, aucune règle définie. La vigilance LAB
              fait l’objet d’une revue humaine séparée et protégée.
            </p>
          </PanelCard>
        )}
      </fieldset>
      <FormActions busy={busy} readonly={readonly} onCancel={onClose} />
    </form>
  );
}
