import { z } from "zod";
import { Button } from "@memlia/ui";
import {
  AddressSchema,
  EstablishmentSchema,
  type CabinetRecord,
  type RecordContentSchema,
} from "@memlia/contracts";
import { Field, Select, type Errors } from "../../forms";
type Content = z.infer<typeof RecordContentSchema>;
function Address({
  value,
  onChange,
  prefix = "address",
}: {
  value: z.infer<typeof AddressSchema>;
  onChange: (a: z.infer<typeof AddressSchema>) => void;
  prefix?: string;
}) {
  return (
    <fieldset>
      <legend>Adresse</legend>
      {(
        [
          ["line1", "Adresse ligne 1"],
          ["line2", "Adresse ligne 2"],
          ["postalCode", "Code postal"],
          ["city", "Ville"],
          ["country", "Pays"],
        ] as const
      ).map(([key, label]) => (
        <Field
          key={key}
          name={prefix + "-" + key}
          label={label}
          value={value[key]}
          onChange={(v) => onChange({ ...value, [key]: v })}
        />
      ))}
    </fieldset>
  );
}
export function ReferentialFields({
  record,
  setData,
  errors,
  dossiers,
}: {
  record: Content;
  setData: (key: string, value: unknown) => void;
  errors: Errors;
  dossiers: CabinetRecord[];
}) {
  if (record.kind !== "dossier" && record.kind !== "contact") return null;
  const data = record.data;
  const text = (
    key: keyof typeof data,
    label: string,
    type = "text",
    nullable = false,
  ) => (
    <Field
      key={key}
      name={key}
      label={label}
      type={type}
      value={String(data[key] ?? "")}
      onChange={(v) => setData(key, nullable ? v || null : v)}
      errors={errors}
    />
  );
  return (
    <>
      {record.kind === "contact" && (
        <Select
          name="contactType"
          label="Type de contact"
          value={record.data.contactType}
          onChange={(v) => setData("contactType", v)}
        >
          <option value="personne">Personne physique</option>
          <option value="organisation">Personne morale</option>
        </Select>
      )}
      {record.kind === "contact" && record.data.contactType === "personne" && (
        <>
          {(
            [
              ["lastName", "Nom"],
              ["firstName", "Prénom"],
              ["nationality", "Nationalité"],
              ["birthCity", "Ville de naissance"],
              ["birthCountry", "Pays de naissance"],
              ["taxNumber", "Numéro fiscal"],
            ] as const
          ).map(([key, label]) => (
            <Field
              key={key}
              name={key}
              label={label}
              value={record.data[key]}
              onChange={(v) => setData(key, v)}
            />
          ))}
          <Field
            name="birthDate"
            label="Date de naissance"
            type="date"
            value={record.data.birthDate ?? ""}
            onChange={(v) => setData("birthDate", v || null)}
          />
          <Select
            name="sex"
            label="Sexe"
            value={record.data.sex ?? ""}
            onChange={(v) => setData("sex", v || null)}
          >
            <option value="">Non renseigné</option>
            <option value="homme">Homme</option>
            <option value="femme">Femme</option>
            <option value="autre">Autre</option>
          </Select>
        </>
      )}
      {(record.kind === "dossier" ||
        record.data.contactType === "organisation") && (
        <>
          {text("siren", "SIREN", "text", true)}
          {text("legalForm", "Forme juridique")}
          {text("capital", "Capital", "text", true)}
          {text("currency", "Devise du capital")}
        </>
      )}
      {text("email", "Adresse email", "email", true)}
      {text("phone", "Téléphone")}
      <Address
        value={data.address}
        onChange={(address) => setData("address", address)}
      />
      {record.kind === "contact" && (
        <fieldset>
          <legend>Autres dossiers liés</legend>
          {dossiers
            .filter((d) => d.id !== record.dossierId)
            .map((d) => (
              <label className="check-row" key={d.id}>
                <input
                  type="checkbox"
                  checked={record.data.relatedDossierIds.includes(d.id)}
                  onChange={(e) =>
                    setData(
                      "relatedDossierIds",
                      e.target.checked
                        ? [...record.data.relatedDossierIds, d.id]
                        : record.data.relatedDossierIds.filter(
                            (id) => id !== d.id,
                          ),
                    )
                  }
                />
                {d.title}
              </label>
            ))}
        </fieldset>
      )}
      {record.kind === "dossier" && (
        <>
          {(
            [
              ["createdOn", "Date de création"],
              ["startedOn", "Début d’activité"],
              ["endedOn", "Fin d’activité"],
              ["financialYearEnd", "Clôture de l’exercice"],
            ] as const
          ).map(([key, label]) => (
            <Field
              key={key}
              name={key}
              label={label}
              type="date"
              value={record.data[key] ?? ""}
              onChange={(v) => setData(key, v || null)}
            />
          ))}
          <Field
            name="activityCode"
            label="Code d’activité"
            value={record.data.activityCode}
            onChange={(v) => setData("activityCode", v)}
          />
          <Field
            name="activity"
            label="Activité"
            value={record.data.activity}
            onChange={(v) => setData("activity", v)}
          />
          {(
            [
              [
                "incomeTaxRegime",
                "Régime d’imposition",
                ["IS", "IR_BIC", "IR_BNC", "IR_BA", "exonere", "autre"],
              ],
              [
                "vatRegime",
                "Régime de TVA",
                [
                  "franchise",
                  "reel_simplifie",
                  "reel_normal",
                  "exonere",
                  "hors_champ",
                ],
              ],
              [
                "vatFrequency",
                "Fréquence de TVA",
                ["mensuelle", "trimestrielle", "annuelle"],
              ],
            ] as const
          ).map(([key, label, values]) => (
            <Select
              key={key}
              name={key}
              label={label}
              value={record.data[key] ?? ""}
              onChange={(v) => setData(key, v || null)}
            >
              <option value="">Non renseigné</option>
              {values.map((v) => (
                <option key={v} value={v}>
                  {v.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
          ))}
          <fieldset>
            <legend>Obligations configurées</legend>
            {[
              "TVA",
              "IS",
              "CFE",
              "CVAE",
              "DAS2",
              "DSN",
              "IRPP",
              "RCM",
              "IFU",
              "DES",
              "TF",
            ].map((value) => (
              <label className="check-row" key={value}>
                <input
                  type="checkbox"
                  checked={record.data.obligations.includes(
                    value as (typeof record.data.obligations)[number],
                  )}
                  onChange={(e) =>
                    setData(
                      "obligations",
                      e.target.checked
                        ? [...record.data.obligations, value]
                        : record.data.obligations.filter((v) => v !== value),
                    )
                  }
                />
                {value}
              </label>
            ))}
            <p className="muted">
              Paramètres du dossier ; aucune déclaration ni habilitation n’est
              émise.
            </p>
          </fieldset>
          <fieldset>
            <legend>Identifiants complémentaires</legend>
            {record.data.identifiers.map((identifier, index) => (
              <div key={index}>
                <Field
                  name={`identifier-kind-${index}`}
                  label="Type d’identifiant"
                  value={identifier.kind}
                  onChange={(kind) =>
                    setData(
                      "identifiers",
                      record.data.identifiers.map((v, i) =>
                        i === index ? { ...v, kind } : v,
                      ),
                    )
                  }
                />
                <Field
                  name={`identifier-value-${index}`}
                  label="Valeur de l’identifiant"
                  value={identifier.value}
                  onChange={(value) =>
                    setData(
                      "identifiers",
                      record.data.identifiers.map((v, i) =>
                        i === index ? { ...v, value } : v,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  onClick={() =>
                    setData(
                      "identifiers",
                      record.data.identifiers.filter((_, i) => i !== index),
                    )
                  }
                >
                  Retirer cet identifiant
                </Button>
              </div>
            ))}
            <Button
              type="button"
              onClick={() =>
                setData("identifiers", [
                  ...record.data.identifiers,
                  { kind: "", value: "" },
                ])
              }
            >
              Ajouter un identifiant
            </Button>
          </fieldset>
          <fieldset>
            <legend>Établissements</legend>
            {record.data.establishments.map((e, index) => {
              const patch = (key: string, value: unknown) =>
                setData(
                  "establishments",
                  record.data.establishments.map((v, i) =>
                    i === index ? { ...v, [key]: value } : v,
                  ),
                );
              return (
                <fieldset key={e.id}>
                  <legend>Établissement {index + 1}</legend>
                  <Field
                    name={`est-${e.id}-name`}
                    label="Nom de l’établissement"
                    value={e.name}
                    onChange={(v) => patch("name", v)}
                  />
                  <Field
                    name={`est-${e.id}-siret`}
                    label={`SIRET ${index + 1}`}
                    value={e.siret ?? ""}
                    onChange={(v) => patch("siret", v || null)}
                    hint="14 chiffres textuels."
                  />
                  <Address
                    prefix={`est-${e.id}`}
                    value={e.address}
                    onChange={(v) => patch("address", v)}
                  />
                  {(
                    [
                      ["openedOn", "Ouverture de l’établissement"],
                      ["closedOn", "Fermeture de l’établissement"],
                    ] as const
                  ).map(([key, label]) => (
                    <Field
                      key={key}
                      name={`est-${e.id}-${key}`}
                      label={label}
                      type="date"
                      value={e[key] ?? ""}
                      onChange={(v) => patch(key, v || null)}
                    />
                  ))}
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={e.headOffice}
                      onChange={(v) => patch("headOffice", v.target.checked)}
                    />
                    Siège social
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={e.active}
                      onChange={(v) => patch("active", v.target.checked)}
                    />
                    Établissement actif
                  </label>
                  <Button
                    type="button"
                    onClick={() =>
                      setData(
                        "establishments",
                        record.data.establishments.filter((v) => v.id !== e.id),
                      )
                    }
                  >
                    Retirer l’établissement
                  </Button>
                </fieldset>
              );
            })}
            <Button
              type="button"
              onClick={() =>
                setData("establishments", [
                  ...record.data.establishments,
                  EstablishmentSchema.parse({ id: crypto.randomUUID() }),
                ])
              }
            >
              Ajouter un établissement
            </Button>
          </fieldset>
        </>
      )}
    </>
  );
}
