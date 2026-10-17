import {
  deriveSourceFreshness,
  type CabinetRecord,
  type RecordKind,
} from "@memlia/contracts";
import { moneyLabel, labelValue } from "../fiscal/labels";
export const columnLabels: Record<string, string> = {
  typeId: "Type de tâche",
  stepId: "Étape du type",
  billing: "Facturation",
  plannedMinutes: "Temps prévu (min)",
  prospectId: "Prospect",
  documentIds: "Pièces liées",
  recurrence: "Récurrence",
  fiscalGross: "Montant brut",
  fiscalNet: "Net à payer",
  fiscalEstimate: "Estimation",
  fiscalReferenceTurnover: "CA de référence",
  fiscalCampaign: "Campagne",
  fiscalStart: "Début de période",
  fiscalEnd: "Fin de période",
  fiscalSubtype: "Déclaration ou acompte",
  fiscalClassification: "Classement",
  fiscalRegime: "Régime fiscal",
  fiscalContact: "Contact fiscal",
  fiscalResponsibles: "Intervenants",
  freshnessState: "Fraîcheur opérationnelle",
  sourceUpdatedAt: "Mise à jour source",
  observedAt: "Collecte",
  cadenceVersion: "Version de cadence",
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
    dossier: "title,siren,vatRegime,financialYearEnd,legalForm",
    contact: "title,email,phone,contactType",
    tache: "title,dueDate,state,version",
    obligation: "title,dueDate,validation,version",
  })[kind];
export function columnValue(
  record: CabinetRecord,
  key: string,
  cabinetTimeZone?: string,
) {
  if (
    record.kind === "obligation" &&
    [
      "freshnessState",
      "sourceUpdatedAt",
      "observedAt",
      "cadenceVersion",
    ].includes(key)
  ) {
    const f = deriveSourceFreshness(
      cabinetTimeZone ? record.data.sourceEvidence : null,
      new Date(),
      new Intl.DateTimeFormat("en-CA", {
        timeZone: cabinetTimeZone ?? "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    );
    return key === "freshnessState"
      ? {
          fresh: "Récente selon politique",
          stale: "Ancienne selon politique",
          unknown: "Indéterminée",
        }[f.state]
      : key === "sourceUpdatedAt"
        ? (f.sourceUpdatedAt ?? "Inconnue")
        : key === "observedAt"
          ? (f.observedAt ?? "Inconnue")
          : (f.policyVersion ?? "Absente");
  }
  const profile = record.kind === "obligation" ? record.data.fiscal : null;
  const fiscal: Record<string, unknown> = profile
    ? {
        fiscalGross: profile.observedValues.gross,
        fiscalNet: profile.observedValues.net,
        fiscalEstimate: profile.observedValues.estimate,
        fiscalReferenceTurnover: profile.observedValues.referenceTurnover,
        fiscalCampaign: profile.period.campaign,
        fiscalStart: profile.period.start,
        fiscalEnd: profile.period.end,
        fiscalSubtype: profile.period.subtype,
        fiscalClassification: profile.classification,
        fiscalRegime: profile.regime,
        fiscalContact: profile.contactId,
        fiscalResponsibles: profile.responsibleIds,
        financialYearEnd: profile.financialYearEnd,
      }
    : {};
  const value =
    key in fiscal
      ? fiscal[key]
      : key.startsWith("custom.")
        ? record.data.customFields[key.slice(7)]
        : key in record
          ? (record as unknown as Record<string, unknown>)[key]
          : (record.data as unknown as Record<string, unknown>)[key];
  if (
    profile &&
    [
      "amount",
      "fiscalGross",
      "fiscalNet",
      "fiscalEstimate",
      "fiscalReferenceTurnover",
    ].includes(key)
  )
    return moneyLabel(typeof value === "string" ? value : null);
  if (profile && key === "fiscalSubtype") return labelValue(String(value));
  if (value === null || value === undefined || value === "")
    return "Non renseigné";
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (key === "address" && typeof value === "object" && value)
    return Object.values(value).filter(Boolean).join(", ") || "Non renseignée";
  if (Array.isArray(value))
    return value.length
      ? `${value.length} élément${value.length > 1 ? "s" : ""}`
      : "Aucun";
  if (typeof value === "object") return "Propriétés structurées";
  if (
    ["vatRegime", "incomeTaxRegime", "vatFrequency", "fiscalRegime"].includes(
      key,
    )
  )
    return labelValue(String(value));
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value)))
    return String(value).split("-").reverse().join("/");
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
