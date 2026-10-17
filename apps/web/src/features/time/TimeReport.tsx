import { useEffect, useState } from "react";
import { z } from "zod";
import {
  TimeReportSchema,
  TimeCsvRunSchema,
  TimeEntitySchema,
  TimeListSchema,
  type SessionUser,
  type TimeEntity,
} from "@memlia/contracts";
import { request, useScope, message } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
import { Button } from "@memlia/ui";
import {
  Table,
  TableRow,
  TableCell,
  TableHeader,
} from "../../upstream/twenty/Table";
import { Peek } from "../../interface/Peek";
import {
  EntryForm,
  useTimeOptions,
  duration,
  ScrollableTable,
  type Options,
} from "./shared";
export function Report({
  user,
  options,
  from,
  to,
  recordId,
  dossierId,
  userId,
  onChanged,
}: {
  user: SessionUser;
  options: Options;
  from: string;
  to: string;
  recordId?: string;
  dossierId?: string;
  userId?: string;
  onChanged?: () => void;
}) {
  const signal = useScope(),
    [report, setReport] = useState<z.infer<typeof TimeReportSchema> | null>(
      null,
    ),
    [offset, setOffset] = useState(0),
    [nature, setNature] = useState(""),
    [error, setError] = useState(""),
    [edit, setEdit] = useState<TimeEntity | null>(null),
    [history, setHistory] = useState<TimeEntity[] | null>(null),
    [epoch, setEpoch] = useState(0),
    [csv, setCsv] = useState<z.infer<typeof TimeCsvRunSchema> | null>(null),
    [exporting, setExporting] = useState(false);
  const query = {
    from,
    to,
    ...(recordId ? { recordId } : {}),
    ...(dossierId ? { dossierId } : {}),
    ...(userId ? { userId } : {}),
    ...(nature ? { natureId: nature } : {}),
    offset,
    limit: 100,
  };
  useEffect(() => {
    const c = new AbortController();
    setReport(null);
    setError("");
    void request(
      "/time/report?" +
        new URLSearchParams(
          Object.entries(query).map(([k, v]) => [k, String(v)]),
        ),
      TimeReportSchema,
      c.signal,
    )
      .then(setReport)
      .catch((e) => {
        if (!c.signal.aborted) setError(message(e));
      });
    return () => c.abort();
  }, [from, to, recordId, dossierId, userId, nature, offset, epoch]);
  useEffect(() => {
    setOffset(0);
    setCsv(null);
  }, [from, to, recordId, dossierId, userId, nature]);
  async function exportCsv() {
    setExporting(true);
    try {
      const r = await request(
        "/time/exports",
        z.object({ id: z.uuid() }),
        signal,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            query: { ...query, offset: 0 },
          }),
        },
      );
      setCsv(await request("/time/exports/" + r.id, TimeCsvRunSchema, signal));
    } catch (e) {
      setError(message(e));
    } finally {
      setExporting(false);
    }
  }
  useEffect(() => {
    if (!csv || ["completed", "failed"].includes(csv.job.state)) return;
    const timer = setTimeout(() => {
      void request("/time/exports/" + csv.id, TimeCsvRunSchema, signal)
        .then(setCsv)
        .catch((e) => setError(message(e)));
    }, 500);
    return () => clearTimeout(timer);
  }, [csv]);
  return (
    <section className="time-report">
      <ErrorSummary message={error} />
      <div className="time-report-bar">
        <Select
          name="time-report-nature"
          label="Nature"
          value={nature}
          onChange={setNature}
        >
          <option value="">Toutes les natures</option>
          {options.natures.map((n) => (
            <option value={n.id} key={n.id}>
              {n.data.kind === "nature" ? n.data.name : ""}
            </option>
          ))}
        </Select>
        <Button onClick={() => void exportCsv()} disabled={exporting}>
          Exporter les temps
        </Button>
      </div>
      {csv && (
        <div role="status">
          {csv.job.state === "completed" ? (
            <>
              CSV prêt ·{" "}
              {Array.from({ length: csv.parts }, (_, i) => (
                <a
                  key={i}
                  href={`/api/v1/time/exports/${csv.id}/parts/${i + 1}`}
                  download
                >
                  Partie {i + 1}{" "}
                </a>
              ))}
            </>
          ) : csv.job.state === "failed" ? (
            "Préparation interrompue. Relancez la sortie."
          ) : (
            "Préparation du CSV…"
          )}
        </div>
      )}
      {report ? (
        <>
          <dl className="time-metrics">
            <div>
              <dt>Réalisé</dt>
              <dd>{duration(report.realizedSeconds)}</dd>
            </div>
            {report.planned && (
              <div>
                <dt>Prévu · {report.planned.source}</dt>
                <dd>
                  {report.planned.minutes === null
                    ? "Inconnu"
                    : duration(report.planned.minutes * 60)}
                </dd>
              </div>
            )}
            <div>
              <dt>Valorisation</dt>
              <dd>
                {report.amount === null
                  ? "Taux incomplet"
                  : report.amount + " €"}
              </dd>
            </div>
            <div>
              <dt>Saisies</dt>
              <dd>{report.total}</dd>
            </div>
          </dl>
          {report.planned && (
            <p className="muted">{report.planned.explanation}</p>
          )}
          <ScrollableTable label="Tableau défilant des temps">
            <Table aria-label="Saisies de temps">
              <thead>
                <TableRow>
                  {[
                    "Date",
                    "Collaborateur",
                    "Nature",
                    "Relation explicite",
                    "Durée",
                    "Origine",
                    "Actions",
                  ].map((v) => (
                    <TableHeader key={v}>{v}</TableHeader>
                  ))}
                </TableRow>
              </thead>
              <tbody>
                {report.entries.map((e) => {
                  if (e.data.kind !== "entry") return null;
                  const d = e.data,
                    nature = options.natures.find((n) => n.id === d.natureId);
                  return (
                    <TableRow key={e.id}>
                      <TableCell>{d.date}</TableCell>
                      <TableCell>
                        {options.users.find((u) => u.id === d.userId)?.name ??
                          "Auteur historique"}
                      </TableCell>
                      <TableCell>
                        {nature?.data.kind === "nature"
                          ? nature.data.name
                          : "Nature historique"}
                      </TableCell>
                      <TableCell>
                        {d.link.kind === "free" ? (
                          <span className="muted">Libre · {d.link.label}</span>
                        ) : (
                          <a
                            href={
                              report.relations.find(
                                (r) =>
                                  r.id ===
                                  (d.link.kind === "free" ? "" : d.link.id),
                              )?.href
                            }
                          >
                            {report.relations.find(
                              (r) =>
                                r.id ===
                                (d.link.kind === "free" ? "" : d.link.id),
                            )?.label ?? "Objet lié"}
                          </a>
                        )}
                      </TableCell>
                      <TableCell className="time-number">
                        {duration(d.seconds)}
                      </TableCell>
                      <TableCell>
                        {d.source === "timer"
                          ? "Chronomètre"
                          : "Saisie manuelle"}
                      </TableCell>
                      <TableCell>
                        <div className="actions">
                          {d.source === "manual" &&
                            (d.userId === user.id || options.canManage) && (
                              <Button size="sm" onClick={() => setEdit(e)}>
                                Corriger
                              </Button>
                            )}
                          <Button
                            size="sm"
                            onClick={() => {
                              void request(
                                "/time/" + e.id + "/history",
                                TimeListSchema,
                                signal,
                              )
                                .then((r) => setHistory(r.items))
                                .catch((e) => setError(message(e)));
                            }}
                          >
                            Historique
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </tbody>
            </Table>
          </ScrollableTable>
          {report.total === 0 && (
            <p className="empty">
              Aucun temps saisi sur cette période et ce périmètre.
            </p>
          )}
          <div className="actions">
            <Button
              disabled={!offset}
              onClick={() => setOffset((v) => Math.max(0, v - 100))}
            >
              Précédents
            </Button>
            <span>
              {report.total ? offset + 1 : 0}–{offset + report.entries.length} /{" "}
              {report.total}
            </span>
            <Button
              disabled={!report.hasMore}
              onClick={() => setOffset((v) => v + 100)}
            >
              Suivants
            </Button>
          </div>
        </>
      ) : (
        !error && <p role="status">Chargement des temps…</p>
      )}
      {edit && (
        <Peek label="Corriger un temps" onClose={() => setEdit(null)}>
          <h2>Corriger un temps</h2>
          <EntryForm
            entry={edit}
            user={user}
            options={options}
            date={from}
            onSaved={() => {
              setEdit(null);
              setEpoch((v) => v + 1);
              onChanged?.();
            }}
          />
        </Peek>
      )}
      {history && (
        <Peek label="Historique du temps" onClose={() => setHistory(null)}>
          <h2>Historique du temps</h2>
          {history.map((e) => (
            <dl className="time-properties" key={e.version}>
              <dt>Version {e.version}</dt>
              <dd>{e.updatedAt}</dd>
              <dt>Durée</dt>
              <dd>
                {e.data.kind === "entry" ? duration(e.data.seconds) : "—"}
              </dd>
              <dt>Taux conservé</dt>
              <dd>
                {e.data.kind === "entry"
                  ? (e.data.rate?.hourlyAmount ?? "Inconnu")
                  : "—"}
              </dd>
            </dl>
          ))}
        </Peek>
      )}
    </section>
  );
}
export function TaskTime({
  user,
  id,
  label,
  date,
}: {
  user: SessionUser;
  id: string;
  label: string;
  date: string;
}) {
  const { options, error } = useTimeOptions(),
    [from, setFrom] = useState(date.slice(0, 7) + "-01"),
    [to, setTo] = useState(
      new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0))
        .toISOString()
        .slice(0, 10),
    ),
    [adding, setAdding] = useState(false),
    [epoch, setEpoch] = useState(0);
  return (
    <section id="task-time">
      <h3>Temps lié à cette tâche</h3>
      <ErrorSummary message={error} />
      <div className="time-toolbar">
        <Field
          name="task-time-from"
          label="Du"
          type="date"
          value={from}
          onChange={setFrom}
        />
        <Field
          name="task-time-to"
          label="Au"
          type="date"
          value={to}
          onChange={setTo}
        />
        <Button onClick={() => setAdding((v) => !v)}>
          {adding ? "Fermer la saisie" : "Saisir du temps"}
        </Button>
      </div>
      {options && (
        <>
          {adding && (
            <EntryForm
              user={user}
              options={options}
              date={date}
              fixedLink={{ id, label }}
              onSaved={() => {
                setAdding(false);
                setEpoch((v) => v + 1);
              }}
            />
          )}
          <Report
            key={epoch}
            user={user}
            options={options}
            from={from}
            to={to}
            recordId={id}
          />
        </>
      )}
      <a href={"#tache?id=" + id + "&section=time"}>
        Lien permanent vers le temps de cette tâche
      </a>
    </section>
  );
}
