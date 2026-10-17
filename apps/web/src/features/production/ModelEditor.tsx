import { PopulationEditor } from "./PopulationEditor";
import { columnTypeLabel, frequencyLabel } from "./value";
import { tabKeys } from "../workflows/tabs";
import { PeopleSelect } from "./PeopleSelect";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button, Checkbox } from "@memlia/ui";
import {
  ProductionModelSchema,
  ProductionTemplateSchema,
  ProductionColumnSchema,
  StageTypeSchema,
  WorkflowModelSchema,
  RoleSchema,
  type ProductionModel,
  type ProductionTemplate,
  type ProductionColumn,
} from "@memlia/contracts";
import { request, message, useScope } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
import { StageValue } from "./value";
import { TargetPicker } from "./TargetPicker";
const kinds = {
  balance: "Bilan annuel",
  custom: "Échéance personnalisée",
  process: "Process ponctuel",
  followup: "Suivi périodique",
  stage_type: "Type d’étape",
};
export function freshModel(
  kind: ProductionModel["model"]["kind"],
  year: number,
): ProductionModel["model"] {
  return kind === "stage_type"
    ? StageTypeSchema.parse({
        kind,
        name: "Nouveau type",
        statuses: [
          {
            id: crypto.randomUUID(),
            name: "À traiter",
            color: "gray",
            icon: "circle",
          },
          {
            id: crypto.randomUUID(),
            name: "Terminé",
            color: "green",
            icon: "check",
            final: true,
          },
        ],
      })
    : ProductionTemplateSchema.parse({
        kind,
        name: kinds[kind],
        target: "dossier",
        year: kind === "balance" ? year : null,
        family: kind === "balance" ? "BIC" : "",
        rule:
          kind === "custom"
            ? {
                frequency: "monthly",
                start: `${year}-01-01`,
                end: `${year}-12-31`,
                nominalDay: 31,
                lastDay: false,
                weekDay: 1,
              }
            : null,
        columns: [
          ProductionColumnSchema.parse({
            id: crypto.randomUUID(),
            name: "Réalisation",
            type: "completion",
            frequency: kind === "followup" ? "yearly" : "once",
          }),
        ],
      });
}
export function irppModel(year: number): ProductionModel["model"] {
  return ProductionTemplateSchema.parse({
    kind: "followup",
    name: "IRPP Contact",
    target: "contact",
    columns: [
      "Questionnaire",
      "Pièces",
      "Revenus",
      "Charges / crédits",
      "Préparation",
      "Validation client",
      "Dépôt",
      "Date",
      "Blocage",
    ].map((name, index) => ({
      id: crypto.randomUUID(),
      name,
      type: index === 7 ? "date" : index === 8 ? "text" : "completion",
      frequency: "yearly",
    })),
  });
}
export function ModelEditor({
  initial,
  models,
  onSave,
  onClose,
}: {
  initial: ProductionModel;
  models: ProductionModel[];
  onSave: (m: ProductionModel) => void;
  onClose: () => void;
}) {
  const signal = useScope(),
    [model, setModel] = useState(initial.model),
    [tab, setTab] = useState("general"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [roles, setRoles] = useState<z.infer<typeof RoleSchema>[]>([]),
    [checklists, setChecklists] = useState<
      z.infer<typeof WorkflowModelSchema>[]
    >([]);
  useEffect(() => {
    void request(
      "/administration/roles",
      z.object({ items: z.array(RoleSchema) }),
      signal,
    )
      .then((r) => setRoles(r.items))
      .catch(() => {});
    void request(
      "/workflows/models",
      z.object({ items: z.array(WorkflowModelSchema) }),
      signal,
    )
      .then((r) =>
        setChecklists(r.items.filter((x) => x.model.kind === "checklist")),
      )
      .catch(() => {});
  }, []);
  const update = (change: Partial<ProductionTemplate>) =>
    setModel((m) => (m.kind === "stage_type" ? m : { ...m, ...change }));
  const column = (id: string, change: Partial<ProductionColumn>) => {
    if (model.kind !== "stage_type")
      update({
        columns: model.columns.map((c) =>
          c.id === id ? { ...c, ...change } : c,
        ),
      });
  };
  const move = (index: number, delta: number) => {
    if (model.kind === "stage_type") {
      const statuses = [...model.statuses];
      [statuses[index], statuses[index + delta]] = [
        statuses[index + delta]!,
        statuses[index]!,
      ];
      setModel({ ...model, statuses });
    } else {
      const columns = [...model.columns];
      [columns[index], columns[index + delta]] = [
        columns[index + delta]!,
        columns[index]!,
      ];
      update({ columns });
    }
  };
  async function save() {
    setBusy(true);
    setError("");
    try {
      onSave(
        await request("/production/models", ProductionModelSchema, signal, {
          method: "POST",
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            id: initial.id,
            expectedVersion: initial.version,
            model,
          }),
        }),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="production-editor" aria-label="Configurer le modèle">
      <header className="production-panel-header">
        <div>
          <span className="muted">
            {kinds[model.kind]} · version {initial.version || "initiale"}
          </span>
          <h2>{model.name}</h2>
        </div>
        <Button onClick={onClose}>Fermer</Button>
      </header>
      <ErrorSummary message={error || undefined} />
      <div
        className="work-tabs"
        onKeyDown={tabKeys}
        role="tablist"
        aria-label="Configuration"
      >
        {[
          ["general", "Général"],
          ["columns", model.kind === "stage_type" ? "Statuts" : "Étapes"],
          ...(model.kind !== "stage_type"
            ? [["population", "Population"]]
            : []),
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id!)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="production-editor-body">
        {tab === "general" && (
          <div className="production-properties">
            <Field
              name="model-name"
              label="Nom du modèle"
              value={model.name}
              onChange={(name) => setModel({ ...model, name })}
            />
            {model.kind !== "stage_type" && (
              <>
                <Select
                  name="model-target"
                  label="Type de cible"
                  value={model.target}
                  onChange={(v) =>
                    update({ target: v as ProductionTemplate["target"] })
                  }
                  disabled={model.kind === "balance" || model.kind === "custom"}
                >
                  {(model.kind === "process"
                    ? ["dossier", "contact", "utilisateur", "libre"]
                    : ["dossier", "contact"]
                  ).map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </Select>
                {model.kind === "balance" && (
                  <>
                    <Field
                      name="model-year"
                      label="Exercice"
                      type="number"
                      value={String(model.year)}
                      onChange={(v) => update({ year: Number(v) })}
                    />
                    <Field
                      name="model-family"
                      label="Famille"
                      value={model.family}
                      onChange={(family) => update({ family })}
                    />
                    <Field
                      name="model-fee"
                      label="Forfait prévu (€)"
                      value={model.fee ?? ""}
                      onChange={(v) => update({ fee: v || null })}
                    />
                  </>
                )}
                {["process", "custom"].includes(model.kind) && (
                  <label className="check">
                    <Checkbox
                      checked={model.allowDuplicates}
                      onCheckedChange={(checked) =>
                        update({ allowDuplicates: checked })
                      }
                    />
                    Plusieurs lignes par dossier
                  </label>
                )}
                <label className="check">
                  <Checkbox
                    checked={model.closed}
                    onCheckedChange={(checked) => update({ closed: checked })}
                  />
                  Configuration fermée
                </label>
                {model.kind === "custom" && model.rule && (
                  <>
                    <Select
                      name="rule-nature"
                      label="Nature"
                      value={model.nature}
                      onChange={(v) =>
                        update({ nature: v as ProductionTemplate["nature"] })
                      }
                    >
                      {["personnalisee", "DAS2", "depot_comptes", "CVAE"].map(
                        (n) => (
                          <option key={n} value={n}>
                            {
                              {
                                personnalisee: "Personnalisée",
                                DAS2: "DAS2",
                                depot_comptes: "Dépôt des comptes",
                                CVAE: "CVAE",
                              }[n]
                            }
                          </option>
                        ),
                      )}
                    </Select>
                    <label className="check">
                      <Checkbox
                        checked={model.paused}
                        onCheckedChange={(checked) =>
                          update({ paused: checked })
                        }
                      />
                      Génération suspendue
                    </label>
                    <Select
                      name="rule-frequency"
                      label="Périodicité"
                      value={model.rule.frequency}
                      onChange={(v) =>
                        update({
                          rule: {
                            ...model.rule!,
                            frequency: v as NonNullable<
                              ProductionTemplate["rule"]
                            >["frequency"],
                          },
                        })
                      }
                    >
                      {["weekly", "monthly", "quarterly", "yearly"].map((v) => (
                        <option key={v} value={v}>
                          {v === "weekly"
                            ? "Hebdomadaire"
                            : v === "monthly"
                              ? "Mensuelle"
                              : v === "quarterly"
                                ? "Trimestrielle"
                                : "Annuelle"}
                        </option>
                      ))}
                    </Select>
                    <Field
                      name="rule-start"
                      label="Début"
                      type="date"
                      value={model.rule.start}
                      onChange={(start) =>
                        update({ rule: { ...model.rule!, start } })
                      }
                    />
                    <Field
                      name="rule-end"
                      label="Fin"
                      type="date"
                      value={model.rule.end ?? ""}
                      onChange={(end) =>
                        update({ rule: { ...model.rule!, end: end } })
                      }
                    />
                    {model.rule.frequency === "weekly" && (
                      <Select
                        name="rule-weekday"
                        label="Jour de la semaine"
                        value={String(model.rule.weekDay)}
                        onChange={(v) =>
                          update({
                            rule: { ...model.rule!, weekDay: Number(v) },
                          })
                        }
                      >
                        {[
                          "Lundi",
                          "Mardi",
                          "Mercredi",
                          "Jeudi",
                          "Vendredi",
                          "Samedi",
                          "Dimanche",
                        ].map((label, i) => (
                          <option key={label} value={i + 1}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    )}
                    <Field
                      name="rule-day"
                      label="Jour nominal"
                      type="number"
                      value={String(model.rule.nominalDay)}
                      onChange={(v) =>
                        update({
                          rule: { ...model.rule!, nominalDay: Number(v) },
                        })
                      }
                    />
                    <label className="check">
                      <Checkbox
                        checked={model.rule.lastDay}
                        onCheckedChange={(checked) =>
                          update({ rule: { ...model.rule!, lastDay: checked } })
                        }
                      />
                      Dernier jour du mois
                    </label>
                  </>
                )}
                <PeopleSelect
                  name="model-assignee"
                  value={model.assigneeId}
                  onChange={(assigneeId) => update({ assigneeId })}
                />
                <Select
                  name="model-checklist"
                  label="Checklist commune"
                  value={model.checklistModelId ?? ""}
                  onChange={(v) => update({ checklistModelId: v || null })}
                >
                  <option value="">Aucune</option>
                  {checklists.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.model.name}
                    </option>
                  ))}
                </Select>
                <Field
                  name="model-tags"
                  label="Étiquettes (séparées par virgule)"
                  value={model.tags.join(", ")}
                  onChange={(v) =>
                    update({
                      tags: v
                        .split(",")
                        .map((x) => x.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </>
            )}
          </div>
        )}
        {tab === "columns" && model.kind === "stage_type" && (
          <>
            <div className="table-scroll">
              <table className="work-grid">
                <thead>
                  <tr>
                    <th>Statut</th>
                    <th>Couleur</th>
                    <th>Icône</th>
                    <th>Final</th>
                    <th>Aperçu / ordre</th>
                  </tr>
                </thead>
                <tbody>
                  {model.statuses.map((s, index) => (
                    <tr key={s.id}>
                      <td>
                        <input
                          aria-label={"Nom du statut " + (index + 1)}
                          value={s.name}
                          onChange={(e) =>
                            setModel({
                              ...model,
                              statuses: model.statuses.map((x) =>
                                x.id === s.id
                                  ? { ...x, name: e.target.value }
                                  : x,
                              ),
                            })
                          }
                        />
                      </td>
                      <td>
                        <select
                          aria-label={"Couleur " + s.name}
                          value={s.color}
                          onChange={(e) =>
                            setModel({
                              ...model,
                              statuses: model.statuses.map((x) =>
                                x.id === s.id
                                  ? {
                                      ...x,
                                      color: e.target.value as typeof s.color,
                                    }
                                  : x,
                              ),
                            })
                          }
                        >
                          {[
                            "gray",
                            "blue",
                            "green",
                            "orange",
                            "red",
                            "purple",
                          ].map((x) => (
                            <option key={x}>{x}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          aria-label={"Icône " + s.name}
                          value={s.icon}
                          onChange={(e) =>
                            setModel({
                              ...model,
                              statuses: model.statuses.map((x) =>
                                x.id === s.id
                                  ? {
                                      ...x,
                                      icon: e.target.value as typeof s.icon,
                                    }
                                  : x,
                              ),
                            })
                          }
                        >
                          {["circle", "check", "clock", "alert", "minus"].map(
                            (x) => (
                              <option key={x}>{x}</option>
                            ),
                          )}
                        </select>
                      </td>
                      <td>
                        <Checkbox
                          aria-label={"Final " + s.name}
                          checked={s.final}
                          onCheckedChange={(checked) =>
                            setModel({
                              ...model,
                              statuses: model.statuses.map((x) =>
                                x.id === s.id ? { ...x, final: checked } : x,
                              ),
                            })
                          }
                        />
                      </td>
                      <td>
                        <StageValue
                          column={ProductionColumnSchema.parse({
                            id: s.id,
                            name: "Aperçu",
                            type: "status",
                            stageTypeId: initial.id,
                          })}
                          value={s.id}
                          models={[{ ...initial, model }]}
                        />
                        <Button
                          aria-label={"Monter " + s.name}
                          disabled={!index}
                          onClick={() => move(index, -1)}
                        >
                          ↑
                        </Button>
                        <Button
                          aria-label={"Descendre " + s.name}
                          disabled={index === model.statuses.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          ↓
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              onClick={() =>
                setModel({
                  ...model,
                  statuses: [
                    ...model.statuses,
                    {
                      id: crypto.randomUUID(),
                      name: "Nouveau statut",
                      color: "gray",
                      icon: "circle",
                      final: false,
                    },
                  ],
                })
              }
            >
              Ajouter un statut
            </Button>
          </>
        )}
        {tab === "columns" && model.kind !== "stage_type" && (
          <>
            <div className="production-column-list">
              {model.columns.map((c, index) => (
                <details key={c.id} open={model.columns.length === 1}>
                  <summary>
                    <span>{c.name}</span>
                    <span className="muted">
                      {columnTypeLabel[c.type]} · {frequencyLabel[c.frequency]}{" "}
                      · {c.plannedMinutes} min
                    </span>
                  </summary>
                  <div className="production-properties">
                    <Field
                      name={"column-name-" + c.id}
                      label="Nom de l’étape"
                      value={c.name}
                      onChange={(name) => column(c.id, { name })}
                    />
                    <Select
                      name={"column-type-" + c.id}
                      label="Type de valeur"
                      value={c.type}
                      onChange={(v) =>
                        column(c.id, {
                          type: v as ProductionColumn["type"],
                          stageTypeId:
                            v === "status"
                              ? (models.find(
                                  (x) => x.model.kind === "stage_type",
                                )?.id ?? null)
                              : null,
                        })
                      }
                    >
                      {[
                        ["completion", "Fait / non fait / non applicable"],
                        ["status", "Statut réutilisable"],
                        ["date", "Date"],
                        ["text", "Texte"],
                        ["boolean", "Oui / non"],
                        ["decimal", "Nombre exact"],
                      ].map(([v, l]) => (
                        <option value={v} key={v}>
                          {l}
                        </option>
                      ))}
                    </Select>
                    {c.type === "status" && (
                      <Select
                        name={"column-status-" + c.id}
                        label="Type d’étape"
                        value={c.stageTypeId ?? ""}
                        onChange={(v) =>
                          column(c.id, { stageTypeId: v || null })
                        }
                      >
                        <option value="">Choisir…</option>
                        {models
                          .filter((x) => x.model.kind === "stage_type")
                          .map((x) => (
                            <option value={x.id} key={x.id}>
                              {x.model.name}
                            </option>
                          ))}
                      </Select>
                    )}
                    <Select
                      name={"column-frequency-" + c.id}
                      label="Fréquence de la colonne"
                      value={c.frequency}
                      onChange={(v) =>
                        column(c.id, {
                          frequency: v as ProductionColumn["frequency"],
                        })
                      }
                    >
                      {[
                        ["once", "Ponctuelle"],
                        ["monthly", "Mensuelle"],
                        ["quarterly", "Trimestrielle"],
                        ["yearly", "Annuelle"],
                      ].map(([v, l]) => (
                        <option value={v} key={v}>
                          {l}
                        </option>
                      ))}
                    </Select>
                    <Select
                      name={"column-role-" + c.id}
                      label="Rôle supplémentaire"
                      value={c.requiredRoleId ?? ""}
                      onChange={(v) =>
                        column(c.id, { requiredRoleId: v || null })
                      }
                    >
                      <option value="">Aucun</option>
                      {roles.map((r) => (
                        <option value={r.id} key={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </Select>
                    <label className="check">
                      <Checkbox
                        checked={c.approval}
                        onCheckedChange={(checked) =>
                          column(c.id, { approval: checked })
                        }
                      />
                      Approbation explicite
                    </label>
                    <PeopleSelect
                      name={"column-assignee-" + c.id}
                      value={c.assigneeId}
                      onChange={(assigneeId) => column(c.id, { assigneeId })}
                    />
                    <Field
                      name={"column-date-" + c.id}
                      label="Date prévue"
                      type="date"
                      value={c.plannedDate ?? ""}
                      onChange={(v) => column(c.id, { plannedDate: v || null })}
                    />
                    <Field
                      name={"column-minutes-" + c.id}
                      label="Charge prévue (minutes)"
                      type="number"
                      value={String(c.plannedMinutes)}
                      onChange={(v) =>
                        column(c.id, { plannedMinutes: Number(v) })
                      }
                    />
                    <div className="actions">
                      <Button disabled={!index} onClick={() => move(index, -1)}>
                        Monter
                      </Button>
                      <Button
                        disabled={index === model.columns.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        Descendre
                      </Button>
                      <Button
                        onClick={() =>
                          update({
                            columns: model.columns.filter((x) => x.id !== c.id),
                          })
                        }
                      >
                        Retirer
                      </Button>
                    </div>
                  </div>
                </details>
              ))}
            </div>
            <Button
              onClick={() =>
                update({
                  columns: [
                    ...model.columns,
                    ProductionColumnSchema.parse({
                      id: crypto.randomUUID(),
                      name: "Nouvelle étape",
                      type: "text",
                      frequency: model.kind === "followup" ? "yearly" : "once",
                    }),
                  ],
                })
              }
            >
              Ajouter une étape
            </Button>
          </>
        )}
        {tab === "population" && model.kind !== "stage_type" && (
          <>
            <p className="muted">
              {model.population.length} cibles configurées. La génération
              vérifie les droits et retrouve les occurrences existantes.
            </p>
            <PopulationEditor model={model} onChange={update} />
          </>
        )}
      </div>
      <footer className="production-panel-footer">
        <Button onClick={onClose}>Annuler</Button>
        <Button disabled={busy} onClick={() => void save()}>
          Enregistrer le modèle
        </Button>
      </footer>
    </section>
  );
}
