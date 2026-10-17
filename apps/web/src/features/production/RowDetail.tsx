import { tabKeys } from "../workflows/tabs";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button, Checkbox } from "@memlia/ui";
import {
  ProductionRowSchema,
  ProductionCapabilitiesSchema,
  DocumentListSchema,
  productionPeriod,
  ProductionCommandSchema,
  DepositSchema,
  ProductionObservationSchema,
  type ProductionRow,
  type ProductionModel,
  type ProductionColumn,
} from "@memlia/contracts";
import { request, message, useScope } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
import { WorkPanel } from "../workflows/WorkPanel";
import { formatCivilDate } from "../workflows/civil";
import { StageValue } from "./value";
import { PeopleSelect } from "./PeopleSelect";
export function RowDetail({
  row: initial,
  model,
  models,
  date,
  onChange,
  onClose,
}: {
  row: ProductionRow;
  model: ProductionModel;
  models: ProductionModel[];
  date: string;
  onChange: (r: ProductionRow) => void;
  onClose: () => void;
}) {
  const signal = useScope(),
    [row, setRow] = useState(initial),
    [tab, setTab] = useState("steps"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [rights, setRights] = useState<z.infer<
      typeof ProductionCapabilitiesSchema
    > | null>(null),
    [documents, setDocuments] = useState<
      z.infer<typeof DocumentListSchema>["items"]
    >([]),
    [docSearch, setDocSearch] = useState(""),
    [docOffset, setDocOffset] = useState(0),
    [docTotal, setDocTotal] = useState(0);
  useEffect(() => {
    void request(
      `/production/rows/${row.id}/capabilities`,
      ProductionCapabilitiesSchema,
      signal,
    )
      .then(setRights)
      .catch((e) => setError(message(e)));
  }, [row.version]);
  const dossierId =
    row.scope?.kind === "dossier" ? row.scope.id : row.scope?.dossierId;
  useEffect(() => {
    const c = new AbortController();
    if (dossierId)
      void request(
        "/documents?" +
          new URLSearchParams({
            dossierId,
            q: docSearch,
            offset: String(docOffset),
            limit: "100",
          }),
        DocumentListSchema,
        c.signal,
      )
        .then((r) => {
          setDocuments(r.items);
          setDocTotal(r.total);
        })
        .catch((e) => {
          if (!c.signal.aborted) setError(message(e));
        });
    return () => c.abort();
  }, [dossierId, docSearch, docOffset]);
  async function command(
    command: z.infer<typeof ProductionCommandSchema>["command"],
  ) {
    setBusy(true);
    setError("");
    try {
      const saved = await request(
        `/production/rows/${row.id}/commands`,
        ProductionRowSchema,
        signal,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            expectedVersion: row.version,
            command,
          }),
        },
      );
      setRow(saved);
      onChange(saved);
      setEditing(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    try {
      const saved = await request(
        `/production/rows/${row.id}`,
        ProductionRowSchema,
        signal,
      );
      setRow(saved);
      onChange(saved);
      setError("");
      setEditing(null);
    } catch (e) {
      setError(message(e));
    }
  }
  if (model.model.kind === "stage_type") return null;
  const template = model.model;
  const docs = (selected: string[], onSelect: (ids: string[]) => void) => (
    <fieldset className="production-documents">
      <legend>Pièces liées</legend>
      {!dossierId ? (
        <p className="muted">
          Rattachez cette cible à un dossier pour associer des pièces.
        </p>
      ) : (
        <>
          <Field
            name="production-doc-search"
            label="Rechercher une pièce"
            value={docSearch}
            onChange={(v) => {
              setDocSearch(v);
              setDocOffset(0);
            }}
          />
          {documents.map((d) => (
            <label className="check" key={d.id}>
              <Checkbox
                checked={selected.includes(d.id)}
                onCheckedChange={(checked) =>
                  onSelect(
                    checked
                      ? [...selected, d.id]
                      : selected.filter((x) => x !== d.id),
                  )
                }
              />
              {d.filename} · v{d.version}
            </label>
          ))}
          {!documents.length && (
            <p className="muted">
              Aucune pièce sur cette page. Ajouter les originaux depuis la GED.
            </p>
          )}
          <div className="actions">
            <Button
              disabled={!docOffset}
              onClick={() => setDocOffset((v) => v - 100)}
            >
              Précédentes
            </Button>
            <Button
              disabled={docOffset + 100 >= docTotal}
              onClick={() => setDocOffset((v) => v + 100)}
            >
              Suivantes
            </Button>
            <a href="#documents">Ouvrir la GED</a>
          </div>
        </>
      )}
    </fieldset>
  );
  return (
    <aside
      className="production-detail"
      aria-label={"Fiche " + row.target.label}
    >
      <header className="production-panel-header">
        <div>
          <span className="muted">
            {template.name} · {row.period}
          </span>
          <h2>{row.target.label}</h2>
        </div>
        <Button onClick={onClose}>Fermer la fiche</Button>
      </header>
      <div className="production-summary">
        <span className="badge">
          {
            {
              not_done: "Non fait",
              done: "Fait",
              not_applicable: "Non applicable",
            }[row.state]
          }
        </span>
        <span>
          Échéance {row.dueDate ? formatCivilDate(row.dueDate) : "non prévue"}
        </span>
        <span className="muted">v{row.version}</span>
      </div>
      <div
        className="work-tabs"
        onKeyDown={tabKeys}
        role="tablist"
        aria-label="Fiche de production"
      >
        {[
          ["steps", "Étapes"],
          ["properties", "Propriétés"],
          ["sources", "Sources"],
          ...(row.recordId ? [["work", "Checklist et échanges"]] : []),
          ...(template.kind === "balance" || template.nature === "depot_comptes"
            ? [["deposit", "Comptes annuels"]]
            : []),
        ].map(([key, label]) => (
          <button
            role="tab"
            aria-selected={tab === key}
            key={key}
            onClick={() => {
              setTab(key!);
              setEditing(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <ErrorSummary message={error || undefined} />
      {error && (
        <Button onClick={() => void reload()}>
          Recharger la version enregistrée
        </Button>
      )}
      <div className="production-detail-body">
        {tab === "steps" && (
          <div className="production-steps">
            {template.columns.map((c) => {
              const period = productionPeriod(
                  c,
                  template.kind === "followup" ? date : (row.dueDate ?? date),
                ),
                cell = row.cells.find(
                  (x) => x.columnId === c.id && x.period === period,
                ),
                permission = rights?.columns.find((x) => x.id === c.id);
              return (
                <section className="production-step" key={c.id}>
                  <header>
                    <div>
                      <strong>{c.name}</strong>
                      <small className="muted">
                        {period === "once" ? "Ponctuel" : period}
                        {c.plannedDate
                          ? " · prévu " + formatCivilDate(c.plannedDate)
                          : ""}{" "}
                        · {c.plannedMinutes} min
                      </small>
                    </div>
                    <Button
                      disabled={!permission?.edit || busy || template.closed}
                      onClick={() => setEditing(c.id)}
                    >
                      Renseigner {c.name}
                    </Button>
                  </header>
                  {editing === c.id ? (
                    <CellEditor
                      column={c}
                      value={cell?.value ?? null}
                      approved={cell?.approved ?? false}
                      note={cell?.note ?? ""}
                      documentIds={cell?.documentIds ?? []}
                      models={models}
                      docs={docs}
                      busy={busy}
                      onCancel={() => setEditing(null)}
                      onSave={(value, approve, note, documentIds) =>
                        void command({
                          kind: "cell",
                          columnId: c.id,
                          period,
                          value,
                          approve,
                          note,
                          documentIds,
                        })
                      }
                    />
                  ) : (
                    <>
                      <StageValue
                        column={c}
                        value={cell?.value ?? null}
                        models={models}
                      />
                      {cell && (
                        <small className="muted">
                          {cell.approved
                            ? "Validée localement"
                            : "Saisie enregistrée"}{" "}
                          · {new Date(cell.at).toLocaleString("fr")}
                        </small>
                      )}
                      {cell?.note && <p>{cell.note}</p>}
                      {cell?.documentIds.map((id) => (
                        <a key={id} href={`/api/v1/documents/${id}/download`}>
                          {documents.find((d) => d.id === id)?.filename ??
                            "Pièce liée"}
                        </a>
                      ))}
                    </>
                  )}
                </section>
              );
            })}
          </div>
        )}
        {tab === "properties" && (
          <Properties
            key={row.version}
            row={row}
            busy={busy || !rights?.update || template.closed}
            assign={rights?.assign ?? false}
            docs={docs}
            onSave={(c) => void command(c)}
          />
        )}
        {tab === "sources" && (
          <SourceObservations
            row={row}
            busy={busy || !rights?.update}
            docs={docs}
            onSave={(observation) =>
              void command({ kind: "observation", observation })
            }
          />
        )}
        {tab === "work" && row.recordId && (
          <WorkPanel targetId={row.recordId} />
        )}
        {tab === "deposit" && (
          <Deposit
            key={row.version}
            value={row.deposit}
            documents={documents}
            docs={docs}
            busy={busy || !rights?.update || template.closed}
            onSave={(deposit) => void command({ kind: "deposit", deposit })}
          />
        )}
      </div>
    </aside>
  );
}
type DocEditor = (
  ids: string[],
  set: (ids: string[]) => void,
) => React.ReactNode;
function CellEditor({
  column,
  value: initial,
  approved: initialApproved,
  note: initialNote,
  documentIds: initialDocs,
  models,
  docs,
  busy,
  onCancel,
  onSave,
}: {
  column: ProductionColumn;
  value: string | boolean | null;
  approved: boolean;
  note: string;
  documentIds: string[];
  models: ProductionModel[];
  docs: DocEditor;
  busy: boolean;
  onCancel: () => void;
  onSave: (
    v: string | boolean | null,
    approved: boolean,
    note: string,
    ids: string[],
  ) => void;
}) {
  const [value, setValue] = useState(initial),
    [approved, setApproved] = useState(initialApproved),
    [note, setNote] = useState(initialNote),
    [ids, setIds] = useState(initialDocs);
  const m = models.find((x) => x.id === column.stageTypeId);
  return (
    <form
      className="production-cell-editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value, approved, note, ids);
      }}
    >
      {["boolean", "completion", "status"].includes(column.type) ? (
        <Select
          name="cell-value"
          label={"Valeur de " + column.name}
          value={value === null ? "" : String(value)}
          onChange={(v) =>
            setValue(
              v === "" ? null : column.type === "boolean" ? v === "true" : v,
            )
          }
        >
          <option value="">Inconnu</option>
          {column.type === "boolean" ? (
            <>
              <option value="true">Oui</option>
              <option value="false">Non</option>
            </>
          ) : column.type === "completion" ? (
            <>
              <option value="done">Fait</option>
              <option value="not_done">Non fait</option>
              <option value="not_applicable">Non applicable</option>
            </>
          ) : m?.model.kind === "stage_type" ? (
            m.model.statuses.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))
          ) : null}
        </Select>
      ) : (
        <Field
          name="cell-value"
          label={"Valeur de " + column.name}
          type={column.type === "date" ? "date" : "text"}
          value={value === null ? "" : String(value)}
          onChange={(v) => setValue(v || null)}
        />
      )}
      <StageValue column={column} value={value} models={models} />
      {column.approval && (
        <label className="check">
          <Checkbox
            checked={approved}
            onCheckedChange={(checked) => setApproved(checked)}
          />
          Je valide cette étape
        </label>
      )}
      <Field
        name="cell-note"
        label="Observation"
        value={note}
        onChange={setNote}
      />
      {docs(ids, setIds)}
      <div className="actions">
        <Button type="button" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit" disabled={busy}>
          Enregistrer l’étape
        </Button>
      </div>
    </form>
  );
}
function Properties({
  row,
  busy,
  assign,
  docs,
  onSave,
}: {
  row: ProductionRow;
  busy: boolean;
  assign: boolean;
  docs: DocEditor;
  onSave: (
    c: Extract<
      z.infer<typeof ProductionCommandSchema>["command"],
      { kind: "properties" }
    >,
  ) => void;
}) {
  const [state, setState] = useState(row.state),
    [date, setDate] = useState(row.dueDate ?? ""),
    [assigneeId, setAssignee] = useState(row.assigneeId),
    [tags, setTags] = useState(row.tags.join(", ")),
    [documentIds, setDocs] = useState(row.documentIds);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          kind: "properties",
          state,
          dueDate: date || null,
          assigneeId,
          tags: tags
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          documentIds,
        });
      }}
    >
      <div className="production-properties">
        <Select
          name="row-state"
          label="Réalisation"
          value={state}
          onChange={(v) => setState(v as typeof state)}
          disabled={busy}
        >
          <option value="not_done">Non fait</option>
          <option value="done">Fait</option>
          <option value="not_applicable">Non applicable</option>
        </Select>
        <Field
          name="row-date"
          label="Date prévue"
          type="date"
          value={date}
          onChange={setDate}
          disabled={busy}
        />
        <PeopleSelect
          name="row-assignee"
          value={assigneeId}
          onChange={setAssignee}
          disabled={busy || !assign}
        />
        <Field
          name="row-tags"
          label="Étiquettes"
          value={tags}
          onChange={setTags}
          disabled={busy}
        />
      </div>
      {docs(documentIds, setDocs)}
      <Button type="submit" disabled={busy}>
        Enregistrer les propriétés
      </Button>
    </form>
  );
}
function Deposit({
  value,
  documents,
  docs,
  busy,
  onSave,
}: {
  value: z.infer<typeof DepositSchema>;
  documents: z.infer<typeof DocumentListSchema>["items"];
  docs: DocEditor;
  busy: boolean;
  onSave: (v: z.infer<typeof DepositSchema>) => void;
}) {
  const [deposit, setDeposit] = useState(value),
    [add, setAdd] = useState(false),
    [date, setDate] = useState(""),
    [state, setState] = useState<
      "submitted" | "waiting" | "rejected" | "accepted"
    >("submitted"),
    [source, setSource] = useState<"manual" | "supplier" | "simulated">(
      "manual",
    ),
    [reference, setReference] = useState(""),
    [receipt, setReceipt] = useState(""),
    [documentIds, setDocs] = useState<string[]>([]);
  return (
    <>
      <div className="production-properties">
        <label className="check">
          <Checkbox
            checked={deposit.applicable}
            disabled={busy}
            onCheckedChange={(checked) =>
              setDeposit({ ...deposit, applicable: checked })
            }
          />
          Dépôt applicable
        </label>
        {(
          [
            ["liasseDate", "Date de liasse"],
            ["assemblyDate", "Date d’assemblée"],
            ["plannedDepositDate", "Dépôt prévu"],
          ] as const
        ).map(([key, label]) => (
          <Field
            key={key}
            name={key}
            label={label}
            type="date"
            value={deposit[key] ?? ""}
            onChange={(v) => setDeposit({ ...deposit, [key]: v || null })}
            disabled={busy}
          />
        ))}
        <label className="check">
          <Checkbox
            checked={deposit.manualComplete}
            disabled={busy}
            onCheckedChange={(checked) =>
              setDeposit({ ...deposit, manualComplete: checked })
            }
          />
          Travail marqué terminé manuellement
        </label>
      </div>
      <p className="muted">
        Cette marque interne ne constitue pas un reçu INPI ou Infogreffe.
      </p>
      <Button disabled={busy} onClick={() => onSave(deposit)}>
        Enregistrer les dates
      </Button>
      <h3>Tentatives et retours</h3>
      {!deposit.attempts.length && (
        <p className="muted">
          Aucune tentative ni preuve de dépôt enregistrée.
        </p>
      )}
      {deposit.attempts.map((a) => (
        <div className="production-attempt" key={a.id}>
          <strong>
            {
              {
                submitted: "Soumis",
                waiting: "En attente",
                rejected: "Rejeté",
                accepted: "Accepté",
              }[a.state]
            }
          </strong>
          <span>
            {formatCivilDate(a.date)} · {a.source} · {a.reference}
          </span>
          {a.receiptDocumentId && (
            <a href={`/api/v1/documents/${a.receiptDocumentId}/download`}>
              Reçu du registre
            </a>
          )}
        </div>
      ))}
      {!add ? (
        <Button disabled={busy} onClick={() => setAdd(true)}>
          Ajouter une observation de dépôt
        </Button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave({
              ...deposit,
              attempts: [
                ...deposit.attempts,
                {
                  id: crypto.randomUUID(),
                  date,
                  state,
                  source,
                  reference,
                  documentIds,
                  receiptDocumentId: receipt || null,
                },
              ],
            });
          }}
        >
          <Field
            name="attempt-date"
            label="Date de l’observation"
            type="date"
            value={date}
            onChange={setDate}
          />
          <Select
            name="attempt-state"
            label="État observé"
            value={state}
            onChange={(v) => setState(v as typeof state)}
          >
            {[
              ["submitted", "Soumis"],
              ["waiting", "En attente"],
              ["rejected", "Rejeté"],
              ["accepted", "Accepté"],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Select
            name="attempt-source"
            label="Provenance"
            value={source}
            onChange={(v) => setSource(v as typeof source)}
          >
            <option value="manual">Saisie manuelle</option>
            <option value="supplier">Observation fournisseur documentée</option>
            <option value="simulated">Source fictive</option>
          </Select>
          <Field
            name="attempt-reference"
            label="Référence de la source"
            value={reference}
            onChange={setReference}
          />
          {docs(documentIds, setDocs)}
          <Select
            name="attempt-receipt"
            label="Reçu officiel lié"
            value={receipt}
            onChange={setReceipt}
          >
            <option value="">Aucun</option>
            {documents.map((d) => (
              <option value={d.id} key={d.id}>
                {d.filename} · v{d.version}
              </option>
            ))}
          </Select>
          <div className="actions">
            <Button type="button" onClick={() => setAdd(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={busy}>
              Conserver l’observation
            </Button>
          </div>
        </form>
      )}
    </>
  );
}

function SourceObservations({
  row,
  busy,
  docs,
  onSave,
}: {
  row: ProductionRow;
  busy: boolean;
  docs: DocEditor;
  onSave: (o: z.infer<typeof ProductionObservationSchema>) => void;
}) {
  const [reference, setReference] = useState(""),
    [campaign, setCampaign] = useState(row.period),
    [date, setDate] = useState(""),
    [source, setSource] = useState<"supplier" | "simulated">("supplier"),
    [state, setState] = useState<
      "observed" | "not_observed" | "unavailable" | "rejected"
    >("observed"),
    [ids, setIds] = useState<string[]>([]);
  return (
    <>
      <p className="muted">
        La génération et la réalisation locale restent distinctes d’une
        observation du fournisseur.
      </p>
      {row.observations.map((o) => (
        <div className="production-attempt" key={o.id}>
          <strong>
            {o.reference} · {o.campaign}
          </strong>
          <span>
            {formatCivilDate(o.observedOn)} ·{" "}
            {o.source === "simulated" ? "Source fictive" : "Fournisseur"} ·{" "}
            {
              {
                observed: "Observé",
                not_observed: "Non observé",
                unavailable: "Indisponible",
                rejected: "Rejeté",
              }[o.state]
            }
          </span>
          {o.documentIds.map((id) => (
            <a key={id} href={"/api/v1/documents/" + id + "/download"}>
              Original lié
            </a>
          ))}
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            id: crypto.randomUUID(),
            reference,
            campaign,
            observedOn: date,
            source,
            state,
            documentIds: ids,
          });
        }}
      >
        <Field
          name="source-reference"
          label="Référence de l’observation"
          value={reference}
          onChange={setReference}
        />
        <Field
          name="source-campaign"
          label="Campagne source"
          value={campaign}
          onChange={setCampaign}
        />
        <Field
          name="source-date"
          label="Date d’observation"
          type="date"
          value={date}
          onChange={setDate}
        />
        <Select
          name="source-kind"
          label="Provenance de l’observation"
          value={source}
          onChange={(v) => setSource(v as typeof source)}
        >
          <option value="supplier">Fournisseur</option>
          <option value="simulated">Source fictive</option>
        </Select>
        <Select
          name="source-state"
          label="Résultat observé"
          value={state}
          onChange={(v) => setState(v as typeof state)}
        >
          {[
            ["observed", "Observé"],
            ["not_observed", "Non observé"],
            ["unavailable", "Indisponible"],
            ["rejected", "Rejeté"],
          ].map(([v, l]) => (
            <option value={v} key={v}>
              {l}
            </option>
          ))}
        </Select>
        {docs(ids, setIds)}
        <Button type="submit" disabled={busy}>
          Conserver l’observation source
        </Button>
      </form>
    </>
  );
}
