import { useState, useRef, useEffect } from "react";
import { z } from "zod";
import { Button, Checkbox } from "@memlia/ui";
import {
  CabinetRecordSchema,
  RecordContentSchema,
  CreateRecordInputSchema,
  UpdateRecordInputSchema,
  TaskTransitionInputSchema,
  TaskDataSchema,
  RecordListSchema,
  HistorySchema,
  UserListSchema,
  type CabinetRecord,
  type RecordKind,
  type SessionUser,
  type TaskTransitionInput,
} from "@memlia/contracts";
import { request, useScope, queryString, message, RequestError } from "./api";
import {
  Field,
  TagsField,
  Select,
  ErrorSummary,
  validationErrors,
  type Errors,
} from "./forms";
export const labels = {
  dossier: "Dossiers",
  contact: "Contacts",
  tache: "Tâches",
  obligation: "Obligations",
};
const singularLabels = {
  dossier: "Dossier",
  contact: "Contact",
  tache: "Tâche",
  obligation: "Obligation",
};
export const stateLabels = {
  a_faire: "À faire",
  en_cours: "En cours",
  terminee: "Terminée",
};
type Content = z.infer<typeof RecordContentSchema>;
function content(record: CabinetRecord): Content {
  const { id, version, createdAt, updatedAt, ...data } = record;
  return data;
}
export function RecordEditor({
  kind,
  id,
  user,
  onClose,
  onSaved,
}: {
  kind: RecordKind;
  id: string | null;
  user: SessionUser;
  onClose: () => void;
  onSaved: () => void;
}) {
  const signal = useScope(),
    dialog = useRef<HTMLDialogElement>(null);
  const [saved, setSaved] = useState<CabinetRecord | null>(null),
    [draft, setDraft] = useState<Content>(() => ({
      ...RecordContentSchema.parse({
        kind,
        title: "Nouvelle fiche",
        data:
          kind === "obligation"
            ? { nature: "À préciser", period: "À préciser" }
            : {},
      }),
      title: "",
    }));
  const [loading, setLoading] = useState(!!id),
    [busy, setBusy] = useState(false),
    [fault, setFault] = useState(""),
    [errors, setErrors] = useState<Errors>({}),
    [notice, setNotice] = useState(""),
    [conflict, setConflict] = useState(false),
    [latest, setLatest] = useState<CabinetRecord | null>(null),
    [dossiers, setDossiers] = useState<CabinetRecord[]>([]),
    [users, setUsers] = useState<z.infer<typeof UserListSchema>["items"]>([
      user,
    ]),
    [history, setHistory] = useState<z.infer<typeof HistorySchema> | null>(
      null,
    ),
    [checkLabel, setCheckLabel] = useState(""),
    [lookupError, setLookupError] = useState("");
  const operation = useRef<{ signature: string; id: string } | null>(null);
  const can = (action: SessionUser["permissions"][number]["action"]) =>
    user.permissions.some(
      (p) =>
        p.action === action &&
        (p.kind === "*" || p.kind === kind) &&
        (p.dossierId === null ||
          p.dossierId === (kind === "dossier" ? saved?.id : draft.dossierId)),
    );
  const editable = saved
    ? can("update")
    : user.permissions.some(
        (p) => p.action === "create" && (p.kind === "*" || p.kind === kind),
      );
  useEffect(() => {
    const opener = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      opener?.focus();
    };
  }, []);
  useEffect(() => {
    if (id)
      request("/records/" + id, CabinetRecordSchema, signal)
        .then((record) => {
          setSaved(record);
          setDraft(content(record));
          setLoading(false);
        })
        .catch((e) => {
          if (!signal.aborted) {
            setFault(message(e));
            setLoading(false);
          }
        });
    if (kind !== "dossier") {
      const load = async () => {
        let offset = 0,
          all: CabinetRecord[] = [];
        do {
          const result = await request(
            "/records?" + queryString({ kind: "dossier", offset, limit: 200 }),
            RecordListSchema,
            signal,
          );
          all.push(...result.items);
          offset += result.items.length;
          if (offset >= result.total || !result.items.length) break;
        } while (true);
        setDossiers(all);
      };
      load().catch((e) => {
        if (!signal.aborted) setLookupError(message(e));
      });
    }
    if (
      kind === "tache" &&
      user.permissions.some(
        (p) =>
          p.action === "manage_users" && p.kind === "*" && p.dossierId === null,
      )
    )
      request("/users", UserListSchema, signal)
        .then((result) => setUsers(result.items))
        .catch((e) => {
          if (!signal.aborted) setLookupError(message(e));
        });
  }, [id, kind, signal, user]);
  const data = (key: string, value: unknown) =>
    setDraft(
      (prev) => ({ ...prev, data: { ...prev.data, [key]: value } }) as Content,
    );
  async function runSave() {
    setErrors({});
    setFault("");
    setNotice("");
    const result = RecordContentSchema.safeParse(draft);
    if (!result.success) {
      setErrors(validationErrors(result.error));
      return;
    }
    setBusy(true);
    const signature = JSON.stringify({
      record: result.data,
      version: saved?.version,
    });
    if (operation.current?.signature !== signature)
      operation.current = { signature, id: crypto.randomUUID() };
    try {
      const body = saved
        ? UpdateRecordInputSchema.parse({
            operationId: operation.current.id,
            expectedVersion: saved.version,
            record: result.data,
          })
        : CreateRecordInputSchema.parse({
            operationId: operation.current.id,
            record: result.data,
          });
      const record = await request(
        saved ? "/records/" + saved.id : "/records",
        CabinetRecordSchema,
        signal,
        { method: saved ? "PUT" : "POST", body: JSON.stringify(body) },
      );
      setSaved(record);
      setDraft(content(record));
      setHistory(null);
      setConflict(false);
      setLatest(null);
      setNotice("Modifications enregistrées.");
      operation.current = null;
      onSaved();
    } catch (e) {
      if (!signal.aborted) {
        setFault(message(e));
        if (
          e instanceof RequestError &&
          ["DOSSIER_REQUIRED", "INVALID_RELATION"].includes(e.code)
        )
          setErrors({ dossierId: e.message });
        setConflict(e instanceof RequestError && e.code === "VERSION_CONFLICT");
      }
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  async function transition(state: TaskTransitionInput["state"]) {
    if (!saved) return;
    setBusy(true);
    setFault("");
    setNotice("");
    try {
      const signature = JSON.stringify({
        id: saved.id,
        version: saved.version,
        state,
      });
      if (operation.current?.signature !== signature)
        operation.current = { signature, id: crypto.randomUUID() };
      const body = TaskTransitionInputSchema.parse({
        operationId: operation.current.id,
        expectedVersion: saved.version,
        state,
      });
      const record = await request(
        "/records/" + saved.id + "/transition",
        CabinetRecordSchema,
        signal,
        { method: "POST", body: JSON.stringify(body) },
      );
      setSaved(record);
      setDraft(content(record));
      setHistory(null);
      setNotice("Étape enregistrée.");
      operation.current = null;
      onSaved();
    } catch (e) {
      if (!signal.aborted) {
        setFault(message(e));
        if (
          e instanceof RequestError &&
          ["DOSSIER_REQUIRED", "INVALID_RELATION"].includes(e.code)
        )
          setErrors({ dossierId: e.message });
        setConflict(e instanceof RequestError && e.code === "VERSION_CONFLICT");
      }
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  const dirty =
    saved && JSON.stringify(content(saved)) !== JSON.stringify(draft);
  return (
    <dialog
      ref={dialog}
      className="record-panel"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="record-heading"
    >
      <header>
        <h2 id="record-heading">
          {saved
            ? "Fiche · " + singularLabels[kind]
            : "Créer " +
              (kind === "tache" || kind === "obligation" ? "une " : "un ") +
              singularLabels[kind].toLowerCase()}
        </h2>
        <Button size="sm" onClick={onClose} aria-label="Fermer la fiche">
          ×
        </Button>
      </header>
      {loading ? (
        <p role="status">Chargement de la fiche…</p>
      ) : id && !saved ? (
        <ErrorSummary message={fault} />
      ) : (
        <>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void runSave();
            }}
          >
            <ErrorSummary errors={errors} message={fault || undefined} />
            {conflict && (
              <section className="conflict">
                <p>
                  Votre saisie est conservée. Consultez la version enregistrée
                  avant de choisir les valeurs à garder.
                </p>
                <Button
                  onClick={async () => {
                    try {
                      const record = await request(
                        "/records/" + saved!.id,
                        CabinetRecordSchema,
                        signal,
                      );
                      setLatest(record);
                    } catch (e) {
                      if (!signal.aborted) setFault(message(e));
                    }
                  }}
                >
                  Consulter la dernière version
                </Button>
                {latest && (
                  <>
                    <h3>Version enregistrée {latest.version}</h3>
                    <RecordComparison
                      latest={latest}
                      draft={draft}
                      dossiers={dossiers}
                      users={users}
                    />
                    <p>
                      Conserver ma saisie remplacera les champs métier par mes
                      valeurs lors du prochain enregistrement.
                    </p>
                    <Button
                      onClick={() => {
                        setSaved(latest);
                        setDraft(content(latest));
                        setConflict(false);
                        setFault("");
                        setLatest(null);
                      }}
                    >
                      Recharger et abandonner ma saisie
                    </Button>
                    <Button
                      onClick={() => {
                        setSaved(latest);
                        if (draft.kind === "tache" && latest.kind === "tache")
                          setDraft({
                            ...draft,
                            data: { ...draft.data, state: latest.data.state },
                          });
                        setConflict(false);
                        setFault("");
                        setLatest(null);
                      }}
                    >
                      Conserver ma saisie
                    </Button>
                  </>
                )}
              </section>
            )}
            <fieldset disabled={!editable || busy || conflict}>
              <Field
                name="title"
                label="Titre"
                value={draft.title}
                onChange={(title) => setDraft({ ...draft, title })}
                required
                errors={errors}
              />
              {kind !== "dossier" && (
                <>
                  <Select
                    name="dossierId"
                    label="Dossier lié"
                    errors={errors}
                    value={draft.dossierId ?? ""}
                    onChange={(dossierId) =>
                      setDraft({ ...draft, dossierId: dossierId || null })
                    }
                  >
                    <option value="">Aucun dossier</option>
                    {draft.dossierId &&
                      !dossiers.some((d) => d.id === draft.dossierId) && (
                        <option value={draft.dossierId}>Dossier actuel</option>
                      )}
                    {dossiers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </Select>
                  {lookupError && (
                    <p role="status">Choix des relations : {lookupError}</p>
                  )}
                </>
              )}
              {draft.kind === "dossier" && (
                <>
                  <Field
                    name="siren"
                    label="SIREN"
                    value={draft.data.siren ?? ""}
                    onChange={(v) => data("siren", v || null)}
                    errors={errors}
                    hint="9 chiffres, zéros initiaux conservés."
                  />
                  <Field
                    name="legalForm"
                    label="Forme juridique"
                    value={draft.data.legalForm}
                    onChange={(v) => data("legalForm", v)}
                    errors={errors}
                  />
                </>
              )}
              {draft.kind === "contact" && (
                <>
                  <Select
                    name="contactType"
                    label="Type de contact"
                    value={draft.data.contactType}
                    onChange={(v) => data("contactType", v)}
                  >
                    <option value="personne">Personne</option>
                    <option value="organisation">Organisation</option>
                  </Select>
                  <Field
                    name="email"
                    label="Adresse email"
                    value={draft.data.email ?? ""}
                    onChange={(v) => data("email", v || null)}
                    errors={errors}
                  />
                  <Field
                    name="phone"
                    label="Téléphone"
                    value={draft.data.phone}
                    onChange={(v) => data("phone", v)}
                    errors={errors}
                  />
                </>
              )}
              {"notes" in draft.data && (
                <div className="field">
                  <label htmlFor="notes">Notes</label>
                  <textarea
                    id="notes"
                    value={draft.data.notes}
                    onChange={(e) => data("notes", e.target.value)}
                    maxLength={10000}
                  />
                </div>
              )}
              {"dueDate" in draft.data && (
                <Field
                  name="dueDate"
                  label="Échéance"
                  type="date"
                  value={draft.data.dueDate ?? ""}
                  onChange={(v) => data("dueDate", v || null)}
                  errors={errors}
                />
              )}
              {draft.kind === "tache" && (
                <>
                  <Select
                    name="priority"
                    label="Priorité"
                    value={draft.data.priority}
                    onChange={(v) => data("priority", v)}
                  >
                    <option value="normale">Normale</option>
                    <option value="haute">Haute</option>
                    <option value="urgente">Urgente</option>
                  </Select>
                  <div className="field">
                    <label htmlFor="description">Description</label>
                    <textarea
                      id="description"
                      maxLength={10000}
                      value={draft.data.description}
                      onChange={(e) => data("description", e.target.value)}
                    />
                  </div>
                  <TagsField
                    tags={draft.data.tags}
                    onChange={(tags) => data("tags", tags)}
                    errors={errors}
                  />
                  <fieldset disabled={!can("assign")}>
                    <legend>Responsables</legend>
                    {users
                      .filter(
                        (u) =>
                          u.active || draft.data.assigneeIds.includes(u.id),
                      )
                      .map((u) => (
                        <label className="check" key={u.id}>
                          <Checkbox
                            checked={draft.data.assigneeIds.includes(u.id)}
                            onCheckedChange={(checked) =>
                              data(
                                "assigneeIds",
                                checked
                                  ? [...draft.data.assigneeIds, u.id]
                                  : draft.data.assigneeIds.filter(
                                      (id) => id !== u.id,
                                    ),
                              )
                            }
                          />
                          {u.name}
                        </label>
                      ))}
                    {draft.data.assigneeIds.filter(
                      (id) => !users.some((u) => u.id === id),
                    ).length > 0 && (
                      <p>Les autres responsables existants sont conservés.</p>
                    )}
                  </fieldset>
                  <h3>Checklist</h3>
                  {draft.data.checklist.map((item) => (
                    <div className="check-row" key={item.id}>
                      <label className="check">
                        <Checkbox
                          checked={item.done}
                          onCheckedChange={(done) =>
                            data(
                              "checklist",
                              draft.data.checklist.map((i) =>
                                i.id === item.id ? { ...i, done } : i,
                              ),
                            )
                          }
                        />
                        {item.label}
                      </label>
                      <Button
                        size="sm"
                        aria-label={"Retirer " + item.label}
                        onClick={() =>
                          data(
                            "checklist",
                            draft.data.checklist.filter(
                              (i) => i.id !== item.id,
                            ),
                          )
                        }
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                  <Field
                    name="checkLabel"
                    label="Nouvel élément de checklist"
                    value={checkLabel}
                    onChange={setCheckLabel}
                    errors={errors}
                  />
                  <Button
                    disabled={!checkLabel.trim()}
                    onClick={() => {
                      const checklist =
                        TaskDataSchema.shape.checklist.safeParse([
                          ...draft.data.checklist,
                          {
                            id: crypto.randomUUID(),
                            label: checkLabel.trim(),
                            done: false,
                          },
                        ]);
                      if (!checklist.success) {
                        setErrors({
                          checkLabel:
                            "Vérifiez le libellé et le nombre d’éléments de la checklist.",
                        });
                        return;
                      }
                      setErrors({});
                      data("checklist", checklist.data);
                      setCheckLabel("");
                    }}
                  >
                    Ajouter à la checklist
                  </Button>
                </>
              )}
              {draft.kind === "obligation" && (
                <>
                  <Field
                    name="nature"
                    label="Nature"
                    value={draft.data.nature}
                    onChange={(v) => data("nature", v)}
                    required
                    errors={errors}
                  />
                  <Field
                    name="period"
                    label="Période"
                    value={draft.data.period}
                    onChange={(v) => data("period", v)}
                    required
                    errors={errors}
                  />
                  <Field
                    name="amount"
                    label="Montant"
                    value={draft.data.amount ?? ""}
                    onChange={(v) => data("amount", v || null)}
                    errors={errors}
                    hint="Valeur décimale exacte, point décimal. Vide = inconnu ; 0.00 = zéro confirmé."
                  />
                  <Select
                    name="preparation"
                    label="Préparation"
                    value={draft.data.preparation}
                    onChange={(v) => data("preparation", v)}
                  >
                    <option value="a_preparer">À préparer</option>
                    <option value="en_cours">En cours</option>
                    <option value="preparee">Préparée</option>
                  </Select>
                  <Select
                    name="source"
                    label="Source"
                    value={draft.data.source}
                    onChange={(v) => data("source", v)}
                  >
                    <option value="manuelle">Manuelle</option>
                    <option value="simulee">Simulée</option>
                  </Select>
                  <Select
                    name="validation"
                    label="Validation locale"
                    value={draft.data.validation}
                    onChange={(v) => data("validation", v)}
                    disabled={!can("approve")}
                  >
                    <option value="non_validee">Non validée</option>
                    <option value="validee_localement">
                      Validée localement
                    </option>
                  </Select>
                  <small>
                    Une modification du contenu invalide l’approbation. La
                    validation locale ne constitue ni un dépôt ni un paiement.
                  </small>
                </>
              )}
              <label className="check">
                <Checkbox
                  checked={draft.confidential}
                  onCheckedChange={(confidential) =>
                    setDraft({ ...draft, confidential })
                  }
                />
                Confidentiel
              </label>
              <label className="check">
                <Checkbox
                  checked={draft.data.archived}
                  onCheckedChange={(v) => data("archived", v)}
                />
                Archivé
              </label>
            </fieldset>
            {editable ? (
              <Button
                type="submit"
                variant="solid"
                loading={busy}
                disabled={conflict}
              >
                Enregistrer
              </Button>
            ) : (
              <p>Lecture seule : modification non autorisée.</p>
            )}
            <p role="status">{notice}</p>
          </form>
          {saved?.kind === "tache" && (
            <section className="transitions">
              <p>État : {stateLabels[saved.data.state]}</p>
              {dirty && (
                <p>Enregistrez vos modifications avant de changer l’étape.</p>
              )}
              {can("transition") && (
                <div className="actions">
                  {saved.data.state !== "en_cours" && (
                    <Button
                      disabled={!!dirty || busy || conflict}
                      onClick={() => void transition("en_cours")}
                    >
                      Commencer
                    </Button>
                  )}
                  {saved.data.state !== "terminee" ? (
                    <Button
                      disabled={!!dirty || busy || conflict}
                      onClick={() => void transition("terminee")}
                    >
                      Terminer
                    </Button>
                  ) : (
                    <Button
                      disabled={!!dirty || busy || conflict}
                      onClick={() => void transition("a_faire")}
                    >
                      Réouvrir
                    </Button>
                  )}
                </div>
              )}
            </section>
          )}
          {saved && (
            <footer>
              <small>
                Version {saved.version} ·{" "}
                {new Date(saved.updatedAt).toLocaleString("fr-FR")}
              </small>
              {can("audit") && (
                <Button
                  onClick={async () => {
                    setFault("");
                    try {
                      setHistory(
                        await request(
                          "/records/" + saved.id + "/history",
                          HistorySchema,
                          signal,
                        ),
                      );
                    } catch (e) {
                      if (!signal.aborted) setFault(message(e));
                    }
                  }}
                >
                  Historique
                </Button>
              )}
            </footer>
          )}
          {history && (
            <section>
              <h3>Historique</h3>
              <ol className="history">
                {history.items.map((event) => (
                  <li key={event.id}>
                    <strong>
                      {
                        {
                          created: "Création",
                          updated: "Modification",
                          transitioned: "Transition",
                        }[event.action]
                      }
                    </strong>{" "}
                    · version {event.version}
                    <br />
                    <small>
                      {new Date(event.at).toLocaleString("fr-FR")} ·{" "}
                      {event.actorId === user.id
                        ? user.name
                        : "Utilisateur du cabinet"}
                    </small>
                    <div>
                      {event.snapshot.title}
                      {"dueDate" in event.snapshot.data &&
                        " · " +
                          (event.snapshot.data.dueDate ?? "Sans échéance")}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
    </dialog>
  );
}

function RecordComparison({
  latest,
  draft,
  dossiers,
  users,
}: {
  latest: CabinetRecord;
  draft: Content;
  dossiers: CabinetRecord[];
  users: SessionUser[];
}) {
  const names: Record<string, string> = {
    title: "Titre",
    dossierId: "Dossier lié",
    confidential: "Confidentiel",
    siren: "SIREN",
    legalForm: "Forme juridique",
    notes: "Notes",
    archived: "Archivé",
    contactType: "Type de contact",
    email: "Email",
    phone: "Téléphone",
    description: "Description",
    dueDate: "Échéance",
    state: "Étape",
    priority: "Priorité",
    assigneeIds: "Responsables",
    checklist: "Checklist",
    tags: "Étiquettes",
    nature: "Nature",
    period: "Période",
    preparation: "Préparation",
    validation: "Validation locale",
    amount: "Montant",
    source: "Source",
  };
  const words: Record<string, string> = {
    ...stateLabels,
    personne: "Personne",
    organisation: "Organisation",
    normale: "Normale",
    haute: "Haute",
    urgente: "Urgente",
    a_preparer: "À préparer",
    preparee: "Préparée",
    non_validee: "Non validée",
    validee_localement: "Validée localement",
    manuelle: "Manuelle",
    simulee: "Simulée",
  };
  function rows(record: Content) {
    return {
      title: record.title,
      dossierId: record.dossierId,
      confidential: record.confidential,
      ...record.data,
    };
  }
  function value(key: string, v: unknown): string {
    if (v === null || v === "")
      return key === "amount" ? "Inconnu" : "Non renseigné";
    if (typeof v === "boolean") return v ? "Oui" : "Non";
    if (key === "dossierId")
      return dossiers.find((d) => d.id === v)?.title ?? "Dossier associé";
    if (key === "assigneeIds" && Array.isArray(v))
      return (
        v
          .map(
            (id) =>
              users.find((u) => u.id === id)?.name ?? "Responsable existant",
          )
          .join(", ") || "Aucun"
      );
    if (key === "checklist")
      return (
        TaskDataSchema.shape.checklist
          .parse(v)
          .map((item) => (item.done ? "Fait : " : "À faire : ") + item.label)
          .join(" ; ") || "Vide"
      );
    if (Array.isArray(v)) return v.join(", ") || "Aucune";
    return words[String(v)] ?? String(v);
  }
  const remote = rows(latest),
    local = rows(draft);
  return (
    <div className="comparison">
      <table>
        <caption>Comparez les valeurs avant de résoudre le conflit</caption>
        <thead>
          <tr>
            <th>Champ</th>
            <th>Enregistré</th>
            <th>Ma saisie</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(remote).map(([key, v]) => (
            <tr key={key}>
              <th scope="row">{names[key] ?? key}</th>
              <td>{value(key, v)}</td>
              <td>{value(key, local[key as keyof typeof local])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
