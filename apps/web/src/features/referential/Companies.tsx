import {
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from "../../upstream/twenty/Table";
import { columnLabels } from "../records/columns";
import { DossierChoices, useDossierChoices } from "./DossierChoices";
import { useModuleEnabled } from "../administration/preferences";
import { useEffect, useState } from "react";
import { Button } from "@memlia/ui";
import {
  CompanySearchResultSchema,
  DetectionSchema,
  DetectionListSchema,
  DetectionPreviewSchema,
  RecordListSchema,
  type Detection,
  type SessionUser,
} from "@memlia/contracts";
import { z } from "zod";
import { request, useScope, message } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
export function Companies({
  user,
  onChanged,
}: {
  user: SessionUser;
  onChanged: () => void;
}) {
  const dossierChoices = useDossierChoices();
  const moduleEnabled = useModuleEnabled("recherche_publique");
  const signal = useScope(),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [found, setFound] = useState<z.infer<
      typeof CompanySearchResultSchema
    > | null>(null),
    [items, setItems] = useState<Detection[]>([]),
    [hidden, setHidden] = useState(false),
    [offset, setOffset] = useState(0),
    [total, setTotal] = useState(0),
    [preview, setPreview] = useState<z.infer<
      typeof DetectionPreviewSchema
    > | null>(null),
    [choices, setChoices] = useState<
      Record<string, "keep_manual" | "use_source">
    >({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [target, setTarget] = useState(""),
    [selected, setSelected] = useState<Detection[]>([]),
    [batchReport, setBatchReport] = useState<string[]>([]);
  const [simTitle, setSimTitle] = useState(""),
    [simSiren, setSimSiren] = useState(""),
    [sourceId, setSourceId] = useState(""),
    [automatic, setAutomatic] = useState(false);
  async function load() {
    try {
      const result = await request(
        `/administration/detections?hidden=${hidden}&offset=${offset}`,
        DetectionListSchema,
        signal,
      );
      setItems(result.items);
      setSelected([]);
      setTotal(result.total);
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    }
  }
  useEffect(() => {
    void load();
  }, [hidden, offset]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  async function show(d: Detection, targetId?: string) {
    setChoices({});
    setPreview(
      await request(
        `/administration/detections/${d.id}/preview${targetId ? "?targetId=" + targetId : ""}`,
        DetectionPreviewSchema,
        signal,
      ),
    );
  }
  async function decide(
    d: Detection,
    decision: "create" | "merge" | "hide" | "restore",
  ) {
    await run(async () => {
      const result = await request(
        `/administration/detections/${d.id}/decide`,
        DetectionSchema,
        signal,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            expectedVersion: d.version,
            decision,
            choices,
            ...(preview?.target
              ? {
                  targetId: preview.target.id,
                  expectedRecordVersion: preview.target.version,
                }
              : {}),
          }),
        },
      );
      setPreview(null);
      setNotice(
        result.dossierId
          ? "Décision conservée et dossier rapproché. Aucune habilitation fiscale créée."
          : "Décision conservée.",
      );
      await load();
      onChanged();
    });
  }
  async function decideBatch(decision: "create" | "hide" | "restore") {
    setBusy(true);
    setBatchReport([]);
    setError("");
    const report: string[] = [];
    for (const d of selected) {
      if (signal.aborted) break;
      try {
        await request(
          `/administration/detections/${d.id}/decide`,
          DetectionSchema,
          signal,
          {
            method: "POST",
            body: JSON.stringify({
              operationId: crypto.randomUUID(),
              expectedVersion: d.version,
              decision,
              choices: {},
            }),
          },
        );
        report.push(`${d.values.title} : décision conservée.`);
      } catch (e) {
        if (!signal.aborted) report.push(`${d.values.title} : ${message(e)}`);
      }
      if (!signal.aborted) setBatchReport([...report]);
    }
    if (!signal.aborted) {
      setPreview(null);
      await load();
      onChanged();
      setBusy(false);
    }
  }
  return (
    <details className="company-panel">
      <summary>Recherche d’entreprise et dossiers détectés</summary>
      <ErrorSummary message={error || undefined} />
      {notice && <p role="status">{notice}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () =>
            setFound(
              await request(
                `/administration/companies/search?q=${encodeURIComponent(q)}&page=${page}`,
                CompanySearchResultSchema,
                signal,
              ),
            ),
          );
        }}
      >
        <p>
          La recherche transmet uniquement votre saisie au service public
          Annuaire des Entreprises. Une sélection propose un dossier ; elle
          n’accorde aucune habilitation.
        </p>
        <Field
          name="company-query"
          label="Nom, SIREN ou SIRET public"
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
        />
        <Field
          name="company-page"
          label="Page de résultats"
          type="number"
          value={String(page)}
          onChange={(v) => setPage(Number(v))}
        />
        <Button type="submit" loading={busy} disabled={!moduleEnabled}>
          Rechercher l’entreprise
        </Button>
      </form>
      {found && (
        <>
          <p>
            {found.total} résultat(s)
            {found.capped ? " — compteur plafonné" : ""}. L’absence de résultat
            ne prouve pas l’inexistence de l’entreprise.
          </p>
          {found.items.map((item) => (
            <div key={item.candidateId}>
              <strong>{item.values.title}</strong> · {item.values.siren}
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const d = await request(
                      "/administration/companies/propose",
                      DetectionSchema,
                      signal,
                      {
                        method: "POST",
                        body: JSON.stringify({
                          operationId: crypto.randomUUID(),
                          candidateId: item.candidateId,
                        }),
                      },
                    );
                    await load();
                    await show(d);
                  })
                }
              >
                Proposer ce dossier
              </Button>
            </div>
          ))}
        </>
      )}
      <h3>Dossiers détectés</h3>
      <label className="check-row">
        <input
          type="checkbox"
          checked={hidden}
          onChange={(e) => {
            setHidden(e.target.checked);
            setOffset(0);
          }}
        />
        Afficher les détections masquées
      </label>
      {!items.length && <p>Aucune détection dans ce périmètre.</p>}
      <div>
        <Button
          disabled={busy || !items.length}
          onClick={() =>
            setSelected(selected.length === items.length ? [] : items)
          }
        >
          Sélectionner ou retirer cette page
        </Button>
        <span>{selected.length} détections sélectionnées</span>
        <Button
          disabled={busy || !selected.length}
          onClick={() => void decideBatch("create")}
        >
          Créer les dossiers sélectionnés
        </Button>
        <Button
          disabled={busy || !selected.length}
          onClick={() => void decideBatch(hidden ? "restore" : "hide")}
        >
          {hidden ? "Restaurer" : "Masquer"} la sélection
        </Button>
        <p>
          Chaque décision vérifie les droits et la version. Un conflit exige un
          examen individuel ; aucune valeur manuelle n’est écrasée par ce lot.
        </p>
        {batchReport.length > 0 && (
          <ul aria-label="Rapport des décisions">
            {batchReport.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        )}
      </div>
      {items.map((d) => (
        <div key={d.id}>
          <label>
            <input
              type="checkbox"
              disabled={busy}
              checked={selected.some((item) => item.id === d.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, d]
                    : selected.filter((item) => item.id !== d.id),
                )
              }
            />
            Sélectionner {d.values.title}
          </label>
          <strong>{d.values.title}</strong> ·{" "}
          {d.origin.kind === "simulated" ? "Source simulée" : d.origin.kind} ·{" "}
          {d.status}{" "}
          <Button onClick={() => void run(() => show(d))}>
            Examiner {d.values.title}
          </Button>
          <Button onClick={() => void decide(d, d.hidden ? "restore" : "hide")}>
            {d.hidden ? "Restaurer" : "Masquer"} {d.values.title}
          </Button>
        </div>
      ))}
      <div className="pagination">
        <Button
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 200))}
        >
          Détections précédentes
        </Button>
        <span>{total} détections autorisées</span>
        <Button
          disabled={offset + 200 >= total}
          onClick={() => setOffset(offset + 200)}
        >
          Détections suivantes
        </Button>
      </div>
      {preview && (
        <section>
          <h3>Proposition : {preview.detection.values.title}</h3>
          <p>
            Origine {preview.detection.origin.reference} · version{" "}
            {preview.detection.origin.version} · observée le{" "}
            {preview.detection.origin.at}
          </p>
          <DossierChoices choices={dossierChoices} />
          <Select
            name="merge-target"
            label="Dossier à rapprocher"
            value={target || preview.target?.id || ""}
            onChange={(v) => {
              setTarget(v);
              void run(() => show(preview.detection, v || undefined));
            }}
          >
            <option value="">Rapprochement automatique par SIREN</option>
            {(target || preview.target?.id) &&
              !dossierChoices.items.some(
                (d) => d.id === (target || preview.target?.id),
              ) && (
                <option value={target || preview.target?.id}>
                  Dossier actuellement choisi
                </option>
              )}
            {dossierChoices.items.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </Select>
          <Table>
            <thead>
              <TableRow>
                <TableHeader>Champ</TableHeader>
                <TableHeader>Valeur actuelle</TableHeader>
                <TableHeader>Source proposée</TableHeader>
                <TableHeader>Décision</TableHeader>
              </TableRow>
            </thead>
            <tbody>
              {Object.entries(preview.detection.values).map(([key, value]) => (
                <TableRow key={key}>
                  <TableCell>{columnLabels[key] ?? key}</TableCell>
                  <TableCell>
                    {JSON.stringify(
                      key === "title"
                        ? preview.target?.title
                        : (
                            preview.target?.data as
                              | Record<string, unknown>
                              | undefined
                          )?.[key],
                    ) ?? "Inconnu"}
                  </TableCell>
                  <TableCell>
                    {typeof value === "object"
                      ? JSON.stringify(value)
                      : String(value ?? "Inconnu")}
                  </TableCell>
                  <TableCell>
                    {preview.conflicts.includes(key) ? (
                      <Select
                        name={`resolve-${key}`}
                        label={`Résolution ${columnLabels[key] ?? key}`}
                        value={choices[key] ?? ""}
                        onChange={(v) =>
                          setChoices({
                            ...choices,
                            [key]: v as "keep_manual" | "use_source",
                          })
                        }
                      >
                        <option value="">Choisir…</option>
                        <option value="keep_manual">
                          Conserver la valeur du cabinet
                        </option>
                        <option value="use_source">Utiliser la source</option>
                      </Select>
                    ) : (
                      "Compatible"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
          <Button
            disabled={busy || preview.conflicts.some((key) => !choices[key])}
            onClick={() =>
              void decide(
                preview.detection,
                preview.target ? "merge" : "create",
              )
            }
          >
            {preview.target
              ? "Confirmer le rapprochement"
              : "Créer le dossier proposé"}
          </Button>
        </section>
      )}
      {user.permissions.some(
        (p) =>
          p.action === "manage_users" && p.kind === "*" && p.dossierId === null,
      ) && (
        <details>
          <summary>Simulation locale d’une détection fournisseur</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await request(
                  "/administration/detections/simulate",
                  DetectionSchema,
                  signal,
                  {
                    method: "POST",
                    body: JSON.stringify({
                      operationId: crypto.randomUUID(),
                      sourceId,
                      sourceVersion: "1",
                      automatic,
                      values: { title: simTitle, siren: simSiren || null },
                    }),
                  },
                );
                await load();
                onChanged();
              });
            }}
          >
            <Field
              name="simulation-title"
              label="Nom fictif"
              value={simTitle}
              onChange={setSimTitle}
            />
            <Field
              name="simulation-siren"
              label="SIREN fictif"
              value={simSiren}
              onChange={setSimSiren}
            />
            <Field
              name="simulation-source"
              label="Identité de source fictive stable"
              value={sourceId}
              onChange={setSourceId}
            />
            <label className="check-row">
              <input
                type="checkbox"
                checked={automatic}
                onChange={(e) => setAutomatic(e.target.checked)}
              />
              Création automatique si aucun conflit
            </label>
            <Button type="submit" loading={busy}>
              Simuler la détection
            </Button>
          </form>
        </details>
      )}
    </details>
  );
}
