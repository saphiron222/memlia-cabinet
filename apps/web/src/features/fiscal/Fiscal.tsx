import { useEffect, useState } from "react";
import { Button } from "@memlia/ui";
import {
  RecordListSchema,
  RecordListQuerySchema,
  FiscalNatureSchema,
  FiscalBulkResultSchema,
  type CabinetRecord,
  type RecordListQuery,
  type FiscalEvent,
} from "@memlia/contracts";
import { Field, Select, ErrorSummary } from "../../forms";
import { request, message, useScope, queryString } from "../../api";
import {
  useModuleEnabled,
  useInstallation,
} from "../administration/preferences";
import { useRecordCapabilities } from "../administration/capabilities";
import { ViewControls } from "../records/ViewControls";
import { CsvExport } from "../records/CsvExport";
import { ExportData } from "../administration/ExportData";
import {
  useCustomFields,
  CustomFieldsStatus,
} from "../referential/CustomValues";
import { columnLabels, columnValue } from "../records/columns";
import { PeopleFilter } from "./PeopleFilter";
import { FiscalCreate } from "./FiscalCreate";
import { FiscalDetail } from "./FiscalDetail";
import { FiscalGeneration } from "./FiscalGeneration";
import { natureLabels } from "./labels";
export function Fiscal() {
  const { info: installation } = useInstallation();
  const signal = useScope(),
    enabled = useModuleEnabled("fiscal"),
    custom = useCustomFields("obligation");
  const [yearText, setYearText] = useState("");
  const [id, setId] = useState(() =>
      new URLSearchParams(location.hash.split("?")[1]).get("id"),
    ),
    [creating, setCreating] = useState(false),
    [generating, setGenerating] = useState(false),
    [query, setQuery] = useState<RecordListQuery>(() =>
      RecordListQuerySchema.parse({
        kind: "obligation",
        fiscalOnly: "true",
        columns:
          "title,nature,fiscalSubtype,fiscalCampaign,fiscalRegime,period,amount,validation,freshnessState",
      }),
    ),
    [items, setItems] = useState<CabinetRecord[]>([]),
    [total, setTotal] = useState(0),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<string[]>([]),
    [reason, setReason] = useState(""),
    [bulkResult, setBulkResult] = useState(""),
    [busy, setBusy] = useState(false);
  const capabilities = useRecordCapabilities(items.map((r) => r.id)),
    key = queryString(query);
  useEffect(() => {
    const change = () => {
      setId(new URLSearchParams(location.hash.split("?")[1]).get("id"));
      setCreating(false);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    setSelected([]);
    void request("/fiscal?" + key, RecordListSchema, ctrl.signal)
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [key, revision]);
  function patch(next: Partial<RecordListQuery>) {
    setQuery({
      ...query,
      ...next,
      kind: "obligation",
      fiscalOnly: "true",
      offset: 0,
    });
  }
  async function bulk(event: FiscalEvent) {
    setBusy(true);
    setError("");
    try {
      const result = await request(
        "/fiscal/bulk",
        FiscalBulkResultSchema,
        signal,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            items: items
              .filter((r) => selected.includes(r.id))
              .map((r) => ({ id: r.id, expectedVersion: r.version })),
            event,
          }),
        },
      );
      setBulkResult(
        result.items
          .map(
            (r) =>
              `${items.find((i) => i.id === r.id)?.title}: ${r.status === "updated" ? "mis à jour" : r.error}`,
          )
          .join(" · "),
      );
      setRevision((v) => v + 1);
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  if (id)
    return (
      <FiscalDetail
        key={id}
        id={id}
        onChange={() => setRevision((v) => v + 1)}
      />
    );
  if (creating)
    return (
      <FiscalCreate
        onCancel={() => setCreating(false)}
        onCreated={(d) => {
          setCreating(false);
          location.hash = `fiscal?id=${d.record.id}`;
          setRevision((v) => v + 1);
        }}
      />
    );
  if (generating)
    return (
      <FiscalGeneration
        onCancel={() => setGenerating(false)}
        onGenerated={() => setRevision((v) => v + 1)}
      />
    );
  const columns = query.columns?.split(",") ?? ["title"];
  return (
    <section className="fiscal-grid">
      <header className="fiscal-record-header">
        <div>
          <h2>Obligations fiscales</h2>
          <span className="muted">Campagnes et suivi du cabinet</span>
        </div>
        <div className="actions">
          <Button
            variant="solid"
            disabled={!enabled}
            onClick={() => setCreating(true)}
          >
            Créer une obligation fiscale
          </Button>
          <Button disabled={!enabled} onClick={() => setGenerating(true)}>
            Générer des occurrences
          </Button>
        </div>
      </header>
      <ErrorSummary message={error || capabilities.error || undefined} />
      <details className="fiscal-filter-panel">
        <summary>Filtres et colonnes</summary>
        <div className="admin-inline">
          <Select
            name="fiscal-filter-nature"
            label="Filtrer par nature fiscale"
            value={query.nature ?? ""}
            onChange={(nature) => patch({ nature: nature || undefined })}
          >
            <option value="">Toutes les natures</option>
            {FiscalNatureSchema.options.map((n) => (
              <option key={n} value={n}>
                {natureLabels[n]}
              </option>
            ))}
          </Select>
          <Field
            name="fiscal-filter-campaign"
            label="Campagne filtrée"
            value={query.campaign ?? ""}
            onChange={(campaign) => patch({ campaign: campaign || undefined })}
          />
          <Field
            name="fiscal-filter-year"
            label="Année filtrée"
            value={yearText}
            type="number"
            onChange={(year) => {
              setYearText(year);
              if (!year || /^\d{4}$/.test(year))
                patch({ year: year || undefined });
            }}
          />
          <Select
            name="fiscal-filter-month"
            label="Mois filtré"
            value={query.month ?? ""}
            onChange={(month) => patch({ month: month || undefined })}
          >
            <option value="">Tous les mois</option>
            {Array.from({ length: 12 }, (_, i) =>
              String(i + 1).padStart(2, "0"),
            ).map((month) => (
              <option key={month} value={month}>
                {month}
              </option>
            ))}
          </Select>
          <Field
            name="fiscal-filter-property"
            label="Bien concerné"
            value={query.property ?? ""}
            onChange={(property) => patch({ property: property || undefined })}
          />
          <Select
            name="fiscal-filter-classification"
            label="Classement fiscal"
            value={query.classification ?? ""}
            onChange={(classification) =>
              patch({
                classification: (classification ||
                  undefined) as RecordListQuery["classification"],
                archived: classification === "archived" ? "true" : "false",
              })
            }
          >
            <option value="">Tous les classements</option>
            <option value="active">Actif</option>
            <option value="archived">Archivé</option>
            <option value="hidden">Masqué</option>
            <option value="nil">Néant</option>
            <option value="not_applicable">Non applicable</option>
          </Select>
        </div>
        <PeopleFilter query={query} onChange={patch} />
        <CustomFieldsStatus state={custom} />
        <ViewControls
          query={query}
          custom={custom.fields}
          fieldsReady={!custom.loading && !custom.error}
          onChange={(q) =>
            setQuery({ ...q, kind: "obligation", fiscalOnly: "true" })
          }
        />
      </details>
      <div className="fiscal-grid-search">
        <Field
          name="fiscal-search"
          label="Rechercher une obligation"
          value={query.q ?? ""}
          onChange={(q) => patch({ q })}
        />
        <Button onClick={() => setRevision((v) => v + 1)}>
          Actualiser la grille
        </Button>
      </div>
      {loading ? (
        <p role="status">Chargement des obligations…</p>
      ) : (
        <>
          <p>{total} obligations autorisées</p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Sélection</th>
                  {columns.map((c) => (
                    <th key={c}>{columnLabels[c] ?? c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Sélectionner ${r.title}`}
                        checked={selected.includes(r.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, r.id]
                              : selected.filter((id) => id !== r.id),
                          )
                        }
                      />
                    </td>
                    {columns.map((c) => (
                      <td key={c}>
                        {c === "title" ? (
                          <a href={`#fiscal?id=${r.id}`}>{r.title}</a>
                        ) : (
                          columnValue(r, c, installation?.cabinetTimeZone)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!items.length && <p>Aucune obligation ne correspond aux filtres.</p>}
          <Button
            disabled={!query.offset}
            onClick={() =>
              setQuery({
                ...query,
                offset: Math.max(0, query.offset - query.limit),
              })
            }
          >
            Obligations précédentes
          </Button>
          <Button
            disabled={query.offset + query.limit >= total}
            onClick={() =>
              setQuery({ ...query, offset: query.offset + query.limit })
            }
          >
            Obligations suivantes
          </Button>
        </>
      )}
      <fieldset
        hidden={!selected.length}
        disabled={!enabled || !selected.length || busy}
      >
        <legend>
          Actions sur les {selected.length} obligations sélectionnées
        </legend>
        <p>
          Chaque ligne est contrôlée séparément ; les refus sont indiqués sans
          modifier la ligne refusée.
        </p>
        <Button
          onClick={() => void bulk({ kind: "preparation", state: "preparee" })}
        >
          Préparer la sélection
        </Button>
        <Button onClick={() => void bulk({ kind: "approval_request" })}>
          Demander l’approbation de la sélection
        </Button>
        <Field
          name="fiscal-bulk-reason"
          label="Motif de l’approbation en lot"
          value={reason}
          onChange={setReason}
        />
        <Button
          disabled={!reason.trim()}
          onClick={() =>
            void bulk({ kind: "approval", decision: "approved", reason })
          }
        >
          Approuver localement la sélection
        </Button>
      </fieldset>
      {bulkResult && <p role="status">{bulkResult}</p>}
      <details className="fiscal-filter-panel">
        <summary>Exporter cette vue</summary>
        <CsvExport query={query} />
        <ExportData query={query} />
        {["TF", "CFE_IFER"].includes(query.nature ?? "") && (
          <ExportData query={query} originals />
        )}
      </details>
    </section>
  );
}
