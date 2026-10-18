import type { Connection } from "../storage/database.js";
import { type SessionUser, RelationshipEntitySchema } from "@memlia/contracts";
import {
  load,
  authorize,
  record,
  event,
  identityFingerprint,
} from "./service.js";
import { fail, ApiFault } from "../errors.js";
import { idempotent } from "../storage/operations.js";
export async function onboardingStatus(
  tx: Connection,
  a: SessionUser,
  id: string,
  today: string,
) {
  const row = await load(tx, a, id);
  const d = row.data;
  if (d.kind !== "onboarding")
    fail(400, "ONBOARDING_REQUIRED", "Accueil requis.");
  const model = await load(tx, a, d.modelId);
  if (model.data.kind !== "onboarding_model")
    fail(400, "MODEL_REQUIRED", "Modèle requis.");
  const person = await record(tx, a, d.personId);
  const fresh = async (proofs: { documentId: string; result: string }[]) => {
    for (const proof of proofs)
      if (
        proof.result === "examined" &&
        !(
          await tx.query(
            "SELECT id FROM cabinet_documents WHERE previous_id=$1 LIMIT 1",
            [proof.documentId],
          )
        ).length
      )
        return true;
    return false;
  };
  let identity = false;
  let identityExpired = false;
  let identityOrigin: import("@memlia/contracts").FieldOrigin | null = null;
  for (const r of await tx.query(
    "SELECT content FROM cabinet_relationship WHERE kind='identity' AND content->'data'->>'personId'=$1 ORDER BY content->'data'->>'observedOn' DESC,content->>'updatedAt' DESC,id DESC LIMIT 1",
    [d.personId],
  )) {
    try {
      const proof = RelationshipEntitySchema.parse(r.content);
      await load(tx, a, proof.id);
      if (proof.data.kind === "identity")
        identityExpired = proof.data.expiresOn < today;
      if (
        proof.data.kind === "identity" &&
        proof.data.result === "examined" &&
        proof.data.expiresOn >= today &&
        proof.identityFingerprint === identityFingerprint(person) &&
        (await fresh(proof.data.evidence))
      ) {
        identity = true;
        identityOrigin = proof.origin;
      }
    } catch (e) {
      if (!(e instanceof ApiFault && [403, 404].includes(e.status))) throw e;
    }
  }
  const blockers: { code: string; stepId: string | null; reason: string }[] =
    [];
  if (!identity)
    blockers.push({
      code: "IDENTITY_REQUIRED",
      stepId: null,
      reason:
        "Identité requise : examen humain et pièce en cours de validité manquants.",
    });
  let mandate = false;
  const currentProofs = new Set<string>();
  for (const v of d.values)
    if (await fresh(v.evidence)) currentProofs.add(v.stepId);
  const steps = model.data.steps
    .filter((s) => s.active)
    .map((step) => {
      const value = d.values.find((v) => v.stepId === step.id),
        expired =
          step.semantic === "identity"
            ? identityExpired
            : !!value?.expiresOn && value.expiresOn < today;
      const done =
        step.semantic === "identity"
          ? identity
          : step.source !== "system" &&
            value?.status === "done" &&
            !expired &&
            value.value !== null &&
            value.value !== false &&
            (step.type !== "status" ||
              step.statuses.some((s) => s.id === value.value && s.final));
      if (step.semantic === "mandate" && done && currentProofs.has(step.id))
        mandate = true;
      if (
        step.required &&
        !done &&
        step.semantic !== "identity" &&
        step.semantic !== "mandate"
      )
        blockers.push({
          code: expired ? "EVIDENCE_EXPIRED" : "STEP_REQUIRED",
          stepId: step.id,
          reason:
            step.name +
            (expired ? " : preuve expirée." : " : étape requise manquante."),
        });
      return {
        ...step,
        value:
          step.semantic === "identity"
            ? identity
              ? true
              : null
            : (value?.value ?? null),
        status: done
          ? "done"
          : expired || value?.status === "done"
            ? "blocked"
            : (value?.status ?? "pending"),
        verifiedAccess: false,
        provenance:
          step.source === "system"
            ? null
            : step.semantic === "identity"
              ? identityOrigin
              : (row.valueOrigins[step.id] ?? null),
        expired,
      };
    });
  if (!mandate)
    blockers.push({
      code: "MANDATE_REQUIRED",
      stepId: null,
      reason:
        "Mandat requis : pouvoirs examinés et justificatif manquants ou expirés.",
    });
  return {
    row,
    steps,
    blockers,
    complete: blockers.length === 0,
    creationOrigins: (await record(tx, a, d.dossierId)).data.fieldOrigins,
    portalState: "not_activated" as const,
  };
}
export async function activate(
  tx: Connection,
  a: SessionUser,
  id: string,
  i: { operationId: string; expectedVersion: number },
  now: Date,
  today: string,
) {
  const row = await load(tx, a, id, "update");
  const status = await onboardingStatus(tx, a, id, today);
  if (status.blockers.length)
    fail(
      409,
      "ONBOARDING_BLOCKED",
      "Activation bloquée : identité ou mandat requis.",
      status.blockers,
    );
  const result = await idempotent(
    tx,
    a,
    i.operationId,
    { activation: id, input: i },
    async () => {
      if (row.version !== i.expectedVersion)
        fail(409, "VERSION_CONFLICT", "Accueil modifié.");
      await event(tx, a, row, i.operationId, "activation_requested", null, now);
      return {
        id,
        rowVersion: row.version,
        state: "pending_portal_producer" as const,
      };
    },
  );
  await authorize(tx, a, row);
  return result;
}
