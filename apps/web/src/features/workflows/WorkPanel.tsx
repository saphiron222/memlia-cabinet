import { loadWorkflowModels } from "./models";
import { tabKeys } from "./tabs";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button, Checkbox, Loader } from "@memlia/ui";
import {
  WorkStateSchema,
  WorkflowModelSchema,
  SessionSchema,
  type WorkState,
  type WorkCommand,
  type WorkflowModel,
} from "@memlia/contracts";
import { request, useScope, message, RequestError } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
import { useRecordCapabilities } from "../administration/capabilities";
export function WorkPanel({
  targetId,
  enabled = true,
}: {
  targetId: string;
  enabled?: boolean;
}) {
  const signal = useScope(),
    rights = useRecordCapabilities([targetId]);
  const [work, setWork] = useState<WorkState | null>(null),
    [models, setModels] = useState<WorkflowModel[]>([]),
    [modelId, setModelId] = useState(""),
    [tab, setTab] = useState("checklist"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [label, setLabel] = useState(""),
    [text, setText] = useState(""),
    [mentions, setMentions] = useState<string[]>([]),
    [userId, setUserId] = useState(""),
    [people, setPeople] = useState<{ id: string; name: string }[]>([]),
    [q, setQ] = useState("");
  const editable =
    enabled && rights.grants[targetId]?.includes("update") && !busy;
  const checklistEditable =
    editable &&
    !(work?.target.kind === "tache" && work.target.data.state === "terminee");
  async function load() {
    setError("");
    try {
      const [w, m, s] = await Promise.all([
        request(`/workflows/targets/${targetId}`, WorkStateSchema, signal),
        loadWorkflowModels(signal),
        request("/session", SessionSchema, signal),
      ]);
      setWork(w);
      setModels(m.items);
      setUserId(s.user?.id ?? "");
    } catch (e) {
      if (!signal.aborted) {
        setError(message(e));
        setWork(null);
      }
    }
  }
  useEffect(() => {
    setWork(null);
    void load();
  }, [targetId]);
  useEffect(() => {
    const c = new AbortController();
    void request(
      `/workflows/targets/${targetId}/people?q=${encodeURIComponent(q)}`,
      z.object({
        items: z.array(z.object({ id: z.uuid(), name: z.string() })),
        hasMore: z.boolean(),
      }),
      c.signal,
    )
      .then((r) => setPeople(r.items))
      .catch(() => setPeople([]));
    return () => c.abort();
  }, [targetId, q]);
  async function command(command: WorkCommand["command"]) {
    if (!work) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setWork(
        await request(
          `/workflows/targets/${targetId}/commands`,
          WorkStateSchema,
          signal,
          {
            method: "POST",
            body: JSON.stringify({
              operationId: crypto.randomUUID(),
              expectedVersion: work.version,
              command,
            }),
          },
        ),
      );
      setNotice("Modification enregistrée.");
      return true;
    } catch (e) {
      if (!signal.aborted) {
        setError(message(e));
        if (e instanceof RequestError && [403, 404].includes(e.status))
          setWork(null);
      }
      return false;
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  const items = work?.checklist?.items ?? [];
  const update = (next: typeof items) =>
    void command({ kind: "checklist", items: next });
  const kind =
    work?.target.kind === "tache"
      ? "tache"
      : work?.target.kind === "obligation"
        ? work.target.data.nature
        : "";
  return (
    <section className="work-panel" aria-label="Travail partagé">
      <div className="work-panel-heading">
        <h3>Suivi du travail</h3>
        <div className="actions">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void load()}
          >
            Actualiser le travail
          </Button>
          {work && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void command({
                  kind: "subscribe",
                  enabled: !work.subscriberIds.includes(userId),
                })
              }
            >
              {work.subscriberIds.includes(userId)
                ? "Ne plus suivre"
                : "Suivre"}
            </Button>
          )}
        </div>
      </div>
      <ErrorSummary message={error || undefined} />
      {error && (
        <Button onClick={() => void load()}>Recharger le travail</Button>
      )}
      {notice && (
        <span role="status" className="muted">
          {notice}
        </span>
      )}
      {!work && !error ? (
        <div role="status">
          <Loader /> Chargement du travail…
        </div>
      ) : (
        work && (
          <>
            <div
              onKeyDown={tabKeys}
              role="tablist"
              aria-label="Contenu du travail"
              className="work-tabs"
            >
              {[
                ["checklist", "Checklist"],
                ["comments", "Commentaires"],
              ].map(([key, name]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key!)}
                >
                  {name}
                  {key === "checklist" && items.length
                    ? ` ${items.filter((i) => i.done).length}/${items.length}`
                    : ""}
                </button>
              ))}
            </div>
            {tab === "checklist" ? (
              <div role="tabpanel" aria-label="Checklist">
                {work.checklist ? (
                  <>
                    <div className="work-checklist-meta">
                      <span>
                        {models.find((m) => m.id === work.checklist?.modelId)
                          ?.model.name ?? "Checklist propre à cette fiche"}
                      </span>
                      {work.checklist.modelVersion && (
                        <span className="badge">
                          Modèle v{work.checklist.modelVersion}
                        </span>
                      )}
                      {work.checklist.modelId && (
                        <Button
                          size="sm"
                          disabled={!checklistEditable}
                          onClick={() =>
                            void command({
                              kind: "merge",
                              modelId: work.checklist!.modelId!,
                            })
                          }
                        >
                          Fusionner la nouvelle version
                        </Button>
                      )}
                    </div>
                    <ul className="work-checklist">
                      {items.map((item, index) => (
                        <li key={item.id}>
                          <label>
                            <Checkbox
                              checked={item.done}
                              disabled={!checklistEditable}
                              onCheckedChange={(done) =>
                                update(
                                  items.map((i) =>
                                    i.id === item.id
                                      ? { ...i, done: !!done }
                                      : i,
                                  ),
                                )
                              }
                            />
                            <span className={item.done ? "work-done" : ""}>
                              {item.label}
                            </span>
                          </label>
                          <div className="actions">
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={"Monter " + item.label}
                              disabled={!checklistEditable || index === 0}
                              onClick={() => {
                                const next = [...items];
                                [next[index - 1], next[index]] = [
                                  next[index]!,
                                  next[index - 1]!,
                                ];
                                update(next);
                              }}
                            >
                              ↑
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={"Descendre " + item.label}
                              disabled={
                                !checklistEditable || index === items.length - 1
                              }
                              onClick={() => {
                                const next = [...items];
                                [next[index + 1], next[index]] = [
                                  next[index]!,
                                  next[index + 1]!,
                                ];
                                update(next);
                              }}
                            >
                              ↓
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={"Supprimer " + item.label}
                              disabled={!checklistEditable}
                              onClick={() =>
                                update(items.filter((i) => i.id !== item.id))
                              }
                            >
                              ×
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <div className="work-empty">
                    <h4>Préparer les étapes du travail</h4>
                    <p>
                      Appliquez un modèle ou ajoutez votre première
                      vérification.
                    </p>
                    <div className="work-inline">
                      <Select
                        name={"checklist-model-" + targetId}
                        label="Modèle de checklist"
                        value={modelId}
                        onChange={setModelId}
                      >
                        <option value="">Choisir un modèle</option>
                        {models
                          .filter(
                            (m) =>
                              m.model.kind === "checklist" &&
                              m.model.targetKinds.includes(kind),
                          )
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.model.name} · v{m.version}
                            </option>
                          ))}
                      </Select>
                      <Button
                        disabled={!checklistEditable || !modelId}
                        onClick={() =>
                          void command({ kind: "instantiate", modelId })
                        }
                      >
                        Appliquer le modèle
                      </Button>
                    </div>
                  </div>
                )}
                <form
                  className="work-inline"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (label.trim())
                      void command({
                        kind: "checklist",
                        items: [
                          ...items,
                          { id: crypto.randomUUID(), label, done: false },
                        ],
                      }).then((ok) => {
                        if (ok) setLabel("");
                      });
                  }}
                >
                  <Field
                    name={"check-item-" + targetId}
                    label="Nouvel élément de checklist"
                    value={label}
                    onChange={setLabel}
                    disabled={!checklistEditable}
                  />
                  <Button
                    type="submit"
                    disabled={!checklistEditable || !label.trim()}
                  >
                    Ajouter l’élément
                  </Button>
                </form>
              </div>
            ) : (
              <div role="tabpanel" aria-label="Commentaires">
                <p className="muted">Échanges internes au cabinet.</p>
                {!work.comments.length ? (
                  <p className="work-empty">
                    Aucun commentaire pour le moment.
                  </p>
                ) : (
                  <ol className="work-comments">
                    {work.comments.map((c) => (
                      <li key={c.id}>
                        <div className="work-comment-byline">
                          <strong>
                            {people.find((p) => p.id === c.authorId)?.name ??
                              "Membre du cabinet"}
                          </strong>
                          <time>{new Date(c.at).toLocaleString("fr-FR")}</time>
                        </div>
                        <p>{c.text}</p>
                      </li>
                    ))}
                  </ol>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void command({
                      kind: "comment",
                      text,
                      mentions,
                      audience: "internal",
                    }).then((ok) => {
                      if (ok) {
                        setText("");
                        setMentions([]);
                      }
                    });
                  }}
                >
                  <label className="field">
                    Nouveau commentaire
                    <textarea
                      value={text}
                      maxLength={5000}
                      rows={3}
                      disabled={!editable}
                      onChange={(e) => setText(e.target.value)}
                    />
                  </label>
                  <details>
                    <summary>Mentionner des collègues</summary>
                    <Field
                      name="mention-search"
                      label="Rechercher un collègue"
                      value={q}
                      onChange={setQ}
                    />
                    {people.map((p) => (
                      <label className="check" key={p.id}>
                        <Checkbox
                          checked={mentions.includes(p.id)}
                          onCheckedChange={(v) =>
                            setMentions(
                              v
                                ? [...mentions, p.id]
                                : mentions.filter((id) => id !== p.id),
                            )
                          }
                        />
                        {p.name}
                      </label>
                    ))}
                  </details>
                  <Button
                    variant="solid"
                    type="submit"
                    disabled={!editable || !text.trim()}
                  >
                    Publier le commentaire
                  </Button>
                </form>
              </div>
            )}
          </>
        )
      )}
    </section>
  );
}
