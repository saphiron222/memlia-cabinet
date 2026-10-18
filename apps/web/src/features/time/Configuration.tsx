import { CatalogSelect, CatalogName, WeightEditor } from "./Catalog";
import { useEffect, useState } from "react";
import {
  TimeEntitySchema,
  TimeListSchema,
  TimeDataSchema,
  type TimeEntity,
  type TimeData,
} from "@memlia/contracts";
import { Button } from "@memlia/ui";
import { request, useScope, message } from "../../api";
import {
  Field,
  Select,
  ErrorSummary,
  validationErrors,
  type Errors,
} from "../../forms";
import {
  Table,
  TableRow,
  TableCell,
  TableHeader,
} from "../../upstream/twenty/Table";
import { PanelCard } from "../../upstream/cal/PanelCard";
import { Peek } from "../../interface/Peek";
import { LinkPicker, type Link, type Options } from "./shared";
import { z } from "zod";
const labels = {
  nature: "Natures",
  plan: "Prévisions et héritage",
  capacity: "Capacités journalières",
  rate: "Taux horaires",
  forfait: "Forfaits datés",
  assignment: "Affectations par rôle",
  allocation: "Porteurs de charge",
  period: "Périodes et verrouillage",
};
type Kind = keyof typeof labels;
export function describe(d: TimeData, options: Options) {
  switch (d.kind) {
    case "nature":
      return `${d.name} · ${d.active ? "active" : "inactive"}`;
    case "plan":
      return `${d.level === "cabinet" ? "Cabinet" : d.level === "dossier" ? "Dossier" : "Occurrence"} · ${d.minutes === null ? "Héritage rétabli" : d.minutes + " min"} · ${d.component === "fixed" ? "incluse au forfait" : "variable"}`;
    case "capacity":
      return (
        <>
          {d.userId ? <CatalogName kind="users" id={d.userId} /> : "Cabinet"} ·{" "}
          {d.dailyMinutes.join(" / ")} min
        </>
      );
    case "rate":
      return (
        <>
          {d.hourlyAmount} € / h ·{" "}
          {d.userId ? <CatalogName kind="users" id={d.userId} /> : "Cabinet"}
        </>
      );
    case "forfait":
      return (
        <>
          <CatalogName kind="roles" id={d.roleId} /> · {d.monthlyMinutes} min /
          mois · {d.amount} €
        </>
      );
    case "assignment":
      return (
        <>
          <CatalogName kind="users" id={d.userId} /> ·{" "}
          <CatalogName kind="roles" id={d.roleId} /> · poids {d.weight}
        </>
      );
    case "allocation":
      return (
        <>
          {d.weights.map((w) => (
            <span key={w.userId}>
              <CatalogName kind="users" id={w.userId} /> × {w.weight}{" "}
            </span>
          ))}
        </>
      );
    case "period":
      return d.closed ? "Verrouillée · " + d.reason : "Ouverte · " + d.reason;
    default:
      return d.kind;
  }
}
export function Configuration({
  options,
  from,
  onChanged,
}: {
  options: Options;
  from: string;
  onChanged: () => void;
}) {
  const signal = useScope(),
    [kind, setKind] = useState<Kind>("nature"),
    [items, setItems] = useState<TimeEntity[] | null>(null),
    [total, setTotal] = useState(0),
    [offset, setOffset] = useState(0),
    [editing, setEditing] = useState<TimeEntity | "new" | null>(null),
    [error, setError] = useState(""),
    [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setItems(null);
    void request(
      "/time/entities?" + new URLSearchParams({ kind, offset: String(offset) }),
      TimeListSchema,
      c.signal,
    )
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(message(e));
      });
    return () => c.abort();
  }, [kind, offset, epoch]);
  return (
    <div className="time-settings">
      <aside aria-label="Familles de configuration">
        {Object.entries(labels)
          .filter(([k]) =>
            k === "period" ? options.canLock : options.canManage,
          )
          .map(([k, label]) => (
            <Button
              key={k}
              variant={kind === k ? "solid" : "ghost"}
              onClick={() => {
                setKind(k as Kind);
                setOffset(0);
              }}
            >
              {label}
            </Button>
          ))}
      </aside>
      <PanelCard
        title={labels[kind]}
        subtitle="Configurations datées et versionnées. Les périodes clôturées conservent leurs valeurs."
        headerContent={
          <Button variant="solid" onClick={() => setEditing("new")}>
            Ajouter
          </Button>
        }
      >
        <ErrorSummary message={error} />
        {items ? (
          <>
            <div className="time-table-scroll">
              <Table aria-label={labels[kind]}>
                <thead>
                  <TableRow>
                    <TableHeader>Configuration</TableHeader>
                    <TableHeader>Application</TableHeader>
                    <TableHeader>Version</TableHeader>
                    <TableHeader>Action</TableHeader>
                  </TableRow>
                </thead>
                <tbody>
                  {items.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{describe(e.data, options)}</TableCell>
                      <TableCell>
                        {"from" in e.data
                          ? e.data.from + " → " + (e.data.to ?? "sans fin")
                          : "Courante"}
                      </TableCell>
                      <TableCell>v{e.version}</TableCell>
                      <TableCell>
                        <Button size="sm" onClick={() => setEditing(e)}>
                          Modifier
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            </div>
            {!items.length && (
              <p className="empty">Aucune configuration dans cette famille.</p>
            )}
            <div className="actions">
              <Button
                disabled={!offset}
                onClick={() => setOffset((v) => Math.max(0, v - 100))}
              >
                Précédentes
              </Button>
              <Button
                disabled={offset + 100 >= total}
                onClick={() => setOffset((v) => v + 100)}
              >
                Suivantes
              </Button>
            </div>
          </>
        ) : (
          <p role="status">Chargement…</p>
        )}
      </PanelCard>
      {editing && (
        <Peek
          label={
            editing === "new"
              ? "Ajouter une configuration"
              : "Modifier une configuration"
          }
          onClose={() => setEditing(null)}
        >
          <h2>{labels[kind]}</h2>
          <ConfigEditor
            kind={kind}
            options={options}
            from={from}
            existing={editing === "new" ? undefined : editing}
            onSaved={() => {
              setEditing(null);
              setEpoch((v) => v + 1);
              onChanged();
            }}
          />
        </Peek>
      )}
    </div>
  );
}
function ConfigEditor({
  kind,
  options,
  from,
  existing,
  onSaved,
}: {
  kind: Kind;
  options: Options;
  from: string;
  existing?: TimeEntity;
  onSaved: () => void;
}) {
  const signal = useScope(),
    d = existing?.data as Record<string, unknown> | undefined;
  const [v, setV] = useState<Record<string, string>>(() => ({
    name: String(d?.name ?? ""),
    active: String(d?.active ?? true),
    level: String(d?.level ?? "cabinet"),
    minutes: d?.minutes === null ? "" : String(d?.minutes ?? 120),
    component: String(d?.component ?? "variable"),
    userId: String(d?.userId ?? ""),
    from: String(d?.from ?? from),
    to: String(d?.to ?? ""),
    hourlyAmount: String(d?.hourlyAmount ?? "0.00"),
    roleId: String(d?.roleId ?? ""),
    activityStart: String(d?.activityStart ?? from),
    monthlyMinutes: String(d?.monthlyMinutes ?? 0),
    amount: String(d?.amount ?? "0.00"),
    prorating: String(d?.prorating ?? "calendar_days"),
    policyVersion: String(d?.policyVersion ?? 1),
    weight: String(d?.weight ?? 1),
    closed: String(d?.closed ?? true),
    reason: String(d?.reason ?? ""),
  }));
  const initialLink: Link = d?.target
    ? (d.target as Link)
    : d?.targetId
      ? {
          kind: d.level === "production" ? "production" : "record",
          id: String(d.targetId),
        }
      : d?.dossierId
        ? { kind: "record", id: String(d.dossierId) }
        : { kind: "free", label: "" };
  const [link, setLink] = useState<Link>(initialLink),
    [daily, setDaily] = useState<number[]>(
      (d?.dailyMinutes as number[]) ?? [420, 420, 420, 420, 420, 0, 0],
    ),
    [weights, setWeights] = useState<{ userId: string; weight: number }[]>(
      (d?.weights as { userId: string; weight: number }[]) ?? [],
    ),
    [errors, setErrors] = useState<Errors>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const set = (k: string, value: string) => setV((s) => ({ ...s, [k]: value }));
  const field = (k: string, label: string, type = "text", hint?: string) => (
    <Field
      name={"config-" + k}
      label={label}
      type={type}
      value={v[k] ?? ""}
      onChange={(value) => set(k, value)}
      hint={hint}
      errors={errors}
    />
  );
  const select = (k: string, label: string, items: [string, string][]) => (
    <Select
      name={"config-" + k}
      label={label}
      value={v[k] ?? ""}
      onChange={(value) => set(k, value)}
    >
      {items.map(([id, name]) => (
        <option value={id} key={id}>
          {name}
        </option>
      ))}
    </Select>
  );
  const personal = (
    <CatalogSelect
      kind="users"
      name="config-userId"
      label="Collaborateur"
      value={v.userId ?? ""}
      onChange={(id) => set("userId", id)}
      active
      empty="Horaire / taux du cabinet"
    />
  );
  const dateFields = (
    <div className="time-form-grid">
      {field("from", "Applicable à partir du", "date")}
      {field("to", "Jusqu’au (facultatif)", "date")}
    </div>
  );
  const role = (
    <CatalogSelect
      kind="roles"
      name="config-roleId"
      label="Rôle porteur"
      value={v.roleId ?? ""}
      onChange={(id) => set("roleId", id)}
    />
  );
  async function submit() {
    if (busy) return;
    setError("");
    setErrors({});
    const dated = { from: v.from, to: v.to || null };
    let data: unknown;
    switch (kind) {
      case "nature":
        data = { kind, name: v.name, active: v.active === "true" };
        break;
      case "plan":
        data = {
          kind,
          level: v.level,
          targetId:
            v.level === "cabinet"
              ? null
              : link.kind !== "free"
                ? link.id
                : null,
          minutes: v.minutes === "" ? null : Number(v.minutes),
          component: v.component,
        };
        break;
      case "capacity":
        data = {
          kind,
          ...dated,
          userId: v.userId || null,
          dailyMinutes: daily,
        };
        break;
      case "rate":
        data = {
          kind,
          ...dated,
          userId: v.userId || null,
          hourlyAmount: v.hourlyAmount,
          currency: "EUR",
        };
        break;
      case "forfait":
        data = {
          kind,
          ...dated,
          dossierId: link.kind !== "free" ? link.id : null,
          roleId: v.roleId,
          activityStart: v.activityStart,
          monthlyMinutes: Number(v.monthlyMinutes),
          amount: v.amount,
          currency: "EUR",
          prorating: v.prorating,
          policyVersion: Number(v.policyVersion),
        };
        break;
      case "assignment":
        data = {
          kind,
          ...dated,
          dossierId: link.kind !== "free" ? link.id : null,
          roleId: v.roleId,
          userId: v.userId,
          weight: Number(v.weight),
          policyVersion: Number(v.policyVersion),
        };
        break;
      case "allocation":
        data = {
          kind,
          ...dated,
          target: link,
          weights,
          policyVersion: Number(v.policyVersion),
        };
        break;
      case "period":
        data = {
          kind,
          from: v.from,
          to: v.to,
          closed: v.closed === "true",
          reason: v.reason,
        };
        break;
    }
    const parsed = TimeDataSchema.safeParse(data);
    if (!parsed.success) {
      setErrors(validationErrors(parsed.error));
      setError(
        "Vérifiez les champs requis, dates et valeurs. Les montants attendent deux décimales.",
      );
      return;
    }
    setBusy(true);
    try {
      await request("/time/entities", TimeEntitySchema, signal, {
        method: "POST",
        body: JSON.stringify({
          id: existing?.id ?? crypto.randomUUID(),
          expectedVersion: existing?.version ?? 0,
          operationId: crypto.randomUUID(),
          data: parsed.data,
        }),
      });
      window.dispatchEvent(new Event("memlia-time-settings"));
      onSaved();
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="time-config-form"
    >
      <ErrorSummary errors={errors} message={error} />
      {kind === "nature" && (
        <>
          {field("name", "Nom de la nature")}
          {select("active", "État", [
            ["true", "Active"],
            ["false", "Inactive — historique conservé"],
          ])}
        </>
      )}
      {kind === "plan" && (
        <>
          {select("level", "Niveau de prévision", [
            ["cabinet", "Cabinet"],
            ["dossier", "Dossier"],
            ["occurrence", "Tâche ou obligation"],
            ["production", "Production"],
          ])}
          {v.level !== "cabinet" && (
            <LinkPicker
              value={link}
              onChange={setLink}
              onlyDossier={v.level === "dossier"}
            />
          )}{" "}
          {field(
            "minutes",
            "Minutes prévues",
            "number",
            "Laisser vide pour revenir à l’héritage. Zéro est une prévision explicite.",
          )}
          {select("component", "Contribution", [
            ["variable", "Variable — ajoutée à la charge"],
            ["fixed", "Incluse dans le forfait — pas de seconde addition"],
          ])}
        </>
      )}
      {[
        "capacity",
        "rate",
        "forfait",
        "assignment",
        "allocation",
        "period",
      ].includes(kind) && dateFields}
      {["capacity", "rate", "assignment"].includes(kind) && personal}
      {kind === "capacity" && (
        <div className="time-week-hours">
          {[
            "Lundi",
            "Mardi",
            "Mercredi",
            "Jeudi",
            "Vendredi",
            "Samedi",
            "Dimanche",
          ].map((name, i) => (
            <Field
              key={name}
              name={"capacity-" + i}
              label={name + " (min)"}
              type="number"
              value={String(daily[i])}
              onChange={(value) =>
                setDaily((days) =>
                  days.map((n, j) => (j === i ? Number(value) : n)),
                )
              }
            />
          ))}
        </div>
      )}
      {kind === "rate" &&
        field(
          "hourlyAmount",
          "Taux horaire (€)",
          "text",
          "Montant exact, par exemple 99.99.",
        )}
      {["forfait", "assignment"].includes(kind) && (
        <>
          <LinkPicker value={link} onChange={setLink} onlyDossier />
          {role}
        </>
      )}
      {kind === "forfait" && (
        <>
          {field("activityStart", "Début d’activité", "date")}
          {field("monthlyMinutes", "Charge mensuelle en minutes", "number")}
          {field("amount", "Montant forfaitaire (€)")}
          {select("prorating", "Base de prorata", [
            ["calendar_days", "Jours calendaires du mois civil"],
            ["working_days", "Jours du lundi au vendredi du mois civil"],
          ])}
          <p className="muted">
            Choix du cabinet. Ce calcul ne constitue pas une règle fiscale.
          </p>
        </>
      )}
      {kind === "assignment" &&
        field(
          "weight",
          "Poids de répartition",
          "number",
          "Les poids du même rôle et de la même date sont normalisés ensemble.",
        )}
      {kind === "allocation" && (
        <>
          <LinkPicker value={link} onChange={setLink} />
          <fieldset>
            <legend>Poids explicites des porteurs</legend>
            <WeightEditor
              prefix="weight"
              weights={weights}
              onChange={setWeights}
            />
          </fieldset>
        </>
      )}
      {["forfait", "assignment", "allocation"].includes(kind) &&
        field("policyVersion", "Version de la règle du cabinet", "number")}
      {kind === "period" && (
        <>
          {select("closed", "État de la période", [
            ["true", "Verrouillée"],
            ["false", "Ouverte / réouverte"],
          ])}
          {field("reason", "Motif de clôture ou réouverture")}
        </>
      )}
      <div className="actions time-sticky-actions">
        <Button type="submit" variant="solid" disabled={busy}>
          Enregistrer la configuration
        </Button>
      </div>
    </form>
  );
}
