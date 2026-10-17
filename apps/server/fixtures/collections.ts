import type {
  CollectionInput,
  CollectionScopeSchema,
  ObservationData,
  ConnectorId,
} from "@memlia/contracts";
import type { z } from "zod";
// All identifiers, amounts, messages and bytes below are invented for local tests.
// These are adapter fixtures, never a representation of an actual portal contract.
export const fixtureIdentity = {
  companyId: "001234567",
  accountId: "COMPTE-FICTIF",
  establishmentId: "00123456700011",
  contributorId: "COTISANT-FICTIF",
  service: "consultation",
  profile: "employeur" as const,
};
export const fixturePeriod = { from: "2026-01-01", to: "2026-12-31" };
export const collectorLabels: Record<ConnectorId, string> = {
  "dgfip-cfe": "Avis CFE / IFER",
  "dgfip-taxe-fonciere": "Taxe foncière",
  "dgfip-attestation-fiscale": "Attestation fiscale",
  "dgfip-dettes": "Dettes et apurements DGFiP",
  "dgfip-tva-documents": "Documents TVA",
  "dgfip-is-documents": "Documents IS",
  "dgfip-messages": "Messages DGFiP",
  "dgfip-habilitations": "Habilitations DGFiP",
  "urssaf-attestations": "Attestations Urssaf",
  "urssaf-echeances": "Échéanciers Urssaf",
  "urssaf-messages": "Messages Urssaf",
  "inpi-creations": "Événements RNE publics",
  "inpi-actes": "Actes INPI publics",
  "inpi-comptes": "Comptes annuels INPI",
  "jedeclare-retours": "Retours jedeclare",
  "pennylane-dossiers": "Portefeuille Pennylane",
  "pennylane-echeances": "Données fiscales Pennylane",
};
export interface FixtureRecord {
  reference: string;
  version: string;
  rawState: string | null;
  data: ObservationData;
  documents: string[];
}
export interface FixturePage {
  identity: z.infer<typeof CollectionScopeSchema>;
  period: typeof fixturePeriod;
  boundary: "last-page" | "unknown";
  records: FixtureRecord[];
  missing: string[];
}
export function simulate(input: CollectionInput): FixturePage {
  const variation = input.scenario === "variation";
  const identity: z.infer<typeof CollectionScopeSchema> = {
    ...fixtureIdentity,
    dossierId: input.scope.dossierId,
  };
  // TI and PAM are independent fictional account/profile branches, not one calendar.
  if (
    input.connectorId === "urssaf-echeances" &&
    ["TI", "PAM"].includes(input.scope.profile)
  )
    identity.profile = input.scope.profile;
  if (input.scenario === "wrong-identity") identity.companyId = "009999999";
  const records: FixtureRecord[] = [];
  const missing: string[] = [];
  const add = (
    reference: string,
    data: ObservationData,
    documents: string[] = [],
    version = variation ? "2" : "1",
    rawState: string | null = null,
  ) => records.push({ reference, version, data, documents, rawState });
  switch (input.connectorId) {
    case "dgfip-cfe":
      add(
        "CFE-FICTIF-2026",
        {
          kind: "tax-notice",
          tax: "CFE",
          role: "general",
          assessmentYear: 2026,
          recoveryYear: 2026,
          amountCents: 125000,
          dueDate: "2026-12-15",
          directDebitEnabled: true,
          paymentObserved: false,
          parts: ["main"],
        },
        ["avis-cfe-fictif.pdf"],
      );
      break;
    case "dgfip-taxe-fonciere":
      add(
        "TF-FICTIF-2026",
        {
          kind: "tax-notice",
          tax: "TF",
          role: "general",
          assessmentYear: 2026,
          recoveryYear: 2026,
          amountCents: 250000,
          dueDate: "2026-10-15",
          directDebitEnabled: null,
          paymentObserved: false,
          parts: ["main", "continuation"],
        },
        ["tf-principal-fictif.pdf", "tf-suite-fictif.pdf"],
      );
      break;
    case "dgfip-attestation-fiscale":
      add(
        "ATTEST-FISCALE-FICTIVE",
        {
          kind: "certificate",
          type: "regularite-fiscale",
          issuedAt: variation ? null : "2026-10-01",
          assessedAt: variation ? null : "2026-09-30",
          state: variation ? "ineligible" : "available",
          group: null,
        },
        variation ? [] : ["attestation-fiscale-fictive.pdf"],
      );
      if (variation) missing.push("attestation-non-eligible-en-ligne");
      break;
    case "dgfip-dettes":
      add("DETTE-FICTIVE-1", {
        kind: "debt",
        tax: "TVA",
        amountCents: 100000,
        balanceCents: 80000,
      });
      add("APUREMENT-FICTIF-1", {
        kind: "settlement",
        debtReference: "DETTE-FICTIVE-1",
        nature: "remission",
        amountCents: 20000,
        paymentReference: null,
      });
      if (!variation)
        add("PAIEMENT-FICTIF-REJETE", {
          kind: "payment",
          amountCents: 80000,
          state: "rejected",
          debtReference: "DETTE-FICTIVE-1",
        });
      break;
    case "dgfip-tva-documents":
    case "dgfip-is-documents": {
      const tax = input.connectorId === "dgfip-tva-documents" ? "TVA" : "IS";
      add(
        tax + "-FICTIF-2026",
        {
          kind: "tax-document",
          tax,
          form: tax === "TVA" ? "CA3" : "2572",
          state: variation ? "rejected" : "filed",
          financialYearEnd: tax === "TVA" ? "2026-12-31" : "2026-06-30",
          paymentState: "unknown",
        },
        [tax.toLowerCase() + "-fictif.pdf"],
      );
      break;
    }
    case "dgfip-messages":
    case "urssaf-messages":
      add(
        "MESSAGE-FICTIF-1",
        {
          kind: "message",
          threadReference: "FIL-FICTIF-1",
          subject: "Demande fictive de précision",
          unreadBefore: true,
          unreadAfter: null,
          state: "awaiting-client",
          attachmentsExpected: 1,
          attachmentsMissing: variation ? 1 : 0,
          portfolios:
            input.connectorId === "urssaf-messages" && variation
              ? ["PORTEFEUILLE-A", "PORTEFEUILLE-B"]
              : ["PORTEFEUILLE-A"],
          channel: "messagerie",
        },
        variation ? [] : ["pj-message-fictif.pdf"],
      );
      if (variation) missing.push("piece-jointe-message-1");
      break;
    case "dgfip-habilitations":
      add("HABILITATION-FICTIVE", {
        kind: "entitlement",
        service: "consultation",
        userReference: "UTILISATEUR-FICTIF",
        role: "consultation",
        state: variation ? "dormant" : "active",
      });
      break;
    case "urssaf-attestations":
      add(
        "ATTEST-URSSAF-FICTIVE",
        {
          kind: "certificate",
          type: "vigilance",
          issuedAt: variation ? null : "2026-10-01",
          assessedAt: variation ? null : "2026-09-30",
          state: variation ? "pending" : "available",
          group: null,
        },
        variation ? [] : ["attestation-urssaf-fictive.pdf"],
      );
      if (variation) missing.push("attestation-en-attente");
      break;
    case "urssaf-echeances": {
      const profile = identity.profile as "employeur" | "TI" | "PAM";
      add(
        "ECHEANCIER-" + profile + "-FICTIF",
        {
          kind: "schedule",
          profile,
          axis:
            profile === "TI"
              ? "provisional"
              : profile === "PAM"
                ? "called"
                : "definitive",
          incomeYear: 2025,
          contributionYear: 2026,
          dueDate: "2026-11-05",
          amountCents: 32000,
          paymentObserved: false,
        },
        ["echeancier-fictif.pdf"],
      );
      if (variation)
        add(
          "REGULARISATION-" + profile + "-FICTIVE",
          {
            kind: "schedule",
            profile,
            axis: "regularisation",
            incomeYear: 2024,
            contributionYear: 2025,
            dueDate: "2026-12-05",
            amountCents: 4500,
            paymentObserved: false,
          },
          [],
          "2",
        );
      break;
    }
    case "inpi-creations":
      add("RNE-FICTIF-1", {
        kind: "registry-event",
        event: variation ? "modification" : "creation",
        scope: "public-rne",
        privateFormalityAccess: false,
      });
      break;
    case "inpi-actes":
    case "inpi-comptes":
      add(
        "RNE-DOCUMENT-FICTIF",
        {
          kind: "registry-document",
          type: input.connectorId === "inpi-actes" ? "act" : "annual-accounts",
          depositedAt: "2026-08-01",
          financialYearEnd:
            input.connectorId === "inpi-actes" ? null : "2025-12-31",
          access: variation ? "confidential" : "public",
          resource: "pdf",
          scope: "public-rne",
        },
        variation ? [] : ["rne-fictif.pdf"],
      );
      if (variation) missing.push("document-confidentiel-non-accessible");
      break;
    case "jedeclare-retours":
      add(
        "ADS-FICTIF",
        {
          kind: "recipient-return",
          attemptReference: "DEPOT-FICTIF-1",
          recipient: "plateforme",
          stage: "ADS",
          state: "accepted",
          expectedReturnPolicy: "explicit",
          replacesAttempt: null,
        },
        ["ads-fictif.pdf"],
      );
      add("ACS-FICTIF", {
        kind: "recipient-return",
        attemptReference: "DEPOT-FICTIF-1",
        recipient: "plateforme",
        stage: "ACS",
        state: "accepted",
        expectedReturnPolicy: "explicit",
        replacesAttempt: null,
      });
      add("ARS-A-FICTIF", {
        kind: "recipient-return",
        attemptReference: "DEPOT-FICTIF-1",
        recipient: "DESTINATAIRE-A",
        stage: "ARS",
        state: "accepted",
        expectedReturnPolicy: "explicit",
        replacesAttempt: null,
      });
      if (variation) {
        add("ARS-B-FICTIF", {
          kind: "recipient-return",
          attemptReference: "DEPOT-FICTIF-1",
          recipient: "DESTINATAIRE-B",
          stage: "ARS",
          state: "pending",
          expectedReturnPolicy: "unknown",
          replacesAttempt: null,
        });
        missing.push("retour-destinataire-B-attendu-inconnu");
      }
      break;
    case "pennylane-dossiers":
      add("SOCIETE-PL-FICTIVE", {
        kind: "company",
        values: { title: "Société Pennylane fictive", siren: "001234567" },
        externalCompanyId: "PL-FICTIF-1",
        connection: "firm-api",
        visibility: "visible",
      });
      break;
    case "pennylane-echeances":
      add("TVA-PL-FICTIVE", {
        kind: "tax-source",
        externalCompanyId: "PL-FICTIF-1",
        connection: "tax-data-sharing",
        warehouse: "ENTREPOT-FICTIF-A",
        sourceUpdatedAt: "2026-10-01T08:00:00.000Z",
        state: "done",
        isExpected: !variation,
        accepted: null,
        paymentValidated: true,
        bankPaymentObserved: false,
      });
      if (variation) missing.push("entrepot-B-indisponible");
      break;
  }
  if (input.connectorId === "urssaf-messages" && variation) {
    const message = records[0]!;
    if (message.data.kind === "message") {
      const data = message.data;
      records.splice(
        0,
        1,
        ...["PORTEFEUILLE-A", "PORTEFEUILLE-B"].map((portfolio) => ({
          ...message,
          data: { ...data, portfolios: [portfolio] },
        })),
      );
    }
  }
  if (input.scenario === "empty" || input.scenario === "unavailable")
    records.length = 0;
  if (input.scenario === "missing-page")
    missing.push("page-2-frontiere-inconnue");
  return {
    identity,
    period: fixturePeriod,
    boundary: input.scenario === "missing-page" ? "unknown" : "last-page",
    records,
    missing,
  };
}
export function fictitiousPdf(filename: string, record: FixtureRecord): Buffer {
  const lines = [
    "SIMULATION - SANS VALEUR FISCALE",
    filename,
    record.reference,
    "SIREN 001234567 - Etablissement 00123456700011",
    "Periode 2026-01-01 au 2026-12-31",
    ...(record.data.kind === "tax-notice"
      ? [
          `Montant en centimes : ${record.data.amountCents ?? "inconnu"}`,
          `Echeance : ${record.data.dueDate ?? "inconnue"}`,
        ]
      : []),
  ];
  const stream =
    "BT /F1 10 Tf 14 TL 30 720 Td " +
    lines
      .map((line, index) => (index ? "T* " : "") + `(${line}) Tj`)
      .join(" ") +
    " ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(output));
    output += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const start = Buffer.byteLength(output);
  output += `xref\n0 6\n0000000000 65535 f \n${offsets.map((n) => String(n).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(output);
}
