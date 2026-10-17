import { columnLabels } from "../records/columns";
import { useModuleEnabled } from "../administration/preferences";
import { useEffect, useRef, useState } from "react";
import { Button } from "@memlia/ui";
import { z } from "zod";
import {
  ImportPreviewSchema,
  ImportRowsSchema,
  ImportListSchema,
  ImportCatalogueSchema,
  ImportAcceptedSchema,
  CustomFieldListSchema,
  type ImportPreview,
  type ImportLine,
} from "@memlia/contracts";
import { request, useScope, message } from "../../api";
import { Field, Select, ErrorSummary } from "../../forms";
const statusLabels = {
  pending: "À décider",
  created: "Créée",
  updated: "Mise à jour",
  assigned: "Affectée",
  removed: "Affectation retirée",
  refused: "Refusée",
};
export function Imports() {
  const moduleEnabled = useModuleEnabled("imports");
  const signal = useScope(),
    [catalogue, setCatalogue] = useState<z.infer<
      typeof ImportCatalogueSchema
    > | null>(null),
    [list, setList] = useState<ImportPreview[]>([]),
    [preview, setPreview] = useState<ImportPreview | null>(null),
    [rows, setRows] = useState<ImportLine[]>([]),
    [offset, setOffset] = useState(0),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [custom, setCustom] = useState<
      z.infer<typeof CustomFieldListSchema>["items"]
    >([]),
    [kind, setKind] = useState<ImportPreview["kind"]>("dossier"),
    [format, setFormat] = useState<"csv" | "xlsx">("csv"),
    [delimiter, setDelimiter] = useState(";"),
    [sheet, setSheet] = useState(""),
    [source, setSource] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const uploadOperation = useRef(crypto.randomUUID()),
    commitOperation = useRef(crypto.randomUUID());
  async function refresh() {
    setList((await request("/imports", ImportListSchema, signal)).items);
  }
  async function open(id: string, nextOffset = 0) {
    const p = await request(`/imports/${id}`, ImportPreviewSchema, signal);
    setPreview(p);
    setMapping(p.mapping);
    setRows(
      (
        await request(
          `/imports/${id}/rows?offset=${nextOffset}`,
          ImportRowsSchema,
          signal,
        )
      ).items,
    );
    setOffset(nextOffset);
  }
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    void run(async () => {
      setCatalogue(
        await request("/imports/catalogue", ImportCatalogueSchema, signal),
      );
      setCustom(
        (await request("/administration/fields", CustomFieldListSchema, signal))
          .items,
      );
      await refresh();
    });
  }, []);
  useEffect(() => {
    if (!preview || !["queued", "running"].includes(preview.state)) return;
    const timer = setInterval(() => {
      void open(preview.id, offset).catch((e) => {
        if (!signal.aborted) setError(message(e));
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [preview?.id, preview?.state, offset]);
  async function upload() {
    if (!file) throw Error("Choisir un fichier local.");
    if (file.size > (catalogue?.maxBytes ?? 0))
      throw Error("Le fichier dépasse 10 Mio.");
    const bytes = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(Error("Lecture du fichier impossible."));
      reader.onload = () => resolve(String(reader.result).split(",")[1]!);
      reader.readAsDataURL(file);
    });
    const p = await request("/imports/preview", ImportPreviewSchema, signal, {
      method: "POST",
      body: JSON.stringify({
        operationId: uploadOperation.current,
        filename: file.name,
        format,
        kind,
        delimiter,
        sheet: sheet || undefined,
        sourceInstallationId: source || null,
        bytes,
        mapping: {},
      }),
    });
    await open(p.id);
    await refresh();
    uploadOperation.current = crypto.randomUUID();
    setNotice(
      "Aperçu conservé. Associez les colonnes puis choisissez les lignes à engager.",
    );
  }
  async function select(
    line: ImportLine,
    accepted: boolean,
    targetId: string | null,
    overwriteFields: string[],
  ) {
    if (!preview) return;
    const target = line.candidates.find((c) => c.id === targetId);
    await request(
      `/imports/${preview.id}/selection`,
      ImportPreviewSchema,
      signal,
      {
        method: "PUT",
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          expectedVersion: preview.version,
          rows: [
            {
              lineId: line.lineId,
              accepted,
              targetId,
              expectedRecordVersion: target?.version,
              overwriteFields,
            },
          ],
        }),
      },
    );
    await open(preview.id, offset);
  }
  return (
    <section className="imports">
      <h2>Reprise des données</h2>
      <p>
        Fichiers locaux CSV UTF-8 ou Excel XLSX. Un aperçu contrôle les données
        avant toute écriture. Les cellules vides d’une mise à jour conservent
        les valeurs du cabinet.
      </p>
      <ErrorSummary message={error || undefined} />
      {notice && <p role="status">{notice}</p>}
      <details open={!preview}>
        <summary>Nouvelle reprise</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(upload);
          }}
        >
          <Select
            name="import-kind"
            label="Données à reprendre"
            value={kind}
            onChange={(v) => {
              setKind(v as typeof kind);
              uploadOperation.current = crypto.randomUUID();
            }}
          >
            <option value="dossier">Dossiers</option>
            <option value="contact">Contacts</option>
            <option value="assignment">Affectations</option>
          </Select>
          <Select
            name="import-format"
            label="Format du fichier"
            value={format}
            onChange={(v) => {
              setFormat(v as typeof format);
              uploadOperation.current = crypto.randomUUID();
            }}
          >
            <option value="csv">CSV UTF-8</option>
            <option value="xlsx">Excel XLSX</option>
          </Select>
          {format === "csv" ? (
            <Select
              name="import-separator"
              label="Séparateur"
              value={delimiter}
              onChange={(v) => {
                setDelimiter(v);
                uploadOperation.current = crypto.randomUUID();
              }}
            >
              <option value=";">Point-virgule</option>
              <option value=",">Virgule</option>
              <option value={"\t"}>Tabulation</option>
            </Select>
          ) : (
            <Field
              name="import-sheet"
              label="Nom exact de la feuille (requis si plusieurs)"
              value={sheet}
              onChange={(v) => {
                setSheet(v);
                uploadOperation.current = crypto.randomUUID();
              }}
            />
          )}
          <Field
            name="source-installation"
            label="Identité du cabinet source (si export Memlia)"
            value={source}
            onChange={(v) => {
              setSource(v);
              uploadOperation.current = crypto.randomUUID();
            }}
          />
          <label>
            Fichier de reprise
            <input
              aria-label="Fichier de reprise"
              type="file"
              accept={format === "csv" ? ".csv" : ".xlsx"}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                uploadOperation.current = crypto.randomUUID();
              }}
            />
          </label>
          <p>
            Maximum 10 Mio, 10 000 lignes, 100 colonnes. Formules, macros et
            relations externes refusées. Aucun lien entre installations n’est
            créé par l’import.
          </p>
          <Button type="submit" loading={busy} disabled={!moduleEnabled}>
            Préparer l’aperçu
          </Button>
        </form>
      </details>
      <h3>Aperçus conservés</h3>
      {list.length ? (
        list.map((p) => (
          <Button key={p.id} onClick={() => void run(() => open(p.id))}>
            {p.filename} · {p.createdAt.slice(0, 10)}
          </Button>
        ))
      ) : (
        <p>Aucun aperçu conservé.</p>
      )}
      {preview && (
        <>
          <h3>{preview.filename}</h3>
          <p>
            {preview.total} lignes · feuille {preview.sheet} ·{" "}
            {preview.state === "preview"
              ? "Décisions à préparer"
              : preview.state === "completed"
                ? "Traitement terminé"
                : preview.state === "failed"
                  ? "Traitement interrompu"
                  : `Traitement ${preview.processed}/${preview.total}`}{" "}
            · empreinte {preview.sourceHash.slice(0, 12)}
          </p>
          {preview.sourceInstallationId && (
            <p>
              Cabinet source déclaré : {preview.sourceInstallationId}. Les
              permissions et identités locales sont recontrôlées ; aucun accès
              au cabinet source n’est accordé.
            </p>
          )}
          {preview.error && <ErrorSummary message={preview.error} />}
          {preview.state === "preview" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await request(
                    `/imports/${preview.id}/mapping`,
                    ImportPreviewSchema,
                    signal,
                    {
                      method: "PUT",
                      body: JSON.stringify({
                        operationId: crypto.randomUUID(),
                        expectedVersion: preview.version,
                        mapping,
                      }),
                    },
                  );
                  await open(preview.id);
                  setNotice(
                    "Colonnes associées. Les choix précédents ont été réinitialisés.",
                  );
                });
              }}
            >
              <fieldset disabled={busy}>
                <legend>Associer les colonnes</legend>
                {preview.headers.map((header, i) => (
                  <Select
                    key={i}
                    name={`map-${i}`}
                    label={`Colonne ${header}`}
                    value={mapping[String(i)] ?? ""}
                    onChange={(v) => setMapping({ ...mapping, [i]: v })}
                  >
                    <option value="">Ignorer</option>
                    {catalogue?.fields[preview.kind].map((f) => (
                      <option key={f.key} value={f.key}>
                        {columnLabels[f.key] ??
                          (
                            {
                              recordId: "Identité de fiche",
                              subjectKind: "Type de destinataire",
                              subjectId: "Identité du destinataire",
                              roleId: "Identité du rôle",
                              remove: "Retirer l’affectation",
                            } as Record<string, string>
                          )[f.key] ??
                          f.label}
                        {f.required ? " *" : ""}
                      </option>
                    ))}
                    {custom
                      .filter((f) => f.kind === preview.kind)
                      .map((f) => (
                        <option key={f.id} value={`custom.${f.id}`}>
                          {f.name} (personnalisé)
                        </option>
                      ))}
                  </Select>
                ))}
              </fieldset>
              <Button type="submit" loading={busy}>
                Actualiser l’aperçu
              </Button>
            </form>
          )}
          <div className="table-wrap">
            <table aria-label="Lignes de reprise">
              <thead>
                <tr>
                  <th>Ligne</th>
                  <th>Données et différences</th>
                  <th>Contrôles</th>
                  <th>Décision</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((line) => (
                  <ImportRow
                    key={preview.version + line.lineId}
                    line={line}
                    disabled={busy || preview.state !== "preview"}
                    onSelect={(accepted, target, fields) =>
                      void run(() => select(line, accepted, target, fields))
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <Button
              disabled={busy || offset === 0}
              onClick={() =>
                void run(() => open(preview.id, Math.max(0, offset - 100)))
              }
            >
              Lignes précédentes
            </Button>
            <span>
              {offset + 1}–{offset + rows.length}/{preview.total}
            </span>
            <Button
              disabled={busy || offset + 100 >= preview.total}
              onClick={() => void run(() => open(preview.id, offset + 100))}
            >
              Lignes suivantes
            </Button>
          </div>
          {preview.state === "preview" && (
            <Button
              variant="solid"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const accepted = await request(
                    `/imports/${preview.id}/accepted`,
                    ImportAcceptedSchema,
                    signal,
                  );
                  if (!accepted.lineIds.length)
                    throw Error(
                      "Retenir au moins une ligne avant l’engagement.",
                    );
                  await request(
                    `/imports/${preview.id}/commit`,
                    ImportPreviewSchema,
                    signal,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        operationId: commitOperation.current,
                        expectedVersion: accepted.version,
                        sourceHash: accepted.sourceHash,
                        lineIds: accepted.lineIds,
                      }),
                    },
                  );
                  await open(preview.id);
                  await refresh();
                  commitOperation.current = crypto.randomUUID();
                })
              }
            >
              Engager les lignes retenues
            </Button>
          )}
          <a href={`/api/v1/imports/${preview.id}/report.csv`} download>
            Exporter le rapport des lignes
          </a>
          <Button
            disabled={busy || ["queued", "running"].includes(preview.state)}
            onClick={() =>
              void run(async () => {
                await request(
                  `/imports/${preview.id}/remove`,
                  z.object({ removed: z.boolean() }),
                  signal,
                  { method: "POST", body: "{}" },
                );
                setPreview(null);
                await refresh();
              })
            }
          >
            Supprimer cet aperçu et son fichier
          </Button>
        </>
      )}
    </section>
  );
}
function ImportRow({
  line,
  disabled,
  onSelect,
}: {
  line: ImportLine;
  disabled: boolean;
  onSelect: (
    accepted: boolean,
    target: string | null,
    fields: string[],
  ) => void;
}) {
  const [target, setTarget] = useState(line.targetId ?? ""),
    [overwrite, setOverwrite] = useState(line.overwriteFields);
  return (
    <tr>
      <td>{line.number}</td>
      <td>
        {line.cells.map((c, i) => (
          <span key={i}>
            {String(c.value ?? "").slice(0, 300)}
            {i < line.cells.length - 1 ? " · " : ""}
          </span>
        ))}
        {line.changes.map((c) => (
          <label className="check-row" key={c.field}>
            <input
              type="checkbox"
              disabled={disabled}
              checked={overwrite.includes(c.field)}
              onChange={(e) =>
                setOverwrite(
                  e.target.checked
                    ? [...overwrite, c.field]
                    : overwrite.filter((f) => f !== c.field),
                )
              }
            />
            Remplacer {columnLabels[c.field] ?? c.field} :{" "}
            {JSON.stringify(c.before)} → {JSON.stringify(c.after)}
          </label>
        ))}
      </td>
      <td>
        {line.errors.map((e, i) => (
          <p key={i}>{e}</p>
        ))}
        {line.duplicate && (
          <p>Doublon dans ce fichier : retenir une seule ligne.</p>
        )}
        {line.candidates.length > 0 && (
          <Select
            name={`target-${line.lineId}`}
            label={`Rapprochement ligne ${line.number}`}
            value={target}
            disabled={disabled}
            onChange={(v) => {
              setTarget(v);
              if (v) onSelect(false, v, []);
            }}
          >
            <option value="">Choisir la fiche</option>
            {line.candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} · version {c.version}
              </option>
            ))}
          </Select>
        )}
        {!line.errors.length && !line.candidates.length && (
          <p>Nouvelle donnée proposée.</p>
        )}
      </td>
      <td>
        {statusLabels[line.status]}
        {line.accepted && <p>Retenue</p>}
        <Button
          disabled={disabled || line.errors.length > 0}
          onClick={() => onSelect(!line.accepted, target || null, overwrite)}
        >
          {line.accepted ? "Écarter" : "Retenir"} ligne {line.number}
        </Button>
      </td>
    </tr>
  );
}
