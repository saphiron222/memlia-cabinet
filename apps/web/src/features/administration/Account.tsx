import { PanelCard } from "../../upstream/cal/PanelCard";
import SettingsHeader from "../../upstream/cal/SettingsHeader";
import { ExportData } from "./ExportData";
import { useEffect, useState } from "react";
import { Button } from "@memlia/ui";
import { Field, Select, ErrorSummary } from "../../forms";
import { useAccountSettings } from "./preferences";
export function Account() {
  const { account, error, busy, save } = useAccountSettings(),
    [name, setName] = useState("");
  useEffect(() => {
    if (account) setName(account.profile.name);
  }, [account?.profile.name]);
  return (
    <section className="administration">
      <SettingsHeader
        title="Mon compte"
        description="Profil personnel et préférences du cabinet"
        borderInShellHeader={false}
        CTA={<a href="#notifications">Préférences de notifications</a>}
      >
        {null}
      </SettingsHeader>
      <ErrorSummary message={error || undefined} />
      {account ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save({ name });
          }}
        >
          <PanelCard title="Profil">
            <fieldset>
              <legend className="sr-only">Profil</legend>
              <p>{account.profile.email}</p>
              <Field
                name="account-name"
                label="Mon nom affiché"
                value={name}
                onChange={setName}
              />
              <Button type="submit" loading={busy}>
                Enregistrer mon nom
              </Button>
            </fieldset>
          </PanelCard>
          <PanelCard title="Apparence">
            <fieldset>
              <legend className="sr-only">Apparence</legend>
              <Select
                name="account-theme"
                label="Thème de l’interface"
                value={account.preferences.theme}
                disabled={busy}
                onChange={(v) =>
                  void save({ theme: v as "system" | "light" | "dark" })
                }
              >
                <option value="system">Préférence du système</option>
                <option value="light">Clair</option>
                <option value="dark">Sombre</option>
              </Select>
              <Select
                name="account-density"
                label="Densité des tableaux"
                value={account.preferences.density}
                disabled={busy}
                onChange={(v) =>
                  void save({ density: v as "normal" | "compact" })
                }
              >
                <option value="normal">Normale</option>
                <option value="compact">Compacte</option>
              </Select>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={account.preferences.sidebarCollapsed}
                  disabled={busy}
                  onChange={(e) =>
                    void save({ sidebarCollapsed: e.target.checked })
                  }
                />
                Navigation repliée
              </label>
              <p>
                Ces choix sont propres à votre compte et sont conservés après
                reconnexion.
              </p>
            </fieldset>
          </PanelCard>
        </form>
      ) : (
        <p role="status">Chargement de votre compte…</p>
      )}
      {account &&
        [
          ...account.profile.permissions,
          ...account.profile.scopedPermissions,
        ].some((p) => p.action === "export") && <ExportData />}
    </section>
  );
}
