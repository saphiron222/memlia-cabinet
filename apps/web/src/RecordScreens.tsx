import {
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from "./upstream/twenty/Table";
import { useInstallation } from "./features/administration/preferences";
import { CsvExport } from "./features/records/CsvExport";
import {
  useCustomFields,
  CustomFieldsStatus,
} from "./features/referential/CustomValues";
import { ViewControls } from "./features/records/ViewControls";
import {
  defaultColumns,
  columnLabels,
  columnValue,
} from "./features/records/columns";
import { Companies } from "./features/referential/Companies";
import { useState, useEffect, useRef } from "react";
import { Button, Input, Checkbox, Loader } from "@memlia/ui";
import { IconPlus, IconDownload, IconBuilding } from "@tabler/icons-react";
import {
  DashboardSchema,
  RecordListSchema,
  RecordListQuerySchema,
  type Dashboard,
  type RecordList,
  type RecordListQuery,
  type RecordKind,
  type SessionUser,
} from "@memlia/contracts";
import { request, useScope, queryString, message, RequestError } from "./api";
import { ErrorSummary } from "./forms";
import { RecordEditor } from "./RecordEditor";
import { labels, stateLabels } from "./RecordLabels";
export { Dashboard as Home } from "./features/records/Dashboard";
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
  const { info: installation } = useInstallation();
  const custom = useCustomFields(kind);
  const customFields = custom.fields;
  const signal = useScope();
  const [filters, setFilters] = useState<RecordListQuery>(() => {
    const raw = Object.fromEntries(
      new URLSearchParams(location.hash.split("?")[1]),
    );
    delete raw.id;
    const parsed = RecordListQuerySchema.safeParse({
      ...raw,
      kind,
      columns: raw.columns ?? defaultColumns(kind),
    });
    return parsed.success
      ? parsed.data
      : RecordListQuerySchema.parse({ kind, columns: defaultColumns(kind) });
  });
  const q = filters.q ?? "",
    archived = filters.archived === "true",
    offset = filters.offset,
    columns = (filters.columns ?? defaultColumns(kind)).split(",");
  const patch = (values: Partial<RecordListQuery>) =>
    setFilters((previous) => ({ ...previous, ...values }));
  const [result, setResult] = useState<RecordList | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [editor, setEditor] = useState<{ id: string | null } | null>(() => {
      const id = new URLSearchParams(location.hash.split("?")[1]).get("id");
      return id ? { id } : null;
    });
  useEffect(() => {
    const change = () => {
      const params = new URLSearchParams(location.hash.split("?")[1]);
      const id = params.get("id");
      setEditor(id ? { id } : null);
      params.delete("id");
      const parsed = RecordListQuerySchema.safeParse({
        ...Object.fromEntries(params),
        kind,
        columns: params.get("columns") ?? defaultColumns(kind),
      });
      if (parsed.success) setFilters(parsed.data);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, [kind]);
  useEffect(() => {
    if (location.hash.slice(1).split("?")[0] !== kind) return;
    const params = new URLSearchParams(queryString(filters));
    if (editor?.id) params.set("id", editor.id);
    history.replaceState(null, "", `#${kind}?${params}`);
  }, [filters, editor?.id, kind]);
  const generation = useRef(0);
  const can = (action: SessionUser["permissions"][number]["action"]) =>
    (action === "create" && kind === "dossier"
      ? user.permissions
      : [...user.permissions, ...user.scopedPermissions]
    ).some((p) => p.action === action && (p.kind === "*" || p.kind === kind));
  const query = queryString(filters);
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
              patch({ q: e.target.value, offset: 0 });
            }}
          />
        </div>
        <label className="check">
          <Checkbox
            checked={archived}
            onCheckedChange={(v) => {
              patch({ archived: v ? "true" : "false", offset: 0 });
            }}
          />
          Archives
        </label>
        <div className="record-context-tools">
          {" "}
          {kind === "dossier" && (
            <Companies
              user={user}
              onChanged={() => setRevision((v) => v + 1)}
            />
          )}
          {(custom.loading || custom.error) && (
            <div className="record-field-status">
              <CustomFieldsStatus state={custom} />
            </div>
          )}
          <ViewControls
            query={filters}
            onChange={setFilters}
            custom={customFields}
            fieldsReady={!custom.loading && !custom.error}
          />
        </div>
        <div className="toolbar-end">
          {can("export") && <CsvExport query={filters} />}
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
                <Table>
                  <caption className="sr-only">
                    {labels[kind]}{" "}
                    {kind === "tache" || kind === "obligation"
                      ? "autorisées"
                      : "autorisés"}
                  </caption>
                  <thead>
                    <TableRow>
                      <TableHeader className="record-icon" aria-label="Type" />
                      {columns.map((key) => (
                        <TableHeader key={key} scope="col">
                          {columnLabels[key] ??
                            (key.startsWith("custom.")
                              ? (customFields.find(
                                  (f) => "custom." + f.id === key,
                                )?.name ??
                                (custom.loading
                                  ? "Chargement du champ…"
                                  : custom.error
                                    ? "Champ non chargé"
                                    : "Champ personnalisé"))
                              : key)}
                        </TableHeader>
                      ))}
                    </TableRow>
                  </thead>
                  <tbody>
                    {result.items.map((record) => (
                      <TableRow key={record.id}>
                        <TableCell className="record-icon">
                          <IconBuilding size={14} aria-hidden />
                        </TableCell>
                        {columns.map((key) => (
                          <TableCell key={key}>
                            {key === "title" ? (
                              <>
                                <button
                                  className="record-link"
                                  onClick={() =>
                                    record.kind === "obligation" &&
                                    record.data.fiscal
                                      ? (location.hash = `fiscal?id=${record.id}`)
                                      : setEditor({ id: record.id })
                                  }
                                >
                                  {record.title}
                                </button>
                                {record.confidential && (
                                  <span className="badge">Confidentiel</span>
                                )}
                              </>
                            ) : (
                              columnValue(
                                record,
                                key,
                                installation?.cabinetTimeZone,
                              )
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
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
                onClick={() =>
                  patch({ offset: Math.max(0, offset - filters.limit) })
                }
              >
                Précédent
              </Button>
              <Button
                size="sm"
                disabled={offset + result.limit >= result.total}
                onClick={() => patch({ offset: offset + filters.limit })}
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
