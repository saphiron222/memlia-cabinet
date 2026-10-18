import { CatalogSelect } from "./Catalog";
import { useEffect, useState, useRef, type ReactNode } from "react";
import { z } from "zod";
import {
  TimeOptionsSchema,
  TimeTargetsSchema,
  TimeLinkSchema,
  TimeEntitySchema,
  type TimeEntity,
  type SessionUser,
} from "@memlia/contracts";
import { request, useScope, message } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
import { Button } from "@memlia/ui";
export type Options = z.infer<typeof TimeOptionsSchema>;
export type Link = z.infer<typeof TimeLinkSchema>;
export function useTimeOptions() {
  const signal = useScope(),
    [options, setOptions] = useState<Options | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const reload = () => {
      void request("/time/options", TimeOptionsSchema, signal)
        .then(setOptions)
        .catch((e) => {
          if (!signal.aborted) setError(message(e));
        });
    };
    reload();
    window.addEventListener("memlia-time-settings", reload);
    return () => window.removeEventListener("memlia-time-settings", reload);
  }, []);
  return { options, error };
}
export const duration = (seconds: number) =>
  `${Math.floor(seconds / 3600)} h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}${seconds % 60 ? " min " + (seconds % 60) + " s" : ""}`;
export const shift = (d: string, n: number) =>
  new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
