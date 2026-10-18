import { useState } from "react";
import { z } from "zod";
import { Button } from "@memlia/ui";
import { Check as Checkbox } from "./shared";
import {
  PipelineSchema,
  MissionSchema,
  OnboardingModelSchema,
  LabPolicySchema,
  RelationshipEntitySchema,
  PipelineImportPreviewSchema,
  type RelationshipData,
  type RelationshipEntity,
} from "@memlia/contracts";
import { request, message, useScope } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
import { PanelCard } from "../../upstream/cal/PanelCard";
import { StageTypeChoice, Choice, FormActions } from "./shared";
type Model = Extract<
  RelationshipData,
  { kind: "pipeline" | "mission" | "onboarding_model" | "lab_policy" }
>;
export function initialModel(kind: Model["kind"]): Model {
  if (kind === "pipeline")
    return PipelineSchema.parse({
      kind,
      name: "Nouveau pipeline",
      stages: [
        {
          id: crypto.randomUUID(),
          name: "Prise de contact",
          color: "blue",
          icon: "circle",
          final: false,
        },
        {
          id: crypto.randomUUID(),
          name: "Découverte",
          color: "orange",
          icon: "clock",
          final: false,
        },
        {
          id: crypto.randomUUID(),
          name: "Intéressé",
          color: "purple",
          icon: "circle",
          final: false,
        },
        {
          id: crypto.randomUUID(),
          name: "Onboarding",
          color: "green",
          icon: "check",
          final: true,
        },
      ],
    });
  if (kind === "mission")
    return {
      kind,
      name: "",
      category: "",
      unit: "",
      quantified: true,
      order: 0,
      active: true,
    };
  if (kind === "lab_policy")
    return { kind, name: "", periodDays: 90, reason: "", active: true };
  return {
    kind,
    name: "",
    active: true,
    steps: [
      {
        id: crypto.randomUUID(),
        name: "Identité",
        type: "boolean",
        semantic: "identity",
        source: "manual",
        required: true,
        active: true,
        stageTypeId: null,
        stageTypeVersion: null,
        statuses: [],
      },
      {
        id: crypto.randomUUID(),
        name: "Mandat et pouvoirs",
        type: "boolean",
        semantic: "mandate",
        source: "manual",
        required: true,
        active: true,
        stageTypeId: null,
        stageTypeVersion: null,
        statuses: [],
      },
    ],
  };
}
export function ModelForm({
  kind,
  entity,
  onSaved,
  onClose,
  readonly = false,
}: {
  kind: Model["kind"];
  entity?: RelationshipEntity;
  onSaved: (e: RelationshipEntity) => void;
  onClose: () => void;
  readonly?: boolean;
}) {
  const signal = useScope(),
    [d, D] = useState<Model>(() =>
      entity ? (entity.data as Model) : initialModel(kind),
    ),
    [error, E] = useState(""),
    [busy, B] = useState(false);
  const set = (v: Partial<Model>) => D({ ...d, ...v } as Model);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    B(true);
    E("");
    try {
      const result = await request(
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
      onSaved(result);
    } catch (e) {
      E(message(e));
    } finally {
      B(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="relationship-form">
      <h2>
        {entity ? "Configurer" : "Créer"}{" "}
        {kind === "pipeline"
          ? "le pipeline"
          : kind === "mission"
            ? "la mission"
            : kind === "lab_policy"
              ? "la politique LAB"
              : "l’accueil"}
      </h2>
      <ErrorSummary message={error || undefined} />
      <fieldset disabled={readonly || busy}>
        <div className="relationship-fields">
          <Field
            name="model-name"
            label="Nom du modèle"
            value={d.name}
            onChange={(v) => set({ name: v })}
            required
          />
          <Checkbox
            label="Actif pour les nouvelles saisies"
            checked={d.active}
            onChange={(e) => set({ active: e.target.checked })}
          />
        </div>
        {d.kind === "pipeline" && (
          <>
            <PanelCard title="Étapes ordonnées">
              <div className="relationship-stack">
                {d.stages.map((s, index) => (
                  <div className="relationship-stage" key={s.id}>
                    <Field
                      name={s.id + "-name"}
                      label={"Étape " + (index + 1)}
                      value={s.name}
                      onChange={(v) =>
                        D({
                          ...d,
                          stages: d.stages.map((x) =>
                            x.id === s.id ? { ...x, name: v } : x,
                          ),
                        })
                      }
                    />
                    <Choice
                      name={s.id + "-color"}
                      label="Couleur"
                      value={s.color}
                      onChange={(v) =>
                        D({
                          ...d,
                          stages: d.stages.map((x) =>
                            x.id === s.id
                              ? { ...x, color: v as typeof x.color }
                              : x,
                          ),
                        })
                      }
                      options={{
                        gray: "Gris",
                        blue: "Bleu",
                        green: "Vert",
                        orange: "Orange",
                        red: "Rouge",
                        purple: "Violet",
                      }}
                    />
                    <Choice
                      name={s.id + "-icon"}
                      label="Icône"
                      value={s.icon}
                      onChange={(v) =>
                        D({
                          ...d,
                          stages: d.stages.map((x) =>
                            x.id === s.id
                              ? { ...x, icon: v as typeof x.icon }
                              : x,
                          ),
                        })
                      }
                      options={{
                        circle: "Cercle",
                        check: "Coche",
                        clock: "Horloge",
                        alert: "Alerte",
                        minus: "Tiret",
                      }}
                    />
                    <Checkbox
                      label="État final"
                      checked={s.final}
                      onChange={(e) =>
                        D({
                          ...d,
                          stages: d.stages.map((x) =>
                            x.id === s.id
                              ? { ...x, final: e.target.checked }
                              : x,
                          ),
                        })
                      }
                    />
                    <Button
                      disabled={!index}
                      onClick={() => {
                        const a = [...d.stages];
                        [a[index - 1], a[index]] = [a[index]!, a[index - 1]!];
                        D({ ...d, stages: a });
                      }}
                    >
                      Monter
                    </Button>
                    <Button
                      onClick={() =>
                        D({
                          ...d,
                          stages: d.stages.filter((x) => x.id !== s.id),
                        })
                      }
                    >
                      Retirer
                    </Button>
                  </div>
                ))}
                <Button
                  onClick={() =>
                    D({
                      ...d,
                      stages: [
                        ...d.stages,
                        {
                          id: crypto.randomUUID(),
                          name: "Nouvelle étape",
                          color: "gray",
                          icon: "circle",
                          final: false,
                        },
                      ],
                    })
                  }
                >
                  Ajouter une étape
                </Button>
              </div>
            </PanelCard>
            <PanelCard title="Déclencheurs indépendants">
              <div className="relationship-fields">
                {(["conversion", "quote", "letter"] as const).map((t) => (
                  <Select
                    key={t}
                    name={"trigger-" + t}
                    label={
                      t === "conversion"
                        ? "Conversion en dossier"
                        : t === "quote"
                          ? "Demande de devis"
                          : "Demande de lettre"
                    }
                    value={
                      t === "conversion"
                        ? (d.conversionStageId ?? "")
                        : t === "quote"
                          ? (d.triggers.quoteStageId ?? "")
                          : (d.triggers.letterStageId ?? "")
                    }
                    onChange={(v) =>
                      D(
                        t === "conversion"
                          ? { ...d, conversionStageId: v || null }
                          : {
                              ...d,
                              triggers: {
                                ...d.triggers,
                                [t === "quote"
                                  ? "quoteStageId"
                                  : "letterStageId"]: v || null,
                              },
                            },
                      )
                    }
                  >
                    <option value="">Aucun déclencheur</option>
                    {d.stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                ))}
              </div>
              <p>
                Devis et lettre : demandes conservées en attente du producteur
                documentaire.
              </p>
            </PanelCard>
          </>
        )}
        {d.kind === "mission" && (
          <div className="relationship-fields">
            <Field
              name="mission-category"
              label="Catégorie"
              value={d.category}
              onChange={(v) => D({ ...d, category: v })}
            />
            <Field
              name="mission-unit"
              label="Unité"
              value={d.unit}
              onChange={(v) => D({ ...d, unit: v })}
            />
            <Field
              name="mission-order"
              label="Ordre"
              type="number"
              value={String(d.order)}
              onChange={(v) => D({ ...d, order: Number(v) })}
            />
            <Checkbox
              label="Mission quantifiée"
              checked={d.quantified}
              onChange={(e) => D({ ...d, quantified: e.target.checked })}
            />
          </div>
        )}
        {d.kind === "lab_policy" && (
          <div className="relationship-fields">
            <Field
              name="policy-days"
              label="Périodicité du cabinet (jours)"
              type="number"
              value={String(d.periodDays)}
              onChange={(v) => D({ ...d, periodDays: Number(v) })}
            />
            <Field
              name="policy-reason"
              label="Justification de la politique"
              value={d.reason}
              onChange={(v) => D({ ...d, reason: v })}
            />
            <p>
              Aucune périodicité réglementaire automatique. Chaque revue
              conserve sa date de révision explicite.
            </p>
          </div>
        )}
        {d.kind === "onboarding_model" && (
          <PanelCard title="Matrice : étapes et types">
            <div className="relationship-stack">
              {d.steps.map((s, index) => (
                <div key={s.id} className="relationship-step-editor">
                  <fieldset disabled={!!entity && s.source === "system"}>
                    <div className="relationship-fields">
                      <Field
                        name={s.id + "-name"}
                        label={"Étape " + (index + 1)}
                        value={s.name}
                        onChange={(v) =>
                          D({
                            ...d,
                            steps: d.steps.map((x) =>
                              x.id === s.id ? { ...x, name: v } : x,
                            ),
                          })
                        }
                      />
                      <Choice
                        name={s.id + "-type"}
                        label="Type de valeur"
                        value={s.type}
                        onChange={(v) =>
                          D({
                            ...d,
                            steps: d.steps.map((x) =>
                              x.id === s.id
                                ? { ...x, type: v as typeof x.type }
                                : x,
                            ),
                          })
                        }
                        options={{
                          boolean: "Case",
                          date: "Date civile",
                          text: "Texte",
                          status: "Statut personnalisé",
                        }}
                      />
                      <Choice
                        name={s.id + "-semantic"}
                        label="Contrôle"
                        value={s.semantic}
                        onChange={(v) =>
                          D({
                            ...d,
                            steps: d.steps.map((x) =>
                              x.id === s.id
                                ? { ...x, semantic: v as typeof x.semantic }
                                : x,
                            ),
                          })
                        }
                        options={{
                          identity: "Identité",
                          mandate: "Mandat et pouvoirs",
                          beneficial_owners: "Bénéficiaires effectifs",
                          letter: "Lettre de mission",
                          fiscal: "Accès fiscal",
                          custom: "Étape personnalisée",
                        }}
                      />
                      <Choice
                        name={s.id + "-source"}
                        label="Provenance"
                        value={s.source}
                        onChange={(v) =>
                          D({
                            ...d,
                            steps: d.steps.map((x) =>
                              x.id === s.id
                                ? { ...x, source: v as typeof x.source }
                                : x,
                            ),
                          })
                        }
                        options={{
                          manual: "Saisie manuelle",
                          system: "Source système verrouillée",
                        }}
                      />
                      <Checkbox
                        label="Étape active"
                        checked={s.active}
                        onChange={(e) =>
                          D({
                            ...d,
                            steps: d.steps.map((x) =>
                              x.id === s.id
                                ? { ...x, active: e.target.checked }
                                : x,
                            ),
                          })
                        }
                      />
                      <Checkbox
                        label="Requise"
                        checked={s.required}
                        onChange={(e) =>
                          D({
                            ...d,
                            steps: d.steps.map((x) =>
                              x.id === s.id
                                ? { ...x, required: e.target.checked }
                                : x,
                            ),
                          })
                        }
                      />
                    </div>
                    {s.type === "status" && (
                      <>
                        <StageTypeChoice
                          value={s.stageTypeId ?? ""}
                          onChange={(type) =>
                            D({
                              ...d,
                              steps: d.steps.map((x) =>
                                x.id === s.id
                                  ? {
                                      ...x,
                                      stageTypeId: type?.id ?? null,
                                      stageTypeVersion: type?.version ?? null,
                                      statuses:
                                        type?.model.kind === "stage_type"
                                          ? type.model.statuses
                                          : [],
                                    }
                                  : x,
                              ),
                            })
                          }
                        />
                        <div className="relationship-fields">
                          {s.statuses.map((status, j) => (
                            <Field
                              key={status.id}
                              name={status.id}
                              label={"Statut " + (j + 1)}
                              disabled={!!s.stageTypeId}
                              value={status.name}
                              onChange={(v) =>
                                D({
                                  ...d,
                                  steps: d.steps.map((x) =>
                                    x.id === s.id
                                      ? {
                                          ...x,
                                          statuses: s.statuses.map((st) =>
                                            st.id === status.id
                                              ? { ...st, name: v }
                                              : st,
                                          ),
                                        }
                                      : x,
                                  ),
                                })
                              }
                            />
                          ))}
                        </div>
                        <Button
                          disabled={!!s.stageTypeId}
                          onClick={() =>
                            D({
                              ...d,
                              steps: d.steps.map((x) =>
                                x.id === s.id
                                  ? {
                                      ...x,
                                      statuses: [
                                        ...s.statuses,
                                        {
                                          id: crypto.randomUUID(),
                                          name: "À suivre",
                                          color: "blue",
                                          icon: "circle",
                                          final: false,
                                        },
                                      ],
                                    }
                                  : x,
                              ),
                            })
                          }
                        >
                          Ajouter un statut
                        </Button>
                      </>
                    )}
                    <div className="actions">
                      <Button
                        disabled={!index}
                        onClick={() => {
                          const a = [...d.steps];
                          [a[index - 1], a[index]] = [a[index]!, a[index - 1]!];
                          D({ ...d, steps: a });
                        }}
                      >
                        Monter
                      </Button>
                      <Button
                        onClick={() =>
                          D({
                            ...d,
                            steps: d.steps.filter((x) => x.id !== s.id),
                          })
                        }
                      >
                        Retirer
                      </Button>
                    </div>
                  </fieldset>
                  {s.source === "system" && (
                    <p>
                      Étape source verrouillée après enregistrement.
                      Habilitation inconnue en l’absence d’observation
                      qualifiée.
                    </p>
                  )}
                </div>
              ))}
              <Button
                onClick={() =>
                  D({
                    ...d,
                    steps: [
                      ...d.steps,
                      {
                        id: crypto.randomUUID(),
                        name: "Nouvelle étape",
                        type: "text",
                        semantic: "custom",
                        source: "manual",
                        required: false,
                        active: true,
                        stageTypeId: null,
                        stageTypeVersion: null,
                        statuses: [],
                      },
                    ],
                  })
                }
              >
                Ajouter une étape
              </Button>
            </div>
          </PanelCard>
        )}
      </fieldset>
      <FormActions busy={busy} readonly={readonly} onCancel={onClose} />
    </form>
  );
}
export function PipelineImport({
  onSaved,
}: {
  onSaved: (e: RelationshipEntity) => void;
}) {
  const signal = useScope(),
    [file, F] = useState<File | null>(null),
    [name, N] = useState(""),
    [preview, P] = useState<z.infer<typeof PipelineImportPreviewSchema> | null>(
      null,
    ),
    [error, E] = useState(""),
    [busy, B] = useState(false),
    [validated, V] = useState(false),
    [mapping, M] = useState({
      stage: "étape",
      color: "couleur",
      icon: "icône",
      conversion: "conversion",
      quote: "devis",
      letter: "lettre",
    });
  async function prepare() {
    if (!file) return;
    B(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      P(
        await request(
          "/relationship/imports/preview",
          PipelineImportPreviewSchema,
          signal,
          {
            method: "POST",
            body: JSON.stringify({
              filename: file.name,
              name,
              base64: btoa(binary),
              mapping,
            }),
          },
        ),
      );
      V(false);
    } catch (e) {
      E(message(e));
    } finally {
      B(false);
    }
  }
  return (
    <PanelCard title="Reprise assistée d’un pipeline">
      <div className="relationship-stack">
        <p>
          Format annoncé CSV séparé par « ; » ou XLSX. Une ligne par étape ;
          couleurs gray/blue/green/orange/red/purple, icônes
          circle/check/clock/alert/minus et déclencheurs true/false.
        </p>
        <ErrorSummary message={error || undefined} />
        <Field
          name="import-name"
          label="Nom du pipeline repris"
          value={name}
          onChange={N}
        />
        <label>
          Fichier d’échange
          <input
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => {
              F(e.target.files?.[0] ?? null);
              P(null);
            }}
          />
        </label>
        <div className="relationship-fields">
          {Object.entries(mapping).map(([k, v]) => (
            <Field
              key={k}
              name={"mapping-" + k}
              label={"Colonne : " + k}
              value={v}
              onChange={(v) => M({ ...mapping, [k]: v })}
            />
          ))}
        </div>
        <Button
          disabled={!file || !name || busy}
          onClick={() => void prepare()}
        >
          Prévisualiser les correspondances
        </Button>
        {preview && (
          <>
            <ol>
              {preview.correspondences.map((c) => (
                <li key={c.line}>
                  Ligne {c.line} → {c.label}
                </li>
              ))}
            </ol>
            <ul>
              {preview.unmapped.map((u, i) => (
                <li key={i}>
                  Ligne {u.line} : {u.reason}
                </li>
              ))}
            </ul>
            <Checkbox
              label="Je valide explicitement les étapes reprises et les valeurs non reprises"
              checked={validated}
              onChange={(e) => V(e.target.checked)}
            />
            <Button
              disabled={!validated || busy}
              onClick={() => {
                B(true);
                void request(
                  "/relationship/imports/" + preview.id + "/commit",
                  z.object({
                    model: RelationshipEntitySchema,
                    report: PipelineImportPreviewSchema,
                  }),
                  signal,
                  {
                    method: "POST",
                    body: JSON.stringify({
                      operationId: crypto.randomUUID(),
                      validated: true,
                    }),
                  },
                )
                  .then((r) => {
                    P(r.report);
                    onSaved(r.model);
                  })
                  .catch((e) => E(message(e)))
                  .finally(() => B(false));
              }}
            >
              Enregistrer le pipeline repris
            </Button>
            {preview.committed && (
              <p role="status">
                Reprise enregistrée. Rapport conservé et modèle éditable.
              </p>
            )}
          </>
        )}
      </div>
    </PanelCard>
  );
}
