import { formatCivilDate } from "./civil";
import { columnLabels, columnValue } from "../records/columns";
import { loadWorkflowModels } from "./models";
import { tabKeys } from "./tabs";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button, Input, Checkbox } from "@memlia/ui";
import {
  WorkflowCalendarSchema,
  RecordListQuerySchema,
  WorkflowModelSchema,
  CabinetRecordSchema,
  FiscalNatureSchema,
  type CabinetRecord,
  type RecordListQuery,
  type SessionUser,
  type WorkflowModel,
} from "@memlia/contracts";
import { request, useScope, queryString, message } from "../../api";
import { ErrorSummary, Select, Field } from "../../forms";
import { stateLabels } from "../../RecordLabels";
import { ViewControls } from "../records/ViewControls";
import { CsvExport } from "../records/CsvExport";
import { TaskDetail } from "./TaskDetail";
import { TaskForm } from "./TaskForm";
import { WorkflowModels } from "./WorkflowModels";

const dateLabel = (date: string | null) =>
  date ? formatCivilDate(date) : "Sans échéance";
const due = (r: CabinetRecord) =>
  r.kind === "tache" || r.kind === "obligation" ? r.data.dueDate : null;
export function Workflows({
  user,
  calendar = false,
}: {
  user: SessionUser;
  calendar?: boolean;
}) {
  const signal = useScope();
  const [id, setId] = useState(() =>
      new URLSearchParams(location.hash.split("?")[1]).get("id"),
    ),
    [mode, setMode] = useState(calendar ? "calendar" : "list"),
    [query, setQuery] = useState<RecordListQuery>(() => {
      const defaults = calendar
        ? {
            sort: "dueDate",
            columns: "title,state,dueDate,nature,dossierId",
            includeTasks: "true",
            natures: FiscalNatureSchema.options.join(","),
          }
        : {
            kind: "tache",
            sort: "dueDate",
            columns: "title,state,dueDate,typeId,dossierId,priority",
          };
      const raw = Object.fromEntries(
        new URLSearchParams(location.hash.split("?")[1]),
      );
      delete raw.id;
      delete raw.section;
      const parsed = RecordListQuerySchema.safeParse({
        ...defaults,
        ...raw,
        ...(!calendar ? { kind: "tache" } : {}),
      });
      return parsed.success
        ? parsed.data
        : RecordListQuerySchema.parse(defaults);
    }),
    [result, setResult] = useState<z.infer<
      typeof WorkflowCalendarSchema
    > | null>(null),
    [models, setModels] = useState<WorkflowModel[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [create, setCreate] = useState(false),
    [configuration, setConfiguration] = useState(false),
    [year, setYear] = useState(String(new Date().getFullYear()));
  const link = (r: CabinetRecord) =>
    result?.productionIds.includes(r.id)
      ? "#production?id=" + r.id
      : r.kind === "obligation"
        ? "#fiscal?id=" + r.id
        : "#tache?id=" + r.id;
  useEffect(() => {
    const change = () =>
      setId(new URLSearchParams(location.hash.split("?")[1]).get("id"));
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    if (mode === "calendar")
      setQuery((q) =>
        q.from && q.to
          ? q
          : {
              ...q,
              from: year + "-01-01",
              to: year + "-12-31",
              offset: 0,
            },
      );
  }, [mode]);
  const fetchQuery = queryString({
    ...query,

    limit: query.limit,
  });
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    void request(
      "/workflows/calendar?" + fetchQuery,
      WorkflowCalendarSchema,
      c.signal,
    )
      .then((r) => {
        setResult(r);
        setLoading(false);
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setResult(null);
          setError(message(e));
          setLoading(false);
        }
      });
    return () => c.abort();
  }, [fetchQuery, revision, calendar]);
  useEffect(() => {
    void loadWorkflowModels(signal)
      .then((r) => setModels(r.items))
      .catch((e) => setError(message(e)));
  }, [revision]);
  const patch = (p: Partial<RecordListQuery>) =>
    setQuery((q) => ({ ...q, ...p, offset: 0 }));
  async function move(record: CabinetRecord, value: string) {
    if (record.kind !== "tache") return;
    setError("");
    try {
      if (record.data.typeId && !query.taskTypeId) {
        const model = models.find((m) => m.id === record.data.typeId)?.model;
        if (model?.kind !== "task_type")
          throw Error("Type indisponible. Actualisez les modèles.");
        const step =
          value === "terminee"
            ? model.steps.find((s) => s.final)
            : value === "a_faire"
              ? model.steps.find((s) => !s.final)
              : model.steps.find((s, index) => !s.final && index > 0);
        if (!step)
          throw Error(
            "Ce type ne possède pas cette étape. Filtrez sur son type pour choisir une étape disponible.",
          );
        value = step.id;
      }
      await request(
        record.data.typeId
          ? `/workflows/tasks/${record.id}/move`
          : `/records/${record.id}/transition`,
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
      setRevision((v) => v + 1);
    } catch (e) {
      setError(message(e));
    }
  }
  const stages = query.taskTypeId
    ? models.find((m) => m.id === query.taskTypeId)?.model
    : null;
  const columns =
    stages?.kind === "task_type"
      ? stages.steps.map((s) => ({ id: s.id, name: s.name }))
      : Object.entries(stateLabels).map(([id, name]) => ({ id, name }));
  function event(r: CabinetRecord) {
    return (
      <a className="work-event" aria-label={r.title} href={link(r)} key={r.id}>
        <span className="work-date">{dateLabel(due(r))}</span>
        <span>{r.title}</span>
        <small>
          {r.dossierId ? result?.dossiers[r.dossierId] : "Sans dossier"}
        </small>
        <small>
          {r.kind === "tache"
            ? stateLabels[r.data.state]
            : r.kind === "obligation"
              ? r.data.nature + " · " + columnValue(r, "preparation")
              : ""}
        </small>
      </a>
    );
  }
  if (id && !calendar)
    return (
      <div className="workflow-workspace">
        <TaskDetail key={id} id={id} models={models} user={user} />
      </div>
    );
  return (
    <div className="workflow-workspace">
      <div className="work-topline">
        <div
          onKeyDown={tabKeys}
          role="tablist"
          aria-label="Vues de travail"
          className="work-tabs"
        >
          {(calendar
            ? [
                ["list", "Liste"],
                ["calendar", "Calendrier"],
              ]
            : [
                ["list", "Liste"],
                ["kanban", "Kanban"],
                ["week", "Semaine"],
                ["calendar", "Calendrier"],
              ]
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={mode === key}
              onClick={() => setMode(key!)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="actions">
          {user.permissions.some((p) => p.action === "manage_users") && (
            <Button onClick={() => setConfiguration((v) => !v)}>
              {configuration ? "Fermer les modèles" : "Modèles et récurrences"}
            </Button>
          )}
          {!calendar && (
            <Button variant="solid" onClick={() => setCreate(true)}>
              Créer une tâche
            </Button>
          )}
        </div>
      </div>
      {configuration && (
        <WorkflowModels
          models={models}
          onChange={() => setRevision((v) => v + 1)}
        />
      )}
      <div className="work-toolbar">
        <label className="work-search">
          <span className="sr-only">Rechercher le travail</span>
          <Input
            placeholder="Rechercher le travail…"
            value={query.q ?? ""}
            onChange={(e) => patch({ q: e.target.value })}
          />
        </label>
        {(calendar || mode === "calendar") && (
          <Field
            name="calendar-year"
            label="Année"
            value={query.from?.slice(0, 4) ?? year}
            type="number"
            onChange={(v) => {
              setYear(v);
              if (/^\d{4}$/.test(v))
                patch({ from: v + "-01-01", to: v + "-12-31" });
            }}
          />
        )}
        <Select
          name="filter-type"
          label="Type"
          value={query.taskTypeId ?? ""}
          onChange={(v) => patch({ taskTypeId: v || undefined })}
        >
          <option value="">Tous les types</option>
          {models
            .filter((m) => m.model.kind === "task_type")
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.model.name}
              </option>
            ))}
        </Select>
        <Button
          onClick={() =>
            patch({ assigneeId: query.assigneeId ? undefined : user.id })
          }
        >
          {query.assigneeId ? "Toute l’équipe" : "Mes tâches"}
        </Button>
        <Button variant="ghost" onClick={() => setRevision((v) => v + 1)}>
          Actualiser
        </Button>
        <CsvExport query={query} />
      </div>
      {calendar && (
        <details className="work-filter-disclosure">
          <summary>Natures du calendrier</summary>
          <div className="work-natures">
            {FiscalNatureSchema.options.map((n) => (
              <label key={n} className="check">
                <Checkbox
                  checked={(query.natures ?? "").split(",").includes(n)}
                  onCheckedChange={(v) => {
                    const values = new Set(
                      (query.natures ?? "").split(",").filter(Boolean),
                    );
                    if (v) values.add(n);
                    else values.delete(n);
                    patch({ natures: [...values].join(",") });
                  }}
                />
                {n}
              </label>
            ))}
            <label className="check">
              <Checkbox
                checked={query.includeTasks !== "false"}
                onCheckedChange={(v) =>
                  patch({ includeTasks: v ? "true" : "false" })
                }
              />
              Tâches
            </label>
          </div>
        </details>
      )}
      <ViewControls query={query} onChange={setQuery} custom={[]} fieldsReady />
      <ErrorSummary message={error || undefined} />
      {error && (
        <Button onClick={() => setRevision((v) => v + 1)}>Réessayer</Button>
      )}
      {loading ? (
        <p role="status">Chargement des échéances…</p>
      ) : result && !result.items.length ? (
        <div className="work-empty">
          <h3>Aucun travail dans ce périmètre</h3>
          <p>Adaptez les filtres ou créez une tâche.</p>
        </div>
      ) : (
        result && (
          <>
            {mode === "list" && (
              <div className="table-scroll">
                <table className="work-grid">
                  <thead>
                    <tr>
                      {(query.columns ?? "title").split(",").map((key) => (
                        <th key={key}>{columnLabels[key] ?? key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((r) => (
                      <tr key={r.id}>
                        {(query.columns ?? "title").split(",").map((key) => (
                          <td key={key}>
                            {key === "title" ? (
                              <a href={link(r)}>{r.title}</a>
                            ) : key === "dossierId" ? (
                              r.dossierId ? (
                                result.dossiers[r.dossierId]
                              ) : (
                                "Sans dossier"
                              )
                            ) : key === "dueDate" ? (
                              dateLabel(due(r))
                            ) : key === "state" ? (
                              <span className="badge">
                                {r.kind === "tache"
                                  ? stateLabels[r.data.state]
                                  : r.kind === "obligation"
                                    ? columnValue(r, "preparation")
                                    : ""}
                              </span>
                            ) : key === "typeId" ? (
                              r.kind === "tache" ? (
                                (models.find((m) => m.id === r.data.typeId)
                                  ?.model.name ?? "Tâche générale")
                              ) : (
                                "—"
                              )
                            ) : (
                              columnValue(r, key)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {mode === "kanban" && (
              <div className="work-board">
                {columns.map((column) => (
                  <section
                    key={column.id}
                    aria-label={column.name}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const record = result.items.find(
                        (r) => r.id === e.dataTransfer.getData("text/plain"),
                      );
                      if (record) void move(record, column.id);
                    }}
                  >
                    <h3>
                      {column.name}{" "}
                      <span className="muted">
                        {
                          result.items.filter(
                            (r) =>
                              r.kind === "tache" &&
                              (query.taskTypeId
                                ? r.data.stepId
                                : r.data.state) === column.id,
                          ).length
                        }
                      </span>
                    </h3>
                    {result.items
                      .filter(
                        (r) =>
                          r.kind === "tache" &&
                          (query.taskTypeId ? r.data.stepId : r.data.state) ===
                            column.id,
                      )
                      .map((r) => (
                        <article
                          key={r.id}
                          draggable
                          onDragStart={(e) =>
                            e.dataTransfer.setData("text/plain", r.id)
                          }
                        >
                          <a href={link(r)}>{r.title}</a>
                          <p className="muted">{dateLabel(due(r))}</p>
                          <Select
                            name={"move-" + r.id}
                            label={"Déplacer " + r.title}
                            value={column.id}
                            onChange={(v) => void move(r, v)}
                          >
                            {columns.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </Select>
                        </article>
                      ))}
                  </section>
                ))}
              </div>
            )}
            {mode === "week" && (
              <div className="work-week">
                {[
                  ...new Set(
                    result.items.map((r) => {
                      const d = due(r);
                      if (!d) return "Sans échéance";
                      const day = new Date(d + "T00:00:00Z");
                      day.setUTCDate(
                        day.getUTCDate() - ((day.getUTCDay() + 6) % 7),
                      );
                      return day.toISOString().slice(0, 10);
                    }),
                  ),
                ]
                  .sort()
                  .map((week) => (
                    <section key={week}>
                      <h3>
                        {week === "Sans échéance"
                          ? week
                          : "Semaine du " + dateLabel(week)}
                      </h3>
                      {result.items
                        .filter((r) => {
                          const d = due(r);
                          if (!d) return week === "Sans échéance";
                          const start = new Date(week + "T00:00:00Z").getTime();
                          const value = new Date(d + "T00:00:00Z").getTime();
                          return value >= start && value < start + 7 * 86400000;
                        })
                        .map(event)}
                    </section>
                  ))}
              </div>
            )}
            {mode === "calendar" && (
              <div className="work-calendar" aria-label="Calendrier annuel">
                {Array.from({ length: 12 }, (_, month) => (
                  <section key={month}>
                    <h3>
                      {new Date(Number(year), month, 1).toLocaleString(
                        "fr-FR",
                        { month: "long" },
                      )}
                    </h3>
                    {result.items
                      .filter((r) => Number(due(r)?.slice(5, 7)) === month + 1)
                      .map(event)}
                    {!result.items.some(
                      (r) => Number(due(r)?.slice(5, 7)) === month + 1,
                    ) && <p className="muted">Aucune échéance</p>}
                  </section>
                ))}
              </div>
            )}
            <div className="pagination">
              <Button
                disabled={!query.offset}
                onClick={() =>
                  setQuery((q) => ({
                    ...q,
                    offset: Math.max(0, q.offset - q.limit),
                  }))
                }
              >
                Précédent
              </Button>
              <span>
                {result.total}{" "}
                {calendar
                  ? result.total === 1
                    ? "échéance"
                    : "échéances"
                  : result.total === 1
                    ? "tâche"
                    : "tâches"}{" "}
                · {result.items.length}{" "}
                {result.items.length === 1 ? "affichée" : "affichées"}
                {result.total > result.items.length
                  ? " — période partielle, parcourir les pages"
                  : ""}
              </span>
              <Button
                disabled={query.offset + query.limit >= result.total}
                onClick={() =>
                  setQuery((q) => ({ ...q, offset: q.offset + q.limit }))
                }
              >
                Suivant
              </Button>
            </div>
          </>
        )
      )}
      {create && (
        <TaskForm
          models={models}
          user={user}
          onClose={() => setCreate(false)}
          onSaved={(r) => {
            setCreate(false);
            setRevision((v) => v + 1);
            location.hash = "tache?id=" + r.id;
          }}
        />
      )}
    </div>
  );
}
