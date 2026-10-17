import { KanbanCard } from "../../upstream/plane/kanban-card";
import { TabButton } from "../../upstream/plane/controls";
import {
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from "../../upstream/twenty/Table";
import { useInstallation } from "../administration/preferences";
import { CalendarGrid } from "./CalendarGrid";
import { Peek } from "../../interface/Peek";
import { FiscalDetail } from "../fiscal/FiscalDetail";
import { formatCivilDate } from "./civil";
import { columnLabels, columnValue } from "../records/columns";
import { loadWorkflowModels } from "./models";
import { tabKeys } from "./tabs";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button, Input, Checkbox } from "@memlia/ui";
import {
  WorkflowCalendarSchema,
  CivilDateSchema,
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
  const { info } = useInstallation();
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: info?.cabinetTimeZone ?? "Europe/Paris",
  }).format(new Date());
  const [id, setId] = useState(() =>
      new URLSearchParams(location.hash.split("?")[1]).get("id"),
    ),
    [mode, setMode] = useState(
      () =>
        new URLSearchParams(location.hash.split("?")[1]).get("view") ??
        (calendar ? "month" : "list"),
    ),
    [inspector, setInspector] = useState<CabinetRecord | null>(null),
    [anchor, setAnchor] = useState(
      () =>
        CivilDateSchema.safeParse(
          new URLSearchParams(location.hash.split("?")[1]).get("anchor"),
        ).data ?? today,
    ),
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
      delete raw.view;
      delete raw.anchor;
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
    [year, setYear] = useState(
      () =>
        new URLSearchParams(location.hash.split("?")[1])
          .get("from")
          ?.slice(0, 4) ?? today.slice(0, 4),
    );
  const link = (r: CabinetRecord) =>
    result?.productionIds.includes(r.id)
      ? "#production?id=" + r.id
      : r.kind === "obligation"
        ? "#fiscal?id=" + r.id
        : "#tache?" +
          queryString({ ...query }) +
          "&view=" +
          mode +
          "&anchor=" +
          anchor +
          "&id=" +
          r.id;
  useEffect(() => {
    const change = () => {
      const params = new URLSearchParams(location.hash.split("?")[1]);
      setId(params.get("id"));
      setMode(params.get("view") ?? (calendar ? "month" : "list"));
      const parsedAnchor = CivilDateSchema.safeParse(params.get("anchor"));
      if (parsedAnchor.success) setAnchor(parsedAnchor.data);
      const raw = Object.fromEntries(params);
      for (const key of ["id", "section", "view", "anchor"]) delete raw[key];
      const parsed = RecordListQuerySchema.safeParse({
        ...raw,
        ...(!calendar ? { kind: "tache" } : {}),
      });
      if (parsed.success) setQuery(parsed.data);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, [calendar]);
  useEffect(() => {
    if (!calendar) return;
    if (!id) {
      setInspector(null);
      return;
    }
    const c = new AbortController();
    void request("/records/" + id, CabinetRecordSchema, c.signal)
      .then(setInspector)
      .catch((e) => {
        if (!c.signal.aborted) setError(message(e));
      });
    return () => c.abort();
  }, [id, calendar]);
  useEffect(() => {
    if (mode === "calendar")
      setQuery((q) => ({
        ...q,
        from: year + "-01-01",
        to: year + "-12-31",
        offset: 0,
      }));
  }, [mode]);
  useEffect(() => {
    if (mode !== "month" && mode !== "calendarWeek") return;
    const start = new Date(anchor + "T12:00:00Z");
    if (mode === "month") start.setUTCDate(1);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + (mode === "month" ? 41 : 6));
    setQuery((q) => ({
      ...q,
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
      offset: 0,
    }));
  }, [mode, anchor]);
  useEffect(() => {
    const page = calendar ? "calendrier" : "tache";
    if (location.hash.slice(1).split("?")[0] !== page) return;
    const params = new URLSearchParams(queryString(query));
    params.set("view", mode);
    params.set("anchor", anchor);
    if (id) params.set("id", id);
    history.replaceState(null, "", `#${page}?${params}`);
  }, [query, mode, anchor, id, calendar]);
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
  const returnParams = new URLSearchParams(queryString(query));
  returnParams.set("view", mode);
  returnParams.set("anchor", anchor);
  const returnHref = `#${calendar ? "calendrier" : "tache"}?${returnParams}`;
  if (id && !calendar)
    return (
      <div className="workflow-workspace">
        <TaskDetail
          key={id}
          id={id}
          models={models}
          user={user}
          returnHref={returnHref}
        />
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
                ["month", "Mois"],
                ["calendarWeek", "Semaine"],
                ["list", "Liste"],
                ["calendar", "Année"],
              ]
            : [
                ["list", "Liste"],
                ["kanban", "Kanban"],
                ["week", "Semaine"],
                ["calendar", "Calendrier"],
              ]
          ).map(([key, label]) => (
            <TabButton
              key={key}
              role="tab"
              aria-selected={mode === key}
              onClick={() => {
                if (
                  key === "calendar" &&
                  (mode === "month" || mode === "calendarWeek")
                )
                  setYear(anchor.slice(0, 4));
                setMode(key!);
              }}
            >
              {label}
            </TabButton>
          ))}
        </div>
        <div className="actions">
          {user.permissions.some((p) => p.action === "manage_users") && (
            <Button onClick={() => setConfiguration((v) => !v)}>
              {configuration ? "Fermer les modèles" : "Modèles et récurrences"}
            </Button>
          )}
          {!calendar &&
            [...user.permissions, ...user.scopedPermissions].some(
              (p) =>
                p.action === "create" && (p.kind === "*" || p.kind === "tache"),
            ) && (
              <Button variant="solid" onClick={() => setCreate(true)}>
                Créer une tâche
              </Button>
            )}
        </div>
      </div>
      {inspector && (
        <Peek
          label="Détail de l’échéance"
          onClose={() => {
            setId(null);
            setInspector(null);
          }}
        >
          {result?.productionIds.includes(inspector.id) ? (
            <>
              <h2>{inspector.title}</h2>
              <p>{dateLabel(due(inspector))}</p>
              <a href={link(inspector)}>Ouvrir la ligne de production</a>
            </>
          ) : inspector.kind === "tache" ? (
            <TaskDetail
              id={inspector.id}
              models={models}
              user={user}
              returnHref={returnHref}
              onReturn={() => {
                setId(null);
                setInspector(null);
              }}
            />
          ) : (
            <FiscalDetail
              id={inspector.id}
              onChange={() => setRevision((v) => v + 1)}
              returnHref={returnHref}
              onReturn={() => {
                setId(null);
                setInspector(null);
              }}
            />
          )}
        </Peek>
      )}
      {configuration && (
        <WorkflowModels
          models={models}
          onChange={() => setRevision((v) => v + 1)}
        />
      )}
      {(mode === "month" || mode === "calendarWeek") && (
        <div className="calendar-navigation">
          <Button
            aria-label="Période précédente"
            onClick={() => {
              const d = new Date(anchor + "T12:00:00Z");
              if (mode === "month") {
                d.setUTCDate(1);
                d.setUTCMonth(d.getUTCMonth() - 1);
              } else d.setUTCDate(d.getUTCDate() - 7);
              setAnchor(d.toISOString().slice(0, 10));
            }}
          >
            ‹
          </Button>
          <h2>
            {new Date(anchor + "T12:00:00Z").toLocaleDateString("fr-FR", {
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            })}
          </h2>
          <Button
            aria-label="Période suivante"
            onClick={() => {
              const d = new Date(anchor + "T12:00:00Z");
              if (mode === "month") {
                d.setUTCDate(1);
                d.setUTCMonth(d.getUTCMonth() + 1);
              } else d.setUTCDate(d.getUTCDate() + 7);
              setAnchor(d.toISOString().slice(0, 10));
            }}
          >
            ›
          </Button>
          <Button onClick={() => setAnchor(today)}>Aujourd’hui</Button>
        </div>
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
        {mode === "calendar" && (
          <Field
            name="calendar-year"
            label="Année"
            value={year}
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
      ) : result &&
        !result.items.length &&
        mode !== "month" &&
        mode !== "calendarWeek" ? (
        <div className="work-empty">
          <h3>Aucun travail dans ce périmètre</h3>
          <p>Adaptez les filtres ou créez une tâche.</p>
        </div>
      ) : (
        result && (
          <>
            {(mode === "month" || mode === "calendarWeek") && (
              <CalendarGrid
                items={result.items}
                anchor={anchor}
                today={today}
                week={mode === "calendarWeek"}
                onSelect={(r) => {
                  setId(r.id);
                  setInspector(r);
                }}
              />
            )}
            {mode === "list" && (
              <div className="table-scroll">
                <Table className="work-grid">
                  <thead>
                    <TableRow>
                      {(query.columns ?? "title").split(",").map((key) => (
                        <TableHeader key={key}>
                          {columnLabels[key] ?? key}
                        </TableHeader>
                      ))}
                    </TableRow>
                  </thead>
                  <tbody>
                    {result.items.map((r) => (
                      <TableRow key={r.id}>
                        {(query.columns ?? "title").split(",").map((key) => (
                          <TableCell key={key}>
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
                              <span
                                className="semantic-status"
                                data-state={
                                  r.kind === "tache" &&
                                  r.data.state === "terminee"
                                    ? "done"
                                    : r.kind === "tache" &&
                                        r.data.state === "en_cours"
                                      ? "pending"
                                      : undefined
                                }
                              >
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
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
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
                        <KanbanCard
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
                        </KanbanCard>
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
