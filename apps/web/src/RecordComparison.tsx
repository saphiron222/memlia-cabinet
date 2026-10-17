import { z } from "zod";
import {
  RecordContentSchema,
  TaskDataSchema,
  type CabinetRecord,
  type SessionUser,
} from "@memlia/contracts";
import { stateLabels } from "./RecordLabels";
type Content = z.infer<typeof RecordContentSchema>;
export function RecordComparison({
  latest,
  draft,
  dossiers,
  users,
}: {
  latest: CabinetRecord;
  draft: Content;
  dossiers: CabinetRecord[];
  users: SessionUser[];
}) {
  const names: Record<string, string> = {
    title: "Titre",
    dossierId: "Dossier lié",
    confidential: "Confidentiel",
    siren: "SIREN",
    legalForm: "Forme juridique",
    notes: "Notes",
    archived: "Archivé",
    contactType: "Type de contact",
    email: "Email",
    phone: "Téléphone",
    description: "Description",
    dueDate: "Échéance",
    state: "Étape",
    priority: "Priorité",
    assigneeIds: "Responsables",
    checklist: "Checklist",
    tags: "Étiquettes",
    nature: "Nature",
    period: "Période",
    preparation: "Préparation",
    validation: "Validation locale",
    amount: "Montant",
    source: "Source",
  };
  const words: Record<string, string> = {
    ...stateLabels,
    personne: "Personne",
    organisation: "Organisation",
    normale: "Normale",
    haute: "Haute",
    urgente: "Urgente",
    a_preparer: "À préparer",
    preparee: "Préparée",
    non_validee: "Non validée",
    validee_localement: "Validée localement",
    manuelle: "Manuelle",
    simulee: "Simulée",
  };
  function rows(record: Content) {
    return {
      title: record.title,
      dossierId: record.dossierId,
      confidential: record.confidential,
      ...record.data,
    };
  }
  function value(key: string, v: unknown): string {
    if (v === null || v === "")
      return key === "amount" ? "Inconnu" : "Non renseigné";
    if (typeof v === "boolean") return v ? "Oui" : "Non";
    if (key === "dossierId")
      return dossiers.find((d) => d.id === v)?.title ?? "Dossier associé";
    if (key === "assigneeIds" && Array.isArray(v))
      return (
        v
          .map(
            (id) =>
              users.find((u) => u.id === id)?.name ?? "Responsable existant",
          )
          .join(", ") || "Aucun"
      );
    if (key === "checklist")
      return (
        TaskDataSchema.shape.checklist
          .parse(v)
          .map((item) => (item.done ? "Fait : " : "À faire : ") + item.label)
          .join(" ; ") || "Vide"
      );
    if (Array.isArray(v)) return v.join(", ") || "Aucune";
    return words[String(v)] ?? String(v);
  }
  const remote = rows(latest),
    local = rows(draft);
  return (
    <div className="comparison">
      <table>
        <caption>Comparez les valeurs avant de résoudre le conflit</caption>
        <thead>
          <tr>
            <th>Champ</th>
            <th>Enregistré</th>
            <th>Ma saisie</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(remote).map(([key, v]) => (
            <tr key={key}>
              <th scope="row">{names[key] ?? key}</th>
              <td>{value(key, v)}</td>
              <td>{value(key, local[key as keyof typeof local])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
