import { useEffect, useState } from "react";
import { Button } from "@memlia/ui";
import {
  ExportRunSchema,
  ExportListSchema,
  ExportManifestSchema,
  type RecordListQuery,
} from "@memlia/contracts";
import { z } from "zod";
import { ErrorSummary } from "../../forms";
import { request, message, useScope } from "../../api";
export function ExportData({ query }: { query?: RecordListQuery }) {
  const signal = useScope(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [parts, setParts] = useState<
      Record<string, z.infer<typeof ExportManifestSchema>["parts"]>
    >({}),
    [runs, setRuns] = useState<z.infer<typeof ExportRunSchema>[]>([]);
  async function load() {
    try {
      setRuns(
        (await request("/administration/exports", ExportListSchema, signal))
          .items,
      );
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const pending = runs.some(
    (r) => r.job.state === "queued" || r.job.state === "running",
  );
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void load(), 700);
    return () => clearInterval(timer);
  }, [pending]);
  async function start() {
    setBusy(true);
    setError("");
    try {
      await request("/administration/exports", ExportRunSchema, signal, {
        method: "POST",
        body: JSON.stringify({ operationId: crypto.randomUUID(), query }),
      });
      await load();
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  async function download(id: string, part?: number) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/v1/administration/exports/${id}/${part ? "parts/" + part : "download"}`,
        { signal },
      );
      if (!response.ok) {
        const failure = await response.json();
        throw new Error(failure.error?.message ?? "Sortie impossible.");
      }
      const blob = await response.blob();
      if (!part) {
        const manifest = ExportManifestSchema.parse(
          JSON.parse(await blob.text()),
        );
        setParts((previous) => ({ ...previous, [id]: manifest.parts }));
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = part
        ? `memlia-partie-${part}.${runs.find((r) => r.id === id)?.encoding ?? "json"}`
        : "memlia-manifeste.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <section>
      <h3>
        {query
          ? "Préparation CSV de cette vue"
          : "Sortie des données autorisées"}
      </h3>
      {query ? (
        <p>
          La préparation conserve filtres, colonnes et tri de la vue entière. Le
          manifeste énumère les parties CSV à télécharger.
        </p>
      ) : (
        <p>
          Manifeste et parties JSON de 8 Mio maximum : dossiers, contacts,
          tâches et obligations actifs et archivés, valeurs personnalisées,
          identité de l’installation et références de leurs pièces accessibles.
          Chaque pièce indique sa disponibilité lors de la préparation et son
          lien de téléchargement ; les originaux sont téléchargés séparément.
          Les droits sont revérifiés avant restitution. Les cinq dernières
          préparations sont conservées.
        </p>
      )}
      <ErrorSummary message={error || undefined} />
      <Button loading={busy} disabled={pending} onClick={() => void start()}>
        {query
          ? "Préparer le CSV de cette vue"
          : "Préparer la sortie complète en JSON"}
      </Button>
      <Button disabled={busy} onClick={() => void load()}>
        Actualiser les sorties
      </Button>
      {runs
        .filter((run) => !query || run.encoding === "csv")
        .map((run) => (
          <div key={run.id}>
            <p>
              {new Date(run.createdAt).toLocaleString("fr-FR")} ·{" "}
              {
                {
                  queued: "En attente",
                  running: "Préparation en cours",
                  completed: "Sortie prête",
                  failed: "Échec : régénérer la sortie",
                }[run.job.state]
              }{" "}
              · {run.encoding.toUpperCase()} · {run.records} objets ·{" "}
              {run.documents} références documentaires
            </p>
            {run.job.state === "completed" && (
              <Button disabled={busy} onClick={() => void download(run.id)}>
                Télécharger le manifeste
              </Button>
            )}
            {parts[run.id]?.map((part) => (
              <Button
                key={part.number}
                disabled={busy}
                onClick={() => void download(run.id, part.number)}
              >
                Télécharger la partie {part.number} ({part.count} éléments)
              </Button>
            ))}
            {(run.error || run.job.error) && (
              <p role="status">{run.error || run.job.error}</p>
            )}
          </div>
        ))}
    </section>
  );
}
