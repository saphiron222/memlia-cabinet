import { formatCivilDate } from "../workflows/civil";
import { Companies } from "../referential/Companies";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@memlia/ui";
import { Check as Checkbox } from "./shared";
import {
  RelationshipEntitySchema,
  RelationshipPageSchema,
  RelationshipEventSchema,
  RelationshipBulkResultSchema,
  CabinetRecordSchema,
  OnboardingStatusSchema,
  type RelationshipEntity,
  type RelationshipData,
  type SessionUser,
} from "@memlia/contracts";
import { request, message, useScope } from "../../api";
import { ErrorSummary, Field, Select } from "../../forms";
import { TabButton } from "../../upstream/plane/controls";
import { KanbanCard } from "../../upstream/plane/kanban-card";
import {
  Table,
  TableHeader,
  TableRow,
  TableCell,
} from "../../upstream/twenty/Table";
import { Peek } from "../../interface/Peek";
import { PanelCard } from "../../upstream/cal/PanelCard";
import { ProspectForm } from "./ProspectForm";
import { ModelForm, PipelineImport } from "./Models";
import { ReviewForm } from "./Reviews";
import {
  PartyChoice,
  useRelationshipTab,
  ModelChoice,
  Pager,
  Choice,
  kindLabels,
} from "./shared";
import { ExportData } from "../administration/ExportData";
import "./relationship.css";
const params = () => new URLSearchParams(location.hash.split("?")[1]);
const views = {
  list: "Prospects",
  kanban: "Pipeline",
  onboarding: "Onboarding",
  identity: "Identités",
  lab: "Vigilance LAB",
  settings: "Configuration",
  export: "Export autorisé",
};
const temperatures = {
  unknown: "Inconnue",
  cold: "Froide",
  warm: "Tiède",
  hot: "Chaude",
};
export function Relationship({ user }: { user: SessionUser }) {
  const signal = useScope(),
    [route, R] = useState(params),
    [revision, Revision] = useState(0),
    [list, L] = useState<z.infer<typeof RelationshipPageSchema> | null>(null),
    [labels, Labels] = useState<Record<string, string>>({}),
    [models, Models] = useState<Record<string, RelationshipEntity>>({}),
    [statuses, Statuses] = useState<
      Record<string, z.infer<typeof OnboardingStatusSchema>>
    >({}),
    [error, E] = useState(""),
    [notice, N] = useState(""),
    [selected, Selected] = useState<string[]>([]),
    [busy, B] = useState(false),
    [conversion, Conversion] = useState<{
      entity: RelationshipEntity;
      stageId: string;
    } | null>(null),
    [bulkStage, BulkStage] = useState(""),
    [bulkResult, BulkResult] = useState<z.infer<
      typeof RelationshipBulkResultSchema
    > | null>(null);
  const view = route.get("view") ?? "list",
    id = route.get("id"),
    kind: RelationshipData["kind"] =
      view === "settings"
        ? ((route.get("section") ?? "pipeline") as RelationshipData["kind"])
        : view === "onboarding"
          ? "onboarding"
          : view === "lab"
            ? "lab"
            : view === "identity"
              ? "identity"
              : "prospect",
    offset = Number(route.get("offset") ?? 0),
    q = route.get("q") ?? "",
    dense = route.get("density") !== "comfortable",
    manage = user.permissions.some(
      (p) => p.action === "manage_users" && p.kind === "*" && !p.dossierId,
    ),
    canCreate =
      kind === "lab"
        ? user.permissions
            .concat(user.scopedPermissions)
            .some((p) => p.action === "lab_manage")
        : user.permissions
            .concat(user.scopedPermissions)
            .some((p) => p.action === "create"),
    modelKind = [
      "pipeline",
      "mission",
      "onboarding_model",
      "lab_policy",
    ].includes(kind);
  function navigate(patch: Record<string, string | null>, replace = false) {
    const p = new URLSearchParams(route);
    for (const [k, v] of Object.entries(patch))
      if (v === null) p.delete(k);
      else p.set(k, v);
    const hash = "#relationship?" + p.toString();
    if (replace) {
      history.replaceState(null, "", hash);
      R(p);
    } else location.hash = hash;
  }
  useEffect(() => {
    const update = () => {
      R(params());
      Selected([]);
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    if (view === "export") return;
    const c = new AbortController();
    L(null);
    E("");
    const p = new URLSearchParams({
      kind,
      q,
      offset: String(offset),
      limit: "50",
    });
    for (const k of [
      "pipelineId",
      "stageId",
      "tag",
      "assigneeId",
      "teamId",
      "origin",
      "followed",
      "hideCompleted",
      "sort",
    ])
      if (route.get(k)) p.set(k, route.get(k)!);
    void request(
      "/relationship/entities?" + p,
      RelationshipPageSchema,
      c.signal,
    )
      .then(async (result) => {
        const titles: Record<string, string> = {},
          mods: Record<string, RelationshipEntity> = {},
          states: Record<string, z.infer<typeof OnboardingStatusSchema>> = {};
        const recordIds = [
          ...new Set(
            result.items.flatMap((e) =>
              e.data.kind === "prospect"
                ? [e.data.contactId]
                : "dossierId" in e.data
                  ? [e.data.dossierId]
                  : [],
            ),
          ),
        ];
        await Promise.all(
          recordIds.map(async (rid) => {
            titles[rid] = (
              await request("/records/" + rid, CabinetRecordSchema, c.signal)
            ).title;
          }),
        );
        const mids = [
          ...new Set(
            result.items.flatMap((e) =>
              e.data.kind === "prospect"
                ? [e.data.pipelineId]
                : e.data.kind === "onboarding"
                  ? [e.data.modelId]
                  : [],
            ),
          ),
        ];
        await Promise.all(
          mids.map(async (mid) => {
            mods[mid] = await request(
              "/relationship/entities/" + mid,
              RelationshipEntitySchema,
              c.signal,
            );
          }),
        );
        if (kind === "onboarding")
          await Promise.all(
            result.items.map(async (e) => {
              states[e.id] = await request(
                "/relationship/onboarding/" + e.id + "/status",
                OnboardingStatusSchema,
                c.signal,
              );
            }),
          );
        if (!c.signal.aborted) {
          Labels(titles);
          Models(mods);
          Statuses(states);
          L(result);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          L(null);
          E(message(e));
        }
      });
    return () => c.abort();
  }, [view, kind, q, offset, route.toString(), revision]);
  const title = (e: RelationshipEntity) =>
    "name" in e.data
      ? e.data.name
      : (labels[
          e.data.kind === "prospect" ? e.data.contactId : e.data.dossierId
        ] ?? "Chargement…");
  const open = (eid: string) =>
    navigate({ id: eid, detailTab: null, formSection: null });
  const close = () => navigate({ id: null });
  const saved = (e: RelationshipEntity) => {
    N("Enregistré · version " + e.version);
    Revision((v) => v + 1);
    navigate({ id: e.id }, true);
  };
  async function move(
    e: RelationshipEntity,
    stageId: string,
    confirmed = false,
  ) {
    const model = e.data.kind === "prospect" ? models[e.data.pipelineId] : null;
    if (
      !confirmed &&
      e.data.kind === "prospect" &&
      !e.data.dossierId &&
      model?.data.kind === "pipeline" &&
      model.data.conversionStageId === stageId
    ) {
      Conversion({ entity: e, stageId });
      return;
    }
    Conversion(null);
    B(true);
    E("");
    try {
      await request(
        "/relationship/prospects/" + e.id + "/move",
        RelationshipEntitySchema,
        signal,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            expectedVersion: e.version,
            stageId,
          }),
        },
      );
      Revision((v) => v + 1);
      N("Étape enregistrée. Les déclencheurs configurés ont été traités.");
    } catch (e) {
      E(message(e));
    } finally {
      B(false);
    }
  }
  const stage = (e: RelationshipEntity) => {
    if (e.data.kind !== "prospect") return null;
    const d = e.data,
      m = models[d.pipelineId];
    return m?.data.kind === "pipeline"
      ? m.data.stages.find((s) => s.id === d.stageId)
      : null;
  };
  const columnOrder = (route.get("columnOrder") ?? "").split(",");
  const columns = [
    ...new Map(
      Object.values(statuses)
        .flatMap((s) => s.steps)
        .map((s) => [s.id, s]),
    ).values(),
  ];
  columns.sort((a, b) => {
    const ai = columnOrder.indexOf(a.id),
      bi = columnOrder.indexOf(b.id);
    return (ai < 0 ? 10000 : ai) - (bi < 0 ? 10000 : bi);
  });
  const hidden = (route.get("hidden") ?? "").split(",");
  return (
    <div
      className={"relationship-workspace " + (dense ? "dense" : "comfortable")}
    >
      <div
        className="relationship-tabs"
        role="tablist"
        aria-label="Relation client"
      >
        {Object.entries(views).map(([v, label]) => (
          <TabButton
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() =>
              navigate({
                view: v,
                id: null,
                offset: null,
                q: null,
                pipelineId: null,
                stageId: null,
              })
            }
          >
            {label}
          </TabButton>
        ))}
      </div>
      <ErrorSummary message={error || undefined} />
      {(view === "list" || view === "kanban") && (
        <details>
          <summary>Recherche publique et propositions de rapprochement</summary>
          <Companies user={user} onChanged={() => Revision((v) => v + 1)} />
        </details>
      )}
      {conversion && (
        <Peek label="Revoir la conversion" onClose={() => Conversion(null)}>
          <PanelCard title="Créer le dossier lié">
            <p>{title(conversion.entity)}</p>
            <p>
              La conversion conserve le contact, sa confidentialité et ses
              relations existantes. Elle crée un dossier unique et consigne les
              demandes documentaires configurées.
            </p>
            {conversion.entity.data.kind === "prospect" && (
              <p>
                Honoraires proposés :{" "}
                {conversion.entity.data.proposedFee ?? "Inconnus"} · Missions :{" "}
                {conversion.entity.data.missions.length} · Source :{" "}
                {conversion.entity.data.source || "Non renseignée"}
              </p>
            )}
            <Button
              variant="solid"
              disabled={busy}
              onClick={() =>
                void move(conversion.entity, conversion.stageId, true)
              }
            >
              Confirmer la conversion
            </Button>
            <Button onClick={() => Conversion(null)}>Annuler</Button>
          </PanelCard>
        </Peek>
      )}
      {notice && <p role="status">{notice}</p>}
      {view === "export" ? (
        <PanelCard title="Sortie interopérable des données autorisées">
          <p>
            La sortie commune comprend les modèles, prospects, conversions,
            accueils, examens d’identité et décisions LAB accessibles, avec
            versions et références GED. Les droits sont revérifiés à chaque
            téléchargement.
          </p>
          <ExportData />
        </PanelCard>
      ) : (
        <>
          {view === "settings" && (
            <div
              className="relationship-tabs"
              role="tablist"
              aria-label="Paramètres relation client"
            >
              {(
                [
                  "pipeline",
                  "mission",
                  "onboarding_model",
                  "lab_policy",
                ] as const
              ).map((k) => (
                <TabButton
                  key={k}
                  role="tab"
                  aria-selected={kind === k}
                  onClick={() =>
                    navigate({ section: k, id: null, offset: null, q: null })
                  }
                >
                  {kindLabels[k]}
                </TabButton>
              ))}
            </div>
          )}
          <div className="relationship-toolbar">
            <Field
              name="relationship-search"
              label="Rechercher un nom ou SIREN"
              value={q}
              onChange={(v) => navigate({ q: v, offset: null }, true)}
            />
            {((canCreate && !modelKind) || (manage && modelKind)) && (
              <Button variant="solid" onClick={() => open("new")}>
                {
                  {
                    prospect: "Nouveau prospect",
                    onboarding: "Nouvelle entrée client",
                    lab: "Nouvelle revue LAB",
                    identity: "Nouvel examen d’identité",
                    pipeline: "Nouveau pipeline",
                    mission: "Nouvelle mission",
                    onboarding_model: "Nouveau modèle d’accueil",
                    lab_policy: "Nouvelle politique LAB",
                  }[kind]
                }
              </Button>
            )}
            <Button onClick={() => Revision((v) => v + 1)}>Actualiser</Button>
            <details>
              <summary>Filtres et affichage</summary>
              <div className="relationship-fields">
                {kind === "prospect" && (
                  <>
                    <ModelChoice
                      name="filter-pipeline"
                      label="Pipeline filtré"
                      kind="pipeline"
                      value={route.get("pipelineId") ?? ""}
                      onChange={(v) =>
                        navigate({ pipelineId: v || null, offset: null })
                      }
                    />
                    <Select
                      name="filter-stage"
                      label="Étape"
                      value={route.get("stageId") ?? ""}
                      onChange={(v) =>
                        navigate({ stageId: v || null, offset: null })
                      }
                    >
                      <option value="">Toutes les étapes</option>
                      {Object.values(models)
                        .flatMap((m) =>
                          m.data.kind === "pipeline" ? m.data.stages : [],
                        )
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </Select>
                  </>
                )}
                {(kind === "prospect" || kind === "onboarding") && (
                  <>
                    <PartyChoice
                      name="filter-assignee"
                      label="Collaborateur filtré"
                      kind="people"
                      value={route.get("assigneeId") ?? ""}
                      onChange={(v) =>
                        navigate({ assigneeId: v || null, offset: null })
                      }
                    />
                    <PartyChoice
                      name="filter-team"
                      label="Équipe filtrée"
                      kind="teams"
                      value={route.get("teamId") ?? ""}
                      onChange={(v) =>
                        navigate({ teamId: v || null, offset: null })
                      }
                    />
                  </>
                )}
                <Field
                  name="filter-tag"
                  label="Étiquette"
                  value={route.get("tag") ?? ""}
                  onChange={(v) =>
                    navigate({ tag: v || null, offset: null }, true)
                  }
                />
                <Choice
                  name="relationship-sort"
                  label="Trier"
                  value={route.get("sort") ?? "name"}
                  onChange={(v) => navigate({ sort: v, offset: null })}
                  options={{ name: "Nom", updated: "Dernière modification" }}
                />
                <Choice
                  name="relationship-density"
                  label="Densité"
                  value={dense ? "dense" : "comfortable"}
                  onChange={(v) => navigate({ density: v }, true)}
                  options={{ dense: "Compacte", comfortable: "Confortable" }}
                />
                {kind === "onboarding" && (
                  <>
                    <Choice
                      name="filter-origin"
                      label="Origine"
                      value={route.get("origin") ?? ""}
                      onChange={(v) =>
                        navigate({ origin: v || null, offset: null })
                      }
                      options={{
                        "": "Toutes",
                        creation: "Création",
                        reprise: "Reprise",
                      }}
                    />
                    <Checkbox
                      label="Masquer les accueils terminés"
                      checked={route.get("hideCompleted") === "true"}
                      onChange={(e) =>
                        navigate({
                          hideCompleted: e.target.checked ? "true" : null,
                          offset: null,
                        })
                      }
                    />
                    <Checkbox
                      label="Seulement les accueils suivis"
                      checked={route.get("followed") === "true"}
                      onChange={(e) =>
                        navigate({
                          followed: e.target.checked ? "true" : null,
                          offset: null,
                        })
                      }
                    />
                    {columns.map((c, index) => (
                      <div key={c.id} className="actions">
                        <Checkbox
                          label={"Colonne : " + c.name}
                          checked={!hidden.includes(c.id)}
                          onChange={(e) =>
                            navigate(
                              {
                                hidden: (e.target.checked
                                  ? hidden.filter((id) => id !== c.id)
                                  : [...hidden, c.id]
                                ).join(","),
                              },
                              true,
                            )
                          }
                        />
                        <Button
                          disabled={!index}
                          onClick={() => {
                            const ids = columns.map((x) => x.id);
                            [ids[index - 1], ids[index]] = [
                              ids[index]!,
                              ids[index - 1]!,
                            ];
                            navigate({ columnOrder: ids.join(",") }, true);
                          }}
                        >
                          Déplacer {c.name} à gauche
                        </Button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </details>
          </div>
          {selected.length > 0 && kind === "prospect" && (
            <div className="relationship-bulk">
              <span>{selected.length} sélectionné(s), maximum 20</span>
              <Select
                name="bulk-stage"
                label="Étape commune du lot"
                value={bulkStage}
                onChange={BulkStage}
              >
                <option value="">Choisir…</option>
                {Object.values(models)
                  .flatMap((m) =>
                    m.data.kind === "pipeline" ? m.data.stages : [],
                  )
                  .filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </Select>
              <Button
                disabled={busy || !bulkStage || selected.length > 20}
                onClick={() => {
                  B(true);
                  void request(
                    "/relationship/prospects/bulk-move",
                    RelationshipBulkResultSchema,
                    signal,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        operationId: crypto.randomUUID(),
                        stageId: bulkStage,
                        items: list?.items
                          .filter((e) => selected.includes(e.id))
                          .map((e) => ({
                            id: e.id,
                            expectedVersion: e.version,
                          })),
                      }),
                    },
                  )
                    .then((r) => {
                      BulkResult(r);
                      Revision((v) => v + 1);
                    })
                    .catch((e) => E(message(e)))
                    .finally(() => B(false));
                }}
              >
                Déplacer la sélection
              </Button>
            </div>
          )}
          {selected.length > 0 && kind === "onboarding" && (
            <div className="relationship-bulk">
              <span>{selected.length} accueil(s) sélectionné(s)</span>
              <Button
                disabled={busy || selected.length > 20}
                onClick={async () => {
                  B(true);
                  const results = [];
                  for (const row of list?.items.filter((x) =>
                    selected.includes(x.id),
                  ) ?? []) {
                    if (row.data.kind !== "onboarding") continue;
                    try {
                      const saved = await request(
                        "/relationship/entities",
                        RelationshipEntitySchema,
                        signal,
                        {
                          method: "POST",
                          body: JSON.stringify({
                            id: row.id,
                            expectedVersion: row.version,
                            operationId: crypto.randomUUID(),
                            data: {
                              ...row.data,
                              followedBy: [
                                ...new Set([...row.data.followedBy, user.id]),
                              ],
                            },
                          }),
                        },
                      );
                      results.push({
                        id: row.id,
                        state: "succeeded" as const,
                        version: saved.version,
                      });
                    } catch (e) {
                      results.push({
                        id: row.id,
                        state: "failed" as const,
                        message: message(e),
                      });
                    }
                  }
                  BulkResult({ items: results });
                  Revision((v) => v + 1);
                  B(false);
                }}
              >
                Suivre la sélection
              </Button>
            </div>
          )}
          {bulkResult && (
            <ul role="status">
              {bulkResult.items.map((r) => (
                <li key={r.id}>
                  {labels[
                    list?.items.find((e) => e.id === r.id)?.data.kind ===
                    "prospect"
                      ? (
                          list.items.find((e) => e.id === r.id)!
                            .data as Extract<
                            RelationshipData,
                            { kind: "prospect" }
                          >
                        ).contactId
                      : ""
                  ] ?? r.id}{" "}
                  : {r.state === "succeeded" ? "Enregistré" : r.message}
                </li>
              ))}
            </ul>
          )}
          {!list && !error ? (
            <p role="status">Chargement de la relation client…</p>
          ) : list?.items.length === 0 ? (
            <div className="work-empty">
              <h3>
                Aucun {kindLabels[kind].toLocaleLowerCase("fr")} accessible
              </h3>
              <p>Créez un élément ou ajustez les filtres.</p>
            </div>
          ) : (
            list && (
              <>
                {view === "kanban" ? (
                  <div className="relationship-kanban">
                    {Object.values(models)
                      .filter((m) => m.data.kind === "pipeline")
                      .flatMap((m) =>
                        m.data.kind === "pipeline"
                          ? m.data.stages.map((s) => (
                              <section key={s.id} aria-label={s.name}>
                                <h3>
                                  <span
                                    className={"relationship-status " + s.color}
                                  >
                                    {s.name}
                                  </span>
                                  <span>
                                    {
                                      list.items.filter(
                                        (e) =>
                                          e.data.kind === "prospect" &&
                                          e.data.stageId === s.id,
                                      ).length
                                    }
                                  </span>
                                </h3>
                                {list.items
                                  .filter(
                                    (e) =>
                                      e.data.kind === "prospect" &&
                                      e.data.stageId === s.id,
                                  )
                                  .map((e) => (
                                    <KanbanCard key={e.id}>
                                      <button
                                        className="relationship-record-link"
                                        onClick={() => open(e.id)}
                                      >
                                        {title(e)}
                                      </button>
                                      {e.data.kind === "prospect" && (
                                        <>
                                          <p>
                                            {temperatures[e.data.temperature]} ·{" "}
                                            {e.data.proposedFee === null
                                              ? "Honoraires inconnus"
                                              : e.data.proposedFee + " €"}
                                          </p>
                                          <span>
                                            {e.data.source ||
                                              "Source non renseignée"}
                                          </span>
                                          <Select
                                            name={"move-" + e.id}
                                            label="Déplacer vers"
                                            value={e.data.stageId}
                                            onChange={(v) => void move(e, v)}
                                            disabled={
                                              busy ||
                                              !user.permissions
                                                .concat(user.scopedPermissions)
                                                .some(
                                                  (p) => p.action === "update",
                                                )
                                            }
                                          >
                                            {m.data.kind === "pipeline" &&
                                              m.data.stages.map((stage) => (
                                                <option
                                                  key={stage.id}
                                                  value={stage.id}
                                                >
                                                  {stage.name}
                                                </option>
                                              ))}
                                          </Select>
                                        </>
                                      )}
                                    </KanbanCard>
                                  ))}
                              </section>
                            ))
                          : [],
                      )}
                  </div>
                ) : (
                  <div
                    className="relationship-grid"
                    tabIndex={0}
                    role="region"
                    aria-label="Tableau relation client défilant"
                  >
                    <Table>
                      <thead>
                        <TableRow>
                          {(kind === "prospect" || kind === "onboarding") && (
                            <TableHeader>
                              <span className="sr-only">Sélection</span>
                            </TableHeader>
                          )}
                          <TableHeader>Nom</TableHeader>
                          {kind === "onboarding" ? (
                            columns
                              .filter((c) => !hidden.includes(c.id))
                              .map((c) => (
                                <TableHeader key={c.id}>
                                  {c.name}
                                  <small>
                                    {c.source === "system"
                                      ? "Source système"
                                      : "Manuel"}
                                  </small>
                                </TableHeader>
                              ))
                          ) : (
                            <>
                              <TableHeader>
                                {kind === "prospect"
                                  ? "Étape"
                                  : kind === "lab"
                                    ? "Vigilance"
                                    : "Type"}
                              </TableHeader>
                              <TableHeader>
                                {kind === "prospect" ? "Température" : "État"}
                              </TableHeader>
                              <TableHeader>
                                {kind === "prospect"
                                  ? "Honoraires proposés"
                                  : "Version"}
                              </TableHeader>
                            </>
                          )}
                          <TableHeader>Action</TableHeader>
                        </TableRow>
                      </thead>
                      <tbody>
                        {list.items.map((e) => (
                          <TableRow key={e.id}>
                            {(kind === "prospect" || kind === "onboarding") && (
                              <TableCell className="relationship-selection">
                                <Checkbox
                                  hideLabel
                                  label={"Sélectionner " + title(e)}
                                  checked={selected.includes(e.id)}
                                  onChange={(event) =>
                                    Selected(
                                      event.target.checked
                                        ? [...selected, e.id]
                                        : selected.filter((id) => id !== e.id),
                                    )
                                  }
                                />
                              </TableCell>
                            )}
                            <TableCell>
                              <button
                                className="relationship-record-link"
                                onClick={() => open(e.id)}
                              >
                                {title(e)}
                              </button>
                              {e.data.kind === "prospect" &&
                                e.data.dossierId && (
                                  <a
                                    className="relationship-linked"
                                    href={"#dossier?id=" + e.data.dossierId}
                                  >
                                    Dossier lié
                                  </a>
                                )}
                            </TableCell>
                            {kind === "onboarding" ? (
                              columns
                                .filter((c) => !hidden.includes(c.id))
                                .map((c) => {
                                  const value = statuses[e.id]?.steps.find(
                                    (s) => s.id === c.id,
                                  );
                                  return (
                                    <TableCell key={c.id}>
                                      <button
                                        className={
                                          "relationship-cell " +
                                          (value?.status === "done"
                                            ? "done"
                                            : value?.status === "blocked"
                                              ? "blocked"
                                              : "")
                                        }
                                        onClick={() => open(e.id)}
                                      >
                                        {!value
                                          ? "—"
                                          : value.expired
                                            ? "Expiré"
                                            : value.source === "system"
                                              ? "Inconnu"
                                              : value.type === "boolean"
                                                ? value.value === true
                                                  ? "Oui"
                                                  : "À renseigner"
                                                : value.type === "status"
                                                  ? (value.statuses.find(
                                                      (s) =>
                                                        s.id === value.value,
                                                    )?.name ?? "À renseigner")
                                                  : String(
                                                      value.value ??
                                                        "À renseigner",
                                                    )}
                                      </button>
                                    </TableCell>
                                  );
                                })
                            ) : (
                              <>
                                <TableCell>
                                  {e.data.kind === "prospect" ? (
                                    <span
                                      className={
                                        "relationship-status " + stage(e)?.color
                                      }
                                    >
                                      {stage(e)?.name ?? "Étape conservée"}
                                    </span>
                                  ) : e.data.kind === "lab" ? (
                                    <span
                                      className={
                                        "relationship-status " +
                                        {
                                          standard: "blue",
                                          simplified: "green",
                                          enhanced: "orange",
                                        }[e.data.level]
                                      }
                                    >
                                      {
                                        {
                                          standard: "Standard",
                                          simplified: "Simplifiée",
                                          enhanced: "Renforcée",
                                        }[e.data.level]
                                      }
                                    </span>
                                  ) : (
                                    kindLabels[e.data.kind]
                                  )}
                                </TableCell>
                                <TableCell>
                                  {e.data.kind === "prospect"
                                    ? temperatures[e.data.temperature]
                                    : "active" in e.data
                                      ? e.data.active
                                        ? "Actif"
                                        : "Inactif"
                                      : e.data.kind === "lab"
                                        ? "Révision : " +
                                          formatCivilDate(e.data.nextReviewOn)
                                        : e.data.kind === "identity"
                                          ? e.data.result
                                          : "À suivre"}
                                </TableCell>
                                <TableCell>
                                  {e.data.kind === "prospect"
                                    ? e.data.proposedFee === null
                                      ? "Inconnus"
                                      : e.data.proposedFee + " €"
                                    : "v" + e.version}
                                </TableCell>
                              </>
                            )}
                            <TableCell>
                              <Button size="sm" onClick={() => open(e.id)}>
                                Ouvrir
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                )}
                <Pager
                  offset={offset}
                  total={list.total}
                  change={(v) => navigate({ offset: String(v) })}
                />
              </>
            )
          )}
          {view === "settings" && kind === "pipeline" && manage && (
            <PipelineImport
              onSaved={(e) => {
                Revision((v) => v + 1);
                N("Pipeline repris : " + ("name" in e.data ? e.data.name : ""));
              }}
            />
          )}
        </>
      )}
      {id && (
        <Peek
          label={
            id === "new" ? "Création relation client" : "Fiche relation client"
          }
          onClose={close}
        >
          <RelationshipDetail
            key={id + ":" + revision}
            id={id}
            kind={kind}
            user={user}
            onClose={close}
            onSaved={saved}
          />
        </Peek>
      )}
    </div>
  );
}
function RelationshipDetail({
  id,
  kind,
  user,
  onClose,
  onSaved,
}: {
  id: string;
  kind: RelationshipData["kind"];
  user: SessionUser;
  onClose: () => void;
  onSaved: (e: RelationshipEntity) => void;
}) {
  const [entity, E] = useState<RelationshipEntity | undefined>(),
    [contextTitle, ContextTitle] = useState(""),
    [readonly, Readonly] = useState(false),
    [error, Error] = useState(""),
    [history, H] = useState<RelationshipEntity[]>([]),
    [events, Events] = useState<z.infer<typeof RelationshipEventSchema>[]>([]),
    [tab, Tab] = useRelationshipTab("detailTab", "details"),
    [ready, Ready] = useState(id === "new");
  useEffect(() => {
    if (id === "new") return;
    const c = new AbortController();
    void Promise.all([
      request(
        "/relationship/entities/" + id,
        RelationshipEntitySchema,
        c.signal,
      ),
      request(
        "/relationship/entities/" + id + "/capabilities",
        z.object({ actions: z.array(z.string()) }),
        c.signal,
      ),
      request(
        "/relationship/" + id + "/history",
        z.object({ items: z.array(RelationshipEntitySchema) }),
        c.signal,
      ),
      request(
        "/relationship/" + id + "/events",
        z.object({ items: z.array(RelationshipEventSchema) }),
        c.signal,
      ),
    ])
      .then(async ([e, cap, h, events]) => {
        const target =
          e.data.kind === "prospect"
            ? e.data.contactId
            : "dossierId" in e.data
              ? e.data.dossierId
              : null;
        ContextTitle(
          target
            ? (
                await request(
                  "/records/" + target,
                  CabinetRecordSchema,
                  c.signal,
                )
              ).title
            : "name" in e.data
              ? e.data.name
              : kindLabels[e.data.kind],
        );
        E(e);
        Readonly(!cap.actions.includes("update"));
        H(h.items);
        Events(events.items);
        Ready(true);
      })
      .catch((e) => {
        if (!c.signal.aborted) Error(message(e));
      });
    return () => c.abort();
  }, [id]);
  const k = entity?.data.kind ?? kind;
  return (
    <>
      <ErrorSummary message={error || undefined} />
      {!ready && !error ? (
        <p role="status">Chargement de la fiche…</p>
      ) : (
        ready && (
          <>
            <div className="relationship-detail-context">
              <p>
                {kindLabels[k]}
                {contextTitle ? " · " + contextTitle : ""}
              </p>
              <div
                className="relationship-tabs"
                role="tablist"
                aria-label="Fiche relation client"
              >
                <TabButton
                  role="tab"
                  aria-selected={tab === "details"}
                  onClick={() => Tab("details")}
                >
                  Fiche
                </TabButton>
                {entity && (
                  <>
                    <TabButton
                      role="tab"
                      aria-selected={tab === "history"}
                      onClick={() => Tab("history")}
                    >
                      Historique
                    </TabButton>
                    <TabButton
                      role="tab"
                      aria-selected={tab === "events"}
                      onClick={() => Tab("events")}
                    >
                      Déclencheurs
                    </TabButton>
                  </>
                )}
              </div>
            </div>
            {readonly && (
              <p className="relationship-readonly">
                Lecture seule : modification non autorisée.
              </p>
            )}
            {tab === "history" ? (
              <div className="relationship-stack">
                <h2>Révisions conservées</h2>
                {history.map((h) => (
                  <PanelCard
                    key={h.version}
                    title={
                      "Version " +
                      h.version +
                      " · " +
                      new Date(h.updatedAt).toLocaleString("fr-FR")
                    }
                  >
                    <p>
                      Auteur : {h.actorId} · Origine : {h.origin.kind}
                    </p>
                    {h.data.kind === "lab" ? (
                      <>
                        <p>
                          Vigilance : {h.data.level} · {h.data.reason}
                        </p>
                        <p>
                          Rôle : {h.data.role} · Prochaine révision :{" "}
                          {h.data.nextReviewOn}
                        </p>
                      </>
                    ) : h.data.kind === "prospect" ? (
                      <p>
                        Température : {temperatures[h.data.temperature]} ·
                        Risque : {h.data.manualRisk} · Score calculé : inconnu
                      </p>
                    ) : (
                      <p>{kindLabels[h.data.kind]}</p>
                    )}
                  </PanelCard>
                ))}
              </div>
            ) : tab === "events" ? (
              <div className="relationship-stack">
                <h2>Événements de la relation</h2>
                {!events.length ? (
                  <p>Aucun déclencheur enregistré.</p>
                ) : (
                  events.map((e) => (
                    <PanelCard
                      key={e.id}
                      title={
                        {
                          converted: "Dossier créé",
                          quote_requested: "Devis demandé",
                          letter_requested: "Lettre demandée",
                          activation_requested: "Accès client demandé",
                        }[e.type]
                      }
                    >
                      <p>
                        {e.state === "pending_producer"
                          ? "En attente du producteur ; aucun envoi ou activation effectué."
                          : "Création canonique enregistrée."}
                      </p>
                      <p>
                        {e.at} · version {e.version}
                      </p>
                    </PanelCard>
                  ))
                )}
              </div>
            ) : k === "prospect" ? (
              <ProspectForm
                entity={entity}
                onSaved={onSaved}
                onClose={onClose}
                readonly={readonly}
              />
            ) : k === "onboarding" || k === "identity" || k === "lab" ? (
              <ReviewForm
                kind={k}
                entity={entity}
                user={user}
                onSaved={onSaved}
                onClose={onClose}
                readonly={readonly}
              />
            ) : (
              <ModelForm
                kind={k}
                entity={entity}
                onSaved={onSaved}
                onClose={onClose}
                readonly={readonly}
              />
            )}
          </>
        )
      )}
    </>
  );
}
