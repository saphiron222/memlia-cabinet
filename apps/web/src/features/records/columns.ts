import type { CabinetRecord, RecordKind } from "@memlia/contracts";
export const columnLabels: Record<string, string> = {
  id: "Identité",
  kind: "Type",
  title: "Titre",
  dossierId: "Dossier lié",
  version: "Version",
  createdAt: "Créée le",
  updatedAt: "Modifiée le",
  confidential: "Confidentiel",
  siren: "SIREN",
  identifiers: "Autres identifiants",
  legalForm: "Forme juridique",
  capital: "Capital",
  currency: "Devise",
  address: "Adresse",
  email: "Email",
  phone: "Téléphone",
  activityCode: "Code activité",
  activity: "Activité",
  createdOn: "Date de création",
  startedOn: "Début d’activité",
  endedOn: "Fin d’activité",
  financialYearEnd: "Clôture d’exercice",
  incomeTaxRegime: "Régime d’imposition",
  vatRegime: "Régime de TVA",
  vatFrequency: "Fréquence TVA",
  establishments: "Établissements",
  obligations: "Obligations applicables",
  notes: "Notes",
  archived: "Archivée",
  contactType: "Nature du contact",
  firstName: "Prénom",
  lastName: "Nom",
  sex: "Sexe",
  birthDate: "Date de naissance",
  birthCity: "Ville de naissance",
  birthCountry: "Pays de naissance",
  nationality: "Nationalité",
  taxNumber: "Numéro fiscal",
  relatedDossierIds: "Autres dossiers liés",
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
  validation: "Validation",
  amount: "Montant",
  source: "Source",
  customFields: "Champs personnalisés",
  fieldOrigins: "Origine des champs",
};
export const defaultColumns = (kind: RecordKind) =>
  ({
    dossier: "title,siren,legalForm,version",
    contact: "title,email,contactType,version",
    tache: "title,dueDate,state,version",
    obligation: "title,dueDate,validation,version",
  })[kind];
export function columnValue(record: CabinetRecord, key: string) {
  const value = key.startsWith("custom.")
    ? record.data.customFields[key.slice(7)]
    : key in record
      ? (record as unknown as Record<string, unknown>)[key]
      : (record.data as unknown as Record<string, unknown>)[key];
  if (value === null || value === undefined || value === "")
    return "Non renseigné";
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (typeof value === "object") return JSON.stringify(value);
  return (
    (
      {
        a_faire: "À faire",
        en_cours: "En cours",
        terminee: "Terminée",
        a_preparer: "À préparer",
        preparee: "Préparée",
        non_validee: "Non validée",
        validee_localement: "Validée localement",
        personne: "Personne",
        organisation: "Organisation",
      } as Record<string, string>
    )[String(value)] ?? String(value)
  );
}
