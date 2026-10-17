import { useState, useEffect, useRef } from "react";
import { Button, Input, Checkbox, Loader } from "@memlia/ui";
import { IconPlus, IconDownload, IconBuilding } from "@tabler/icons-react";
import {
  DashboardSchema,
  RecordListSchema,
  RecordListQuerySchema,
  type Dashboard,
  type RecordList,
  type RecordKind,
  type SessionUser,
} from "@memlia/contracts";
import { request, useScope, queryString, message, RequestError } from "./api";
import { ErrorSummary } from "./forms";
import { RecordEditor } from "./RecordEditor";
import { labels, stateLabels } from "./RecordLabels";
export function Home() {
  const signal = useScope();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null),
    [error, setError] = useState("");
  async function load() {
    setError("");
    try {
      setDashboard(await request("/dashboard", DashboardSchema, signal));
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="home">
      <h2>Le travail du cabinet</h2>
      <p className="muted">Vos dossiers, contacts et échéances autorisés.</p>
      {error ? (
        <>
          <ErrorSummary message={error} />
          <Button onClick={() => void load()}>Réessayer</Button>
        </>
      ) : !dashboard ? (
        <p role="status">Chargement de la synthèse…</p>
      ) : (
        <>
          <div className="summary-grid">
            {Object.entries(dashboard.counts).map(([kind, count]) => (
              <a href={"#" + kind} key={kind}>
                <span>{labels[kind as RecordKind]}</span>
                <strong>{count}</strong>
              </a>
            ))}
          </div>
          <section className="overview">
            <h3>À suivre</h3>
            <p>
              <strong>{dashboard.openTasks}</strong> tâches ouvertes
            </p>
            <p>
              <strong>{dashboard.overdueTasks}</strong> tâches en retard
            </p>
          </section>
          <p className="muted">
            Actualisé le {new Date(dashboard.asOf).toLocaleString("fr-FR")}
          </p>
        </>
      )}
    </div>
  );
}
const createLabels = {
  dossier: "Créer un dossier",
  contact: "Créer un contact",
  tache: "Créer une tâche",
  obligation: "Créer une obligation",
};
export function Records({
  kind,
  user,
}: {
  kind: RecordKind;
  user: SessionUser;
}) {
  const signal = useScope();
  const [q, setQ] = useState(""),
    [archived, setArchived] = useState(false),
    [offset, setOffset] = useState(0),
    [result, setResult] = useState<RecordList | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [editor, setEditor] = useState<{ id: string | null } | null>(null),
    [exporting, setExporting] = useState(false);
  const generation = useRef(0);
  const can = (action: SessionUser["permissions"][number]["action"]) =>
    (action === "create" && kind === "dossier"
      ? user.permissions
      : [...user.permissions, ...user.scopedPermissions]
    ).some((p) => p.action === action && (p.kind === "*" || p.kind === kind));
  const query = queryString({
    kind,
    q,
    archived: archived ? "true" : "false",
    offset,
    limit: 50,
  });
  useEffect(() => {
    const serial = ++generation.current;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    request("/records?" + query, RecordListSchema, controller.signal)
      .then((list) => {
        if (serial === generation.current) {
          setResult(list);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(
            e instanceof RequestError && e.status === 403
              ? "Accès refusé : vous ne pouvez pas consulter cette liste."
              : message(e),
          );
          setResult(null);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [query, revision]);
  async function exportCsv() {
    setExporting(true);
    setError("");
    try {
      const response = await fetch("/api/v1/records/export.csv?" + query, {
        signal,
      });
      if (!response.ok) {
        if (response.status === 401)
          window.dispatchEvent(new Event("memlia-session-expired"));
        throw new Error(
          response.status === 403
            ? "Export non autorisé."
            : "Export impossible. Réessayez.",
        );
      }
      const blob = await response.blob();
      if (signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "memlia-" + kind + ".csv";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      if (!signal.aborted) setExporting(false);
    }
  }
  return (
    <>
      <div className="toolbar">
        <div className="search">
          <label className="sr-only" htmlFor="search">
            Rechercher
          </label>
          <Input
            id="search"
            maxLength={
              RecordListQuerySchema.shape.q.unwrap().maxLength ?? undefined
            }
            placeholder={"Rechercher dans " + labels[kind].toLowerCase()}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOffset(0);
            }}
          />
        </div>
        <label className="check">
          <Checkbox
            checked={archived}
            onCheckedChange={(v) => {
              setArchived(v);
              setOffset(0);
            }}
          />
          Archives
        </label>
        <div className="toolbar-end">
          {can("export") && (
            <Button
              startIcon={<IconDownload size={16} />}
              loading={exporting}
              onClick={() => void exportCsv()}
            >
              Exporter en CSV
            </Button>
          )}
          {can("create") && (
            <Button
              variant="solid"
              startIcon={<IconPlus size={16} />}
              onClick={() => setEditor({ id: null })}
            >
              {createLabels[kind]}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <div className="list-state">
          <ErrorSummary message={error} />
          <Button onClick={() => setRevision((v) => v + 1)}>Réessayer</Button>
        </div>
      )}
      {loading ? (
        <div className="list-state" role="status">
          <Loader /> Chargement de la liste…
        </div>
      ) : (
        result && (
          <>
            {result.items.length === 0 ? (
              <div className="empty">
                <IconBuilding size={24} aria-hidden />
                <h2>Aucun résultat</h2>
                <p>
                  {q || archived
                    ? "Ajustez votre recherche ou le filtre Archives."
                    : "Commencez par créer une fiche pour votre cabinet."}
                </p>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <caption className="sr-only">
                    {labels[kind]}{" "}
                    {kind === "tache" || kind === "obligation"
                      ? "autorisées"
                      : "autorisés"}
                  </caption>
                  <thead>
                    <tr>
                      <th className="record-icon" aria-label="Type" />
                      <th scope="col">Titre</th>
                      <th scope="col">
                        {kind === "dossier"
                          ? "SIREN"
                          : kind === "contact"
                            ? "Email"
                            : "Échéance"}
                      </th>
                      <th scope="col">
                        {kind === "tache"
                          ? "Étape"
                          : kind === "obligation"
                            ? "Validation"
                            : "Informations"}
                      </th>
                      <th scope="col">Version</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((record) => (
                      <tr key={record.id}>
                        <td className="record-icon">
                          <span aria-hidden>◈</span>
                        </td>
                        <td>
                          <button
                            className="record-link"
                            onClick={() => setEditor({ id: record.id })}
                          >
                            {record.title}
                          </button>
                          {record.confidential && (
                            <span className="badge">Confidentiel</span>
                          )}
                        </td>
                        <td className="mono">
                          {"dueDate" in record.data
                            ? (record.data.dueDate ?? "Non renseignée")
                            : record.kind === "dossier"
                              ? (record.data.siren ?? "Non renseigné")
                              : record.kind === "contact"
                                ? (record.data.email ?? "Non renseigné")
                                : ""}
                        </td>
                        <td>
                          {record.kind === "tache" ? (
                            <span className="badge">
                              {stateLabels[record.data.state]}
                            </span>
                          ) : record.kind === "obligation" ? (
                            record.data.validation === "validee_localement" ? (
                              "Validée localement"
                            ) : (
                              "Non validée"
                            )
                          ) : record.kind === "dossier" ? (
                            record.data.legalForm
                          ) : record.kind === "contact" ? (
                            record.data.contactType === "personne" ? (
                              "Personne"
                            ) : (
                              "Organisation"
                            )
                          ) : (
                            ""
                          )}
                        </td>
                        <td className="mono">{record.version}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <footer className="pagination">
              <span>
                {result.total} résultat{result.total > 1 ? "s" : ""} ·{" "}
                {result.items.length ? offset + 1 : 0}–
                {offset + result.items.length}
              </span>
              <Button
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset((v) => Math.max(0, v - 50))}
              >
                Précédent
              </Button>
              <Button
                size="sm"
                disabled={offset + result.limit >= result.total}
                onClick={() => setOffset((v) => v + 50)}
              >
                Suivant
              </Button>
            </footer>
          </>
        )
      )}
      {editor && (
        <RecordEditor
          key={editor.id ?? "new"}
          id={editor.id}
          kind={kind}
          user={user}
          onClose={() => setEditor(null)}
          onSaved={() => setRevision((v) => v + 1)}
        />
      )}
    </>
  );
}
