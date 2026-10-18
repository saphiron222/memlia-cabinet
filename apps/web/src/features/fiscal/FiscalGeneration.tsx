import { useEffect, useState } from "react";
import { Button } from "@memlia/ui";
import {
  FiscalGenerationResultSchema,
  FiscalGenerationSchema,
  FiscalNatureSchema,
  RecordListSchema,
  type CabinetRecord,
} from "@memlia/contracts";
import { Field, Select, ErrorSummary } from "../../forms";
import { request, message, useScope } from "../../api";
import {
  DossierChoices,
  useDossierChoices,
} from "../referential/DossierChoices";
import { natureLabels, fiscalFormMessage } from "./labels";
export function FiscalGeneration({
  onCancel,
  onGenerated,
}: {
  onCancel: () => void;
  onGenerated: () => void;
}) {
  const signal = useScope(),
    choices = useDossierChoices(),
    [dossierId, setDossier] = useState(""),
    [nature, setNature] = useState("TVA"),
    [year, setYear] = useState(String(new Date().getFullYear())),
    [campaign, setCampaign] = useState(year),
    [ruleId, setRule] = useState(""),
    [version, setVersion] = useState("1"),
    [source, setSource] = useState(""),
    [datedOn, setDate] = useState(""),
    [contact, setContact] = useState(""),
    [establishment, setEstablishment] = useState(""),
    [frequency, setFrequency] = useState("annuelle"),
    [error, setError] = useState(""),
    [result, setResult] = useState(""),
    [busy, setBusy] = useState(false);
  const [contacts, setContacts] = useState<CabinetRecord[]>([]),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [total, setTotal] = useState(0);
  useEffect(() => {
    if (!dossierId) return;
    const ctrl = new AbortController();
    void request(
      `/records?kind=contact&dossierId=${dossierId}&q=${encodeURIComponent(search)}&offset=${offset}&limit=100`,
      RecordListSchema,
      ctrl.signal,
    )
      .then((r) => {
        setContacts(r.items);
        setTotal(r.total);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(fiscalFormMessage(e));
      });
    return () => ctrl.abort();
  }, [dossierId, search, offset]);
  const dossier = choices.items.find((r) => r.id === dossierId);
  async function generate() {
    setBusy(true);
    setError("");
    try {
      const input = FiscalGenerationSchema.parse({
        operationId: crypto.randomUUID(),
        dossierId,
        expectedDossierVersion: dossier?.version,
        nature,
        year: Number(year),
        campaign,
        contactId: contact || null,
        establishmentId: establishment || null,
        ...(nature === "CUSTOM" ? { customFrequency: frequency } : {}),
        rule: { id: ruleId, version, source, datedOn },
      });
      const r = await request(
        "/fiscal/generate",
        FiscalGenerationResultSchema,
        signal,
        { method: "POST", body: JSON.stringify(input) },
      );
      setResult(`${r.items.length} occurrences disponibles. ${r.reason}`);
      onGenerated();
    } catch (e) {
      if (!signal.aborted) setError(fiscalFormMessage(e));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <section>
      <h2>Générer des occurrences</h2>
      <p>
        La génération utilise le profil et la clôture du dossier ainsi qu’une
        règle datée. Elle ne calcule aucun impôt et ne déduit aucune échéance
        légale. Une occurrence déjà présente est conservée.
      </p>
      <ErrorSummary message={error || undefined} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void generate();
        }}
      >
        <DossierChoices choices={choices} />
        <Select
          name="generation-dossier"
          label="Dossier à planifier"
          value={dossierId}
          onChange={setDossier}
        >
          <option value="">Choisir</option>
          {choices.items.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </Select>
        <Select
          name="generation-nature"
          label="Nature à générer"
          value={nature}
          onChange={setNature}
        >
          {FiscalNatureSchema.options.map((n) => (
            <option key={n} value={n}>
              {natureLabels[n]}
            </option>
          ))}
        </Select>
        <Field
          name="generation-year"
          label="Année à générer"
          value={year}
          onChange={setYear}
          type="number"
        />
        <Field
          name="generation-campaign"
          label="Campagne à générer"
          value={campaign}
          onChange={setCampaign}
        />
        {nature === "IRPP" && (
          <>
            <Field
              name="generation-contact-search"
              label="Rechercher le contact IRPP"
              value={search}
              onChange={(v) => {
                setSearch(v);
                setOffset(0);
              }}
            />
            <Select
              name="generation-contact"
              label="Contact IRPP"
              value={contact}
              onChange={setContact}
            >
              <option value="">Choisir un contact</option>
              {contacts.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              disabled={!offset}
              onClick={() => setOffset(offset - 100)}
            >
              Contacts précédents
            </Button>
            <Button
              type="button"
              disabled={offset + 100 >= total}
              onClick={() => setOffset(offset + 100)}
            >
              Contacts suivants
            </Button>
          </>
        )}{" "}
        {nature === "DSN" && dossier?.kind === "dossier" && (
          <Select
            name="generation-establishment"
            label="Établissement DSN"
            value={establishment}
            onChange={setEstablishment}
          >
            <option value="">Choisir</option>
            {dossier.data.establishments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.siret}
              </option>
            ))}
          </Select>
        )}
        {nature === "CUSTOM" && (
          <Select
            name="generation-frequency"
            label="Fréquence personnalisée"
            value={frequency}
            onChange={setFrequency}
          >
            <option value="mensuelle">Mensuelle</option>
            <option value="trimestrielle">Trimestrielle</option>
            <option value="annuelle">Annuelle</option>
          </Select>
        )}
        <Field
          name="generation-rule"
          label="Règle de génération"
          value={ruleId}
          onChange={setRule}
        />
        <Field
          name="generation-version"
          label="Version de la règle"
          value={version}
          onChange={setVersion}
        />
        <Field
          name="generation-source"
          label="Source de la règle"
          value={source}
          onChange={setSource}
        />
        <Field
          name="generation-date"
          label="Date de la règle"
          value={datedOn}
          onChange={setDate}
          type="date"
        />
        <Button type="submit" loading={busy}>
          Générer les occurrences
        </Button>
        <Button type="button" onClick={onCancel}>
          Revenir à la grille
        </Button>
      </form>
      {result && <p role="status">{result}</p>}
    </section>
  );
}
