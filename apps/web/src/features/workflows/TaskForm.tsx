import { NativeDialog } from "../../upstream/plane/controls";
import { NativeTextArea } from "../../upstream/plane/controls";
import { TabButton } from "../../upstream/plane/controls";
import { tabKeys } from "./tabs";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button, Checkbox } from "@memlia/ui";
import {
  CabinetRecordSchema,
  RecordContentSchema,
  TaskDataSchema,
  RecordListSchema,
  UserListSchema,
  type CabinetRecord,
  type SessionUser,
  type WorkflowModel,
} from "@memlia/contracts";
import { request, useScope, message, RequestError } from "../../api";
import {
  Field,
  Select,
  ErrorSummary,
  validationErrors,
  type Errors,
} from "../../forms";
import {
  DossierChoices,
  useDossierChoices,
} from "../referential/DossierChoices";
export function TaskForm({
  record,
  models,
  user,
  onSaved,
  onClose,
}: {
  record?: Extract<CabinetRecord, { kind: "tache" }>;
  models: WorkflowModel[];
  user: SessionUser;
  onSaved: (r: CabinetRecord) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    signal = useScope(),
    dossiers = useDossierChoices();
  const [tagsText, setTagsText] = useState(record?.data.tags.join(", ") ?? ""),
    [title, setTitle] = useState(record?.title ?? ""),
    [dossierId, setDossierId] = useState(record?.dossierId ?? ""),
    [data, setData] = useState(() => record?.data ?? TaskDataSchema.parse({})),
    [confidential, setConfidential] = useState(record?.confidential ?? false),
    [tab, setTab] = useState("main"),
    [error, setError] = useState(""),
    [errors, setErrors] = useState<Errors>({}),
    [busy, setBusy] = useState(false),
    [people, setPeople] = useState<{ id: string; name: string }[]>([user]),
    [contacts, setContacts] = useState<CabinetRecord[]>([]),
    [search, setSearch] = useState("");
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => prior?.focus();
  }, []);
  useEffect(() => {
    const c = new AbortController();
    void request(
      "/records?kind=contact&q=" + encodeURIComponent(search),
      RecordListSchema,
      c.signal,
    )
      .then((r) => setContacts(r.items))
      .catch(() => setContacts([]));
    return () => c.abort();
  }, [search]);
  useEffect(() => {
    if (record)
      void request(
        `/workflows/targets/${record.id}/people`,
        z.object({
          items: z.array(z.object({ id: z.uuid(), name: z.string() })),
        }),
        signal,
      )
        .then((r) => setPeople(r.items))
        .catch(() => {});
    else if (user.permissions.some((p) => p.action === "manage_users"))
      void request("/users", UserListSchema, signal)
        .then((r) => setPeople(r.items))
        .catch(() => {});
  }, []);
  const operation = useRef<{ signature: string; id: string } | null>(null);
  const patch = (p: Partial<typeof data>) => setData((v) => ({ ...v, ...p }));
  async function save() {
    setBusy(true);
    setError("");
    setErrors({});
    try {
      const content = RecordContentSchema.parse({
        kind: "tache",
        title,
        dossierId: dossierId || null,
        confidential,
        data: {
          ...data,
          tags: tagsText
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      });
      const signature = JSON.stringify({ content, version: record?.version });
      if (operation.current?.signature !== signature)
        operation.current = { signature, id: crypto.randomUUID() };
      const value = await request(
        "/records" + (record ? "/" + record.id : ""),
        CabinetRecordSchema,
        signal,
        {
          method: record ? "PUT" : "POST",
          body: JSON.stringify({
            operationId: operation.current.id,
            ...(record ? { expectedVersion: record.version } : {}),
            record: content,
          }),
        },
      );
      onSaved(value);
    } catch (e) {
      if (!signal.aborted) {
        setError(message(e));
        if (e instanceof z.ZodError) {
          const labels: Record<string, string> = {
            title: "task-title",
            dossierId: "task-dossier",
            dueDate: "task-date",
            tags: "task-tags",
          };
          setErrors(
            Object.fromEntries(
              Object.entries(validationErrors(e)).map(([key, value]) => [
                labels[key] ?? key,
                value,
              ]),
            ),
          );
          setTab(
            e.issues.some((i) => i.path.includes("tags")) ? "details" : "main",
          );
        } else if (
          e instanceof RequestError &&
          (["DOSSIER_REQUIRED", "INVALID_RELATION"].includes(e.code) ||
            [403, 404].includes(e.status))
        ) {
          setErrors({ "task-dossier": e.message });
          setTab("main");
        }
      }
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <NativeDialog
      ref={ref}
      className="work-dialog"
      aria-labelledby="task-form-heading"
      onCancel={onClose}
    >
      <header>
        <h2 id="task-form-heading">
          {record ? "Modifier la tâche" : "Créer une tâche"}
        </h2>
        <Button variant="ghost" onClick={onClose} aria-label="Fermer la tâche">
          ×
        </Button>
      </header>
      <ErrorSummary message={error || undefined} errors={errors} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div
          onKeyDown={tabKeys}
          role="tablist"
          aria-label="Champs de la tâche"
          className="work-tabs"
        >
          {[
            ["main", "Essentiel"],
            ["assignment", "Affectation"],
            ["details", "Détails"],
          ].map(([id, name]) => (
            <TabButton
              type="button"
              role="tab"
              aria-selected={tab === id}
              key={id}
              onClick={() => setTab(id!)}
            >
              {name}
            </TabButton>
          ))}
        </div>
        {tab === "main" && (
          <>
            <Field
              errors={errors}
              name="task-title"
              label="Titre de la tâche"
              value={title}
              onChange={setTitle}
              required
            />
            <Select
              errors={errors}
              name="task-dossier"
              label="Dossier de la tâche"
              value={dossierId}
              onChange={setDossierId}
            >
              <option value="">Sans dossier</option>
              {record?.dossierId &&
                !dossiers.items.some((d) => d.id === record.dossierId) && (
                  <option value={record.dossierId}>Dossier actuel</option>
                )}
              {dossiers.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </Select>
            <details>
              <summary>Rechercher d’autres dossiers</summary>
              <DossierChoices choices={dossiers} />
            </details>
            <Field
              errors={errors}
              name="task-date"
              label="Échéance de la tâche"
              value={data.dueDate ?? ""}
              type="date"
              onChange={(v) => patch({ dueDate: v || null })}
            />
            <Select
              name="task-type"
              label="Type de tâche"
              value={data.typeId ?? ""}
              onChange={(v) => {
                const m = models.find((m) => m.id === v);
                patch({
                  typeId: v || null,
                  stepId:
                    m?.model.kind === "task_type"
                      ? (data.state === "terminee"
                          ? m.model.steps.find((s) => s.final)!
                          : (m.model.steps.find((s) => !s.final) ??
                            m.model.steps[0]!)
                        ).id
                      : null,
                });
              }}
            >
              <option value="">Tâche générale</option>
              {models
                .filter((m) => m.model.kind === "task_type")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.model.name}
                  </option>
                ))}
            </Select>
            <Select
              name="task-priority"
              label="Urgence"
              value={data.priority}
              onChange={(v) => patch({ priority: v as typeof data.priority })}
            >
              <option value="normale">Normale</option>
              <option value="haute">Haute</option>
              <option value="urgente">Urgente</option>
            </Select>
          </>
        )}
        {tab === "assignment" && (
          <>
            <fieldset>
              <legend>Personnes affectées</legend>
              {people.map((p) => (
                <label className="check" key={p.id}>
                  <Checkbox
                    checked={data.assigneeIds.includes(p.id)}
                    onCheckedChange={(v) =>
                      patch({
                        assigneeIds: v
                          ? [...data.assigneeIds, p.id]
                          : data.assigneeIds.filter((id) => id !== p.id),
                      })
                    }
                  />
                  {p.name}
                </label>
              ))}
            </fieldset>
            <Field
              name="task-prospect-search"
              label="Rechercher un prospect"
              value={search}
              onChange={setSearch}
            />
            <Select
              name="task-prospect"
              label="Prospect lié"
              value={data.prospectId ?? ""}
              onChange={(v) => patch({ prospectId: v || null })}
            >
              <option value="">Sans prospect</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
            <label className="check">
              <Checkbox
                checked={confidential}
                onCheckedChange={(v) => setConfidential(!!v)}
              />
              Confidentiel
            </label>
          </>
        )}
        {tab === "details" && (
          <>
            <div className="field">
              <label htmlFor="task-description">Description</label>
              <NativeTextArea
                id="task-description"
                rows={4}
                value={data.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </div>
            <Select
              name="task-billing"
              label="Facturation"
              value={data.billing}
              onChange={(v) => patch({ billing: v as typeof data.billing })}
            >
              <option value="unknown">À préciser</option>
              <option value="billable">Facturable</option>
              <option value="included">Incluse dans la mission</option>
              <option value="non_billable">Non facturable</option>
            </Select>
            <Field
              name="task-planned"
              label="Temps prévu en minutes"
              type="number"
              value={
                data.plannedMinutes === null ? "" : String(data.plannedMinutes)
              }
              onChange={(v) =>
                patch({ plannedMinutes: v === "" ? null : Number(v) })
              }
            />
            <Field
              errors={errors}
              name="task-tags"
              label="Étiquettes séparées par des virgules"
              value={tagsText}
              onChange={setTagsText}
            />
          </>
        )}
        <footer>
          <Button type="button" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="solid" type="submit" loading={busy}>
            Enregistrer la tâche
          </Button>
        </footer>
      </form>
    </NativeDialog>
  );
}
