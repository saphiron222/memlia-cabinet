import { Parties } from "./shared";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@memlia/ui";
import { Check as Checkbox } from "./shared";
import {
  RelationshipEntitySchema,
  OnboardingSchema,
  OnboardingValueSchema,
  IdentityReviewSchema,
  LabReviewSchema,
  OnboardingStatusSchema,
  type RelationshipData,
  type RelationshipEntity,
  type SessionUser,
  type EvidenceSchema,
} from "@memlia/contracts";
import { request, message, useScope } from "../../api";
import { Field, ErrorSummary, TagsField } from "../../forms";
import { PanelCard } from "../../upstream/cal/PanelCard";
import {
  Choice,
  Area,
  RecordChoice,
  ModelChoice,
  EvidenceEditor,
  FormActions,
} from "./shared";
import { PeopleSelect } from "../production/PeopleSelect";
type Review = Extract<
  RelationshipData,
  { kind: "onboarding" | "identity" | "lab" }
>;
export function ReviewForm({
  kind,
  entity,
  user,
  onSaved,
  onClose,
  readonly = false,
}: {
  kind: Review["kind"];
  entity?: RelationshipEntity;
  user: SessionUser;
  onSaved: (e: RelationshipEntity) => void;
  onClose: () => void;
  readonly?: boolean;
}) {
  const signal = useScope(),
    [d, D] = useState<Review>(() =>
      entity
        ? (entity.data as Review)
        : kind === "onboarding"
          ? {
              kind,
              dossierId: "",
              personId: "",
              modelId: "",
              values: [],
              assigneeIds: [],
              teamIds: [],
              tags: [],
              followedBy: [],
              origin: "creation",
            }
          : kind === "identity"
            ? {
                kind,
                personId: "",
                dossierId: "",
                evidence: [],
                result: "to_review",
                observedOn: "",
                expiresOn: "",
                method: "",
                address: "",
                birthIdentity: "",
                reason: "",
              }
            : {
                kind,
                dossierId: "",
                personId: null,
                level: "standard",
                reason: "",
                role: "",
                observedOn: "",
                decisionOn: "",
                nextReviewOn: "",
                policyId: "",
                policyVersion: 1,
                evidence: [],
                recipientIds: [user.id],
                signals: [],
                status: "reviewed",
              },
    ),
    [model, M] = useState<RelationshipEntity | null>(null),
    [status, Status] = useState<z.infer<typeof OnboardingStatusSchema> | null>(
      null,
    ),
    [error, E] = useState(""),
    [notice, N] = useState(""),
    [busy, B] = useState(false);
  useEffect(() => {
    if (d.kind !== "onboarding" || !d.modelId) return;
    const c = new AbortController();
    void request(
      "/relationship/entities/" + d.modelId,
      RelationshipEntitySchema,
      c.signal,
    )
      .then(M)
      .catch((e) => {
        if (!c.signal.aborted) E(message(e));
      });
    return () => c.abort();
  }, [d.kind, d.kind === "onboarding" ? d.modelId : null]);
  useEffect(() => {
    if (kind !== "onboarding" || !entity) return;
    const c = new AbortController();
    void request(
      "/relationship/onboarding/" + entity.id + "/status",
      OnboardingStatusSchema,
      c.signal,
    )
      .then(Status)
      .catch((e) => {
        if (!c.signal.aborted) E(message(e));
      });
    return () => c.abort();
  }, [entity?.id, entity?.version, kind]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    B(true);
    E("");
    try {
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
            data: d,
          }),
        },
      );
      onSaved(r);
    } catch (e) {
      E(message(e));
    } finally {
      B(false);
    }
  }
  function cell(
    stepId: string,
    patch: Partial<z.infer<typeof OnboardingValueSchema>>,
  ) {
    if (d.kind !== "onboarding") return;
    const old =
      d.values.find((v) => v.stepId === stepId) ??
      OnboardingValueSchema.parse({ stepId, value: null });
    D({
      ...d,
      values: [
        ...d.values.filter((v) => v.stepId !== stepId),
        { ...old, ...patch },
      ],
    });
  }
  return (
    <form className="relationship-form" onSubmit={(e) => void submit(e)}>
      <h2>
        {kind === "lab"
          ? "Revue humaine de vigilance LAB"
          : kind === "identity"
            ? "Examen d’identité de la personne"
            : "Accueil client"}
      </h2>
      <ErrorSummary message={error || undefined} />
      {notice && <p role="status">{notice}</p>}
      <fieldset disabled={readonly || busy}>
        <PanelCard title="Dossier et personne">
          <div className="relationship-fields">
            <RecordChoice
              name="review-dossier"
              label="Dossier"
              kind="dossier"
              value={d.dossierId}
              onChange={(v) => D({ ...d, dossierId: v })}
            />
            <RecordChoice
              name="review-person"
              label="Personne concernée"
              kind="contact"
              value={d.personId ?? ""}
              onChange={(v) =>
                D({ ...d, personId: kind === "lab" ? v || null : v } as Review)
              }
            />
          </div>
        </PanelCard>
        {d.kind === "onboarding" && (
          <>
            <PanelCard title="Configuration et affectation">
              <ModelChoice
                name="onboarding-model"
                label="Modèle d’accueil"
                kind="onboarding_model"
                value={d.modelId}
                onChange={(id, m) => {
                  D({ ...d, modelId: id });
                  M(m);
                }}
              />
              <div className="relationship-fields">
                <Choice
                  name="onboarding-origin"
                  label="Création ou reprise"
                  value={d.origin}
                  onChange={(v) => D({ ...d, origin: v as typeof d.origin })}
                  options={{ creation: "Création", reprise: "Reprise" }}
                />
                <Parties
                  kind="people"
                  values={d.assigneeIds}
                  onChange={(v) => D({ ...d, assigneeIds: v })}
                />
                <Parties
                  kind="teams"
                  values={d.teamIds}
                  onChange={(v) => D({ ...d, teamIds: v })}
                />
                <TagsField
                  tags={d.tags}
                  onChange={(v) => D({ ...d, tags: v })}
                  errors={{}}
                />
                <Checkbox
                  label="Suivre cet accueil"
                  checked={d.followedBy.includes(user.id)}
                  onChange={(e) =>
                    D({
                      ...d,
                      followedBy: e.target.checked
                        ? [...d.followedBy, user.id]
                        : d.followedBy.filter((id) => id !== user.id),
                    })
                  }
                />
              </div>
            </PanelCard>
            {model?.data.kind === "onboarding_model" &&
              model.data.steps
                .filter((s) => s.active)
                .map((step) => {
                  const value = d.values.find((v) => v.stepId === step.id),
                    locked = step.source === "system";
                  return (
                    <PanelCard
                      key={step.id}
                      title={step.name}
                      subtitle={
                        locked
                          ? "Source système • habilitation inconnue"
                          : step.required
                            ? "Saisie manuelle • étape requise"
                            : "Saisie manuelle"
                      }
                    >
                      <div className="relationship-stack">
                        {locked ? (
                          <p>
                            En attente d’une observation source qualifiée. Cette
                            étape ne peut pas être cochée manuellement.
                          </p>
                        ) : (
                          <>
                            <div className="relationship-fields">
                              {step.type === "boolean" ? (
                                <Checkbox
                                  label={step.name}
                                  checked={value?.value === true}
                                  onChange={(e) =>
                                    cell(step.id, { value: e.target.checked })
                                  }
                                />
                              ) : step.type === "status" ? (
                                <Choice
                                  name={step.id + "-value"}
                                  label="Valeur"
                                  value={String(value?.value ?? "")}
                                  onChange={(v) =>
                                    cell(step.id, { value: v || null })
                                  }
                                  options={{
                                    "": "Non renseigné",
                                    ...Object.fromEntries(
                                      step.statuses.map((s) => [s.id, s.name]),
                                    ),
                                  }}
                                />
                              ) : (
                                <Field
                                  name={step.id + "-value"}
                                  label={step.name}
                                  type={step.type === "date" ? "date" : "text"}
                                  value={String(value?.value ?? "")}
                                  onChange={(v) =>
                                    cell(step.id, { value: v || null })
                                  }
                                />
                              )}
                              <Choice
                                name={step.id + "-status"}
                                label="Avancement"
                                value={value?.status ?? "pending"}
                                onChange={(v) =>
                                  cell(step.id, {
                                    status: v as z.infer<
                                      typeof OnboardingValueSchema
                                    >["status"],
                                  })
                                }
                                options={{
                                  pending: "À faire",
                                  in_progress: "En cours",
                                  done: "Terminé",
                                  blocked: "Bloqué",
                                  not_applicable: "Non applicable",
                                }}
                              />
                              <Field
                                name={step.id + "-date"}
                                label="Date du contrôle"
                                type="date"
                                value={value?.date ?? ""}
                                onChange={(v) =>
                                  cell(step.id, { date: v || null })
                                }
                              />
                              <Field
                                name={step.id + "-expires"}
                                label="Validité jusqu’au"
                                type="date"
                                value={value?.expiresOn ?? ""}
                                onChange={(v) =>
                                  cell(step.id, { expiresOn: v || null })
                                }
                              />
                            </div>
                            <Area
                              name={step.id + "-note"}
                              label="Note et blocage"
                              value={value?.note ?? ""}
                              onChange={(v) => cell(step.id, { note: v })}
                            />
                            <EvidenceEditor
                              dossierId={d.dossierId}
                              value={value?.evidence ?? []}
                              onChange={(evidence) =>
                                cell(step.id, { evidence })
                              }
                              disabled={readonly}
                            />
                            {step.semantic === "identity" && (
                              <p>
                                L’identité est vérifiée dans l’examen de la
                                personne. Une case seule ne lève pas ce blocage.
                              </p>
                            )}
                            {step.semantic === "fiscal" && (
                              <p>
                                Déclaration du cabinet, sans habilitation
                                portail vérifiée.
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </PanelCard>
                  );
                })}
          </>
        )}
        {d.kind === "identity" && (
          <PanelCard title="Vérification humaine et validité">
            <div className="relationship-fields">
              <Choice
                name="identity-result"
                label="Résultat humain"
                value={d.result}
                onChange={(v) => D({ ...d, result: v as typeof d.result })}
                options={{
                  to_review: "À examiner",
                  examined: "Examiné",
                  insufficient: "Insuffisant",
                }}
              />
              <Field
                name="identity-date"
                label="Date d’observation"
                type="date"
                value={d.observedOn}
                onChange={(v) => D({ ...d, observedOn: v })}
              />
              <Field
                name="identity-expiry"
                label="Expiration de la pièce"
                type="date"
                value={d.expiresOn}
                onChange={(v) => D({ ...d, expiresOn: v })}
              />
              <Field
                name="identity-method"
                label="Méthode d’examen"
                value={d.method}
                onChange={(v) => D({ ...d, method: v })}
              />
              <Field
                name="identity-address"
                label="Adresse examinée"
                value={d.address}
                onChange={(v) => D({ ...d, address: v })}
              />
              <Field
                name="identity-birth"
                label="Identité de naissance examinée"
                value={d.birthIdentity}
                onChange={(v) => D({ ...d, birthIdentity: v })}
              />
            </div>
            <Area
              name="identity-reason"
              label="Conclusion motivée"
              value={d.reason}
              onChange={(v) => D({ ...d, reason: v })}
            />
            <p>
              L’examen appartient à cette personne et reste soumis aux droits de
              ses dossiers. L’expiration réouvre le blocage ; les versions
              antérieures sont conservées.
            </p>
          </PanelCard>
        )}
        {d.kind === "lab" && (
          <>
            <PanelCard title="Décision humaine motivée">
              <div className="relationship-fields">
                <Choice
                  name="lab-level"
                  label="Niveau de vigilance"
                  value={d.level}
                  onChange={(v) => D({ ...d, level: v as typeof d.level })}
                  options={{
                    simplified: "Simplifiée",
                    standard: "Standard",
                    enhanced: "Renforcée",
                  }}
                />
                <Choice
                  name="lab-status"
                  label="État de la revue"
                  value={d.status}
                  onChange={(v) => D({ ...d, status: v as typeof d.status })}
                  options={{
                    reviewed: "Examinée",
                    reopened: "Rouverte pour examen",
                  }}
                />
                <Field
                  name="lab-role"
                  label="Rôle du décideur"
                  value={d.role}
                  onChange={(v) => D({ ...d, role: v })}
                />
                <Field
                  name="lab-observed"
                  label="Date d’observation"
                  type="date"
                  value={d.observedOn}
                  onChange={(v) => D({ ...d, observedOn: v })}
                />
                <Field
                  name="lab-decision"
                  label="Date de décision"
                  type="date"
                  value={d.decisionOn}
                  onChange={(v) => D({ ...d, decisionOn: v })}
                />
              </div>
              <Area
                name="lab-reason"
                label="Justification de la vigilance"
                value={d.reason}
                onChange={(v) => D({ ...d, reason: v })}
              />
              <Area
                name="lab-signals"
                label="Signaux à examiner (un par ligne)"
                value={d.signals.join("\n")}
                onChange={(v) =>
                  D({ ...d, signals: v.split("\n").filter(Boolean) })
                }
              />
            </PanelCard>
            <PanelCard title="Révision et rappel du cabinet">
              <ModelChoice
                name="lab-policy"
                label="Politique de vigilance"
                kind="lab_policy"
                value={d.policyId}
                onChange={(id, m) =>
                  D({ ...d, policyId: id, policyVersion: m?.version ?? 1 })
                }
              />
              <Field
                name="lab-next"
                label="Prochaine révision saisie"
                type="date"
                value={d.nextReviewOn}
                onChange={(v) => D({ ...d, nextReviewOn: v })}
              />
              <Checkbox
                label="Recevoir le rappel interne"
                checked={d.recipientIds.includes(user.id)}
                onChange={(e) =>
                  D({
                    ...d,
                    recipientIds: e.target.checked
                      ? [...d.recipientIds, user.id]
                      : d.recipientIds.filter((id) => id !== user.id),
                  })
                }
              />
              <PeopleSelect
                name="lab-recipient"
                value={d.recipientIds.find((id) => id !== user.id) ?? null}
                onChange={(v) =>
                  D({
                    ...d,
                    recipientIds: [
                      ...d.recipientIds.filter((id) => id === user.id),
                      ...(v ? [v] : []),
                    ],
                  })
                }
              />
              <p>
                Les rappels respectent les préférences et droits LAB courants.
                Aucun score, contrôle réglementaire ou signalement automatique.
              </p>
            </PanelCard>
          </>
        )}
        {d.kind !== "onboarding" && (
          <PanelCard title="Justificatifs et résultats d’examen">
            <EvidenceEditor
              dossierId={d.dossierId}
              value={d.evidence}
              onChange={(evidence) => D({ ...d, evidence })}
              disabled={readonly}
            />
          </PanelCard>
        )}
      </fieldset>
      {status && (
        <PanelCard title="Conditions d’activation">
          <div className="relationship-stack">
            {status.blockers.length ? (
              <ul>
                {status.blockers.map((b, i) => (
                  <li key={i}>{b.reason}</li>
                ))}
              </ul>
            ) : (
              <p>
                Les contrôles requis sont renseignés et en cours de validité.
              </p>
            )}
            <p>
              Origine du dossier :{" "}
              {Object.values(status.creationOrigins)
                .map((o) => o.kind)
                .filter((x, i, a) => a.indexOf(x) === i)
                .join(", ") || "À renseigner"}
              . Accès client non activé.
            </p>
            <Button
              disabled={readonly || busy}
              onClick={() => {
                B(true);
                void request(
                  "/relationship/onboarding/" + entity!.id + "/activate",
                  z.object({ state: z.string() }),
                  signal,
                  {
                    method: "POST",
                    body: JSON.stringify({
                      operationId: crypto.randomUUID(),
                      expectedVersion: entity!.version,
                    }),
                  },
                )
                  .then(() =>
                    N(
                      "Demande enregistrée, en attente du producteur portail client.",
                    ),
                  )
                  .catch((e) => E(message(e)))
                  .finally(() => B(false));
              }}
            >
              Demander l’activation
            </Button>
          </div>
        </PanelCard>
      )}
      <FormActions busy={busy} readonly={readonly} onCancel={onClose} />
    </form>
  );
}
