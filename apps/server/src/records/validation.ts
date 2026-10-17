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
