import {
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from "../../upstream/twenty/Table";
import { useEffect, useRef, useState } from "react";
import { Button } from "@memlia/ui";
import {
  FiscalMatrixSchema,
  RecordListSchema,
  RecordListQuerySchema,
  FiscalNatureSchema,
  type FiscalMatrix,
  type RecordListQuery,
  type CabinetRecord,
} from "@memlia/contracts";
import { request, queryString, message } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
import { useInstallation } from "../administration/preferences";
import { CsvExport } from "../records/CsvExport";
import { FiscalDetail } from "./FiscalDetail";
import { natureLabels, moneyLabel, labelValue } from "./labels";
import { Peek } from "../../interface/Peek";
import { formatCivilDate } from "../workflows/civil";
const months = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];
function dateFor(
  record: CabinetRecord,
  reference: RecordListQuery["fiscalDateReference"],
) {
  if (record.kind !== "obligation") return null;
  return reference === "period_end"
    ? record.data.fiscal?.period.end
    : reference === "closing"
      ? record.data.fiscal?.financialYearEnd
      : record.data.dueDate;
}
export function FiscalMatrixView({
  nature,
  dossierId,
}: {
  nature?: string;
  dossierId?: string;
}) {
  const { info } = useInstallation();
  const tableScroll = useRef<HTMLDivElement>(null);
  const pageScope = useRef<{
    key: string;
    revision: number;
    controller: AbortController;
    pending: Set<string>;
    cursors: Map<string, number>;
  } | null>(null);
  const [pendingRows, setPendingRows] = useState<Set<string>>(new Set());
  const params = new URLSearchParams(location.hash.split("?")[1]);
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: info?.cabinetTimeZone ?? "UTC",
  }).format(new Date());
  const year = params.get("year") ?? today.slice(0, 4),
    month = params.get("month") ?? today.slice(5, 7);
  const reference =
    params.get("fiscalDateReference") ?? (dossierId ? "period_end" : "due");
  const parsed = RecordListQuerySchema.safeParse({
    kind: "obligation",
    fiscalOnly: "true",
    nature,
    dossierId,
    year,
    ...(!dossierId && nature === "TVA" ? { month } : {}),
    fiscalDateReference: reference,
    dossierQuery: params.get("dossierQuery") ?? undefined,
    own: params.get("own") ?? "false",
    regime: params.get("regime") ?? undefined,
    preparation: params.get("preparation") ?? undefined,
    source: params.get("source") ?? undefined,
    lateBefore: params.get("lateBefore") ?? undefined,
    offset: params.get("offset") ?? 0,
    limit: 25,
  });
  const [result, setResult] = useState<FiscalMatrix | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [compact, setCompact] = useState(false),
    [loading, setLoading] = useState(false);
  const query = parsed.success ? parsed.data : null,
    key = query ? queryString(query) : "";
  const selected = params.get("id");
  const [yearDraft, setYearDraft] = useState(year);
  useEffect(() => setYearDraft(year), [year]);
  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(location.hash.split("?")[1]);
    next.delete("offset");
    next.delete("id");
    Object.entries(patch).forEach(([k, v]) =>
      v ? next.set(k, v) : next.delete(k),
    );
    location.hash = `fiscal?${next}`;
  };
  const back = () => {
    const next = new URLSearchParams(location.hash.split("?")[1]);
    next.delete("id");
    return `#fiscal?${next}`;
  };
  useEffect(() => {
    const c = new AbortController();
    const scope = {
      key,
      revision,
      controller: c,
      pending: new Set<string>(),
      cursors: new Map<string, number>(),
    };
    pageScope.current = scope;
    setPendingRows(new Set());
    if (!query) return () => c.abort();
    setLoading(true);
    setError("");
    setResult(null);
    void request("/fiscal/matrix?" + key, FiscalMatrixSchema, c.signal)
      .then((value) => {
        if (!c.signal.aborted) {
          value.rows.forEach((row) =>
            scope.cursors.set(row.dossier.id, row.occurrences.length),
          );
          setResult(value);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [key, revision]);
  async function more(row: FiscalMatrix["rows"][number]) {
    const scope = pageScope.current;
    const id = row.dossier.id;
    if (
      !query ||
      !scope ||
      scope.key !== key ||
      scope.revision !== revision ||
      scope.controller.signal.aborted ||
      scope.pending.has(id) ||
      row.complete
    )
      return;
    const offset = scope.cursors.get(id);
    if (offset === undefined) return;
    scope.pending.add(id); // Synchronous lock also covers two events before React commits.
    setPendingRows(new Set(scope.pending));
    const current = () =>
      pageScope.current === scope && !scope.controller.signal.aborted;
    try {
      const next = await request(
        "/fiscal?" +
          queryString({ ...query, dossierId: id, offset, limit: 200 }),
        RecordListSchema,
        scope.controller.signal,
      );
      if (!current() || scope.cursors.get(id) !== offset) return;
      // Cursor counts server rows consumed, independently of unique displayed identities.
      scope.cursors.set(id, offset + next.items.length);
      setResult((old) =>
        !old || !current()
          ? old
          : {
              ...old,
              rows: old.rows.map((r) => {
                if (r.dossier.id !== id) return r;
                const unique = new Map(
                  r.occurrences.map((item) => [item.id, item]),
                );
                next.items.forEach((item) => {
                  if (item.kind === "obligation") unique.set(item.id, item);
                });
                const occurrences = [...unique.values()];
                return {
                  ...r,
                  occurrences,
                  total: next.total,
                  complete: occurrences.length >= next.total,
                };
              }),
            },
      );
    } catch (e) {
      if (current()) setError(message(e));
    } finally {
      scope.pending.delete(id);
      if (current()) setPendingRows(new Set(scope.pending));
    }
  }
  const columns = dossierId
    ? months.map((label, i) => ({ id: String(i + 1).padStart(2, "0"), label }))
    : nature === "TVA"
      ? Array.from(
          { length: new Date(Number(year), Number(month), 0).getDate() },
          (_, i) => ({
            id: String(i + 1).padStart(2, "0"),
            label: String(i + 1),
          }),
        )
      : [
          { id: "solde", label: "Solde" },
          ...Array.from({ length: 4 }, (_, i) => ({
            id: `acompte_${i + 1}`,
            label: `${i + 1}${i === 0 ? "er" : "e"} acompte`,
          })),
          { id: "other", label: "Autres sous-types" },
        ];
  function cell(
    items: FiscalMatrix["rows"][number]["occurrences"],
    column: string,
  ) {
    return items.filter((r) =>
      dossierId
        ? dateFor(r, query?.fiscalDateReference)?.slice(5, 7) === column
        : nature === "TVA"
          ? dateFor(r, query?.fiscalDateReference)?.slice(8, 10) === column
          : column === "other"
            ? ![
                "solde",
                "acompte_1",
                "acompte_2",
                "acompte_3",
                "acompte_4",
              ].includes(r.data.fiscal!.period.subtype)
            : r.data.fiscal!.period.subtype === column,
    );
  }
  function occurrence(r: FiscalMatrix["rows"][number]["occurrences"][number]) {
    const link = new URLSearchParams(location.hash.split("?")[1]);
    link.set("id", r.id);
    return (
      <a
        key={r.id}
        href={`#fiscal?${link}`}
        className="matrix-occurrence"
        title={`${r.title} · ${r.data.fiscal?.period.subtype} · ${r.data.dueDate ? formatCivilDate(r.data.dueDate) : "Date limite inconnue"}`}
        aria-label={`Ouvrir ${r.title}`}
      >
        <span
          className="semantic-status"
          data-state={
            r.data.validation === "validee_localement"
              ? "done"
              : r.data.preparation === "preparee"
                ? "ready"
                : r.data.preparation === "en_cours"
                  ? "pending"
                  : "todo"
          }
        >
          {r.data.validation === "validee_localement"
            ? "Approuvée"
            : r.data.preparation === "preparee"
              ? "Préparée"
              : r.data.preparation === "en_cours"
                ? "En cours"
                : "À préparer"}
        </span>
        {!compact && (
          <>
            <strong>{moneyLabel(r.data.amount)}</strong>
            <small>{labelValue(r.data.fiscal?.period.subtype ?? "")}</small>
          </>
        )}
      </a>
    );
  }
  return (
    <section className="matrix-workspace">
      <header className="section-heading">
        <div>
          <h2>
            {dossierId ? "Échéances du dossier" : natureLabels[nature ?? ""]}
          </h2>
          <p>
            {dossierId
              ? "Natures et mois de l’exercice"
              : "Dossiers autorisés et suivi des déclarations"}
          </p>
        </div>
        <div className="actions">
          <Button onClick={() => setRevision((v) => v + 1)}>
            Actualiser la grille
          </Button>
          <a href="#fiscal">Toutes les obligations et actions</a>
        </div>
      </header>
      <div className="matrix-controls">
        <Select
          name="matrix-scope"
          label="Périmètre"
          value={params.get("own") ?? "false"}
          onChange={(own) => update({ own })}
        >
          <option value="false">Tous les dossiers autorisés</option>
          <option value="true">Mes dossiers affectés</option>
        </Select>
        <Field
          name="matrix-year"
          label="Année"
          type="number"
          value={yearDraft}
          onChange={(year) => {
            setYearDraft(year);
            if (/^\d{4}$/.test(year)) update({ year });
          }}
        />
        <Select
          name="matrix-reference"
          label="Référence de date"
          value={reference}
          onChange={(fiscalDateReference) => update({ fiscalDateReference })}
        >
          <option value="due">Date limite</option>
          {nature !== "IS" && (
            <option value="period_end">Fin de période</option>
          )}
          {(nature === "IS" || dossierId) && (
            <option value="closing">Clôture</option>
          )}
        </Select>
        <Button
          size="sm"
          onClick={() => setCompact((v) => !v)}
          aria-pressed={compact}
        >
          {compact ? "Compressé" : "Classique"}
        </Button>
      </div>
      {!dossierId && nature === "TVA" && (
        <nav className="month-strip" aria-label="Mois de TVA">
          {months.map((label, i) => (
            <button
              key={label}
              aria-current={Number(month) === i + 1 ? "date" : undefined}
              onClick={() => update({ month: String(i + 1).padStart(2, "0") })}
            >
              {
                [
                  "Jan",
                  "Fév",
                  "Mar",
                  "Avr",
                  "Mai",
                  "Juin",
                  "Juil",
                  "Aoû",
                  "Sep",
                  "Oct",
                  "Nov",
                  "Déc",
                ][i]
              }
              <span className="sr-only"> {year}</span>
            </button>
          ))}
        </nav>
      )}
      <div className="matrix-filters">
        <Field
          name="matrix-search"
          label="Rechercher un dossier"
          value={params.get("dossierQuery") ?? ""}
          onChange={(dossierQuery) => update({ dossierQuery })}
        />
        <Select
          name="matrix-regime"
          label="Régime"
          value={params.get("regime") ?? ""}
          onChange={(regime) => update({ regime })}
        >
          <option value="">Tous les régimes</option>
          {[
            "reel_normal",
            "reel_simplifie",
            "franchise",
            "exonere",
            "hors_champ",
          ].map((v) => (
            <option key={v} value={v}>
              {labelValue(v)}
            </option>
          ))}
        </Select>
        <Select
          name="matrix-preparation"
          label="Préparation"
          value={params.get("preparation") ?? ""}
          onChange={(preparation) => update({ preparation })}
        >
          <option value="">Tous les états</option>
          <option value="a_preparer">À préparer</option>
          <option value="en_cours">En cours</option>
          <option value="preparee">Préparée</option>
        </Select>
        <Select
          name="matrix-source"
          label="Source"
          value={params.get("source") ?? ""}
          onChange={(source) => update({ source })}
        >
          <option value="">Toutes les sources</option>
          <option value="manuelle">Manuelle</option>
          <option value="simulee">Simulée</option>
        </Select>
        <label className="check-row">
          <input
            type="checkbox"
            checked={!!params.get("lateBefore")}
            onChange={(e) =>
              update({ lateBefore: e.target.checked ? today : undefined })
            }
          />
          En retard au {formatCivilDate(today)}
        </label>
      </div>
      <ErrorSummary
        message={
          !parsed.success
            ? "Vérifiez l’année et les filtres de la grille."
            : error || undefined
        }
      />
      {loading ? (
        <p role="status">Chargement de la matrice…</p>
      ) : (
        result && (
          <>
            <div
              className="matrix-scroll-actions"
              aria-label="Défilement des colonnes"
            >
              <span>
                {nature === "TVA" && !dossierId
                  ? "Jours du mois"
                  : "Colonnes de la matrice"}
              </span>
              <Button
                size="sm"
                onClick={() =>
                  tableScroll.current?.scrollBy({
                    left: -Math.max(200, tableScroll.current.clientWidth - 240),
                  })
                }
              >
                Colonnes précédentes
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  tableScroll.current?.scrollBy({
                    left: Math.max(200, tableScroll.current.clientWidth - 240),
                  })
                }
              >
                Colonnes suivantes
              </Button>
            </div>
            <div
              ref={tableScroll}
              role="region"
              aria-label="Matrice fiscale défilante"
              tabIndex={0}
              className={`table-scroll fiscal-matrix ${compact ? "compressed" : ""}`}
            >
              <Table>
                <caption className="sr-only">
                  {dossierId
                    ? "Matrice nature par mois"
                    : "Matrice dossier par " +
                      (nature === "TVA" ? "jour" : "solde et acompte")}
                </caption>
                <thead>
                  <TableRow>
                    <TableHeader>
                      {dossierId ? "Nature" : "Dossier"}
                    </TableHeader>
                    {columns.map((c) => (
                      <TableHeader key={c.id} scope="col">
                        {c.label}
                      </TableHeader>
                    ))}
                  </TableRow>
                </thead>
                <tbody>
                  {result.rows.flatMap((row) => {
                    const rows = dossierId
                      ? FiscalNatureSchema.options.map((n) => ({
                          name: natureLabels[n] ?? n,
                          items: row.occurrences.filter(
                            (r) => r.data.nature === n,
                          ),
                          id: n,
                        }))
                      : [
                          {
                            name: row.dossier.title,
                            items: row.occurrences,
                            id: row.dossier.id,
                          },
                        ];
                    return rows.map((r) => (
                      <TableRow key={row.dossier.id + "-" + r.id}>
                        <TableHeader scope="row">
                          <a href={`#dossier?id=${row.dossier.id}`}>{r.name}</a>
                          {!dossierId && (
                            <small>
                              {labelValue(
                                row.dossier.data.vatRegime ?? "unknown",
                              )}
                            </small>
                          )}
                          {!row.complete && (
                            <Button
                              size="sm"
                              disabled={pendingRows.has(row.dossier.id)}
                              aria-busy={pendingRows.has(row.dossier.id)}
                              onClick={() => void more(row)}
                            >
                              Charger les occurrences suivantes (
                              {row.occurrences.length}/{row.total})
                            </Button>
                          )}
                        </TableHeader>
                        {columns.map((c) => (
                          <TableCell key={c.id}>
                            {cell(r.items, c.id).map(occurrence)}
                            {!cell(r.items, c.id).length && (
                              <span
                                className="matrix-no-observation"
                                title={
                                  row.complete
                                    ? "Aucune occurrence autorisée dans ce périmètre. La disponibilité de la source reste inconnue."
                                    : "Couverture partielle, d’autres occurrences restent à charger."
                                }
                              >
                                {row.complete ? "—" : "…"}
                              </span>
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    ));
                  })}
                </tbody>
              </Table>
            </div>
            {!result.rows.length && (
              <p className="work-empty">
                Aucun dossier autorisé dans ce périmètre.
              </p>
            )}
            <footer className="matrix-footer">
              <span>
                {result.total} dossiers autorisés ·{" "}
                {result.rows.reduce((n, r) => n + r.occurrences.length, 0)}{" "}
                occurrences chargées
              </span>
              <Button
                size="sm"
                disabled={!query?.offset}
                onClick={() =>
                  update({
                    offset: String(Math.max(0, (query?.offset ?? 0) - 25)),
                  })
                }
              >
                Dossiers précédents
              </Button>
              <Button
                size="sm"
                disabled={result.offset + result.limit >= result.total}
                onClick={() =>
                  update({ offset: String(result.offset + result.limit) })
                }
              >
                Dossiers suivants
              </Button>
            </footer>
            <p className="matrix-legend">
              — Aucune occurrence autorisée observée pour ces filtres ;
              disponibilité de la source inconnue. … Chargement incomplet.
            </p>
          </>
        )
      )}
      {query && (
        <details className="matrix-export">
          <summary>Exporter les obligations de ce périmètre</summary>
          <p>
            Les dates, la référence, les filtres et les droits courants sont
            appliqués à l’export.
          </p>
          <CsvExport
            query={{
              ...query,
              offset: 0,
              columns:
                "title,nature,fiscalSubtype,period,dueDate,amount,validation",
            }}
          />
        </details>
      )}
      {selected && (
        <Peek
          label="Détail de l’obligation"
          onClose={() => {
            location.hash = back();
          }}
        >
          <FiscalDetail
            key={selected}
            id={selected}
            onChange={() => setRevision((v) => v + 1)}
            returnHref={back()}
          />
        </Peek>
      )}
    </section>
  );
}
