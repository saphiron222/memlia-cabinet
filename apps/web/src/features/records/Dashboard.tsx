import { CsvExport } from "./CsvExport";
import { useEffect, useState } from "react";
import { Button } from "@memlia/ui";
import {
  DashboardSchema,
  RecordListQuerySchema,
  type Dashboard as DashboardData,
  type RecordListQuery,
  type RecordKind,
} from "@memlia/contracts";
import { request, queryString, message } from "../../api";
import { ErrorSummary } from "../../forms";
import { ScopeFilters } from "./ScopeFilters";
import { useAccountSettings } from "../administration/preferences";
import { labels, stateLabels } from "../../RecordLabels";
import { defaultColumns } from "./columns";
const widgetLabels = {
  counts: "Synthèse",
  tasks: "Progression des tâches",
  obligations: "Préparation des obligations",
};
export function Dashboard() {
  const [filters, setFilters] = useState<RecordListQuery>(() =>
      RecordListQuerySchema.parse({}),
    ),
    [data, setData] = useState<DashboardData | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [pendingOrder, setPendingOrder] = useState<
      (keyof typeof widgetLabels)[] | null
    >(null);
  const { account, save, busy, error: settingsError } = useAccountSettings();
  const query = queryString(filters);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    void request("/dashboard?" + query, DashboardSchema, controller.signal)
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [query, revision]);
  const detail = (kind: RecordKind, extra: Partial<RecordListQuery> = {}) =>
    queryString({
      ...filters,
      kind,
      columns: defaultColumns(kind),
      ...extra,
      offset: 0,
    });
  const order = pendingOrder ??
    account?.preferences.widgetOrder ?? ["counts", "tasks", "obligations"];
  async function updateOrder(next: (keyof typeof widgetLabels)[]) {
    setPendingOrder(next);
    try {
      await save({ widgetOrder: next });
    } finally {
      setPendingOrder(null);
    }
  }
  const canExport = (kind: RecordKind) =>
    [
      ...(account?.profile.permissions ?? []),
      ...(account?.profile.scopedPermissions ?? []),
    ].some((p) => p.action === "export" && (p.kind === kind || p.kind === "*"));
  return (
    <section className="home">
      <h2>Le travail du cabinet</h2>
      <p className="muted">Vos dossiers, contacts et échéances autorisés.</p>
      <ScopeFilters
        query={filters}
        onChange={(patch) => setFilters({ ...filters, ...patch, offset: 0 })}
      />
      <ErrorSummary message={error || settingsError || undefined} />
      {error ? (
        <Button onClick={() => setRevision((v) => v + 1)}>Réessayer</Button>
      ) : !data ? (
        <p role="status">Chargement de la synthèse…</p>
      ) : (
        <>
          <fieldset>
            <legend>Widgets affichés</legend>
            {(Object.keys(widgetLabels) as (keyof typeof widgetLabels)[]).map(
              (widget) => (
                <label key={widget} className="check">
                  <input
                    type="checkbox"
                    checked={order.includes(widget)}
                    disabled={busy}
                    onChange={(e) =>
                      void updateOrder(
                        e.target.checked
                          ? [...order, widget]
                          : order.filter((id) => id !== widget),
                      )
                    }
                  />
                  {widgetLabels[widget]}
                </label>
              ),
            )}
          </fieldset>
          {order.map((widget, index) => (
            <section
              className="dashboard-widget"
              key={widget}
              aria-label={widgetLabels[widget]}
            >
              <header>
                <h3>{widgetLabels[widget]}</h3>
                <Button
                  size="sm"
                  disabled={busy || index === 0}
                  onClick={() => {
                    const next = [...order];
                    [next[index - 1], next[index]] = [
                      next[index]!,
                      next[index - 1]!,
                    ];
                    void updateOrder(next);
                  }}
                >
                  Monter {widgetLabels[widget]}
                </Button>
                <Button
                  size="sm"
                  disabled={busy || index === order.length - 1}
                  onClick={() => {
                    const next = [...order];
                    [next[index + 1], next[index]] = [
                      next[index]!,
                      next[index + 1]!,
                    ];
                    void updateOrder(next);
                  }}
                >
                  Descendre {widgetLabels[widget]}
                </Button>
              </header>
              {widget === "counts" ? (
                <div className="summary-grid">
                  {Object.entries(data.counts).map(([kind, count]) => (
                    <a
                      key={kind}
                      href={`#${kind}?${detail(kind as RecordKind)}`}
                    >
                      <span>{labels[kind as RecordKind]}</span>
                      <strong>{count}</strong>
                    </a>
                  ))}
                </div>
              ) : widget === "tasks" ? (
                <>
                  <p>
                    <strong>{data.openTasks}</strong> tâches ouvertes ·{" "}
                    <strong>{data.overdueTasks}</strong> en retard ·{" "}
                    <strong>{data.upcomingTasks}</strong> à venir
                  </p>
                  <ul
                    className="progress-chart"
                    aria-label="Répartition des tâches"
                  >
                    {data.tasks.map((s) => (
                      <li key={s.state}>
                        <a
                          href={`#tache?${detail("tache", { state: s.state })}`}
                        >
                          <span>
                            {stateLabels[s.state]} : {s.count}
                          </span>
                          <span
                            aria-hidden
                            className="progress-bar"
                            style={{
                              width: `${data.counts.tache ? (100 * s.count) / data.counts.tache : 0}%`,
                            }}
                          />
                        </a>
                        {canExport("tache") && (
                          <CsvExport
                            link
                            query={{
                              ...filters,
                              kind: "tache",
                              state: s.state,
                              columns: defaultColumns("tache"),
                              offset: 0,
                            }}
                            label={`Exporter ${stateLabels[s.state]}`}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <p>
                    Aucune source vérifiée pour ces {data.counts.obligation}{" "}
                    obligations. Évaluation selon les politiques opérationnelles
                    configurées : {data.obligationSources.fresh} récentes,{" "}
                    {data.obligationSources.stale} anciennes,{" "}
                    {data.obligationSources.unknown} indéterminées. Les dates de
                    modification locale ne prouvent pas une actualité
                    fournisseur.
                  </p>
                  <div>
                    {(["manuelle", "simulee"] as const).map((source) => (
                      <div key={source}>
                        <a
                          href={`#obligation?${detail("obligation", { source })}`}
                        >
                          {source === "manuelle"
                            ? "Saisie manuelle"
                            : "Simulation"}{" "}
                          :{" "}
                          {source === "manuelle"
                            ? data.obligationSources.manual
                            : data.obligationSources.simulated}
                        </a>{" "}
                        {canExport("obligation") && (
                          <CsvExport
                            link
                            query={{
                              ...filters,
                              kind: "obligation",
                              source,
                              columns: "id,title,source,dueDate,updatedAt",
                              offset: 0,
                            }}
                            label={
                              source === "manuelle"
                                ? "Exporter les saisies manuelles"
                                : "Exporter les simulations"
                            }
                          />
                        )}{" "}
                      </div>
                    ))}
                  </div>
                  <ul
                    className="progress-chart"
                    aria-label="Répartition des obligations"
                  >
                    {data.obligations.map((s) => (
                      <li key={s.state}>
                        <a
                          href={`#obligation?${detail("obligation", { preparation: s.state })}`}
                        >
                          <span>
                            {
                              {
                                a_preparer: "À préparer",
                                en_cours: "En cours",
                                preparee: "Préparées",
                              }[s.state]
                            }{" "}
                            : {s.count}
                          </span>
                          <span
                            aria-hidden
                            className="progress-bar"
                            style={{
                              width: `${data.counts.obligation ? (100 * s.count) / data.counts.obligation : 0}%`,
                            }}
                          />
                        </a>
                        {canExport("obligation") && (
                          <CsvExport
                            link
                            query={{
                              ...filters,
                              kind: "obligation",
                              preparation: s.state,
                              columns: defaultColumns("obligation"),
                              offset: 0,
                            }}
                            label={`Exporter ${{ a_preparer: "À préparer", en_cours: "En cours", preparee: "Préparées" }[s.state]}`}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          ))}
          <p className="muted">
            Actualisé le {new Date(data.asOf).toLocaleString("fr-FR")}
          </p>
        </>
      )}
    </section>
  );
}
