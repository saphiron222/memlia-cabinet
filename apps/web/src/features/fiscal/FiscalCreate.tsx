import { useEffect, useState } from "react";
import { Button } from "@memlia/ui";
import {
  FiscalCreateSchema,
  FiscalDetailSchema,
  FiscalNatureSchema,
  RecordListSchema,
  type FiscalDetail,
  type CabinetRecord,
} from "@memlia/contracts";
import { Field, Select, ErrorSummary } from "../../forms";
import { request, useScope, message } from "../../api";
import {
  DossierChoices,
  useDossierChoices,
} from "../referential/DossierChoices";
import { useCreationCapabilities } from "../administration/capabilities";
import { natureLabels, fiscalFormMessage } from "./labels";
export function FiscalCreate({
  onCreated,
  onCancel,
}: {
  onCreated: (v: FiscalDetail) => void;
  onCancel: () => void;
}) {
  const signal = useScope(),
    choices = useDossierChoices();
  const [dossierId, setDossier] = useState(""),
    [title, setTitle] = useState(""),
    [nature, setNature] = useState("TVA"),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [campaign, setCampaign] = useState(String(new Date().getFullYear())),
    [subtype, setSubtype] = useState("declaration"),
    [amount, setAmount] = useState(""),
    [contact, setContact] = useState(""),
    [establishment, setEstablishment] = useState(""),
    [confidential, setConfidential] = useState(false),
    [contacts, setContacts] = useState<CabinetRecord[]>([]),
    [contactSearch, setContactSearch] = useState(""),
    [contactOffset, setContactOffset] = useState(0),
    [contactTotal, setContactTotal] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const capabilities = useCreationCapabilities(
      "obligation",
      dossierId || null,
      confidential,
    ),
    dossier = choices.items.find((r) => r.id === dossierId);
  useEffect(() => {
    if (!dossierId) return;
    const ctrl = new AbortController();
    void request(
      `/records?kind=contact&dossierId=${dossierId}&q=${encodeURIComponent(contactSearch)}&offset=${contactOffset}&limit=100`,
      RecordListSchema,
      ctrl.signal,
    )
      .then((r) => {
        setContacts(r.items);
        setContactTotal(r.total);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(fiscalFormMessage(e));
      });
    return () => ctrl.abort();
  }, [dossierId, contactSearch, contactOffset]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const input = FiscalCreateSchema.parse({
        operationId: crypto.randomUUID(),
        dossierId,
        title,
        nature,
        period: { start, end, campaign, subtype },
        amount: amount || null,
        contactId: contact || null,
        establishmentId: establishment || null,
        confidential,
        financialYearEnd:
          dossier?.kind === "dossier" ? dossier.data.financialYearEnd : null,
        regime:
          dossier?.kind === "dossier"
            ? nature === "TVA"
              ? dossier.data.vatRegime
              : nature === "IS"
                ? dossier.data.incomeTaxRegime
                : null
            : null,
      });
      onCreated(
        await request("/fiscal", FiscalDetailSchema, signal, {
          method: "POST",
          body: JSON.stringify(input),
        }),
      );
    } catch (e) {
      if (!signal.aborted) setError(fiscalFormMessage(e));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <section>
      <h2>Nouvelle obligation fiscale</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <ErrorSummary message={error || capabilities.error || undefined} />
        <DossierChoices choices={choices} />
        <Select
          name="fiscal-dossier"
          label="Dossier de l’obligation"
          value={dossierId}
          onChange={(v) => {
            setDossier(v);
            setContact("");
            setEstablishment("");
          }}
        >
          <option value="">Choisir un dossier</option>
          {choices.items.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </Select>
        <Field
          name="fiscal-title"
          label="Titre fiscal"
          value={title}
          onChange={setTitle}
          required
        />
        <Select
          name="fiscal-nature"
          label="Nature fiscale"
          value={nature}
          onChange={setNature}
        >
          {FiscalNatureSchema.options.map((n) => (
            <option key={n} value={n}>
              {natureLabels[n]}
            </option>
          ))}
        </Select>
        <div className="admin-inline">
          <Field
            name="fiscal-start"
            label="Début de période"
            type="date"
            value={start}
            onChange={setStart}
          />
          <Field
            name="fiscal-end"
            label="Fin de période"
            type="date"
            value={end}
            onChange={setEnd}
          />
        </div>
        <Field
          name="fiscal-campaign"
          label="Campagne"
          value={campaign}
          onChange={setCampaign}
        />
        <Field
          name="fiscal-subtype"
          label="Déclaration ou acompte"
          value={subtype}
          onChange={setSubtype}
        />
        <Field
          name="fiscal-amount"
          label="Montant suivi"
          value={amount}
          onChange={setAmount}
          hint="Deux décimales, par exemple 100.00. Vide signifie inconnu ; 0.00 signifie zéro connu."
        />
        {nature === "IRPP" && (
          <>
            <Field
              name="contact-search"
              label="Rechercher le contact fiscal"
              value={contactSearch}
              onChange={(v) => {
                setContactSearch(v);
                setContactOffset(0);
              }}
            />
            <Select
              name="fiscal-contact"
              label="Contact de l’IRPP"
              value={contact}
              onChange={setContact}
            >
              <option value="">Choisir une personne</option>
              {contacts.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              disabled={!contactOffset}
              onClick={() => setContactOffset(contactOffset - 100)}
            >
              Contacts précédents
            </Button>
            <Button
              type="button"
              disabled={contactOffset + 100 >= contactTotal}
              onClick={() => setContactOffset(contactOffset + 100)}
            >
              Contacts suivants
            </Button>
          </>
        )}
        {dossier?.kind === "dossier" && (
          <Select
            name="fiscal-establishment"
            label="Établissement (obligatoire pour la DSN)"
            value={establishment}
            onChange={setEstablishment}
          >
            <option value="">Aucun</option>
            {dossier.data.establishments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.siret}
              </option>
            ))}
          </Select>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={confidential}
            onChange={(e) => setConfidential(e.target.checked)}
          />
          Confidentielle
        </label>
        <Button
          type="submit"
          loading={busy}
          disabled={!capabilities.actions.includes("create")}
        >
          Enregistrer l’obligation
        </Button>
        <Button type="button" disabled={busy} onClick={onCancel}>
          Annuler
        </Button>
      </form>
    </section>
  );
}
