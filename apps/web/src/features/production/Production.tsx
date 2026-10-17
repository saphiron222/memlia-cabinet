import { Overlay } from "./Overlay";
import { tabKeys } from "../workflows/tabs";
import { useEffect, useState, useRef } from "react";
import { z } from "zod";
import { Button, Loader } from "@memlia/ui";
import {
  ProductionModelSchema,
  ProductionModelListSchema,
  ProductionRowSchema,
  ProductionRowListSchema,
  ProductionQuerySchema,
  ProductionImportPreviewSchema,
  JobSchema,
  productionPeriod,
  previewOccurrences,
  productionOccurrencePeriod,
  type ProductionModel,
  type ProductionRow,
  type SessionUser,
  type ProductionImportPreview,
} from "@memlia/contracts";
import { request, message, useScope } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
import { ModelEditor, freshModel, irppModel } from "./ModelEditor";
import { TargetPicker } from "./TargetPicker";
import { RowDetail } from "./RowDetail";
import { StageValue, completed, frequencyLabel, periodLabel } from "./value";
import { formatCivilDate } from "../workflows/civil";
import "./production.css";
const tabs = {
  balance: "Bilans",
  custom: "Échéances personnalisées",
  process: "Process",
  followup: "Suivis périodiques",
  stage_type: "Types d’étape",
};
export function Production({ user }: { user: SessionUser }) {
  const signal = useScope(),
    [kind, setKind] = useState<ProductionModel["model"]["kind"]>("balance"),
    [models, setModels] = useState<ProductionModel[]>([]),
    [selected, setSelected] = useState(""),
    [rowModels, setRowModels] = useState<ProductionModel[]>([]),
    [occurrence, setOccurrence] = useState(""),
    [rows, setRows] = useState<ProductionRow[]>([]),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [editing, setEditing] = useState<ProductionModel | null>(null),
    [row, setRow] = useState<ProductionRow | null>(null),
    [adding, setAdding] = useState(false),
    [year, setYear] = useState(""),
    [month, setMonth] = useState(""),
    [q, setQ] = useState(""),
    [state, setState] = useState(""),
    [tag, setTag] = useState(""),
    [deposit, setDeposit] = useState(""),
    [offset, setOffset] = useState(0),
    [sort, setSort] = useState("title"),
    [job, setJob] = useState<z.infer<typeof JobSchema> | null>(null),
    [preview, setPreview] = useState<{
      dates: string[];
      population: number;
      paused: boolean;
      modelVersion: number;
    } | null>(null),
    [reprise, setReprise] = useState(false),
    [migration, setMigration] = useState(false);
  const manager = user.permissions.some(
      (p) => p.action === "manage_users" && p.kind === "*",
    ),
    model = models.find((m) => m.id === selected),
    date = `${year}-${month}-01`;
  const rowRequest = useRef(0);
  const parsedQuery = ProductionQuerySchema.safeParse({
    referenceDate: kind === "followup" ? date : null,
    q,
    state,
    tag,
    deposit,
    offset,
    sort,
    period: kind === "balance" || kind === "followup" ? year : "",
    year: kind === "custom" ? year : "",
  });
  const validFilters = parsedQuery.success && /^\d{4}$/.test(year);
  const query = parsedQuery.success ? parsedQuery.data : null;
  const filterError =
    year && !validFilters
      ? "Vérifiez les filtres : année à quatre chiffres, recherche de 200 caractères et étiquette de 80 caractères maximum."
      : "";
  const versions = rows.length
    ? rowModels.filter((m) =>
        rows.some((r) => r.modelId === m.id && r.modelVersion === m.version),
      )
    : model
      ? [model]
      : [];
  const gridColumns = versions.flatMap((m) =>
    m.model.kind === "stage_type"
      ? []
      : m.model.columns.map((column) => ({ column, version: m.version })),
  );
  const rowModel = (r: ProductionRow) =>
    rowModels.find((m) => m.id === r.modelId && m.version === r.modelVersion);
  const selectedRule =
    model?.model.kind !== "stage_type" ? model?.model.rule : null;
  const occurrences =
    model?.model.kind === "custom" && model.model.rule && validFilters
      ? previewOccurrences(model.model.rule, `${year}-01-01`, `${year}-12-31`)
      : [];
  const selectedOccurrence = occurrences.includes(occurrence)
    ? occurrence
    : occurrences[0];
  async function loadModels(select?: string) {
    try {
      let after: string | null = null;
      const items: ProductionModel[] = [];
      do {
        const page: z.infer<typeof ProductionModelListSchema> = await request(
          "/production/models" + (after ? "?after=" + after : ""),
          ProductionModelListSchema,
          signal,
        );
        items.push(...page.items);
        after = page.nextCursor;
      } while (after);
      setModels(items);
      if (select) setSelected(select);
      else
        setSelected((current) =>
          items.some((x) => x.id === current && x.model.kind === kind)
            ? current
            : (items.find((x) => x.model.kind === kind)?.id ?? ""),
        );
      setError("");
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      setLoading(false);
    }
  }
  async function loadRows() {
    const requestId = ++rowRequest.current;
    if (!selected || !year || !month || !validFilters || !query) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await request(
        `/production/models/${selected}/rows?` +
          new URLSearchParams(
            Object.entries(query)
              .filter(([, v]) => v !== null && v !== undefined)
              .map(([k, v]) => [k, String(v)]),
          ),
        ProductionRowListSchema,
        signal,
      );
      const needed = [
        ...new Map(
          result.items.map((r) => [`${r.modelId}:${r.modelVersion}`, r]),
        ).values(),
      ];
      const snapshots = await Promise.all(
        needed.map((r) =>
          request(
            `/production/models/${r.modelId}?version=${r.modelVersion}`,
            ProductionModelSchema,
            signal,
          ),
        ),
      );
      if (requestId !== rowRequest.current) return;
      setRowModels(snapshots);
      setRows(result.items);
      setMore(result.hasMore);
    } catch (e) {
      if (!signal.aborted && requestId === rowRequest.current) {
        setRows([]);
        setError(message(e));
      }
    } finally {
      if (requestId === rowRequest.current) setLoading(false);
    }
  }
  useEffect(() => {
    void request(
      "/production/calendar",
      z.object({ today: z.string() }),
      signal,
    )
      .then(({ today }) => {
        setYear(today.slice(0, 4));
        setMonth(today.slice(5, 7));
      })
      .catch((e) => setError(message(e)));
  }, []);
  useEffect(() => {
    void loadModels();
    setRow(null);
    setOffset(0);
  }, [kind]);
  useEffect(() => {
    setRow(null);
    void loadRows();
  }, [selected, q, state, tag, deposit, offset, sort, year, month, models]);
  useEffect(() => {
    const id = new URLSearchParams(location.hash.split("?")[1]).get("id");
    if (!id || loading || !models.length) return;
    void request("/production/rows/" + id, ProductionRowSchema, signal)
      .then((r) => {
        const m = models.find((x) => x.id === r.modelId);
        if (m) {
          if (kind !== m.model.kind) setKind(m.model.kind);
          if (selected !== m.id) setSelected(m.id);
          else setRow(r);
        }
      })
      .catch((e) => setError(message(e)));
  }, [models, selected, loading]);
  useEffect(() => {
    if (!job || ["completed", "failed"].includes(job.state)) return;
    const timer = setTimeout(() => {
      void request("/production/jobs/" + job.id, JobSchema, signal)
        .then((j) => {
          setJob(j);
          if (j.state === "completed") void loadRows();
        })
        .catch((e) => setError(message(e)));
    }, 500);
    return () => clearTimeout(timer);
  }, [job]);
  const newModel = (irpp = false) =>
    setEditing({
      id: crypto.randomUUID(),
      version: 0,
      actorId: user.id,
      updatedAt: new Date().toISOString(),
      model: irpp ? irppModel(Number(year)) : freshModel(kind, Number(year)),
    });
  async function generate(previewOnly: boolean) {
    if (!model) return;
    setError("");
    try {
      const body = {
        operationId: crypto.randomUUID(),
        modelId: model.id,
        from: `${year}-01-01`,
        to: `${year}-12-31`,
      };
      if (previewOnly)
        setPreview(
          await request(
            "/production/preview",
            z.object({
              dates: z.array(z.string()),
              population: z.number(),
              paused: z.boolean(),
              modelVersion: z.number(),
            }),
            signal,
            { method: "POST", body: JSON.stringify(body) },
          ),
        );
      else {
        const r = await request(
          "/production/generate",
          z.object({ jobId: z.uuid() }),
          signal,
          { method: "POST", body: JSON.stringify(body) },
        );
        setJob(await request("/production/jobs/" + r.jobId, JobSchema, signal));
        setPreview(null);
      }
    } catch (e) {
      setError(message(e));
    }
  }
  async function duplicate() {
    if (!model) return;
    try {
      const next = await request(
        `/production/models/${model.id}/duplicate`,
        ProductionModelSchema,
        signal,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            expectedVersion: model.version,
            year: Number(year) + 1,
          }),
        },
      );
      setYear(String(Number(year) + 1));
      await loadModels(next.id);
      setNotice(
        "Configuration dupliquée. Les réalisations de l’année précédente sont conservées dans leur exercice.",
      );
    } catch (e) {
      setError(message(e));
    }
  }
  async function exportGrid() {
    if (!model || !validFilters || !query) return;
    try {
      const r = await request(
        "/production/exports",
        z.object({ jobId: z.uuid() }),
        signal,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            modelId: model.id,
            query,
          }),
        },
      );
      setNotice("Export en préparation.");
      setExportId(r.jobId);
    } catch (e) {
      setError(message(e));
    }
  }
  const [exportId, setExportId] = useState<string | null>(null);
  return (
    <div className="production-workspace">
      <div className="work-topline">
        <div
          className="work-tabs"
          onKeyDown={tabKeys}
          role="tablist"
          aria-label="Familles de production"
        >
          {Object.entries(tabs).map(([key, label]) => (
            <button
              role="tab"
              aria-selected={kind === key}
              key={key}
              onClick={() => {
                setKind(key as typeof kind);
                setSelected("");
                setRow(null);
                setEditing(null);
                setPreview(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="actions">
          {manager && (
            <Button onClick={() => newModel()}>Nouveau modèle</Button>
          )}
          {kind === "followup" && manager && (
            <Button onClick={() => newModel(true)}>Modèle IRPP Contact</Button>
          )}
          {kind === "stage_type" && manager && (
            <Button onClick={() => setReprise(true)}>
              Reprendre des statuts
            </Button>
          )}
        </div>
      </div>
      {filterError && (
        <div className="error-summary" role="alert">
          <strong>{filterError}</strong>
        </div>
      )}
      <ErrorSummary message={error || undefined} />
      {error && <Button onClick={() => void loadRows()}>Réessayer</Button>}
      {notice && (
        <p role="status" className="production-notice">
          {notice}
        </p>
      )}
      <div className="production-toolbar">
        <Select
          name="production-model"
          label="Modèle"
          value={selected}
          onChange={(v) => {
            setSelected(v);
            setOffset(0);
            setPreview(null);
          }}
        >
          <option value="">Choisir un modèle</option>
          {models
            .filter((m) => m.model.kind === kind)
            .map((m) => (
              <option value={m.id} key={m.id}>
                {m.model.name}
                {m.model.kind === "balance"
                  ? " · " + m.model.year + " · " + m.model.family
                  : ""}
              </option>
            ))}
        </Select>
        <Field
          errors={
            year && !/^\d{4}$/.test(year)
              ? { "production-year": "Saisissez quatre chiffres." }
              : {}
          }
          name="production-year"
          label="Année"
          type="number"
          value={year}
          onChange={setYear}
        />
        {kind === "followup" && (
          <Select
            name="production-month"
            label="Mois de référence"
            value={month}
            onChange={setMonth}
          >
            {Array.from({ length: 12 }, (_, i) =>
              String(i + 1).padStart(2, "0"),
            ).map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
        )}
        {model && (
          <div className="actions">
            {manager && (
              <Button onClick={() => setEditing(model)}>Configurer</Button>
            )}
            {kind === "balance" && manager && (
              <Button onClick={() => void duplicate()}>
                Préparer {Number(year) + 1}
              </Button>
            )}
            {(kind === "balance" || kind === "custom") && manager && (
              <Button onClick={() => void generate(true)}>
                Générer les occurrences
              </Button>
            )}
            {kind !== "stage_type" && (
              <>
                <Button onClick={() => setAdding(true)}>
                  Ajouter une ligne
                </Button>
                <Button onClick={() => void exportGrid()}>
                  Exporter la grille
                </Button>
              </>
            )}
            {["process", "followup"].includes(kind) && manager && (
              <Button onClick={() => setMigration(true)}>
                Migrer les cibles
              </Button>
            )}
          </div>
        )}
      </div>
      {preview && (
        <section className="production-preview">
          <strong>
            {preview.dates.length * preview.population} occurrences à contrôler
          </strong>
          <p>
            {preview.population} dossiers ·{" "}
            {preview.dates.map(formatCivilDate).join(", ")}
          </p>
          <p className="muted">
            L’existant sera retrouvé. Chaque cible recevra un résultat de
            génération locale ; aucun dépôt externe n’est effectué.
          </p>
          <Button
            disabled={preview.paused}
            onClick={() => void generate(false)}
          >
            Confirmer la génération
          </Button>
          <Button onClick={() => setPreview(null)}>Annuler</Button>
        </section>
      )}
      {job && (
        <div role="status" className="production-job">
          Génération :{" "}
          {
            {
              queued: "En attente",
              running: "En cours",
              completed: "Terminée",
              failed: "Échec",
            }[job.state]
          }
          {job.error ? " · " + job.error : ""}
          {job.state === "completed" && <GenerationResults id={job.id} />}
        </div>
      )}
      {exportId && <ExportResult id={exportId} />}
      {model && kind !== "stage_type" && (
        <div className="production-filters">
          <Field
            errors={
              q.length > 200
                ? { "production-search": "200 caractères maximum." }
                : {}
            }
            name="production-search"
            label="Rechercher dans la grille"
            value={q}
            onChange={(v) => {
              setQ(v);
              setOffset(0);
            }}
          />
          <Select
            name="production-state"
            label="Réalisation"
            value={state}
            onChange={(v) => {
              setState(v);
              setOffset(0);
            }}
          >
            <option value="">Tous les états</option>
            <option value="not_done">Non fait</option>
            <option value="done">Fait</option>
            <option value="not_applicable">Non applicable</option>
          </Select>
          <Field
            errors={
              tag.length > 80
                ? { "production-tag": "80 caractères maximum." }
                : {}
            }
            name="production-tag"
            label="Étiquette"
            value={tag}
            onChange={(v) => {
              setTag(v);
              setOffset(0);
            }}
          />
          {(kind === "balance" ||
            (model.model.kind === "custom" &&
              model.model.nature === "depot_comptes")) && (
            <Select
              name="production-deposit"
              label="Dépôt des comptes"
              value={deposit}
              onChange={(v) => {
                setDeposit(v);
                setOffset(0);
              }}
            >
              {[
                ["", "Tous les dépôts"],
                ["not_submitted", "Sans tentative"],
                ["waiting", "En attente"],
                ["submitted", "Soumis"],
                ["rejected", "Rejeté"],
                ["accepted", "Accepté"],
                ["not_applicable", "Non applicable"],
              ].map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </Select>
          )}
          <Select
            name="production-sort"
            label="Trier par"
            value={sort}
            onChange={setSort}
          >
            <option value="title">Cible</option>
            <option value="dueDate">Échéance</option>
            {(kind === "balance" || kind === "custom") && (
              <>
                <option value="assemblyDate">Date d’assemblée</option>
                <option value="depositDate">Date de dépôt</option>
              </>
            )}
            <option value="id">Identité</option>
          </Select>
        </div>
      )}
      {loading ? (
        <div role="status" className="work-empty">
          <Loader /> Chargement de la production…
        </div>
      ) : !model ? (
        <div className="work-empty">
          <h2>Aucun modèle sélectionné</h2>
          <p>Configurez les étapes et la population pour commencer ce suivi.</p>
        </div>
      ) : model.model.kind === "stage_type" ? (
        <div className="production-type-preview">
          <h2>{model.model.name}</h2>
          {model.model.statuses.map((s) => (
            <div key={s.id}>
              <StageValue
                column={{
                  id: s.id,
                  name: s.name,
                  type: "status",
                  stageTypeId: model.id,
                  frequency: "once",
                  requiredRoleId: null,
                  approval: false,
                  assigneeId: null,
                  plannedDate: null,
                  plannedMinutes: 0,
                }}
                value={s.id}
                models={models}
              />
              <span className="muted">
                {s.final ? "État final" : "En cours"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="production-content">
          <div className="production-grid-area">
            <div className="table-scroll">
              <table className="work-grid production-grid">
                <thead>
                  <tr>
                    <th>Cible</th>
                    <th>Période</th>
                    <th>Échéance</th>
                    <th>Avancement</th>
                    {gridColumns.map(({ column: c, version }) => (
                      <th key={`${version}:${c.id}`}>
                        {c.name}
                        <small>
                          v{version} ·{" "}
                          {kind === "followup"
                            ? productionPeriod(c, date)
                            : frequencyLabel[c.frequency]}
                        </small>
                      </th>
                    ))}
                    {kind === "balance" && (
                      <>
                        <th>Liasse</th>
                        <th>Assemblée</th>
                        <th>Dépôt</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const referenceDate =
                      kind === "followup" ? date : (r.dueDate ?? date);
                    const columns =
                        rowModel(r)?.model.kind !== "stage_type"
                          ? ((
                              rowModel(r)?.model as
                                | import("@memlia/contracts").ProductionTemplate
                                | undefined
                            )?.columns ?? [])
                          : [],
                      done = columns.filter((c) =>
                        completed(
                          c,
                          r.cells.find(
                            (x) =>
                              x.columnId === c.id &&
                              x.period === productionPeriod(c, referenceDate),
                          )?.value ?? null,
                          models,
                        ),
                      ).length,
                      remaining = columns
                        .filter(
                          (c) =>
                            !completed(
                              c,
                              r.cells.find(
                                (x) =>
                                  x.columnId === c.id &&
                                  x.period ===
                                    productionPeriod(c, referenceDate),
                              )?.value ?? null,
                              models,
                            ),
                        )
                        .reduce((sum, c) => sum + c.plannedMinutes, 0);
                    return (
                      <tr key={r.id} aria-selected={row?.id === r.id}>
                        <td>
                          <button
                            className="production-row-title"
                            onClick={() => setRow(r)}
                          >
                            {r.target.label}
                            {r.target.active === false ? " · Inactif" : ""}
                          </button>
                          <small>Configuration v{r.modelVersion}</small>
                        </td>
                        <td>{periodLabel(r.period)}</td>
                        <td>{r.dueDate ? formatCivilDate(r.dueDate) : "—"}</td>
                        <td>
                          <span>
                            {done}/{columns.length}
                          </span>
                          <small>{remaining} min restantes</small>
                        </td>
                        {gridColumns.map(({ column: c, version }) =>
                          version !== r.modelVersion ? (
                            <td key={`${version}:${c.id}`}>—</td>
                          ) : (
                            <td key={`${version}:${c.id}`}>
                              <button
                                className="production-cell"
                                aria-label={`${c.name} — ${r.target.label}`}
                                onClick={() => setRow(r)}
                              >
                                <StageValue
                                  column={c}
                                  value={
                                    r.cells.find(
                                      (x) =>
                                        x.columnId === c.id &&
                                        x.period ===
                                          productionPeriod(c, referenceDate),
                                    )?.value ?? null
                                  }
                                  models={models}
                                />
                              </button>
                            </td>
                          ),
                        )}
                        {kind === "balance" && (
                          <>
                            <td>
                              {r.deposit.liasseDate
                                ? formatCivilDate(r.deposit.liasseDate)
                                : "—"}
                            </td>
                            <td>
                              {r.deposit.assemblyDate
                                ? formatCivilDate(r.deposit.assemblyDate)
                                : "—"}
                            </td>
                            <td>
                              {!r.deposit.applicable
                                ? "Non applicable"
                                : r.deposit.attempts.at(-1)?.state ===
                                    "accepted"
                                  ? "Accepté"
                                  : r.deposit.attempts.at(-1)?.state ===
                                      "rejected"
                                    ? "Rejeté"
                                    : r.deposit.attempts.length
                                      ? "En attente"
                                      : "Sans tentative"}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!rows.length && (
              <div className="work-empty">
                <h2>Aucune ligne dans ce périmètre</h2>
                <p>Ajoutez une cible ou générez la population configurée.</p>
              </div>
            )}
            <div className="pagination">
              <Button
                disabled={!offset}
                onClick={() => setOffset((v) => Math.max(0, v - 100))}
              >
                Page précédente
              </Button>
              <span>
                {rows.length} lignes · page {Math.floor(offset / 100) + 1}
              </span>
              <Button
                disabled={!more}
                onClick={() => setOffset((v) => v + 100)}
              >
                Page suivante
              </Button>
            </div>
          </div>
          {row && rowModel(row) && (
            <RowDetail
              key={row.id}
              row={row}
              model={rowModel(row)!}
              models={models}
              date={date}
              onClose={() => setRow(null)}
              onChange={(r) => {
                setRow(r);
                setRows((rows) => rows.map((x) => (x.id === r.id ? r : x)));
              }}
            />
          )}
        </div>
      )}
      {editing && (
        <Overlay onClose={() => setEditing(null)}>
          <ModelEditor
            initial={editing}
            models={models}
            onClose={() => setEditing(null)}
            onSave={(m) => {
              setEditing(null);
              setKind(m.model.kind);
              void loadModels(m.id);
              setNotice("Modèle enregistré.");
            }}
          />
        </Overlay>
      )}
      {adding && model && model.model.kind !== "stage_type" && (
        <Overlay onClose={() => setAdding(false)}>
          <section className="production-small-panel">
            <header>
              <h2>Ajouter une ligne</h2>
              <Button onClick={() => setAdding(false)}>Fermer</Button>
            </header>
            {kind === "custom" && (
              <Select
                name="manual-occurrence"
                label="Occurrence prévue"
                value={selectedOccurrence ?? ""}
                onChange={setOccurrence}
              >
                {!occurrences.length && (
                  <option value="">Aucune occurrence cette année</option>
                )}
                {occurrences.map((date) => (
                  <option key={date} value={date}>
                    {periodLabel(
                      productionOccurrencePeriod(selectedRule!, date),
                    )}{" "}
                    · {formatCivilDate(date)}
                  </option>
                ))}
              </Select>
            )}
            {(kind !== "custom" || selectedOccurrence) && (
              <TargetPicker
                kind={model.model.target}
                onSelect={(target) => {
                  void request(
                    `/production/models/${model.id}/rows`,
                    ProductionRowSchema,
                    signal,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        operationId: crypto.randomUUID(),
                        expectedVersion: model.version,
                        target,
                        period:
                          kind === "balance" || kind === "followup"
                            ? year
                            : kind === "custom"
                              ? productionOccurrencePeriod(
                                  selectedRule!,
                                  selectedOccurrence!,
                                )
                              : "once",
                      }),
                    },
                  )
                    .then((r) => {
                      setAdding(false);
                      void loadRows();
                      setRow(r);
                    })
                    .catch((e) => setError(message(e)));
                }}
              />
            )}
          </section>
        </Overlay>
      )}
      {reprise && (
        <StageImport
          onClose={() => setReprise(false)}
          onDone={() => void loadModels()}
        />
      )}
      {migration && model && (
        <TargetMigration
          model={model}
          onClose={() => setMigration(false)}
          onDone={() => {
            setMigration(false);
            void loadModels();
            void loadRows();
          }}
        />
      )}
    </div>
  );
}
function GenerationResults({ id }: { id: string }) {
  const signal = useScope(),
    [offset, setOffset] = useState(0),
    [result, setResult] = useState<{
      items: {
        ordinal: number;
        state: string;
        period?: string;
        code?: string | null;
      }[];
      hasMore: boolean;
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    void request(
      `/production/jobs/${id}/results?offset=${offset}`,
      z.object({
        items: z.array(
          z.object({
            ordinal: z.number(),
            state: z.string(),
            period: z.string().optional(),
            code: z.string().nullable().optional(),
          }),
        ),
        hasMore: z.boolean(),
      }),
      signal,
    )
      .then(setResult)
      .catch((e) => setError(message(e)));
  }, [offset]);
  return (
    <details>
      <summary>Résultats par cible</summary>
      <ErrorSummary message={error || undefined} />
      {result?.items.map((x) => (
        <p key={x.ordinal}>
          Ligne {x.ordinal + 1} · {x.period} ·{" "}
          {{
            created: "Créée",
            existing: "Déjà présente",
            regenerated: "Régénérée",
            refused: "Refusée",
          }[x.state] ?? x.state}
          {x.code ? " · " + x.code : ""}
        </p>
      ))}
      <Button disabled={!offset} onClick={() => setOffset((v) => v - 100)}>
        Précédents
      </Button>
      <Button
        disabled={!result?.hasMore}
        onClick={() => setOffset((v) => v + 100)}
      >
        Suivants
      </Button>
    </details>
  );
}
function ExportResult({ id }: { id: string }) {
  const signal = useScope(),
    [job, setJob] = useState<{
      job: z.infer<typeof JobSchema>;
      parts: number;
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      void request(
        `/production/exports/${id}`,
        z.object({ job: JobSchema, parts: z.number() }),
        signal,
      )
        .then((r) => {
          setJob(r);
          if (!["failed", "completed"].includes(r.job.state))
            timer = setTimeout(poll, 500);
        })
        .catch((e) => setError(message(e)));
    };
    poll();
    return () => clearTimeout(timer);
  }, [id]);
  return (
    <div className="production-job">
      <ErrorSummary message={error || undefined} />
      {job?.job.state === "completed" ? (
        Array.from({ length: job.parts }, (_, index) => (
          <a
            key={index}
            href={`/api/v1/production/exports/${id}/parts/${index + 1}`}
          >
            Télécharger CSV · partie {index + 1}
          </a>
        ))
      ) : (
        <span role="status">
          Export : {job?.job.state ?? "préparation"} {job?.job.error}
        </span>
      )}
    </div>
  );
}
function StageImport({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const signal = useScope(),
    [preview, setPreview] = useState<ProductionImportPreview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mapping, setMapping] = useState({
      model: "Modèle",
      status: "Statut",
      color: "Couleur",
      icon: "Icône",
      final: "Final",
    });
  async function file(file: File) {
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let text = "";
      for (const byte of bytes) text += String.fromCharCode(byte);
      setPreview(
        await request(
          "/production/imports/preview",
          ProductionImportPreviewSchema,
          signal,
          {
            method: "POST",
            body: JSON.stringify({
              format: "memlia-stages-1",
              filename: file.name,
              base64: btoa(text),
              mapping,
            }),
          },
        ),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Overlay onClose={onClose}>
      <section className="production-small-panel">
        <header>
          <h2>Reprendre les statuts</h2>
          <Button onClick={onClose}>Fermer</Button>
        </header>
        <p>
          Échange memlia-stages-1 : CSV UTF-8 séparé par point-virgule ou XLSX
          de valeurs. Ordre des lignes conservé ; couleurs
          gray/blue/green/orange/red/purple, icônes
          circle/check/clock/alert/minus, Final true/false.
        </p>
        <ErrorSummary message={error || undefined} />
        {Object.entries(mapping).map(([key, value]) => (
          <Field
            key={key}
            name={"mapping-" + key}
            label={"Colonne " + key}
            value={value}
            onChange={(v) => setMapping({ ...mapping, [key]: v })}
          />
        ))}
        <label className="field">
          Fichier de statuts
          <input
            type="file"
            accept=".csv,.xlsx"
            disabled={busy}
            onChange={(e) => {
              if (e.target.files?.[0]) void file(e.target.files[0]);
            }}
          />
        </label>
        {preview && (
          <>
            <h3>Aperçu</h3>
            {preview.models.map((m, index) => (
              <section key={index}>
                <strong>{m.name}</strong>
                {m.statuses.map((s) => (
                  <StageValue
                    key={s.id}
                    column={{
                      id: s.id,
                      name: m.name,
                      type: "status",
                      frequency: "once",
                      stageTypeId: s.id,
                      requiredRoleId: null,
                      approval: false,
                      assigneeId: null,
                      plannedDate: null,
                      plannedMinutes: 0,
                    }}
                    value={s.id}
                    models={[
                      {
                        id: s.id,
                        version: 1,
                        actorId: preview.actorId,
                        updatedAt: new Date().toISOString(),
                        model: m,
                      },
                    ]}
                  />
                ))}
              </section>
            ))}
            <h3>Éléments non repris ({preview.unmapped.length})</h3>
            {preview.unmapped.map((u, index) => (
              <p key={index}>
                Ligne {u.line} : {u.reason}
              </p>
            ))}
            <Button
              disabled={!preview.models.length || busy}
              onClick={() => {
                setBusy(true);
                void request(
                  `/production/imports/${preview.id}/commit`,
                  z.object({ items: z.array(ProductionModelSchema) }),
                  signal,
                  {
                    method: "POST",
                    body: JSON.stringify({
                      operationId: crypto.randomUUID(),
                      validatedModels: preview.models.map((_, i) => i),
                    }),
                  },
                )
                  .then(() => {
                    onDone();
                    onClose();
                  })
                  .catch((e) => setError(message(e)))
                  .finally(() => setBusy(false));
              }}
            >
              Valider les modèles de cet aperçu
            </Button>
          </>
        )}
      </section>
    </Overlay>
  );
}
function TargetMigration({
  model,
  onClose,
  onDone,
}: {
  model: ProductionModel;
  onClose: () => void;
  onDone: () => void;
}) {
  const signal = useScope(),
    [target, setTarget] = useState<
      "dossier" | "contact" | "utilisateur" | "libre"
    >("contact"),
    [rows, setRows] = useState<ProductionRow[]>([]),
    [mapping, setMapping] = useState<Record<string, ProductionRow["target"]>>(
      {},
    ),
    [current, setCurrent] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    async function load() {
      let offset = 0,
        more = true;
      const rows: ProductionRow[] = [];
      while (more) {
        const page = await request(
          `/production/models/${model.id}/rows?offset=${offset}`,
          ProductionRowListSchema,
          signal,
        );
        rows.push(...page.items);
        more = page.hasMore;
        offset += 100;
      }
      setRows(rows);
    }
    void load().catch((e) => setError(message(e)));
  }, []);
  return (
    <Overlay onClose={onClose}>
      <section className="production-small-panel">
        <header>
          <h2>Migrer les cibles</h2>
          <Button onClick={onClose}>Fermer</Button>
        </header>
        <ErrorSummary message={error || undefined} />
        <p>
          Chaque ligne conserve son identité, ses cellules et son historique.
          Associez explicitement chaque nouvelle cible.
        </p>
        <Select
          name="migration-target"
          label="Nouvelle cible"
          value={target}
          onChange={(v) => {
            setTarget(v as typeof target);
            setMapping({});
          }}
        >
          {(model.model.kind === "followup"
            ? ["dossier", "contact"]
            : ["dossier", "contact", "utilisateur", "libre"]
          ).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </Select>
        <Select
          name="migration-row"
          label="Ligne à associer"
          value={current}
          onChange={setCurrent}
        >
          <option value="">Choisir…</option>
          {rows.map((r) => (
            <option value={r.id} key={r.id}>
              {r.target.label}
              {mapping[r.id] ? " → " + mapping[r.id]!.label : ""}
            </option>
          ))}
        </Select>
        {current && (
          <TargetPicker
            key={target + current}
            kind={target}
            onSelect={(t) => setMapping({ ...mapping, [current]: t })}
          />
        )}
        <Field
          name="migration-reason"
          label="Motif de la migration"
          value={reason}
          onChange={setReason}
        />
        <p>
          {Object.keys(mapping).length}/{rows.length} lignes associées
        </p>
        <Button
          disabled={busy || !reason || rows.some((r) => !mapping[r.id])}
          onClick={() => {
            setBusy(true);
            void request(
              `/production/models/${model.id}/migrate-targets`,
              ProductionModelSchema,
              signal,
              {
                method: "POST",
                body: JSON.stringify({
                  operationId: crypto.randomUUID(),
                  expectedVersion: model.version,
                  target,
                  reason,
                  mappings: rows.map((r) => ({
                    rowId: r.id,
                    expectedVersion: r.version,
                    target: mapping[r.id],
                  })),
                }),
              },
            )
              .then(onDone)
              .catch((e) => setError(message(e)))
              .finally(() => setBusy(false));
          }}
        >
          Valider la migration
        </Button>
      </section>
    </Overlay>
  );
}