export function LinkPicker({
  value,
  onChange,
  onlyDossier = false,
}: {
  value: Link;
  onChange: (v: Link) => void;
  onlyDossier?: boolean;
}) {
  const [kind, setKind] = useState(
      onlyDossier
        ? "dossier"
        : value.kind === "free"
          ? "free"
          : value.kind === "production"
            ? "production"
            : "tache",
    ),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [items, setItems] = useState<z.infer<typeof TimeTargetsSchema> | null>(
      null,
    ),
    [error, setError] = useState("");
  useEffect(() => {
    if (kind === "free") return;
    const c = new AbortController();
    setItems(null);
    void request(
      "/time/targets?" +
        new URLSearchParams({ kind, q: query, offset: String(offset) }),
      TimeTargetsSchema,
      c.signal,
    )
      .then(setItems)
      .catch((e) => {
        if (!c.signal.aborted) setError(message(e));
      });
    return () => c.abort();
  }, [kind, query, offset]);
  return (
    <div className="time-link-picker">
      <ErrorSummary message={error} />
      {!onlyDossier && (
        <Select
          name="time-link-kind"
          label="Objet ou temps libre"
          value={kind}
          onChange={(v) => {
            setKind(v);
            setOffset(0);
            onChange({ kind: "free", label: "" });
          }}
        >
          <option value="free">Travail interne / libellé libre</option>
          <option value="dossier">Dossier</option>
          <option value="tache">Tâche</option>
          <option value="obligation">Obligation</option>
          <option value="production">Ligne de production</option>
        </Select>
      )}
      {kind === "free" ? (
        <Field
          name="time-free-label"
          label="Libellé libre"
          value={value.kind === "free" ? value.label : ""}
          onChange={(label) => onChange({ kind: "free", label })}
        />
      ) : (
        <>
          <Field
            name="time-object-search"
            label="Rechercher l’objet"
            value={query}
            onChange={(v) => {
              setQuery(v);
              setOffset(0);
            }}
          />
          <Select
            name="time-object"
            label={onlyDossier ? "Dossier" : "Objet lié"}
            value={value.kind === "free" ? "" : value.id}
            onChange={(id) =>
              onChange({
                kind: kind === "production" ? "production" : "record",
                id,
              })
            }
          >
            <option value="">
              {items ? "Choisir un objet…" : "Chargement…"}
            </option>
            {value.kind !== "free" &&
              !items?.items.some((i) => i.id === value.id) && (
                <option value={value.id}>
                  Objet sélectionné · {value.id.slice(0, 8)}
                </option>
              )}
            {items?.items.map((i) => (
              <option value={i.id} key={i.id}>
                {i.label}
              </option>
            ))}
          </Select>
          {(offset > 0 || items?.hasMore) && (
            <div className="actions">
              <Button
                disabled={!offset}
                onClick={() => setOffset((v) => Math.max(0, v - 100))}
              >
                Précédents
              </Button>
              <Button
                disabled={!items?.hasMore}
                onClick={() => setOffset((v) => v + 100)}
              >
                Suivants
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
export function EntryForm({
  user,
  options,
  date,
  fixedLink,
  onSaved,
  entry,
}: {
  user: SessionUser;
  options: Options;
  date: string;
  fixedLink?: { id: string; label: string };
  onSaved: () => void;
  entry?: TimeEntity;
}) {
  const signal = useScope(),
    old = entry?.data.kind === "entry" ? entry.data : null;
  const [day, setDay] = useState(old?.date ?? date),
    [nature, setNature] = useState(old?.natureId ?? ""),
    [userId, setUserId] = useState(old?.userId ?? user.id),
    [link, setLink] = useState<Link>(
      old?.link ??
        (fixedLink
          ? { kind: "record", id: fixedLink.id }
          : { kind: "free", label: "" }),
    ),
    [minutes, setMinutes] = useState(old ? String(old.seconds / 60) : ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(timer = false) {
    if (busy) return;
    setError("");
    const seconds = Math.round(Number(minutes) * 60);
    if (!nature || (!timer && (!Number.isFinite(seconds) || seconds < 1))) {
      setError("Choisissez une nature active et une durée positive (minutes).");
      return;
    }
    if (link.kind === "free" && !link.label.trim()) {
      setError("Renseignez un libellé ou liez un objet.");
      return;
    }
    setBusy(true);
    try {
      await request(
        timer ? "/time/timers/start" : "/time/entities",
        TimeEntitySchema,
        signal,
        {
          method: "POST",
          body: JSON.stringify(
            timer
              ? {
                  operationId: crypto.randomUUID(),
                  date: day,
                  natureId: nature,
                  link,
                }
              : {
                  id: entry?.id ?? crypto.randomUUID(),
                  operationId: crypto.randomUUID(),
                  expectedVersion: entry?.version ?? 0,
                  data: {
                    kind: "entry",
                    userId,
                    date: day,
                    natureId: nature,
                    link,
                    seconds,
                    source: "manual",
                    timerId: null,
                    rate: null,
                  },
                },
          ),
        },
      );
      onSaved();
      setMinutes("");
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <form
      className="time-entry-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <ErrorSummary message={error} />
      <div className="time-form-grid">
        <Field
          name="time-date"
          label="Date du temps"
          type="date"
          value={day}
          onChange={setDay}
        />
        <CatalogSelect
          kind="natures"
          name="time-nature"
          label="Nature du temps"
          value={nature}
          onChange={setNature}
          active
        />
        {options.canManage && (
          <CatalogSelect
            kind="users"
            name="time-author"
            label="Auteur du temps"
            value={userId}
            onChange={setUserId}
            active
          />
        )}
      </div>
      {fixedLink ? (
        <dl className="time-properties">
          <dt>Objet lié</dt>
          <dd>{fixedLink.label}</dd>
        </dl>
      ) : (
        <LinkPicker value={link} onChange={setLink} />
      )}
      <Field
        name="time-duration"
        label="Durée en minutes"
        type="number"
        value={minutes}
        onChange={setMinutes}
        hint="Ex. 90 pour 1 h 30. Tab puis Entrée pour enregistrer."
      />
      <div className="actions">
        <Button
          type="submit"
          variant="solid"
          disabled={busy || old?.source === "timer"}
        >
          {entry ? "Enregistrer la correction" : "Enregistrer le temps"}
        </Button>
        {!entry && userId === user.id && (
          <Button disabled={busy} onClick={() => void submit(true)}>
            Démarrer le chronomètre
          </Button>
        )}
      </div>
    </form>
  );
}

export function ScrollableTable({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null),
    [scroll, setScroll] = useState({ left: 0, max: 0 });
  const measure = () => {
    const el = ref.current;
    if (el)
      setScroll({ left: el.scrollLeft, max: el.scrollWidth - el.clientWidth });
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    measure();
    return () => observer.disconnect();
  }, []);
  return (
    <div className="time-table-frame">
      {scroll.max > 0 && (
        <div className="time-scroll-controls">
          <span className="muted">Tableau défilant</span>
          <Button
            size="sm"
            disabled={scroll.left <= 0}
            onClick={() => ref.current?.scrollBy({ left: -360 })}
          >
            Colonnes précédentes
          </Button>
          <Button
            size="sm"
            disabled={scroll.left >= scroll.max - 1}
            onClick={() => ref.current?.scrollBy({ left: 360 })}
          >
            Colonnes suivantes
          </Button>
        </div>
      )}
      <div
        ref={ref}
        className="time-table-scroll"
        role="region"
        aria-label={label}
        tabIndex={0}
        onScroll={measure}
      >
        {children}
      </div>
    </div>
  );
}
