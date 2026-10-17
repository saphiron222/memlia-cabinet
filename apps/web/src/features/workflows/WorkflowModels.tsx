import {
  WorkflowCalendarSchema,
  FiscalNatureSchema,
  CabinetRecordSchema,
} from "@memlia/contracts";
import { useState, useEffect } from "react";
import { z } from "zod";
import { Button, Checkbox } from "@memlia/ui";
import {
  WorkflowModelSchema,
  TaskDataSchema,
  JobSchema,
  ChecklistRepriseSchema,
  previewOccurrences,
  ReminderRunListSchema,
  type WorkflowModel,
  type RecurrenceRule,
  type ChecklistReprise,
} from "@memlia/contracts";
import { request, useScope, message } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
import {
  useDossierChoices,
  DossierChoices,
} from "../referential/DossierChoices";
const labels = {
  checklist: "Checklist",
  task_type: "Type de tâche",
  recurrence: "Récurrence",
  reminder: "Rappel",
};
const ruleDefault: RecurrenceRule = {
  frequency: "monthly",
  start: new Date().toISOString().slice(0, 10),
  end: String(new Date().getFullYear() + 1) + "-12-31",
  nominalDay: 31,
  lastDay: false,
  weekDay: 1,
};
export function WorkflowModels({
  models,
  onChange,
}: {
  models: WorkflowModel[];
  onChange: () => void;
}) {
  const signal = useScope(),
    dossiers = useDossierChoices();
  const [kind, setKind] = useState<WorkflowModel["model"]["kind"]>("checklist"),
    [editing, setEditing] = useState<WorkflowModel | null>(null),
    [showForm, setShowForm] = useState(false),
    [name, setName] = useState(""),
    [items, setItems] = useState<
      Extract<WorkflowModel["model"], { kind: "checklist" }>["items"]
    >([{ id: crypto.randomUUID(), label: "" }]),
    [targets, setTargets] = useState(["tache", "TVA", "DAS2"]),
    [steps, setSteps] = useState<
      Extract<WorkflowModel["model"], { kind: "task_type" }>["steps"]
    >([
      { id: crypto.randomUUID(), name: "À traiter", final: false },
      { id: crypto.randomUUID(), name: "Terminé", final: true },
    ]),
    [color, setColor] = useState("blue"),
    [dossierId, setDossierId] = useState(""),
    [rule, setRule] = useState<RecurrenceRule>(ruleDefault),
    [checklist, setChecklist] = useState(""),
    [dates, setDates] = useState<string[] | null>(null),
    [nextDate, setNextDate] = useState<string | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [job, setJob] = useState<z.infer<typeof JobSchema> | null>(null),
    [hour, setHour] = useState("09:00"),
    [reminderText, setReminderText] = useState("Échéance à contrôler"),
    [enabled, setEnabled] = useState(true),
    [event, setEvent] = useState<"schedule" | "deadline">("schedule"),
    [targetIds, setTargetIds] = useState<string[]>([]),
    [recipients, setRecipients] = useState<string[]>([]),
    [records, setRecords] = useState<{ id: string; title: string }[]>([]),
    [targetSearch, setTargetSearch] = useState(""),
    [targetOffset, setTargetOffset] = useState(0),
    [targetTotal, setTargetTotal] = useState(0),
    [selectedRecords, setSelectedRecords] = useState<
      { id: string; title: string }[]
    >([]),
    [targetError, setTargetError] = useState(""),
    [people, setPeople] = useState<{ id: string; name: string }[]>([]),
    [importing, setImporting] = useState(false);
  function edit(m: WorkflowModel | null, newKind = kind) {
    setEditing(m);
    setJob(null);
    setKind(m?.model.kind ?? newKind);
    setName(m?.model.name ?? "");
    setDates(null);
    setNotice("");
    setShowForm(true);
    if (!m) {
      setRule(ruleDefault);
      setChecklist("");
      setDossierId("");
      setTargets(["tache", "TVA", "DAS2"]);
      setSteps([
        { id: crypto.randomUUID(), name: "À traiter", final: false },
        { id: crypto.randomUUID(), name: "Terminé", final: true },
      ]);
      setColor("blue");
      setTargetIds([]);
      setRecipients([]);
      setHour("09:00");
      setReminderText("Échéance à contrôler");
      setEnabled(true);
      setEvent("schedule");
    }

    if (m?.model.kind === "checklist") {
      setItems(m.model.items);
      setTargets(m.model.targetKinds);
    } else setItems([{ id: crypto.randomUUID(), label: "" }]);
    if (m?.model.kind === "task_type") {
      setSteps(m.model.steps);
      setColor(m.model.color);
    }
    if (m?.model.kind === "recurrence") {
      setRule(m.model.rule);
      setDossierId(m.model.dossierId);
      setChecklist(m.model.checklistModelId ?? "");
    }
    if (m?.model.kind === "reminder") {
      setRule(m.model.rule);
      setTargetIds(m.model.targetIds);
      setRecipients(m.model.recipientIds);
      setHour(m.model.hour);
      setReminderText(m.model.message);
      setEnabled(m.model.enabled);
      setEvent(m.model.event);
    }
  }
  useEffect(() => {
    if (kind !== "reminder" || !showForm) return;
    void request(
      "/users",
      z.object({
        items: z.array(z.object({ id: z.uuid(), name: z.string() })),
      }),
      signal,
    )
      .then((r) => setPeople(r.items))
      .catch((e) => setError(message(e)));
  }, [kind, showForm]);
  useEffect(() => {
    if (kind !== "reminder" || !showForm) return;
    const c = new AbortController();
    setTargetError("");
    setRecords([]);
    void request(
      "/workflows/calendar?includeTasks=true&natures=" +
        encodeURIComponent(FiscalNatureSchema.options.join(",")) +
        "&limit=50&offset=" +
        targetOffset +
        "&q=" +
        encodeURIComponent(targetSearch),
      WorkflowCalendarSchema,
      c.signal,
    )
      .then((r) => {
        setRecords(r.items);
        setTargetTotal(r.total);
      })
      .catch((e) => {
        if (!c.signal.aborted) setTargetError(message(e));
      });
    return () => c.abort();
  }, [kind, showForm, targetSearch, targetOffset]);
  useEffect(() => {
    if (kind !== "reminder" || !showForm) return;
    const c = new AbortController();
    void Promise.all(
      targetIds.map(async (id) => {
        try {
          return await request("/records/" + id, CabinetRecordSchema, c.signal);
        } catch {
          return {
            id,
            title: "Travail inaccessible — retirer de la sélection",
          };
        }
      }),
    ).then((r) => {
      if (!c.signal.aborted) setSelectedRecords(r);
    });
    return () => c.abort();
  }, [kind, showForm, targetIds, targetSearch, targetOffset]);
  useEffect(() => {
    if (!job || ["completed", "failed"].includes(job.state)) return;
    const c = new AbortController();
    const timer = setTimeout(() => {
      void request("/workflows/jobs/" + job.id, JobSchema, c.signal)
        .then(setJob)
        .catch((e) => {
          if (!c.signal.aborted) setError(message(e));
        });
    }, 500);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [job, editing?.id]);
  useEffect(() => {
    if (editing?.model.kind !== "recurrence") return;
    const c = new AbortController();
    void request(
      "/workflows/models/" + editing.id + "/job",
      z.object({ job: JobSchema.nullable() }),
      c.signal,
    )
      .then((r) => setJob(r.job))
      .catch((e) => {
        if (!c.signal.aborted) setError(message(e));
      });
    return () => c.abort();
  }, [editing?.id]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const model =
        kind === "checklist"
          ? { kind, name, targetKinds: targets, items }
          : kind === "task_type"
            ? { kind, name, color, steps }
            : kind === "recurrence"
              ? {
                  kind,
                  name,
                  dossierId,
                  rule,
                  task:
                    editing?.model.kind === "recurrence"
                      ? editing.model.task
                      : TaskDataSchema.parse({}),
                  checklistModelId: checklist || null,
                }
              : {
                  kind,
                  name,
                  targetIds,
                  recipientIds: recipients,
                  event,
                  message: reminderText,
                  hour,
                  enabled,
                  rule,
                };
      const m = await request(
        "/workflows/models",
        WorkflowModelSchema,
        signal,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            id: editing?.id ?? crypto.randomUUID(),
            expectedVersion: editing?.version ?? 0,
            model,
          }),
        },
      );
      setEditing(m);
      setNotice("Modèle enregistré · version " + m.version);
      onChange();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function preview() {
    setError("");
    try {
      const r = await request(
        "/workflows/preview",
        z.object({ dates: z.array(z.string()), today: z.string() }),
        signal,
        {
          method: "POST",
          body: JSON.stringify({ rule, from: rule.start, to: rule.end }),
        },
      );
      setDates(r.dates);
      setNextDate(r.dates.find((date) => date >= r.today) ?? null);
    } catch (e) {
      setError(message(e));
    }
  }
  async function generate() {
    if (!editing) return;
    setError("");
    setBusy(true);
    try {
      const r = await request(
        "/workflows/generate",
        z.object({ jobId: z.uuid() }),
        signal,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            modelId: editing.id,
            from: rule.start,
            to: rule.end,
          }),
        },
      );
      setJob(await request("/workflows/jobs/" + r.jobId, JobSchema, signal));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="work-models" aria-label="Modèles de travail">
      <header className="work-panel-heading">
        <h3>Modèles du cabinet</h3>
        <Button onClick={() => setImporting((v) => !v)}>
          Reprendre des modèles
        </Button>
      </header>
      <div className="actions">
        {Object.entries(labels).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            onClick={() => edit(null, key as typeof kind)}
          >
            Nouveau modèle · {label}
          </Button>
        ))}
      </div>
      <div className="work-model-list">
        {models.map((m) => (
          <button key={m.id} onClick={() => edit(m)}>
            <strong>{m.model.name}</strong>
            <span>
              {labels[m.model.kind]} · v{m.version}
            </span>
          </button>
        ))}
      </div>
      {importing && <ChecklistImport onChange={onChange} />}
      {showForm && (
        <div className="work-model-editor">
          <header className="work-panel-heading">
            <h4>
              {editing ? "Modifier" : "Créer"} · {labels[kind]}
            </h4>
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              Fermer le modèle
            </Button>
          </header>
          <ErrorSummary message={error || undefined} />
          {notice && <p role="status">{notice}</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field
              name="workflow-model-name"
              label="Nom du modèle"
              value={name}
              onChange={setName}
              required
            />
            {kind === "checklist" && (
              <>
                <fieldset>
                  <legend>Types de cible</legend>
                  <div className="work-natures">
                    {[
                      "tache",
                      "TVA",
                      "DAS2",
                      "IS",
                      "CVAE",
                      "CFE_IFER",
                      "TF",
                      "DSN",
                      "IRPP",
                      "RCM_2777",
                      "IFU_2561",
                      "DES",
                      "CUSTOM",
                    ].map((t) => (
                      <label key={t} className="check">
                        <Checkbox
                          checked={targets.includes(t)}
                          onCheckedChange={(v) =>
                            setTargets(
                              v
                                ? [...targets, t]
                                : targets.filter((x) => x !== t),
                            )
                          }
                        />
                        {t === "tache" ? "Tâches" : t}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {items.map((item, n) => (
                  <div className="work-inline" key={item.id}>
                    <Field
                      name={"model-item-" + item.id}
                      label={"Élément " + (n + 1)}
                      value={item.label}
                      onChange={(v) =>
                        setItems(
                          items.map((x) =>
                            x.id === item.id ? { ...x, label: v } : x,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={!n}
                      onClick={() => {
                        const next = [...items];
                        [next[n - 1], next[n]] = [next[n]!, next[n - 1]!];
                        setItems(next);
                      }}
                    >
                      Monter
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() =>
                        setItems(items.filter((x) => x.id !== item.id))
                      }
                    >
                      Retirer
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  onClick={() =>
                    setItems([...items, { id: crypto.randomUUID(), label: "" }])
                  }
                >
                  Ajouter une étape de contrôle
                </Button>
              </>
            )}
            {kind === "task_type" && (
              <>
                <Select
                  name="type-color"
                  label="Couleur du type"
                  value={color}
                  onChange={setColor}
                >
                  {[
                    ["blue", "Bleu"],
                    ["green", "Vert"],
                    ["orange", "Orange"],
                    ["red", "Rouge"],
                    ["purple", "Violet"],
                    ["gray", "Gris"],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
                {steps.map((s, n) => (
                  <div className="work-inline" key={s.id}>
                    <Field
                      name={"step-" + s.id}
                      label={"Étape " + (n + 1)}
                      value={s.name}
                      onChange={(v) =>
                        setSteps(
                          steps.map((x) =>
                            x.id === s.id ? { ...x, name: v } : x,
                          ),
                        )
                      }
                    />
                    <label className="check">
                      <input
                        type="radio"
                        name="final-step"
                        checked={s.final}
                        onChange={() =>
                          setSteps(
                            steps.map((x) => ({ ...x, final: x.id === s.id })),
                          )
                        }
                      />
                      Finale
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!n}
                      onClick={() => {
                        const next = [...steps];
                        [next[n - 1], next[n]] = [next[n]!, next[n - 1]!];
                        setSteps(next);
                      }}
                    >
                      Monter
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() =>
                        setSteps(steps.filter((x) => x.id !== s.id))
                      }
                    >
                      Retirer
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  onClick={() =>
                    setSteps([
                      ...steps,
                      {
                        id: crypto.randomUUID(),
                        name: "Nouvelle étape",
                        final: false,
                      },
                    ])
                  }
                >
                  Ajouter une étape
                </Button>
              </>
            )}
            {kind === "recurrence" && (
              <>
                <Select
                  name="recurrence-dossier"
                  label="Dossier de la récurrence"
                  value={dossierId}
                  onChange={setDossierId}
                >
                  <option value="">Choisir un dossier</option>
                  {dossiers.items.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </Select>
                <details>
                  <summary>Rechercher un dossier</summary>
                  <DossierChoices choices={dossiers} />
                </details>
                <Select
                  name="recurrence-checklist"
                  label="Checklist des nouvelles tâches"
                  value={checklist}
                  onChange={setChecklist}
                >
                  <option value="">Sans modèle</option>
                  {models
                    .filter(
                      (m) =>
                        m.model.kind === "checklist" &&
                        m.model.targetKinds.includes("tache"),
                    )
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.model.name}
                      </option>
                    ))}
                </Select>
              </>
            )}
            {kind === "reminder" && (
              <>
                <Select
                  name="reminder-event"
                  label="Événement du rappel"
                  value={event}
                  onChange={(v) => setEvent(v as typeof event)}
                >
                  <option value="schedule">À la fréquence choisie</option>
                  <option value="deadline">Échéance à cette date</option>
                </Select>
                <Field
                  name="reminder-message"
                  label="Contenu du rappel"
                  value={reminderText}
                  onChange={setReminderText}
                />
                <Field
                  name="reminder-hour"
                  label="Heure du cabinet"
                  type="time"
                  value={hour}
                  onChange={setHour}
                />
                <fieldset>
                  <legend>Travaux concernés</legend>
                  <Field
                    name="reminder-target-search"
                    label="Rechercher un travail"
                    value={targetSearch}
                    onChange={(v) => {
                      setTargetSearch(v);
                      setTargetOffset(0);
                    }}
                  />
                  <ErrorSummary message={targetError || undefined} />
                  <p>
                    {targetIds.length}{" "}
                    {targetIds.length === 1
                      ? "travail sélectionné"
                      : "travaux sélectionnés"}{" "}
                    · {targetTotal}{" "}
                    {targetTotal === 1 ? "résultat" : "résultats"}
                  </p>
                  {[
                    ...new Map(
                      [...selectedRecords, ...records].map((r) => [r.id, r]),
                    ).values(),
                  ].map((r) => (
                    <label className="check" key={r.id}>
                      <Checkbox
                        checked={targetIds.includes(r.id)}
                        onCheckedChange={(v) =>
                          setTargetIds(
                            v
                              ? [...targetIds, r.id]
                              : targetIds.filter((x) => x !== r.id),
                          )
                        }
                      />
                      {r.title}
                    </label>
                  ))}
                  <div className="actions">
                    <Button
                      disabled={!targetOffset}
                      onClick={() =>
                        setTargetOffset(Math.max(0, targetOffset - 50))
                      }
                    >
                      Travaux précédents
                    </Button>
                    <Button
                      disabled={targetOffset + 50 >= targetTotal}
                      onClick={() => setTargetOffset(targetOffset + 50)}
                    >
                      Travaux suivants
                    </Button>
                  </div>
                </fieldset>
                <fieldset>
                  <legend>Destinataires</legend>
                  {people.map((p) => (
                    <label className="check" key={p.id}>
                      <Checkbox
                        checked={recipients.includes(p.id)}
                        onCheckedChange={(v) =>
                          setRecipients(
                            v
                              ? [...recipients, p.id]
                              : recipients.filter((x) => x !== p.id),
                          )
                        }
                      />
                      {p.name}
                    </label>
                  ))}
                </fieldset>
                <label className="check">
                  <Checkbox
                    checked={enabled}
                    onCheckedChange={(v) => setEnabled(!!v)}
                  />
                  Rappel actif dans l’application
                </label>
                <p className="muted">
                  Aucun email envoyé. Les droits sont vérifiés à l’heure du
                  rappel.
                </p>
              </>
            )}
            {["recurrence", "reminder"].includes(kind) && (
              <RuleFields rule={rule} onChange={setRule} />
            )}
            <footer>
              <Button type="submit" variant="solid" loading={busy}>
                Enregistrer le modèle
              </Button>
              {["recurrence", "reminder"].includes(kind) && (
                <Button type="button" onClick={() => void preview()}>
                  Prévisualiser les dates
                </Button>
              )}
              {kind === "recurrence" && editing && (
                <Button
                  type="button"
                  disabled={
                    busy ||
                    editing.model.kind !== "recurrence" ||
                    JSON.stringify(editing.model.rule) !==
                      JSON.stringify(rule) ||
                    editing.model.name !== name ||
                    editing.model.dossierId !== dossierId ||
                    (editing.model.checklistModelId ?? "") !== checklist
                  }
                  onClick={() => void generate()}
                >
                  Générer les tâches enregistrées
                </Button>
              )}
            </footer>
          </form>
          {dates && (
            <div className="work-preview" role="status">
              <strong>{dates.length} occurrences prévisualisées</strong>
              <p>
                {dates.slice(0, 24).join(" · ")}
                {dates.length > 24 ? " · …" : ""}
              </p>
              {kind === "reminder" && dates.length > 0 && (
                <p>
                  Prochaine date prévue :{" "}
                  {nextDate
                    ? `${nextDate} à ${hour}, heure du cabinet`
                    : "aucune dans cette période"}
                  .
                </p>
              )}
            </div>
          )}
          {editing?.model.kind === "reminder" && (
            <ReminderRuns modelId={editing.id} />
          )}
          {job && editing?.model.kind === "recurrence" && (
            <div role="status">
              Génération :{" "}
              {
                {
                  queued: "en attente",
                  running: "en cours",
                  completed: "terminée",
                  failed: "interrompue",
                }[job.state]
              }
              {job.error && " · " + job.error}
              {job.state === "completed" && (
                <Button onClick={onChange}>Actualiser les tâches</Button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
function RuleFields({
  rule,
  onChange,
}: {
  rule: RecurrenceRule;
  onChange: (r: RecurrenceRule) => void;
}) {
  const patch = (p: Partial<RecurrenceRule>) => onChange({ ...rule, ...p });
  return (
    <fieldset className="work-rule">
      <legend>Règle de calendrier</legend>
      <Select
        name="rule-frequency"
        label="Fréquence"
        value={rule.frequency}
        onChange={(v) => patch({ frequency: v as RecurrenceRule["frequency"] })}
      >
        <option value="weekly">Hebdomadaire</option>
        <option value="monthly">Mensuelle</option>
        <option value="quarterly">Trimestrielle</option>
        <option value="yearly">Annuelle</option>
      </Select>
      <Field
        name="rule-start"
        label="Début de la règle"
        type="date"
        value={rule.start}
        onChange={(v) => patch({ start: v })}
      />
      <Field
        name="rule-end"
        label="Fin de la règle"
        type="date"
        value={rule.end}
        onChange={(v) => patch({ end: v })}
      />
      {rule.frequency === "weekly" ? (
        <Select
          name="rule-weekday"
          label="Jour de semaine"
          value={String(rule.weekDay)}
          onChange={(v) => patch({ weekDay: Number(v) })}
        >
          {[
            "Lundi",
            "Mardi",
            "Mercredi",
            "Jeudi",
            "Vendredi",
            "Samedi",
            "Dimanche",
          ].map((d, n) => (
            <option key={d} value={n + 1}>
              {d}
            </option>
          ))}
        </Select>
      ) : (
        <>
          <Field
            name="rule-day"
            label="Jour nominal"
            type="number"
            value={String(rule.nominalDay)}
            onChange={(v) => patch({ nominalDay: Number(v) })}
            disabled={rule.lastDay}
          />
          <label className="check">
            <Checkbox
              checked={rule.lastDay}
              onCheckedChange={(v) => patch({ lastDay: !!v })}
            />
            Dernier jour du mois
          </label>
          <p className="muted">
            Un jour 31 devient le dernier jour des mois courts. Le jour nominal
            est conservé.
          </p>
        </>
      )}
    </fieldset>
  );
}
function ChecklistImport({ onChange }: { onChange: () => void }) {
  const signal = useScope();
  const [bytes, setBytes] = useState(""),
    [format, setFormat] = useState<"csv" | "xlsx">("csv"),
    [mapping, setMapping] = useState<Record<string, string>>({
      "0": "modelId",
      "1": "name",
      "2": "targetKinds",
      "3": "itemId",
      "4": "label",
      "5": "order",
    }),
    [preview, setPreview] = useState<ChecklistReprise | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function inspect() {
    setError("");
    try {
      setPreview(
        await request(
          "/workflows/imports/preview",
          ChecklistRepriseSchema,
          signal,
          {
            method: "POST",
            body: JSON.stringify({
              operationId: crypto.randomUUID(),
              exchange: "memlia-checklists-1",
              format,
              bytes,
              mapping,
            }),
          },
        ),
      );
      setSelected([]);
    } catch (e) {
      setError(message(e));
    }
  }
  async function commit() {
    if (!preview) return;
    try {
      const r = await request(
        `/workflows/imports/${preview.id}/commit`,
        z.object({
          models: z.array(WorkflowModelSchema),
          unmapped: z.array(z.string()),
        }),
        signal,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            validatedModelIds: selected,
          }),
        },
      );
      setNotice(
        `${r.models.length} modèles enregistrés. Colonnes non reprises : ${r.unmapped.join(", ") || "aucune"}.`,
      );
      setPreview(null);
      onChange();
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <section className="work-reprise">
      <h4>Reprise assistée de checklists</h4>
      <p>
        Échange memlia-checklists-1, CSV UTF-8 séparé par « ; » ou XLSX sans
        formule. Colonnes : identifiant du modèle (UUID), nom, types de cible
        séparés par virgules, identifiant d’élément (UUID), libellé, ordre. Les
        identités existantes créent une nouvelle version.
      </p>
      <label className="field">
        Fichier de modèles
        <input
          type="file"
          accept=".csv,.xlsx"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setFormat(file.name.endsWith(".xlsx") ? "xlsx" : "csv");
            void file.arrayBuffer().then((buffer) => {
              const values = new Uint8Array(buffer);
              if (values.length > 10 * 1024 * 1024) {
                setError("Fichier supérieur à 10 Mio.");
                return;
              }
              let binary = "";
              for (const b of values) binary += String.fromCharCode(b);
              setBytes(btoa(binary));
            });
          }}
        />
      </label>
      <Button disabled={!bytes} onClick={() => void inspect()}>
        Prévisualiser la reprise
      </Button>
      <ErrorSummary message={error || undefined} />
      {notice && <p role="status">{notice}</p>}
      {preview && (
        <>
          <h4>Correspondance des colonnes</h4>
          {preview.headers.map((h, n) => (
            <Select
              key={n}
              name={"mapping-" + n}
              label={h}
              value={mapping[String(n)] ?? ""}
              onChange={(v) => setMapping({ ...mapping, [String(n)]: v })}
            >
              <option value="">Ne pas reprendre</option>
              {[
                ["modelId", "Identité du modèle"],
                ["name", "Nom"],
                ["targetKinds", "Types de cible"],
                ["itemId", "Identité de l’élément"],
                ["label", "Libellé"],
                ["order", "Ordre"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          ))}
          <Button onClick={() => void inspect()}>Recalculer l’aperçu</Button>
          <p>Non repris : {preview.unmapped.join(", ") || "aucun élément"}.</p>
          {preview.errors.map((e) => (
            <p role="alert" key={e.line}>
              Ligne {e.line} : {e.message}
            </p>
          ))}
          {preview.models.map((m) => (
            <label className="check" key={m.id}>
              <Checkbox
                checked={selected.includes(m.id)}
                onCheckedChange={(v) =>
                  setSelected(
                    v
                      ? [...selected, m.id]
                      : selected.filter((id) => id !== m.id),
                  )
                }
              />
              Valider « {m.model.name} » — {m.model.items.length} éléments,
              future version {m.expectedVersion + 1}
            </label>
          ))}
          <Button
            variant="solid"
            disabled={!selected.length || !!preview.errors.length}
            onClick={() => void commit()}
          >
            Enregistrer les modèles validés
          </Button>
        </>
      )}
    </section>
  );
}

function ReminderRuns({ modelId }: { modelId: string }) {
  const signal = useScope();
  const [runs, setRuns] = useState<z.infer<
      typeof ReminderRunListSchema
    > | null>(null),
    [error, setError] = useState(""),
    [offset, setOffset] = useState(0);
  async function load() {
    setError("");
    try {
      setRuns(
        await request(
          "/notifications/runs?modelId=" + modelId + "&offset=" + offset,
          ReminderRunListSchema,
          signal,
        ),
      );
    } catch (e) {
      setError(message(e));
      setRuns(null);
    }
  }
  useEffect(() => {
    void load();
  }, [modelId, offset]);
  return (
    <section className="work-reminder-runs">
      <h4>Suivi des rappels programmés</h4>
      <Button onClick={() => void load()}>Actualiser les rappels</Button>
      <Button
        onClick={() => {
          void request(
            "/notifications/process",
            z.object({ scheduled: z.number() }),
            signal,
            {
              method: "POST",
              body: JSON.stringify({ operationId: crypto.randomUUID() }),
            },
          )
            .then(load)
            .catch((e) => setError(message(e)));
        }}
      >
        Reprendre la préparation
      </Button>
      <ErrorSummary message={error || undefined} />
      {runs ? (
        <>
          <p>
            Rattrapage automatique : au plus 31 jours par version et 20 versions
            par passage. Les droits sont contrôlés à chaque traitement.
          </p>
          {runs.preparation.map((p) => (
            <p key={p.id}>
              Modèle v{p.modelVersion} ·{" "}
              {p.complete
                ? "Période préparée"
                : "À préparer à partir du " + p.nextDate}
              {p.error && <span role="alert"> · {p.error}</span>}
            </p>
          ))}
          {!runs.items.length && (
            <p>Aucune occurrence traitée pour ce modèle.</p>
          )}
          <ul>
            {runs.items.map((r) => (
              <li key={r.job.id}>
                <strong>
                  {r.date} · modèle v{r.modelVersion}
                </strong>
                <p>
                  {
                    {
                      queued: "En attente",
                      running: "En cours",
                      completed: "Traitement terminé",
                      failed: "Interrompu après trois tentatives",
                    }[r.job.state]
                  }{" "}
                  · {r.job.attempts} tentative(s)
                </p>
                {r.job.error && <p>{r.job.error}</p>}
                <details>
                  <summary>Journal du traitement</summary>
                  {r.job.events.map((e) => (
                    <p key={e.sequence}>
                      {e.at} · {e.message}
                    </p>
                  ))}
                </details>
              </li>
            ))}
          </ul>
          <div className="actions">
            <Button
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              Rappels précédents
            </Button>
            <Button
              disabled={runs.nextOffset === null}
              onClick={() => setOffset(runs.nextOffset!)}
            >
              Rappels suivants
            </Button>
          </div>
        </>
      ) : (
        !error && <p role="status">Chargement des rappels…</p>
      )}
    </section>
  );
}
