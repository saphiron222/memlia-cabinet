import { useEffect, useState } from "react";
import { Button } from "@memlia/ui";
import { InstallationSchema, type ModuleId } from "@memlia/contracts";
import { request, useScope, message } from "../../api";
import { Field, ErrorSummary } from "../../forms";
import { useInstallation } from "./preferences";
export function Installation() {
  const signal = useScope(),
    { info, error: readError, reload } = useInstallation(),
    [name, setName] = useState(""),
    [enabled, setEnabled] = useState<ModuleId[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    if (info) {
      setName(info.name);
      setEnabled(info.enabledModules);
    }
  }, [info?.version]);
  async function save() {
    if (!info) return;
    setBusy(true);
    setError("");
    try {
      await request(
        "/administration/installation",
        InstallationSchema,
        signal,
        {
          method: "PUT",
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            expectedVersion: info.version,
            name,
            enabledModules: enabled,
          }),
        },
      );
      await reload();
      window.dispatchEvent(new Event("memlia-modules-updated"));
      setNotice(
        "Paramètres appliqués. Les opérations suivantes recontrôlent les capacités activées.",
      );
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <section>
      <h2>Installation et capacités</h2>
      <ErrorSummary message={error || readError || undefined} />
      {notice && <p role="status">{notice}</p>}
      {info ? (
        <>
          <p>
            Installation locale · version {info.applicationVersion} · identité{" "}
            {info.id}
          </p>
          <p>
            Jour métier du cabinet : {info.cabinetTimeZone}. Ce fuseau est
            conservé dans la configuration locale d’exploitation.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field
              name="installation-name"
              label="Nom du cabinet"
              value={name}
              onChange={setName}
            />
            {info.modules.map((m) => (
              <section key={m.id}>
                <h3>{m.label}</h3>
                <p>
                  {m.availability === "available"
                    ? "Disponible localement"
                    : "À construire"}{" "}
                  ·{" "}
                  {m.connection === "simulation_only"
                    ? "Source simulée uniquement"
                    : m.connection === "not_connected"
                      ? "Aucun fournisseur connecté"
                      : "Sans connexion de compte fournisseur"}{" "}
                  · {m.usable ? "Utilisable" : "Non utilisable"}
                </p>
                <p>{m.impact}</p>
                {m.availability === "available" && (
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={enabled.includes(m.id as ModuleId)}
                      disabled={busy}
                      onChange={(e) =>
                        setEnabled(
                          e.target.checked
                            ? [...enabled, m.id as ModuleId]
                            : enabled.filter((v) => v !== m.id),
                        )
                      }
                    />
                    Activer {m.label}
                  </label>
                )}
              </section>
            ))}
            <Button type="submit" loading={busy}>
              Appliquer les capacités du cabinet
            </Button>
          </form>
          <h3>Consommation mesurée</h3>
          {info.usage ? (
            <dl>
              <dt>Objets conservés</dt>
              <dd>{info.usage.records}</dd>
              <dt>Versions de pièces référencées</dt>
              <dd>{info.usage.documents}</dd>
              <dt>Octets des originaux référencés</dt>
              <dd>{info.usage.documentBytes}</dd>
              <dt>Utilisateurs</dt>
              <dd>{info.usage.users}</dd>
              <dt>Traitements en attente ou actifs</dt>
              <dd>{info.usage.pendingJobs}</dd>
            </dl>
          ) : (
            <p>Mesures globales réservées à l’administration.</p>
          )}
          <h3>Documents commerciaux</h3>
          {info.commercialDocuments.length ? (
            info.commercialDocuments.map((d) => (
              <p key={d.url}>
                <a href={d.url}>{d.title}</a> · {d.origin}
              </p>
            ))
          ) : (
            <p>
              Aucun document commercial fourni pour cette installation. Aucun
              abonnement cloud ni moyen de paiement n’est requis pour démarrer.
            </p>
          )}
        </>
      ) : (
        <p role="status">Chargement de l’installation…</p>
      )}
    </section>
  );
}
