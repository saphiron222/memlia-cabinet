import { z } from "zod";
import {
  CabinetRecordSchema,
  RecordContentSchema,
  type SessionUser,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { validateCustomFields } from "../administration/custom-values.js";
import { requireAccess } from "./permissions.js";
import { fail } from "../errors.js";
// Shared preflight and commit invariants. No writes and no guessed defaults.
export async function validateReferentialContent(
  tx: Connection,
  actor: SessionUser,
  record: z.infer<typeof RecordContentSchema>,
) {
  await validateCustomFields(tx, record);
  if (record.kind === "dossier") {
    if (record.dossierId !== null)
      fail(
        400,
        "INVALID_RELATION",
        "Un dossier ne dépend pas d’un autre dossier.",
      );
    if (
      record.data.siren &&
      record.data.establishments.some(
        (e) => e.siret && !e.siret.startsWith(record.data.siren!),
      )
    )
      fail(
        400,
        "INVALID_ESTABLISHMENT",
        "Le SIRET doit appartenir au SIREN du dossier.",
      );
    if (
      record.data.startedOn &&
      record.data.endedOn &&
      record.data.endedOn < record.data.startedOn
    )
      fail(400, "INVALID_DATE_RANGE", "La fin d’activité précède le début.");
    if (
      record.data.establishments.some(
        (e) => e.openedOn && e.closedOn && e.closedOn < e.openedOn,
      )
    )
      fail(
        400,
        "INVALID_DATE_RANGE",
        "La fermeture de l’établissement précède son ouverture.",
      );
  }
  if (record.kind === "obligation" && !record.dossierId)
    fail(
      400,
      "DOSSIER_REQUIRED",
      "Une obligation doit être rattachée à un dossier.",
    );
  if (record.kind === "obligation" && record.data.fiscal) {
    const profile = record.data.fiscal;
    if (profile.contactId) {
      const rows = await tx.query(
        "SELECT content FROM cabinet_records WHERE id=$1 AND kind='contact'",
        [profile.contactId],
      );
      if (!rows[0]) fail(404, "NOT_FOUND", "Contact inaccessible.");
      const contact = CabinetRecordSchema.parse(rows[0].content);
      await requireAccess(tx, actor, "read", contact);
      if (
        contact.kind !== "contact" ||
        (contact.dossierId !== record.dossierId &&
          !contact.data.relatedDossierIds.includes(record.dossierId!))
      )
        fail(
          400,
          "INVALID_CONTACT",
          "Le contact doit être lié au dossier de l’obligation.",
        );
    }
    if (record.dossierId) {
      const rows = await tx.query(
        "SELECT content FROM cabinet_records WHERE id=$1 AND kind='dossier'",
        [record.dossierId],
      );
      const parent = rows[0]
        ? CabinetRecordSchema.parse(rows[0].content)
        : null;
      if (
        profile.establishmentId &&
        (parent?.kind !== "dossier" ||
          !parent.data.establishments.some(
            (e) => e.id === profile.establishmentId,
          ))
      )
        fail(400, "INVALID_ESTABLISHMENT", "Établissement du dossier requis.");
    }
    if (
      profile.responsibleIds.length &&
      (
        await tx.query(
          "SELECT id FROM cabinet_users WHERE active=true AND id=ANY($1::uuid[])",
          [profile.responsibleIds],
        )
      ).length !== new Set(profile.responsibleIds).size
    )
      fail(400, "INVALID_ASSIGNEE", "Responsable inconnu ou inactif.");
    if (record.data.nature === "IRPP" && !profile.contactId)
      fail(400, "CONTACT_REQUIRED", "Contact requis pour l’IRPP.");
    if (record.data.nature === "DSN" && !profile.establishmentId)
      fail(400, "ESTABLISHMENT_REQUIRED", "Établissement requis pour la DSN.");
    if (
      ["IRPP", "IFU_2561"].includes(record.data.nature) &&
      (!profile.period.start.endsWith("-01-01") ||
        profile.period.end !== profile.period.start.slice(0, 4) + "-12-31")
    )
      fail(400, "CIVIL_YEAR_REQUIRED", "Année civile des revenus requise.");
    if (["DSN", "RCM_2777"].includes(record.data.nature)) {
      const end = new Date(profile.period.start + "T00:00:00Z");
      end.setUTCMonth(end.getUTCMonth() + 1, 0);
      if (
        !profile.period.start.endsWith("-01") ||
        profile.period.end !== end.toISOString().slice(0, 10)
      )
        fail(400, "MONTH_REQUIRED", "Mois civil complet requis.");
    }
  }
  const ids = new Set([
    ...(record.dossierId ? [record.dossierId] : []),
    ...(record.kind === "contact" ? record.data.relatedDossierIds : []),
  ]);
  for (const id of ids) {
    const rows = await tx.query(
      "SELECT content FROM cabinet_records WHERE id=$1",
      [id],
    );
    if (!rows[0]) fail(404, "NOT_FOUND", "Ressource inaccessible.");
    const parent = CabinetRecordSchema.parse(rows[0].content);
    if (parent.kind !== "dossier")
      fail(400, "INVALID_RELATION", "Dossier attendu.");
    await requireAccess(tx, actor, "read", parent);
  }
}
