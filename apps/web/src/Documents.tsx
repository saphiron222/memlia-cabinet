import { useRecordCapabilities } from "./features/administration/capabilities";
import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Input } from "@memlia/ui";
import {
  DocumentInputSchema,
  DocumentListSchema,
  DocumentSchema,
  RecordListSchema,
  DOCUMENT_MAX_BYTES,
  type Document,
  type CabinetRecord,
  type SessionUser,
} from "@memlia/contracts";
import {
  request,
  useScope,
  message,
  downloadDocument,
  RequestError,
} from "./api";
import { ErrorSummary, Select, validationErrors, type Errors } from "./forms";
const extractionLabels = {
  complete: "Texte indexé",
  needs_ocr: "Sans texte — OCR nécessaire",
  unsupported: "Extraction non prise en charge",
};
const availabilityLabels = {
  available: "Disponible",
  missing: "Original absent",
  corrupt: "Original altéré",
};
export function Documents({
  user,
  dossier,
}: {
  user: SessionUser;
  dossier?: CabinetRecord;
}) {
  const signal = useScope(),
    generation = useRef(0),
    returnFocus = useRef<HTMLElement | null>(null);
  const [items, setItems] = useState<Document[] | null>(null),
    [total, setTotal] = useState(0),
    [q, setQ] = useState(""),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false),
    [previous, setPrevious] = useState<Document | undefined>(),
    [revision, setRevision] = useState(0);
  const rights = useRecordCapabilities([
    ...(dossier ? [dossier.id] : []),
    ...(items ?? []).map((d) => d.dossierId),
  ]);
  const canUpload = dossier
    ? (rights.grants[dossier.id]?.includes("update") ?? false)
    : [...user.permissions, ...user.scopedPermissions].some(
        (p) =>
          p.action === "update" && (p.kind === "*" || p.kind === "dossier"),
      );
  useEffect(() => {
    const epoch = ++generation.current;
    const controller = new AbortController();
    setItems(null);
    setError("");
    const query = new URLSearchParams({
      q,
      offset: String(offset),
      limit: "20",
      ...(dossier ? { dossierId: dossier.id } : {}),
    });
    request("/documents?" + query, DocumentListSchema, controller.signal)
      .then((result) => {
        if (epoch === generation.current) {
          setItems(result.items);
          setTotal(result.total);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [q, offset, dossier?.id, revision]);
  function open(previous?: Document) {
    returnFocus.current = document.activeElement as HTMLElement;
    setPrevious(previous);
    setEditing(true);
  }
  function close() {
    setEditing(false);
    requestAnimationFrame(() => returnFocus.current?.focus());
  }
  return (
    <section
      className={dossier ? "document-section" : "records"}
      aria-label="Pièces du cabinet"
    >
      {dossier && <h3>Pièces du dossier</h3>}
      <div className="toolbar">
        <label>
          Rechercher dans les pièces
          <Input
            aria-label="Rechercher dans les pièces"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        {canUpload && <Button onClick={() => open()}>Ajouter une pièce</Button>}
      </div>
      <ErrorSummary message={error || rights.error || undefined} />
      {error && (
        <Button onClick={() => setRevision((n) => n + 1)}>Réessayer</Button>
      )}
      {editing && (
        <UploadForm
          key={previous?.id ?? "new"}
          dossier={dossier}
          previous={previous}
          user={user}
          onClose={close}
          onSaved={() => {
            close();
            setRevision((n) => n + 1);
          }}
        />
      )}
      {!items && !error ? (
        <p role="status">Chargement des pièces…</p>
      ) : items?.length === 0 ? (
        <p>Aucune pièce dans ce périmètre.</p>
      ) : (
        items && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Pièce</th>
                  <th>Version</th>
                  <th>Contenu</th>
                  <th>Provenance</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((doc) => (
                  <tr key={doc.id}>
                    <td
                      title={`${doc.size.toLocaleString("fr-FR")} octets · SHA-256 ${doc.sha256}`}
                    >
                      {doc.filename}
                      {doc.confidential && " · Confidentiel"}
                    </td>
                    <td title={new Date(doc.createdAt).toLocaleString("fr-FR")}>
                      {doc.version}
                    </td>
                    <td>
                      {doc.availability === "available"
                        ? extractionLabels[doc.extraction.status]
                        : availabilityLabels[doc.availability]}
                    </td>
                    <td title={doc.source.reference}>
                      {doc.source.kind === "manual"
                        ? "Ajout manuel"
                        : doc.source.kind}{" "}
                      · v{doc.source.version}
                    </td>
                    <td>
                      <div className="document-actions">
                        {rights.grants[doc.dossierId]?.includes("export") && (
                          <Button
                            size="sm"
                            aria-label={`Télécharger ${doc.filename} v${doc.version}`}
                            disabled={doc.availability !== "available"}
                            onClick={async () => {
                              try {
                                await downloadDocument(
                                  doc.id,
                                  doc.filename,
                                  signal,
                                );
                              } catch (e) {
                                if (!signal.aborted) setError(message(e));
                              }
                            }}
                          >
                            Télécharger
                          </Button>
                        )}
                        {rights.grants[doc.dossierId]?.includes("update") && (
                          <Button
                            size="sm"
                            aria-label={`Nouvelle version de ${doc.filename} v${doc.version}`}
                            onClick={() => open(doc)}
                          >
                            Nouvelle version
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {items && (
        <div className="pagination">
          <span>
            {total} pièce{total > 1 ? "s" : ""}
          </span>
          <Button
            disabled={offset === 0}
            onClick={() => setOffset((n) => Math.max(0, n - 20))}
          >
            Précédent
          </Button>
          <Button
            disabled={offset + 20 >= total}
            onClick={() => setOffset((n) => n + 20)}
          >
            Suivant
          </Button>
        </div>
      )}
    </section>
  );
}
function UploadForm({
  dossier,
  previous,
  user,
  onClose,
  onSaved,
}: {
  dossier?: CabinetRecord;
  previous?: Document;
  user: SessionUser;
  onClose: () => void;
  onSaved: () => void;
}) {
  const signal = useScope(),
    form = useRef<HTMLFormElement>(null),
    [operationId] = useState(() => crypto.randomUUID());
  const [dossiers, setDossiers] = useState<CabinetRecord[]>(
      dossier ? [dossier] : [],
    ),
    [dossierId, setDossierId] = useState(
      previous?.dossierId ?? dossier?.id ?? "",
    ),
    [file, setFile] = useState<File | null>(null),
    [confidential, setConfidential] = useState(previous?.confidential ?? false),
    [errors, setErrors] = useState<Errors>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const rights = useRecordCapabilities([
    ...dossiers.map((d) => d.id),
    ...(dossierId ? [dossierId] : []),
  ]);
  useEffect(() => {
    form.current?.querySelector<HTMLElement>("select,input")?.focus();
    if (!dossier && !previous) {
      void (async () => {
        const all: CabinetRecord[] = [];
        let offset = 0;
        while (!signal.aborted) {
          const result = await request(
            "/records?kind=dossier&limit=100&offset=" + offset,
            RecordListSchema,
            signal,
          );
          all.push(...result.items);
          offset += result.items.length;
          if (offset >= result.total || !result.items.length) break;
        }
        if (!signal.aborted) setDossiers(all);
      })().catch((e) => {
        if (!signal.aborted) setError(message(e));
      });
    }
  }, []);
  async function submit() {
    setErrors({});
    setError("");
    if (!file) {
      setErrors({ piece: "Choisissez un fichier." });
      return;
    }
    if (file.size > DOCUMENT_MAX_BYTES) {
      setErrors({ piece: "La pièce dépasse la limite de 10 Mio." });
      return;
    }
    const filename = file.name.trim();
    const mediaType = filename.toLowerCase().endsWith(".pdf")
      ? "application/pdf"
      : filename.toLowerCase().endsWith(".txt")
        ? "text/plain"
        : "application/octet-stream";
    const parsed = DocumentInputSchema.safeParse({
      operationId,
      dossierId,
      filename,
      mediaType,
      confidential,
      previousVersionId: previous?.id ?? null,
      source: {
        kind: "manual",
        reference: previous?.source.reference ?? operationId,
        version: String((previous?.version ?? 0) + 1),
      },
    });
    if (!parsed.success) {
      setErrors(validationErrors(parsed.error));
      return;
    }
    const data = new FormData();
    data.append("metadata", JSON.stringify(parsed.data));
    data.append(
      "file",
      new Blob([file], { type: mediaType }),
      parsed.data.filename,
    );
    setBusy(true);
    try {
      await request("/documents", DocumentSchema, signal, {
        method: "POST",
        body: data,
      });
      onSaved();
    } catch (e) {
      if (!signal.aborted) {
        setError(message(e));
        if (
          e instanceof RequestError &&
          [
            "INVALID_PDF",
            "INVALID_TEXT",
            "PASSWORD_REQUIRED",
            "PAYLOAD_TOO_LARGE",
            "EMPTY_DOCUMENT",
          ].includes(e.code)
        )
          setErrors({ piece: message(e) });
      }
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <form
      ref={form}
      className="document-upload"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <h3>
        {previous
          ? "Nouvelle version de " + previous.filename
          : "Ajouter une pièce"}
      </h3>
      <ErrorSummary
        errors={errors}
        message={error || rights.error || undefined}
      />
      {previous ? (
        <p>Rattachée au même dossier, version {previous.version + 1}.</p>
      ) : dossier ? (
        <p>{dossier.title}</p>
      ) : (
        <Select
          name="dossierId"
          label="Dossier de la pièce"
          value={dossierId}
          onChange={setDossierId}
          errors={errors}
        >
          <option value="">Choisir un dossier</option>
          {dossiers
            .filter((d) => rights.grants[d.id]?.includes("update"))
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
        </Select>
      )}
      <div className="field">
        <label htmlFor="piece">Fichier original</label>
        <input
          id="piece"
          type="file"
          aria-invalid={!!errors.piece}
          aria-describedby={errors.piece ? "piece-error" : "piece-hint"}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <small id="piece-hint">
          10 Mio maximum. PDF lisible et texte UTF-8 indexés ; autres fichiers
          conservés sans extraction. Aucun OCR.
        </small>
        {errors.piece && (
          <small id="piece-error" className="field-error">
            {errors.piece}
          </small>
        )}
      </div>
      <label className="check">
        <Checkbox
          checked={confidential}
          disabled={
            !!previous ||
            (!confidential &&
              !rights.grants[dossierId]?.includes("confidential"))
          }
          onCheckedChange={setConfidential}
        />
        Pièce confidentielle
      </label>
      <div className="actions">
        <Button
          type="submit"
          variant="solid"
          loading={busy}
          disabled={!rights.grants[dossierId]?.includes("update")}
        >
          Conserver la pièce
        </Button>
        <Button onClick={onClose}>Annuler l’ajout</Button>
      </div>
    </form>
  );
}
