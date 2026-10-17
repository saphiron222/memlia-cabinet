import { formatCivilDate } from "./civil";
import { tabKeys } from "./tabs";
import { useEffect, useState } from "react";
import { Button } from "@memlia/ui";
import {
  CabinetRecordSchema,
  HistorySchema,
  DocumentListSchema,
  DocumentSchema,
  type CabinetRecord,
  type SessionUser,
  type WorkflowModel,
} from "@memlia/contracts";
import { z } from "zod";
import { request, useScope, message, downloadDocument } from "../../api";
import { ErrorSummary, Select } from "../../forms";
import { WorkPanel } from "./WorkPanel";
import { TaskForm } from "./TaskForm";
import { useRecordCapabilities } from "../administration/capabilities";
import { stateLabels } from "../../RecordLabels";
export function TaskDetail({
  id,
  models,
  user,
}: {
  id: string;
  models: WorkflowModel[];
  user: SessionUser;
}) {
  const signal = useScope(),
    rights = useRecordCapabilities([id]);
  const [record, setRecord] = useState<Extract<
      CabinetRecord,
      { kind: "tache" }
    > | null>(null),
    [dossier, setDossier] = useState<CabinetRecord | null>(null),
    [tab, setTab] = useState(
      new URLSearchParams(location.hash.split("?")[1]).get("section") === "time"
        ? "time"
        : "work",
    ),
    [edit, setEdit] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<z.infer<typeof HistorySchema> | null>(
      null,
    ),
    [documents, setDocuments] = useState<z.infer<typeof DocumentSchema>[]>([]),
    [piece, setPiece] = useState(""),
    [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  async function load() {
    setError("");
    try {
      const r = await request("/records/" + id, CabinetRecordSchema, signal);
      if (r.kind !== "tache") throw Error("Tâche inaccessible.");
      setRecord(r);
      setDossier(
        r.dossierId
          ? await request(
              "/records/" + r.dossierId,
              CabinetRecordSchema,
              signal,
            )
          : null,
      );
      if (r.dossierId)
        setDocuments(
          (
            await request(
              "/documents?dossierId=" + r.dossierId,
              DocumentListSchema,
              signal,
            )
          ).items,
        );
      const linked = await Promise.all(
        r.data.documentIds.map((id) =>
          request("/documents/" + id, DocumentSchema, signal),
        ),
      );
      setDocuments((current) => [
        ...new Map([...current, ...linked].map((d) => [d.id, d])).values(),
      ]);
      setPeople(
        (
          await request(
            "/workflows/targets/" + id + "/people",
            z.object({
              items: z.array(z.object({ id: z.uuid(), name: z.string() })),
            }),
            signal,
          )
        ).items,
      );
    } catch (e) {
      if (!signal.aborted) {
        setRecord(null);
        setError(message(e));
      }
    }
  }
  useEffect(() => {
    void load();
  }, [id]);
  async function move(value: string) {
    if (!record) return;
    setBusy(true);
    setError("");
    try {
      const r = await request(
        record.data.typeId
          ? `/workflows/tasks/${id}/move`
          : `/records/${id}/transition`,
        CabinetRecordSchema,
        signal,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            expectedVersion: record.version,
            ...(record.data.typeId ? { stepId: value } : { state: value }),
          }),
        },
      );
      if (r.kind === "tache") setRecord(r);
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function attach() {
    if (!record || !piece) return;
    const {
      id: _,
      version,
      createdAt: __,
      updatedAt: ___,
      ...content
    } = record;
    setBusy(true);
    try {
      const r = await request("/records/" + id, CabinetRecordSchema, signal, {
        method: "PUT",
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          expectedVersion: version,
          record: {
            ...content,
            data: {
              ...content.data,
              documentIds: [...new Set([...content.data.documentIds, piece])],
            },
          },
        }),
      });
      if (r.kind === "tache") setRecord(r);
      setPiece("");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const model = models.find((m) => m.id === record?.data.typeId),
    steps = model?.model.kind === "task_type" ? model.model.steps : [];
  return (
    <section className="work-detail">
      <a href="#tache">Revenir aux tâches</a>
      <ErrorSummary message={error || undefined} />
      {!record ? (
        error ? (
          <Button onClick={() => void load()}>Réessayer</Button>
        ) : (
          <p role="status">Chargement de la tâche…</p>
        )
      ) : (
        <>
          <header className="work-record-header">
            <div>
              <span
                className="work-type-label"
                style={
                  model?.model.kind === "task_type"
                    ? {
                        color: `var(--t-tag-text-${model.model.color})`,
                        background: `var(--t-tag-background-${model.model.color})`,
                      }
                    : undefined
                }
              >
                {model?.model.name ?? "Tâche générale"}
              </span>
              <h2>{record.title}</h2>
              <span className="badge">{stateLabels[record.data.state]}</span>
            </div>
            <div className="actions">
              <Button onClick={() => void load()} disabled={busy}>
                Actualiser
              </Button>
              <Button
                variant="solid"
                disabled={!rights.grants[id]?.includes("update") || busy}
                onClick={() => setEdit(true)}
              >
                Modifier la tâche
              </Button>
            </div>
          </header>
          <div className="work-detail-layout">
            <aside
              className="work-properties"
              aria-label="Propriétés de la tâche"
            >
              <h3>Propriétés</h3>
              <dl>
                <div>
                  <dt>Dossier</dt>
                  <dd>
                    {dossier ? (
                      <a href={"#dossier?id=" + dossier.id}>{dossier.title}</a>
                    ) : (
                      "Sans dossier"
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Échéance</dt>
                  <dd>
                    {record.data.dueDate
                      ? formatCivilDate(record.data.dueDate)
                      : "À préciser"}
                  </dd>
                </div>
                <div>
                  <dt>Urgence</dt>
                  <dd>{record.data.priority}</dd>
                </div>
                <div>
                  <dt>Responsables</dt>
                  <dd>
                    {record.data.assigneeIds.length
                      ? record.data.assigneeIds
                          .map(
                            (id) =>
                              people.find((p) => p.id === id)?.name ??
                              "Membre du cabinet",
                          )
                          .join(", ")
                      : "Non affectée"}
                  </dd>
                </div>
                <div>
                  <dt>Facturation</dt>
                  <dd>
                    {
                      {
                        unknown: "À préciser",
                        billable: "Facturable",
                        included: "Incluse",
                        non_billable: "Non facturable",
                      }[record.data.billing]
                    }
                  </dd>
                </div>
                <div>
                  <dt>Étiquettes</dt>
                  <dd>{record.data.tags.join(", ") || "Aucune"}</dd>
                </div>
                <div>
                  <dt>Confidentialité</dt>
                  <dd>
                    {record.confidential ? "Restreinte" : "Droits du dossier"}
                  </dd>
                </div>
                <div>
                  <dt>Temps prévu</dt>
                  <dd>
                    {record.data.plannedMinutes === null
                      ? "À préciser"
                      : `${record.data.plannedMinutes} min`}
                  </dd>
                </div>
                {record.data.recurrence && (
                  <div>
                    <dt>Récurrence</dt>
                    <dd>
                      {record.data.recurrence.period} · modèle v
                      {record.data.recurrence.modelVersion}
                    </dd>
                  </div>
                )}
              </dl>
              <Select
                name="task-move"
                label="Déplacer la tâche"
                value={record.data.stepId ?? record.data.state}
                disabled={busy || !rights.grants[id]?.includes("transition")}
                onChange={(v) => void move(v)}
              >
                {steps.length
                  ? steps.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))
                  : Object.entries(stateLabels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
              </Select>
            </aside>
            <div className="work-detail-content">
              <div
                onKeyDown={tabKeys}
                role="tablist"
                aria-label="Fiche tâche"
                className="work-tabs"
              >
                {[
                  ["work", "Travail"],
                  ["documents", "Pièces"],
                  ["time", "Temps"],
                  ["history", "Historique"],
                ].map(([key, name]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => {
                      setTab(key!);
                      if (key === "history")
                        void request(
                          "/records/" + id + "/history",
                          HistorySchema,
                          signal,
                        )
                          .then(setHistory)
                          .catch((e) => setError(message(e)));
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
              {tab === "work" && (
                <>
                  {record.data.description && (
                    <p className="work-description">
                      {record.data.description}
                    </p>
                  )}
                  <WorkPanel key={id + record.version} targetId={id} />
                </>
              )}
              {tab === "documents" && (
                <section>
                  <h3>Pièces liées</h3>
                  {!record.data.documentIds.length && (
                    <p className="work-empty">
                      Aucune pièce liée à cette tâche.
                    </p>
                  )}
                  <ul className="work-document-list">
                    {record.data.documentIds.map((id) => {
                      const d = documents.find((d) => d.id === id);
                      return (
                        <li key={id}>
                          {d ? (
                            <>
                              <span>
                                {d.filename} · v{d.version}
                              </span>
                              <Button
                                onClick={() =>
                                  void downloadDocument(
                                    d.id,
                                    d.filename,
                                    signal,
                                  ).catch((e) => setError(message(e)))
                                }
                              >
                                Télécharger
                              </Button>
                            </>
                          ) : (
                            <span>
                              Pièce hors de la page courante — consulter la GED
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <div className="work-inline">
                    <Select
                      name="task-document"
                      label="Pièce du dossier"
                      value={piece}
                      onChange={setPiece}
                    >
                      <option value="">Choisir une pièce</option>
                      {documents.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.filename} · v{d.version}
                        </option>
                      ))}
                    </Select>
                    <Button
                      disabled={
                        !piece || busy || !rights.grants[id]?.includes("update")
                      }
                      onClick={() => void attach()}
                    >
                      Lier la pièce
                    </Button>
                  </div>
                  <a href="#documents">Ouvrir les documents du cabinet</a>
                </section>
              )}
              {tab === "time" && (
                <section id="task-time">
                  <h3>Temps lié à cette tâche</h3>
                  <dl className="work-time">
                    <dt>Prévu</dt>
                    <dd>
                      {record.data.plannedMinutes === null
                        ? "Inconnu"
                        : `${record.data.plannedMinutes} minutes`}
                    </dd>
                    <dt>Réalisé</dt>
                    <dd>Indisponible — saisies de temps non raccordées</dd>
                  </dl>
                  <a href={"#tache?id=" + id + "&section=time"}>
                    Lien permanent vers le temps de cette tâche
                  </a>
                </section>
              )}
              {tab === "history" && (
                <section>
                  <h3>Historique</h3>
                  {history ? (
                    <ol className="work-comments">
                      {history.items.map((e) => (
                        <li key={e.id}>
                          <strong>
                            {
                              {
                                created: "Création",
                                updated: "Modification",
                                transitioned: "Déplacement",
                              }[e.action]
                            }
                          </strong>
                          <p>
                            Version {e.version} ·{" "}
                            {new Date(e.at).toLocaleString("fr-FR")}
                          </p>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p role="status">Chargement de l’historique…</p>
                  )}
                </section>
              )}
            </div>
          </div>
          {edit && (
            <TaskForm
              record={record}
              models={models}
              user={user}
              onClose={() => setEdit(false)}
              onSaved={(r) => {
                if (r.kind === "tache") setRecord(r);
                setEdit(false);
                void load();
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
