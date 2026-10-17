import { useEffect, useState } from "react";
import { RecordListSchema, type CabinetRecord } from "@memlia/contracts";
import { request, useScope, message } from "../../api";
export function RelatedRecords({
  record,
  onNavigate,
}: {
  record: CabinetRecord;
  onNavigate: () => void;
}) {
  const signal = useScope(),
    [contacts, setContacts] = useState<CabinetRecord[]>([]),
    [error, setError] = useState(""),
    [total, setTotal] = useState(0);
  useEffect(() => {
    if (record.kind !== "dossier") return;
    void request(
      `/records?kind=contact&dossierId=${record.id}&limit=200`,
      RecordListSchema,
      signal,
    )
      .then((r) => {
        setContacts(r.items);
        setTotal(r.total);
      })
      .catch((e) => {
        if (!signal.aborted) setError(message(e));
      });
  }, [record.id]);
  const ids = [
    ...new Set([
      ...(record.dossierId ? [record.dossierId] : []),
      ...(record.kind === "contact" ? record.data.relatedDossierIds : []),
    ]),
  ];
  return (
    <nav aria-label="Relations de la fiche">
      {ids.map((id, i) => (
        <a key={id} href={`#dossier?id=${id}`} onClick={onNavigate}>
          Ouvrir le dossier lié {i + 1}
        </a>
      ))}
      {contacts.map((c) => (
        <a key={c.id} href={`#contact?id=${c.id}`} onClick={onNavigate}>
          Ouvrir le contact {c.title}
        </a>
      ))}
      {total > contacts.length && (
        <a href={`#contact?dossierId=${record.id}`} onClick={onNavigate}>
          Voir les {total} contacts liés dans la liste paginée
        </a>
      )}
      {error && <p role="status">Relations : {error}</p>}
    </nav>
  );
}
