import { Relationship } from "./features/relationship/Relationship";
import { Time } from "./features/time/Time";
import AuthContainer from "./upstream/cal/AuthContainer";
import { AppHeader as PlaneAppHeader } from "./upstream/plane/app-header";
import { Navigation, pageContext } from "./interface/Navigation";
import { Production } from "./features/production/Production";
import { Workflows } from "./features/workflows/Workflows";
import { Notifications } from "./features/workflows/Notifications";
import { Fiscal } from "./features/fiscal/Fiscal";
import { Account } from "./features/administration/Account";
import {
  useAccountSettings,
  useInstallation,
} from "./features/administration/preferences";
import { Imports } from "./features/imports/Imports";
import { Administration } from "./features/administration/Administration";
import { Collections } from "./Collections";
import { Documents } from "./Documents";
import { Home, Records } from "./RecordScreens";
import { useEffect, useState, useRef } from "react";
import { z } from "zod";
import { Button, Loader } from "@memlia/ui";
import {
  IconHome,
  IconBuilding,
  IconUsers,
  IconCheckbox,
  IconCalendar,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconSun,
  IconMoon,
  IconLogout,
  IconDownload,
} from "@tabler/icons-react";
import {
  SetupStatusSchema,
  SessionSchema,
  SetupInputSchema,
  LoginInputSchema,
  type RecordKind,
  type SessionUser,
} from "@memlia/contracts";
import { request, useScope, message } from "./api";
import { Field, ErrorSummary, validationErrors, type Errors } from "./forms";
import { labels } from "./RecordLabels";
type Setup = z.infer<typeof SetupStatusSchema>;
export function App() {
  const signal = useScope();
  const [setup, setSetup] = useState<Setup | null>(null),
    [user, setUser] = useState<SessionUser | null>(null),
    [ready, setReady] = useState(false),
    [fault, setFault] = useState(""),
    [epoch, setEpoch] = useState(0);
  async function start() {
    setFault("");
    try {
      const status = await request("/setup", SetupStatusSchema, signal);
      setSetup(status);
      setUser((await request("/session", SessionSchema, signal)).user);
      setReady(true);
    } catch (e) {
      if (!signal.aborted) setFault(message(e));
    }
  }
  useEffect(() => {
    void start();
    const expired = () => {
      setUser(null);
      setEpoch((v) => v + 1);
      setFault("Votre session a expiré. Reconnectez-vous.");
    };
    window.addEventListener("memlia-session-expired", expired);
    return () => window.removeEventListener("memlia-session-expired", expired);
  }, []);
  if (!ready)
    return (
      <AuthContainer>
        <h1>Memlia Cabinet</h1>
        {fault ? (
          <>
            <ErrorSummary message={fault} />
            <Button onClick={() => void start()}>Réessayer</Button>
          </>
        ) : (
          <div role="status">
            <Loader /> Chargement du cabinet…
          </div>
        )}
      </AuthContainer>
    );
  if (!user)
    return (
      <Auth
        key={epoch}
        setup={setup!}
        fault={fault}
        onUser={(user) => {
          setUser(user);
          setSetup({ needsSetup: false, requiresToken: false });
          setFault("");
        }}
      />
    );
  return (
    <Cabinet
      key={user.id + "-" + epoch}
      user={user}
      onLogout={() => {
        setUser(null);
        setEpoch((v) => v + 1);
      }}
    />
  );
}
function Auth({
  setup,
  fault,
  onUser,
}: {
  setup: Setup;
  fault: string;
  onUser: (u: SessionUser) => void;
}) {
  const signal = useScope();
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [token, setToken] = useState(""),
    [errors, setErrors] = useState<Errors>({}),
    [error, setError] = useState(fault),
    [busy, setBusy] = useState(false);
  async function submit() {
    setErrors({});
    setError("");
    const result = setup.needsSetup
      ? SetupInputSchema.safeParse({ name, email, password })
      : LoginInputSchema.safeParse({ email, password });
    if (!result.success) {
      setErrors(validationErrors(result.error));
      return;
    }
    if (setup.needsSetup && setup.requiresToken && !token) {
      setErrors({
        bootstrap: "Le jeton fourni par votre administrateur est requis.",
      });
      return;
    }
    setBusy(true);
    try {
      const session = await request(
        setup.needsSetup ? "/setup" : "/login",
        SessionSchema,
        signal,
        {
          method: "POST",
          headers:
            setup.needsSetup && setup.requiresToken
              ? { "X-Bootstrap-Token": token }
              : {},
          body: JSON.stringify(result.data),
        },
      );
      setToken("");
      setPassword("");
      if (session.user) onUser(session.user);
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <AuthContainer>
      <div className="brand-mark">m</div>
      <h1>
        {setup.needsSetup ? "Installer Memlia Cabinet" : "Connexion au cabinet"}
      </h1>
      <p>
        {setup.needsSetup
          ? "Créez le premier accès personnel du cabinet."
          : "Retrouvez les dossiers et le travail de votre équipe."}
      </p>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <ErrorSummary errors={errors} message={error || undefined} />
        {setup.needsSetup && (
          <Field
            name="name"
            label="Nom complet"
            value={name}
            onChange={setName}
            errors={errors}
            required
          />
        )}
        <Field
          name="email"
          label="Adresse email"
          type="email"
          value={email}
          onChange={setEmail}
          errors={errors}
          required
        />
        <Field
          name="password"
          label="Mot de passe"
          type="password"
          value={password}
          onChange={setPassword}
          errors={errors}
          required
          hint={setup.needsSetup ? "12 caractères minimum." : undefined}
        />
        {setup.needsSetup && setup.requiresToken && (
          <Field
            name="bootstrap"
            label="Jeton local d’installation"
            type="password"
            value={token}
            onChange={setToken}
            errors={errors}
            required
            hint="Fourni par votre administrateur, utilisé uniquement pour cette installation."
          />
        )}
        <Button type="submit" variant="solid" fullWidth loading={busy}>
          {setup.needsSetup ? "Créer le cabinet" : "Se connecter"}
        </Button>
      </form>
    </AuthContainer>
  );
}
type Page =
  | "relationship"
  | "temps"
  | "temps-cabinet"
  | "charge"
  | "production"
  | "calendrier"
  | "notifications"
  | "fiscal"
  | "compte"
  | "imports"
  | "administration"
  | "accueil"
  | "documents"
  | "collectes"
  | RecordKind;
const icons = {
  relationship: IconUsers,
  temps: IconCalendar,
  "temps-cabinet": IconCalendar,
  charge: IconCalendar,
  production: IconCheckbox,
  calendrier: IconCalendar,
  notifications: IconCheckbox,
  fiscal: IconCalendar,
  compte: IconUsers,
  imports: IconDownload,
  administration: IconUsers,
  collectes: IconDownload,
  documents: IconDownload,
  accueil: IconHome,
  dossier: IconBuilding,
  contact: IconUsers,
  tache: IconCheckbox,
  obligation: IconCalendar,
};
function route(): Page {
  const hash = location.hash.slice(1).split("?")[0];
  return [
    "relationship",
    "temps",
    "temps-cabinet",
    "charge",
    "production",
    "calendrier",
    "notifications",
    "fiscal",
    "dossier",
    "contact",
    "tache",
    "obligation",
    "documents",
    "collectes",
    "compte",
    "imports",
    "administration",
  ].includes(hash)
    ? (hash as Page)
    : "accueil";
}
function Cabinet({
  user,
  onLogout,
}: {
  user: SessionUser;
  onLogout: () => void;
}) {
  const signal = useScope();
  const {
    account,
    error: accountError,
    busy: settingsBusy,
    save: saveSettings,
  } = useAccountSettings();
  const { info: installation } = useInstallation();
  const [page, setPage] = useState<Page>(route),
    [hash, setHash] = useState(location.hash),
    [sidebarWidth, setSidebarWidth] = useState(250),
    [systemDark, setSystemDark] = useState(
      () => matchMedia("(prefers-color-scheme: dark)").matches,
    ),
    [fault, setFault] = useState("");
  const theme =
    account?.preferences.theme === "system"
      ? systemDark
        ? "dark"
        : "light"
      : (account?.preferences.theme ?? "light");
  const collapsed = account?.preferences.sidebarCollapsed ?? false;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const change = () => {
      setPage(route());
      setHash(location.hash);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)"),
      change = () => setSystemDark(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    document.documentElement.className = theme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.density =
      account?.preferences.density ?? "normal";
  }, [theme, account?.preferences.density]);
  useEffect(() => {
    heading.current?.focus();
  }, [page]);
  return (
    <div
      className={"shell plane-shell" + (collapsed ? " collapsed" : "")}
      style={{
        gridTemplateColumns: `${collapsed ? 0 : sidebarWidth}px minmax(0,1fr)`,
      }}
    >
      <a
        href="#main"
        className="skip"
        onClick={(e) => {
          e.preventDefault();
          heading.current?.focus();
        }}
      >
        Aller au contenu
      </a>
      <Navigation
        timeCabinet={user.permissions.some(
          (p) =>
            p.action === "time_read" && p.kind === "*" && p.dossierId === null,
        )}
        hash={hash}
        collapsed={collapsed}
        toggle={() => void saveSettings({ sidebarCollapsed: !collapsed })}
        disabled={settingsBusy || !account}
        onWidthChange={setSidebarWidth}
        footer={
          <div className="plane-sidebar-footer">
            {!collapsed && (
              <div className="user-name" title={user.email}>
                {account?.profile.name ?? user.name}
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              aria-label={
                theme === "light"
                  ? "Activer le thème sombre"
                  : "Activer le thème clair"
              }
              disabled={settingsBusy || !account}
              onClick={() =>
                void saveSettings({
                  theme: theme === "light" ? "dark" : "light",
                })
              }
            >
              {theme === "light" ? (
                <IconMoon size={16} />
              ) : (
                <IconSun size={16} />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Se déconnecter"
              onClick={async () => {
                try {
                  await request("/logout", SessionSchema, signal, {
                    method: "POST",
                    body: "{}",
                  });
                  onLogout();
                } catch (e) {
                  if (!signal.aborted) setFault(message(e));
                }
              }}
            >
              <IconLogout size={16} />
            </Button>
            <a href="/licenses/source.tar.gz" className="source-link">
              Code source · licences
            </a>
          </div>
        }
      />
      <main id="main" className="main">
        <PlaneAppHeader
          className="plane-header"
          sidebarCollapsed={collapsed}
          toggleSidebar={() =>
            void saveSettings({ sidebarCollapsed: !collapsed })
          }
          header={
            <header className="app-header">
              {collapsed && (
                <a
                  href="/licenses/source.tar.gz"
                  className="source-link"
                  aria-label="Code source et licences"
                >
                  Code source · licences
                </a>
              )}
              <span className="breadcrumb-context">
                {pageContext(page)} <span aria-hidden> / </span>
              </span>
              <h1 ref={heading} tabIndex={-1}>
                {page === "relationship" ? "Relation client" : page === "temps"
                  ? "Mes temps"
                  : page === "temps-cabinet"
                    ? "Temps du cabinet"
                    : page === "charge"
                      ? "Plan de charge"
                      : page === "production"
                        ? "Production"
                        : page === "calendrier"
                          ? "Calendrier"
                          : page === "notifications"
                            ? "Notifications"
                            : page === "fiscal"
                              ? "Fiscalité"
                              : page === "compte"
                                ? "Mon compte"
                                : page === "imports"
                                  ? "Reprise"
                                  : page === "administration"
                                    ? "Administration"
                                    : page === "accueil"
                                      ? "Accueil"
                                      : page === "documents"
                                        ? "Documents"
                                        : page === "collectes"
                                          ? "Collectes"
                                          : labels[page]}
              </h1>
              <span className="muted">
                {installation?.name ?? "Cabinet partagé"}
              </span>
            </header>
          }
        />
        <ErrorSummary message={fault || accountError || undefined} />
        {page === "relationship" ? <Relationship user={user}/> : page === "temps" || page === "temps-cabinet" || page === "charge" ? (
          <Time key={page} user={user} mode={page} />
        ) : page === "production" ? (
          <Production user={user} />
        ) : page === "tache" || page === "calendrier" ? (
          <Workflows key={page} user={user} calendar={page === "calendrier"} />
        ) : page === "notifications" ? (
          <Notifications />
        ) : page === "fiscal" ? (
          <div className="fiscal-workspace">
            <Fiscal />
          </div>
        ) : page === "compte" ? (
          <Account />
        ) : page === "imports" ? (
          <Imports />
        ) : page === "administration" ? (
          <Administration user={user} />
        ) : page === "accueil" ? (
          <Home key={page} />
        ) : page === "collectes" ? (
          <Collections user={user} />
        ) : page === "documents" ? (
          <Documents user={user} />
        ) : (
          <Records key={page} kind={page} user={user} />
        )}
      </main>
    </div>
  );
}
