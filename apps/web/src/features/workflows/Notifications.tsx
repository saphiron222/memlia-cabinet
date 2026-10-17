import { useEffect, useState } from "react";
import { z } from "zod";
import { Button, Checkbox } from "@memlia/ui";
import {
  NotificationListSchema,
  NotificationSchema,
  NotificationPreferencesSchema,
  type Notification,
} from "@memlia/contracts";
import { request, useScope, message } from "../../api";
import { ErrorSummary } from "../../forms";
export function Notifications() {
  const signal = useScope();
  const [list, setList] = useState<z.infer<
      typeof NotificationListSchema
    > | null>(null),
    [preferences, setPreferences] = useState<z.infer<
      typeof NotificationPreferencesSchema
    > | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [offset, setOffset] = useState(0);
  async function load() {
    setError("");
    try {
      const [l, p] = await Promise.all([
        request(
          "/notifications?offset=" + offset,
          NotificationListSchema,
          signal,
        ),
        request(
          "/notifications/preferences",
          NotificationPreferencesSchema,
          signal,
        ),
      ]);
      setList(l);
      setPreferences(p);
    } catch (e) {
      if (!signal.aborted) {
        setList(null);
        setError(message(e));
      }
    }
  }
  useEffect(() => {
    void load();
  }, [offset]);
  async function update(n: Notification, state: "read" | "dismissed") {
    setBusy(true);
    try {
      await request("/notifications/" + n.id, NotificationSchema, signal, {
        method: "POST",
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          expectedVersion: n.version,
          state,
        }),
      });
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!preferences) return;
    setBusy(true);
    try {
      setPreferences(
        await request(
          "/notifications/preferences",
          NotificationPreferencesSchema,
          signal,
          {
            method: "POST",
            body: JSON.stringify({
              ...preferences,
              operationId: crypto.randomUUID(),
            }),
          },
        ),
      );
      setNotice("Préférences enregistrées.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workflow-workspace">
      <header className="work-panel-heading">
        <h2>
          Boîte de réception{" "}
          {list && (
            <span className="semantic-status">
              {list.unread} {list.unread === 1 ? "non lue" : "non lues"}
            </span>
          )}
        </h2>
        <Button onClick={() => void load()}>Actualiser</Button>
      </header>
      <ErrorSummary message={error || undefined} />
      {!list && !error ? (
        <p role="status">Chargement des notifications…</p>
      ) : list && !list.items.length ? (
        <div className="work-empty">Aucune notification accessible.</div>
      ) : (
        <ul className="work-notifications">
          {list?.items.map((n) => (
            <li key={n.id} className={n.state === "unread" ? "unread" : ""}>
              <div>
                <strong>{n.title}</strong>
                <p>{n.text}</p>
                <small>{new Date(n.at).toLocaleString("fr-FR")}</small>
              </div>
              <div className="actions">
                <a
                  href={
                    (n.targetKind === "obligation"
                      ? "#fiscal?id="
                      : "#tache?id=") + n.targetId
                  }
                >
                  Ouvrir le travail
                </a>
                {n.state === "unread" && (
                  <Button
                    disabled={busy}
                    size="sm"
                    onClick={() => void update(n, "read")}
                  >
                    Marquer lue
                  </Button>
                )}
                <Button
                  disabled={busy}
                  size="sm"
                  onClick={() => void update(n, "dismissed")}
                >
                  Masquer
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {list && (
        <div className="pagination">
          <Button
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 100))}
          >
            Précédent
          </Button>
          <Button
            disabled={list.nextOffset === null}
            onClick={() => setOffset(list.nextOffset!)}
          >
            Suivant
          </Button>
        </div>
      )}
      <details className="work-notification-settings">
        <summary>Préférences de notifications</summary>
        {preferences && (
          <>
            <p>Canal : dans l’application du cabinet.</p>
            {(
              [
                ["inApp", "Recevoir des notifications"],
                ["mentions", "Mentions"],
                ["subscriptions", "Travaux suivis"],
                ["reminders", "Rappels programmés"],
              ] as const
            ).map(([key, label]) => (
              <label className="check" key={key}>
                <Checkbox
                  checked={preferences[key]}
                  onCheckedChange={(v) =>
                    setPreferences({ ...preferences, [key]: !!v })
                  }
                />
                {label}
              </label>
            ))}
            <Button variant="solid" disabled={busy} onClick={() => void save()}>
              Enregistrer les préférences
            </Button>
            {notice && <p role="status">{notice}</p>}
          </>
        )}
      </details>
    </div>
  );
}
