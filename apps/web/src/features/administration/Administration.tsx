import { Installation } from "./Installation";
import { CustomFieldAdministration } from "./CustomFieldAdministration";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button, Loader } from "@memlia/ui";
import {
  ActionSchema,
  PermissionSchema,
  RoleSchema,
  RoleListSchema,
  GroupSchema,
  GroupListSchema,
  AdministrationUserSchema,
  AdministrationUserListSchema,
  SessionUserSchema,
  AssignmentListSchema,
  AssignmentResultSchema,
  RecordListSchema,
  type Role,
  type Group,
  type SessionUser,
} from "@memlia/contracts";
import { request, useScope, message } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
type AdminUser = z.infer<typeof AdministrationUserSchema>;
type Permission = z.infer<typeof PermissionSchema>;
const actionLabels: Record<Permission["action"], string> = {
  read: "Consulter",
  create: "Créer",
  update: "Modifier",
  transition: "Changer l’étape",
  assign: "Affecter",
  approve: "Approuver",
  export: "Exporter",
  audit: "Consulter l’historique",
  confidential: "Consulter le confidentiel",
  manage_users: "Administrer les utilisateurs",
};
function Permissions({
  value,
  onChange,
}: {
  value: Permission[];
  onChange: (p: Permission[]) => void;
}) {
  const [action, setAction] = useState<Permission["action"]>("read"),
    [kind, setKind] = useState<Permission["kind"]>("*");
  return (
    <fieldset>
      <legend>Permissions explicites</legend>
      <ul>
        {value.map((p, i) => (
          <li key={i}>
            {actionLabels[p.action]} ·{" "}
            {p.kind === "*" ? "Toutes les ressources" : p.kind}
            {p.dossierId ? ` · Dossier ${p.dossierId}` : ""}{" "}
            <Button
              size="sm"
              type="button"
              onClick={() => onChange(value.filter((_, n) => n !== i))}
              aria-label={`Retirer ${actionLabels[p.action]} ${p.kind}`}
            >
              Retirer
            </Button>
          </li>
        ))}
      </ul>
      <div className="admin-inline">
        <Select
          name="permission-action"
          label="Action"
          value={action}
          onChange={(v) => setAction(v as Permission["action"])}
        >
          {ActionSchema.options.map((a) => (
            <option key={a} value={a}>
              {actionLabels[a]}
            </option>
          ))}
        </Select>
        <Select
          name="permission-kind"
          label="Ressource"
          value={kind}
          onChange={(v) => setKind(v as Permission["kind"])}
        >
          {["*", "dossier", "contact", "tache", "obligation"].map((k) => (
            <option key={k} value={k}>
              {k === "*" ? "Toutes" : k}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          onClick={() => {
            if (
              !value.some(
                (p) =>
                  p.action === action &&
                  p.kind === kind &&
                  p.dossierId === null,
              )
            )
              onChange([...value, { action, kind, dossierId: null }]);
          }}
        >
          Ajouter la permission
        </Button>
      </div>
    </fieldset>
  );
}
export function Administration({ user }: { user: SessionUser }) {
  const signal = useScope();
  const [tab, setTab] = useState<
      "roles" | "groups" | "users" | "assignments" | "fields" | "installation"
    >("roles"),
    [roles, setRoles] = useState<Role[]>([]),
    [groups, setGroups] = useState<Group[]>([]),
    [users, setUsers] = useState<AdminUser[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const [role, setRole] = useState<Partial<Role>>({
      name: "",
      order: 0,
      permissions: [],
    }),
    [group, setGroup] = useState<Partial<Group>>({
      kind: "team",
      name: "",
      memberIds: [],
    }),
    [editUser, setEditUser] = useState<AdminUser | null>(null),
    [newUser, setNewUser] = useState({ name: "", email: "", password: "" });
  const manager = user.permissions.some(
    (p) =>
      p.action === "manage_users" && p.kind === "*" && p.dossierId === null,
  );
  async function load() {
    setError("");
    setLoading(true);
    try {
      const [r, g, u] = await Promise.all([
        request("/administration/roles", RoleListSchema, signal),
        request("/administration/groups", GroupListSchema, signal),
        request("/administration/users", AdministrationUserListSchema, signal),
      ]);
      setRoles(r.items);
      setGroups(g.items);
      setUsers(u.items);
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    if (manager) void load();
    else setLoading(false);
  }, [revision]);
  async function save(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      setNotice(
        "Configuration enregistrée. Les droits prennent effet à la prochaine commande.",
      );
      setRevision((v) => v + 1);
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="administration">
      <p className="muted">
        Les rôles globaux et les affectations de dossiers accordent uniquement
        les permissions choisies.
      </p>
      <ErrorSummary message={error || undefined} />
      {notice && <p role="status">{notice}</p>}
      {manager ? (
        <>
          <div className="toolbar" aria-label="Administration">
            {(
              [
                ["roles", "Rôles"],
                ["fields", "Champs personnalisés"],
                ["installation", "Installation et capacités"],
                ["groups", "Équipes et sites"],
                ["users", "Utilisateurs"],
                ["assignments", "Affectations"],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                variant={tab === key ? "solid" : "ghost"}
                onClick={() => {
                  setTab(key);
                  setNotice("");
                  setError("");
                }}
              >
                {label}
              </Button>
            ))}
            <Button onClick={() => setRevision((v) => v + 1)}>Recharger</Button>
          </div>
          {loading ? (
            <div role="status">
              <Loader /> Chargement de l’administration…
            </div>
          ) : (
            <>
              {tab === "fields" && <CustomFieldAdministration />}
              {tab === "installation" && <Installation />}
              {tab === "roles" && (
                <div className="admin-layout">
                  <div>
                    <h2>Rôles ordonnés</h2>
                    {!roles.length && <p>Aucun rôle enregistré.</p>}
                    {roles.map((r) => (
                      <Button key={r.id} onClick={() => setRole(r)}>
                        {r.order} · {r.name}
                      </Button>
                    ))}
                    <Button
                      onClick={() =>
                        setRole({ name: "", order: 0, permissions: [] })
                      }
                    >
                      Nouveau rôle
                    </Button>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void save(async () => {
                        const result = await request(
                          `/administration/roles${role.id ? "/" + role.id : ""}`,
                          RoleSchema,
                          signal,
                          {
                            method: role.id ? "PUT" : "POST",
                            body: JSON.stringify({
                              operationId: crypto.randomUUID(),
                              expectedVersion: role.version,
                              name: role.name,
                              order: role.order,
                              permissions: role.permissions,
                            }),
                          },
                        );
                        setRole(result);
                      });
                    }}
                  >
                    <h2>{role.id ? "Modifier le rôle" : "Créer un rôle"}</h2>
                    <Field
                      name="role-name"
                      label="Nom du rôle"
                      value={role.name ?? ""}
                      onChange={(name) => setRole({ ...role, name })}
                      required
                    />
                    <Field
                      name="role-order"
                      label="Ordre"
                      type="number"
                      value={String(role.order ?? 0)}
                      onChange={(v) => setRole({ ...role, order: Number(v) })}
                    />
                    <Permissions
                      value={role.permissions ?? []}
                      onChange={(permissions) =>
                        setRole({ ...role, permissions })
                      }
                    />
                    <Button type="submit" loading={busy}>
                      Enregistrer le rôle
                    </Button>
                  </form>
                </div>
              )}
              {tab === "groups" && (
                <div className="admin-layout">
                  <div>
                    <h2>Équipes et sites</h2>
                    {!groups.length && <p>Aucun groupe enregistré.</p>}
                    {groups.map((g) => (
                      <Button key={g.id} onClick={() => setGroup(g)}>
                        {g.kind === "team" ? "Équipe" : "Site"} · {g.name}
                      </Button>
                    ))}
                    <Button
                      onClick={() =>
                        setGroup({ kind: "team", name: "", memberIds: [] })
                      }
                    >
                      Nouveau groupe
                    </Button>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void save(async () =>
                        setGroup(
                          await request(
                            `/administration/groups${group.id ? "/" + group.id : ""}`,
                            GroupSchema,
                            signal,
                            {
                              method: group.id ? "PUT" : "POST",
                              body: JSON.stringify({
                                operationId: crypto.randomUUID(),
                                expectedVersion: group.version,
                                name: group.name,
                                kind: group.kind,
                                memberIds: group.memberIds,
                              }),
                            },
                          ),
                        ),
                      );
                    }}
                  >
                    <h2>
                      {group.id ? "Modifier le groupe" : "Créer un groupe"}
                    </h2>
                    <Select
                      name="group-kind"
                      label="Type de groupe"
                      value={group.kind ?? "team"}
                      disabled={Boolean(group.id)}
                      onChange={(kind) =>
                        setGroup({ ...group, kind: kind as Group["kind"] })
                      }
                    >
                      <option value="team">Équipe</option>
                      <option value="site">Site</option>
                    </Select>
                    <Field
                      name="group-name"
                      label="Nom du groupe"
                      value={group.name ?? ""}
                      onChange={(name) => setGroup({ ...group, name })}
                      required
                    />
                    <fieldset>
                      <legend>Membres</legend>
                      {users.map((u) => (
                        <label className="check-row" key={u.id}>
                          <input
                            type="checkbox"
                            checked={group.memberIds?.includes(u.id) ?? false}
                            onChange={(e) =>
                              setGroup({
                                ...group,
                                memberIds: e.target.checked
                                  ? [...(group.memberIds ?? []), u.id]
                                  : (group.memberIds ?? []).filter(
                                      (id) => id !== u.id,
                                    ),
                              })
                            }
                          />
                          {u.name}
                          {u.active ? "" : " (inactif)"}
                        </label>
                      ))}
                    </fieldset>
                    <p className="muted">
                      Être membre ne donne aucun accès sans affectation
                      explicite à un dossier.
                    </p>
                    <Button type="submit" loading={busy}>
                      Enregistrer le groupe
                    </Button>
                  </form>
                </div>
              )}
              {tab === "users" && (
                <div className="admin-layout">
                  <div>
                    <h2>Utilisateurs</h2>
                    {users.map((u) => (
                      <Button key={u.id} onClick={() => setEditUser(u)}>
                        {u.name}
                        {u.active ? "" : " · Inactif"}
                      </Button>
                    ))}
                    <Button
                      onClick={() => {
                        setEditUser(null);
                        setNewUser({ name: "", email: "", password: "" });
                      }}
                    >
                      Nouvel utilisateur
                    </Button>
                  </div>
                  {editUser ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void save(async () =>
                          setEditUser(
                            await request(
                              `/administration/users/${editUser.id}`,
                              AdministrationUserSchema,
                              signal,
                              {
                                method: "PUT",
                                body: JSON.stringify({
                                  operationId: crypto.randomUUID(),
                                  expectedVersion: editUser.version,
                                  name: editUser.name,
                                  active: editUser.active,
                                  permissions: editUser.directPermissions,
                                  roleIds: editUser.roleIds,
                                }),
                              },
                            ),
                          ),
                        );
                      }}
                    >
                      <h2>Modifier l’utilisateur</h2>
                      <Field
                        name="user-name"
                        label="Nom de l’utilisateur"
                        value={editUser.name}
                        onChange={(name) => setEditUser({ ...editUser, name })}
                      />
                      <p>{editUser.email}</p>
                      <label className="check-row">
                        <input
                          type="checkbox"
                          checked={editUser.active}
                          onChange={(e) =>
                            setEditUser({
                              ...editUser,
                              active: e.target.checked,
                            })
                          }
                        />
                        Accès actif
                      </label>
                      <fieldset>
                        <legend>Rôles globaux</legend>
                        {roles.map((r) => (
                          <label className="check-row" key={r.id}>
                            <input
                              type="checkbox"
                              checked={editUser.roleIds.includes(r.id)}
                              onChange={(e) =>
                                setEditUser({
                                  ...editUser,
                                  roleIds: e.target.checked
                                    ? [...editUser.roleIds, r.id]
                                    : editUser.roleIds.filter(
                                        (id) => id !== r.id,
                                      ),
                                })
                              }
                            />
                            {r.name}
                          </label>
                        ))}
                      </fieldset>
                      <Permissions
                        value={editUser.directPermissions}
                        onChange={(directPermissions) =>
                          setEditUser({ ...editUser, directPermissions })
                        }
                      />
                      <Button type="submit" loading={busy}>
                        Enregistrer l’utilisateur
                      </Button>
                    </form>
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void save(async () => {
                          await request("/users", SessionUserSchema, signal, {
                            method: "POST",
                            body: JSON.stringify({
                              ...newUser,
                              permissions: [],
                              operationId: crypto.randomUUID(),
                            }),
                          });
                          setNewUser({ name: "", email: "", password: "" });
                        });
                      }}
                    >
                      <h2>Créer un utilisateur</h2>
                      <Field
                        name="new-name"
                        label="Nom de l’utilisateur"
                        value={newUser.name}
                        onChange={(name) => setNewUser({ ...newUser, name })}
                      />
                      <Field
                        name="new-email"
                        label="Email de l’utilisateur"
                        type="email"
                        value={newUser.email}
                        onChange={(email) => setNewUser({ ...newUser, email })}
                      />
                      <Field
                        name="new-password"
                        label="Mot de passe initial"
                        type="password"
                        value={newUser.password}
                        onChange={(password) =>
                          setNewUser({ ...newUser, password })
                        }
                        hint="12 caractères minimum. Ajoutez ensuite les droits et affectations."
                      />
                      <Button type="submit" loading={busy}>
                        Créer l’utilisateur
                      </Button>
                    </form>
                  )}
                </div>
              )}
              {tab === "assignments" && (
                <Assignments roles={roles} groups={groups} users={users} />
              )}
            </>
          )}
        </>
      ) : (
        <p>Administration réservée aux utilisateurs autorisés.</p>
      )}
    </section>
  );
}
function Assignments({
  roles,
  groups,
  users,
}: {
  roles: Role[];
  groups: Group[];
  users: AdminUser[];
}) {
  const signal = useScope(),
    [dossiers, setDossiers] = useState<
      z.infer<typeof RecordListSchema>["items"]
    >([]),
    [q, setQ] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [previews, setPreviews] = useState<
      Record<string, z.infer<typeof AssignmentListSchema>>
    >({}),
    [subject, setSubject] = useState(""),
    [roleId, setRoleId] = useState(""),
    [remove, setRemove] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<z.infer<
      typeof AssignmentResultSchema
    > | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void request(
      "/records?kind=dossier&limit=200&q=" + encodeURIComponent(q),
      RecordListSchema,
      controller.signal,
    )
      .then((r) => setDossiers(r.items))
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [q]);
  async function commit() {
    setBusy(true);
    setError("");
    try {
      const [kind, id] = subject.split(":");
      const rows = selected.map((dossierId) => ({
        dossierId,
        expectedVersion: previews[dossierId]!.version,
        subject: { kind, id },
        roleId,
        remove,
      }));
      setResult(
        await request(
          "/administration/assignments",
          AssignmentResultSchema,
          signal,
          {
            method: "POST",
            body: JSON.stringify({ operationId: crypto.randomUUID(), rows }),
          },
        ),
      );
      setSelected([]);
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
        void commit();
      }}
    >
      <h2>Affectations par dossier</h2>
      <ErrorSummary message={error || undefined} />
      <Field
        name="assignment-search"
        label="Rechercher les dossiers à affecter"
        value={q}
        onChange={setQ}
      />
      <fieldset>
        <legend>Dossiers (200 résultats maximum, affinez la recherche)</legend>
        {dossiers.map((d) => (
          <label className="check-row" key={d.id}>
            <input
              type="checkbox"
              checked={selected.includes(d.id)}
              disabled={busy}
              onChange={async (e) => {
                if (!e.target.checked) {
                  setSelected((ids) => ids.filter((id) => id !== d.id));
                  return;
                }
                setSelected((ids) => [...ids, d.id]);
                setBusy(true);
                setError("");
                try {
                  const preview = await request(
                    "/administration/assignments/" + d.id,
                    AssignmentListSchema,
                    signal,
                  );
                  setPreviews((p) => ({ ...p, [d.id]: preview }));
                } catch (e) {
                  setSelected((ids) => ids.filter((id) => id !== d.id));
                  if (!signal.aborted) setError(message(e));
                } finally {
                  if (!signal.aborted) setBusy(false);
                }
              }}
            />
            {d.title}
          </label>
        ))}
      </fieldset>
      {selected.map((id) => (
        <p key={id}>
          Affectations actuelles de{" "}
          {dossiers.find((d) => d.id === id)?.title ?? "la sélection"} :{" "}
          {previews[id]?.items
            .map((a) => roles.find((r) => r.id === a.roleId)?.name ?? "Rôle")
            .join(", ") || "aucune"}
        </p>
      ))}
      <Select
        name="assignment-subject"
        label="Utilisateur, équipe ou site"
        value={subject}
        onChange={setSubject}
      >
        <option value="">Choisir…</option>
        {users
          .filter((u) => u.active)
          .map((u) => (
            <option key={u.id} value={"user:" + u.id}>
              {u.name}
            </option>
          ))}
        {groups.map((g) => (
          <option key={g.id} value={g.kind + ":" + g.id}>
            {g.kind === "team" ? "Équipe" : "Site"} · {g.name}
          </option>
        ))}
      </Select>
      <Select
        name="assignment-role"
        label="Rôle sur les dossiers"
        value={roleId}
        onChange={setRoleId}
      >
        <option value="">Choisir…</option>
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>
      <label className="check-row">
        <input
          type="checkbox"
          checked={remove}
          onChange={(e) => setRemove(e.target.checked)}
        />
        Retirer cette affectation
      </label>
      <Button
        type="submit"
        disabled={busy || !selected.length || !subject || !roleId}
        loading={busy}
      >
        Appliquer aux dossiers choisis
      </Button>
      {result && (
        <ul aria-label="Rapport des affectations">
          {result.items.map((r) => (
            <li key={r.dossierId}>
              {dossiers.find((d) => d.id === r.dossierId)?.title ??
                "Dossier demandé"}{" "}
              :{" "}
              {
                {
                  assigned: "affecté",
                  removed: "retiré",
                  refused: "refusé",
                  conflict: "conflit — rechargez",
                  invalid: "valeurs invalides",
                }[r.status]
              }
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
