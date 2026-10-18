import { CatalogSelect, CatalogName, WeightEditor } from "./Catalog";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  WorkloadSchema,
  TimeEntitySchema,
  TimeListSchema,
  TimeReassignmentPreviewSchema,
  type TimeEntity,
} from "@memlia/contracts";
import { Button } from "@memlia/ui";
import { request, useScope, message } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
import {
  Table,
  TableRow,
  TableCell,
  TableHeader,
} from "../../upstream/twenty/Table";
import { Peek } from "../../interface/Peek";
import { duration, ScrollableTable, type Options } from "./shared";
type Workload = z.infer<typeof WorkloadSchema>;
export function WorkloadGrid({
  options,
  from,
  to,
}: {
  options: Options;
  from: string;
  to: string;
}) {
  const signal = useScope(),
    [data, setData] = useState<Workload | null>(null),
    [error, setError] = useState(""),
    [userId, setUserId] = useState(""),
    [groupId, setGroupId] = useState(""),
    [roleId, setRoleId] = useState(""),
    [epoch, setEpoch] = useState(0),
    [detail, setDetail] = useState<Workload["rows"][number] | null>(null),
    [allocations, setAllocations] = useState<TimeEntity[]>([]),
    [allocation, setAllocation] = useState<TimeEntity | null>(null),
    [weights, setWeights] = useState<{ userId: string; weight: number }[]>([]),
    [preview, setPreview] = useState<z.infer<
      typeof TimeReassignmentPreviewSchema
    > | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    setData(null);
    setError("");
    void request(
      "/time/workload?" +
        new URLSearchParams({
          from,
          to,
          ...(userId ? { userId } : {}),
          ...(groupId ? { groupId } : {}),
          ...(roleId ? { roleId } : {}),
        }),
      WorkloadSchema,
      c.signal,
    )
      .then(setData)
      .catch((e) => {
        if (!c.signal.aborted) setError(message(e));
      });
    return () => c.abort();
  }, [from, to, userId, groupId, roleId, epoch]);
  async function open(row: Workload["rows"][number]) {
    setDetail(row);
    setPreview(null);
    setAllocation(null);
    setAllocations([]);
    if (!options.canManage) return;
    try {
      const result = await request(
        "/time/entities?kind=" +
          (row.component === "fixed" ? "assignment" : "allocation") +
          "&referenceId=" +
          (row.component === "fixed"
            ? row.dossierId
            : row.target && "id" in row.target
              ? row.target.id
              : ""),
        TimeListSchema,
        signal,
      );
      const matches = result.items.filter((e) =>
        e.data.kind === "allocation"
          ? row.target?.kind === e.data.target.kind &&
            row.target.id === e.data.target.id
          : e.data.kind === "assignment" &&
            e.data.dossierId === row.dossierId &&
            e.data.roleId === row.roleId &&
            e.data.userId === row.userId,
      );
      setAllocations(matches);
      if (matches[0]) choose(matches[0]);
    } catch (e) {
      setError(message(e));
    }
  }
  function choose(a: TimeEntity) {
    setAllocation(a);
    setPreview(null);
    setWeights(
      a.data.kind === "allocation"
        ? a.data.weights
        : a.data.kind === "assignment"
          ? [{ userId: a.data.userId, weight: a.data.weight }]
          : [],
    );
  }
  async function reassign(commit = false) {
    if (!allocation || busy) return;
    setBusy(true);
    try {
      const body = {
        allocationId: allocation.id,
        expectedVersion: allocation.version,
        from,
        to,
        weights,
        ...(commit
          ? {
              sourceVersions: preview!.sourceVersions,
              operationId: crypto.randomUUID(),
            }
          : {}),
      };
      if (commit) {
        await request("/time/reassignment/commit", TimeEntitySchema, signal, {
          method: "POST",
          body: JSON.stringify(body),
        });
        setDetail(null);
        setEpoch((v) => v + 1);
      } else
        setPreview(
          await request(
            "/time/reassignment/preview",
            TimeReassignmentPreviewSchema,
            signal,
            { method: "POST", body: JSON.stringify(body) },
          ),
        );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const name = (id: string | null) => <CatalogName kind="users" id={id} />;
  return (
    <section>
      <ErrorSummary message={error} />
      <div className="time-toolbar">
        <CatalogSelect
          kind="users"
          name="workload-user"
          label="Collaborateur"
          value={userId}
          onChange={setUserId}
          empty="Tous les collaborateurs autorisés"
        />
        <CatalogSelect
          kind="groups"
          name="workload-group"
          label="Pôle / site"
          value={groupId}
          onChange={setGroupId}
          empty="Tous les pôles et sites"
        />
        <CatalogSelect
          kind="roles"
          name="workload-role"
          label="Rôle porteur"
          value={roleId}
          onChange={setRoleId}
          empty="Tous les rôles"
        />
      </div>
      {data ? (
        <>
          <ScrollableTable label="Tableau défilant de charge">
            <Table aria-label="Capacité et charge des collaborateurs">
              <thead>
                <TableRow>
                  {[
                    "Collaborateur",
                    "Capacité",
                    "Origine",
                    "Prévu",
                    "Réalisé",
                    "Surcharge",
                  ].map((h) => (
                    <TableHeader key={h}>{h}</TableHeader>
                  ))}
                </TableRow>
              </thead>
              <tbody>
                {data.people.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      {p.name}
                      {!p.active && " · Inactif"}
                    </TableCell>
                    <TableCell>
                      {p.capacityMinutes === null
                        ? "Inconnue"
                        : duration(p.capacityMinutes * 60)}
                    </TableCell>
                    <TableCell>
                      {p.capacitySource === "cabinet"
                        ? "Horaire du cabinet"
                        : p.capacitySource === "individual"
                          ? "Dérogation individuelle"
                          : "Non configurée"}
                    </TableCell>
                    <TableCell>
                      {duration(p.plannedMinutes * 60)}
                      {p.unknownPlans > 0 &&
                        ` · Partiel (${p.unknownPlans} prévision(s) inconnue(s))`}
                    </TableCell>
                    <TableCell>{duration(p.realizedSeconds)}</TableCell>
                    <TableCell>
                      <span
                        className={
                          p.overloadMinutes === null
                            ? "muted"
                            : p.overloadMinutes
                              ? "time-overload"
                              : "time-balanced"
                        }
                      >
                        {p.overloadMinutes === null
                          ? "Inconnue"
                          : p.overloadMinutes
                            ? duration(p.overloadMinutes * 60) + " en surcharge"
                            : "Capacité respectée"}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </ScrollableTable>
          <div className="time-section-heading">
            <h2>Contributions de charge</h2>
            <span className="muted">
              {data.unknownPlans} prévision(s) inconnue(s) · période {from} →{" "}
              {to}
            </span>
          </div>
          <ScrollableTable label="Tableau défilant de charge">
            <Table aria-label="Contributions de charge">
              <thead>
                <TableRow>
                  {[
                    "Travail",
                    "Porteur",
                    "Rôle",
                    "Contribution",
                    "Prévu",
                    "Réalisé",
                    "Détail",
                  ].map((h) => (
                    <TableHeader key={h}>{h}</TableHeader>
                  ))}
                </TableRow>
              </thead>
              <tbody>
                {data.rows
                  .filter((r) => !roleId || r.roleId === roleId)
                  .map((r) => (
                    <TableRow key={r.key}>
                      <TableCell>{r.label}</TableCell>
                      <TableCell>{name(r.userId)}</TableCell>
                      <TableCell>
                        <CatalogName kind="roles" id={r.roleId} />
                      </TableCell>
                      <TableCell>
                        <span className="time-tag">
                          {r.component === "fixed" ? "Forfait" : "Variable"}
                        </span>
                      </TableCell>
                      <TableCell>
                        {r.plannedMinutes === null
                          ? "Inconnu"
                          : duration(r.plannedMinutes * 60)}
                      </TableCell>
                      <TableCell>{duration(r.realizedSeconds)}</TableCell>
                      <TableCell>
                        <Button size="sm" onClick={() => void open(r)}>
                          Voir la charge
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
              </tbody>
            </Table>
          </ScrollableTable>
          {!data.rows.length && (
            <p className="empty">Aucune contribution sur ce périmètre.</p>
          )}
        </>
      ) : (
        !error && <p role="status">Calcul de la charge…</p>
      )}
      {detail && (
        <Peek
          label="Détail de charge et réaffectation"
          onClose={() => setDetail(null)}
        >
          <h2>{detail.label}</h2>
          <dl className="time-properties">
            <dt>Porteur</dt>
            <dd>{name(detail.userId)}</dd>
            <dt>Période</dt>
            <dd>
              {detail.from} → {detail.to}
            </dd>
            <dt>Prévision</dt>
            <dd>
              {detail.plannedMinutes === null
                ? "Inconnue"
                : duration(detail.plannedMinutes * 60)}
            </dd>
            <dt>Réalisé</dt>
            <dd>{duration(detail.realizedSeconds)}</dd>
            <dt>Origine et calcul</dt>
            <dd>{detail.provenance}</dd>
          </dl>
          <ErrorSummary message={error} />
          {options.canManage ? (
            <>
              {allocation ? (
                <>
                  <h3>Réaffecter la charge</h3>
                  {allocations.length > 1 && (
                    <Select
                      name="allocation-version"
                      label="Affectation datée"
                      value={allocation.id}
                      onChange={(id) => {
                        const a = allocations.find((x) => x.id === id);
                        if (a) choose(a);
                      }}
                    >
                      {allocations.map((a) => (
                        <option key={a.id} value={a.id}>
                          {"from" in a.data ? a.data.from : ""} · v{a.version}
                        </option>
                      ))}
                    </Select>
                  )}
                  <p className="muted">
                    Poids explicites. Le réalisé conserve son auteur historique.
                  </p>
                  <WeightEditor
                    prefix="reassign"
                    weights={weights}
                    onChange={(w) => {
                      setPreview(null);
                      setWeights(w);
                    }}
                  />
                  <Button
                    onClick={() => void reassign()}
                    disabled={busy || !weights.length}
                  >
                    Prévisualiser la réaffectation
                  </Button>
                  {preview && (
                    <>
                      <Table aria-label="Aperçu de réaffectation">
                        <thead>
                          <TableRow>
                            <TableHeader>Collaborateur</TableHeader>
                            <TableHeader>Avant</TableHeader>
                            <TableHeader>Après</TableHeader>
                          </TableRow>
                        </thead>
                        <tbody>
                          {preview.after.people.map((p) => (
                            <TableRow key={p.id}>
                              <TableCell>
                                {p.name}
                                {!p.active && " · Inactif"}
                              </TableCell>
                              <TableCell>
                                {preview.before.people.find(
                                  (b) => b.id === p.id,
                                )?.plannedMinutes ?? 0}{" "}
                                min
                              </TableCell>
                              <TableCell>{p.plannedMinutes} min</TableCell>
                            </TableRow>
                          ))}
                        </tbody>
                      </Table>
                      <Button
                        variant="solid"
                        disabled={busy}
                        onClick={() => void reassign(true)}
                      >
                        Confirmer la réaffectation
                      </Button>
                    </>
                  )}
                </>
              ) : (
                <p>
                  Définissez les porteurs et leurs poids dans Configuration →
                  Porteurs de charge pour prévisualiser une réaffectation.
                </p>
              )}
            </>
          ) : (
            <p className="muted">
              Lecture seule : modification de charge non autorisée.
            </p>
          )}
        </Peek>
      )}
    </section>
  );
}
