import { CatalogSelect } from "./Catalog";
import { useEffect, useState } from "react";
import {
  TimeListSchema,
  TimeEntitySchema,
  type SessionUser,
  type TimeEntity,
} from "@memlia/contracts";
import { Button } from "@memlia/ui";
import { TabButton } from "../../upstream/plane/controls";
import { Calendar } from "../../upstream/cal/Calendar";
import { PanelCard } from "../../upstream/cal/PanelCard";
import { Peek } from "../../interface/Peek";
import { Field, Select, ErrorSummary } from "../../forms";
import { request, useScope, message } from "../../api";
import { useInstallation } from "../administration/preferences";
import { tabKeys } from "../workflows/tabs";
import { Configuration } from "./Configuration";
import { WorkloadGrid } from "./Workload";
import { Report } from "./TimeReport";
import {
  useTimeOptions,
  EntryForm,
  LinkPicker,
  type Link,
  shift,
} from "./shared";
import "./time.css";
export function Time({
  user,
  mode,
}: {
  user: SessionUser;
  mode: "temps" | "temps-cabinet" | "charge";
}) {
  const signal = useScope(),
    { options, error: optionsError } = useTimeOptions(),
    { info } = useInstallation();
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: info?.cabinetTimeZone ?? "Europe/Paris",
  }).format(new Date());
  const monday = shift(
    today,
    -((new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7),
  );
  const [from, setFrom] = useState(monday),
    [to, setTo] = useState(shift(monday, 6)),
    [tab, setTab] = useState<"report" | "workload" | "settings">(
      mode === "charge" ? "workload" : "report",
    ),
    [entry, setEntry] = useState(false),
    [calendar, setCalendar] = useState(false),
    [dossier, setDossier] = useState<Link>({ kind: "free", label: "" }),
    [filterDossier, setFilterDossier] = useState(false),
    [userId, setUserId] = useState(mode === "temps" ? user.id : ""),
    [timers, setTimers] = useState<TimeEntity[]>([]),
    [epoch, setEpoch] = useState(0),
    [error, setError] = useState(""),
    [stopping, setStopping] = useState(false),
    [abandonId, setAbandonId] = useState<string | null>(null),
    [abandonReason, setAbandonReason] = useState("");
  useEffect(() => {
    void request(
      "/time/entities?kind=timer&active=true&userId=" + user.id,
      TimeListSchema,
      signal,
    )
      .then((r) =>
        setTimers(
          r.items.filter(
            (e) =>
              e.data.kind === "timer" &&
              e.data.userId === user.id &&
              !e.data.stoppedAt,
          ),
        ),
      )
      .catch((e) => {
        if (!signal.aborted) setError(message(e));
      });
  }, [epoch]);
  const changed = () => setEpoch((v) => v + 1);
  async function stop(t: TimeEntity, abandon = false) {
    setStopping(true);
    try {
      await request(
        "/time/timers/" + t.id + (abandon ? "/abandon" : "/stop"),
        TimeEntitySchema,
        signal,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            expectedVersion: t.version,
            ...(abandon ? { reason: abandonReason } : {}),
          }),
        },
      );
      changed();
      setAbandonId(null);
      setAbandonReason("");
      setError("");
    } catch (e) {
      setError(message(e));
    } finally {
      setStopping(false);
    }
  }
  const tabs = [
    ["report", "Temps saisis"],
    ["workload", "Plan de charge"],
    ...(options?.canManage || options?.canLock
      ? [["settings", "Configuration"]]
      : []),
  ] as const;
  return (
    <div className="time-workspace">
      <ErrorSummary message={error || optionsError} />
      <div
        className="work-tabs"
        role="tablist"
        aria-label="Gestion des temps"
        onKeyDown={tabKeys}
      >
        {tabs.map(([id, label]) => (
          <TabButton
            key={id}
            role="tab"
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id as typeof tab)}
          >
            {label}
          </TabButton>
        ))}
      </div>
      <div className="time-toolbar">
        <Button
          size="sm"
          disabled={!from || !to}
          onClick={() => {
            setFrom(shift(from, -7));
            setTo(shift(to, -7));
          }}
        >
          Semaine précédente
        </Button>
        <Button
          size="sm"
          disabled={!from || !to}
          onClick={() => {
            setFrom(shift(from, 7));
            setTo(shift(to, 7));
          }}
        >
          Semaine suivante
        </Button>
        <Button onClick={() => setCalendar(true)}>Choisir une semaine</Button>
        <Field
          name="time-from"
          label="Du"
          type="date"
          value={from}
          onChange={setFrom}
        />
        <Field
          name="time-to"
          label="Au"
          type="date"
          value={to}
          onChange={setTo}
        />
        {tab === "report" && (
          <Button variant="solid" onClick={() => setEntry(true)}>
            Saisir du temps
          </Button>
        )}
      </div>
      {timers.map((t) => (
        <div key={t.id} className="time-running" role="status">
          <span>
            Chronomètre actif depuis{" "}
            {t.data.kind === "timer"
              ? new Date(t.data.startedAt).toLocaleTimeString("fr-FR")
              : ""}
          </span>
          <Button disabled={stopping} onClick={() => void stop(t)}>
            Arrêter et enregistrer
          </Button>
          <Button disabled={stopping} onClick={() => setAbandonId(t.id)}>
            Abandonner sans temps
          </Button>
          {abandonId === t.id && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void stop(t, true);
              }}
            >
              <Field
                name="time-abandon-reason"
                label="Motif de l’abandon"
                value={abandonReason}
                onChange={(value) => setAbandonReason(value.slice(0, 300))}
                required
                hint="Aucune durée ne sera imputée."
              />
              <Button
                type="submit"
                disabled={stopping || !abandonReason.trim()}
              >
                Confirmer l’abandon
              </Button>
              <Button type="button" onClick={() => setAbandonId(null)}>
                Annuler
              </Button>
            </form>
          )}
        </div>
      ))}
      {options ? (
        <>
          {tab === "report" && (
            <>
              {options.canReadOthers && (
                <div className="time-toolbar">
                  <CatalogSelect
                    kind="users"
                    name="time-report-user"
                    label="Collaborateur du rapport"
                    value={userId}
                    onChange={setUserId}
                    empty="Tous les collaborateurs autorisés"
                  />
                </div>
              )}
              <div className="time-dossier-filter">
                <Button
                  size="sm"
                  onClick={() => {
                    setFilterDossier((v) => !v);
                    setDossier({ kind: "free", label: "" });
                  }}
                >
                  {filterDossier ? "Tous les dossiers" : "Filtrer par dossier"}
                </Button>
                {filterDossier && (
                  <LinkPicker
                    onlyDossier
                    value={dossier}
                    onChange={setDossier}
                  />
                )}
              </div>
              <Report
                key={epoch}
                user={user}
                options={options}
                from={from}
                to={to}
                userId={userId || undefined}
                dossierId={dossier.kind === "record" ? dossier.id : undefined}
              />
            </>
          )}
          {tab === "workload" && (
            <WorkloadGrid key={epoch} options={options} from={from} to={to} />
          )}{" "}
          {tab === "settings" && (
            <Configuration options={options} from={from} onChanged={changed} />
          )}
        </>
      ) : (
        !optionsError && <p role="status">Chargement des capacités…</p>
      )}
      {entry && options && (
        <Peek label="Saisir du temps" onClose={() => setEntry(false)}>
          <h2>Nouvelle saisie</h2>
          <p className="muted">
            Liez un objet ou conservez un libellé libre. Seule une relation
            explicite alimente son réalisé.
          </p>
          <EntryForm
            user={user}
            options={options}
            date={today}
            onSaved={() => {
              setEntry(false);
              changed();
            }}
          />
        </Peek>
      )}
      {calendar && (
        <Peek label="Choisir une semaine" onClose={() => setCalendar(false)}>
          <PanelCard title="Semaine de travail">
            <Calendar
              mode="single"
              timeZone="UTC"
              weekStartsOn={1}
              selected={new Date((from || monday) + "T00:00:00Z")}
              onSelect={(date) => {
                if (!date) return;
                const value = date.toISOString().slice(0, 10),
                  start = shift(value, -((date.getUTCDay() + 6) % 7));
                setFrom(start);
                setTo(shift(start, 6));
                setCalendar(false);
              }}
            />
          </PanelCard>
        </Peek>
      )}
    </div>
  );
}
