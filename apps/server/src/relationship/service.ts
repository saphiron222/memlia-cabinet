import { loadProductionModel, modelAccess } from "../production/service.js";
import { digest } from "../identity/security.js";
import { onboardingStatus } from "./onboarding.js";
import { relationshipDocumentPredicate } from "./document-scope.js";
import { randomUUID } from "node:crypto";
import {
  RelationshipEntitySchema,
  RelationshipSaveSchema,
  RelationshipEventSchema,
  type RelationshipEntity,
  type RelationshipData,
  type RelationshipSave,
  type SessionUser,
  type Action,
  CabinetRecordSchema,
  CivilDateSchema,
  type RelationshipQuerySchema,
} from "@memlia/contracts";
import { z } from "zod";
import type { Connection } from "../storage/database.js";
import { fail, ApiFault } from "../errors.js";
import {
  requireAccess,
  requireGlobal,
  scopedPermission,
} from "../records/permissions.js";
import { loadRecord, saveRecord } from "../records/service.js";
import { idempotent } from "../storage/operations.js";
import { stableId } from "../workflows/generation.js";
export async function raw(tx: Connection, id: string) {
  const r = await tx.query(
    "SELECT content FROM cabinet_relationship WHERE id=$1",
    [id],
  );
  if (!r[0]) fail(404, "NOT_FOUND", "Ressource inaccessible.");
  return RelationshipEntitySchema.parse(r[0].content);
}
export async function record(
  tx: Connection,
  a: SessionUser,
  id: string,
  action: Action = "read",
) {
  const r = await loadRecord(tx, id);
  await requireAccess(tx, a, action, r);
  let after = 0;
  while (true) {
    const history = await tx.query(
      "SELECT event->'snapshot' content FROM cabinet_history WHERE record_id=$1 AND (event->>'version')::integer>$2 ORDER BY (event->>'version')::integer LIMIT 100",
      [id, after],
    );
    if (!history.length) break;
    for (const h of history) {
      const snapshot = CabinetRecordSchema.parse(h.content);
      await requireAccess(tx, a, "read", snapshot);
      after = snapshot.version;
    }
  }
  return r;
}
export async function authorize(
  tx: Connection,
  a: SessionUser,
  e: RelationshipEntity,
  action: Action = "read",
) {
  const d = e.data;
  if (
    d.kind === "pipeline" ||
    d.kind === "mission" ||
    d.kind === "onboarding_model" ||
    d.kind === "lab_policy"
  ) {
    if (d.kind === "lab_policy")
      requireGlobal(
        a,
        action === "read"
          ? "lab_read"
          : action === "export"
            ? "lab_export"
            : "lab_manage",
      );
    if (action !== "read")
      requireGlobal(a, action === "export" ? "export" : "manage_users");
    return;
  }
  if (d.kind !== "prospect") {
    await record(tx, a, d.dossierId, action);
    if (d.kind === "lab") {
      const verb =
        action === "export"
          ? "lab_export"
          : action === "read"
            ? "lab_read"
            : "lab_manage";
      if (
        !(await scopedPermission(tx, a, verb, "dossier", d.dossierId)) ||
        !(await scopedPermission(tx, a, "lab_read", "dossier", d.dossierId))
      )
        fail(404, "NOT_FOUND", "Ressource inaccessible.");
    }
    if (d.personId) {
      const person = await record(tx, a, d.personId);
      if (person.kind !== "contact" || person.data.contactType !== "personne")
        fail(400, "PERSON_REQUIRED", "Personne requise.");
    }
    const evidence =
      d.kind === "onboarding"
        ? d.values.flatMap((v) => v.evidence)
        : d.evidence;
    for (const proof of evidence) await evidenceAccess(tx, a, proof);
    return;
  }
  const c = await record(tx, a, d.contactId, action);
  if (c.kind !== "contact") fail(400, "CONTACT_REQUIRED", "Contact requis.");
  if (d.mainContactId) await record(tx, a, d.mainContactId);
  if (d.dossierId) await record(tx, a, d.dossierId);
}
export async function load(
  tx: Connection,
  a: SessionUser,
  id: string,
  action: Action = "read",
) {
  const e = await raw(tx, id);
  await authorize(tx, a, e, action);
  let after = 0;
  while (true) {
    const rows = await tx.query(
      "SELECT content FROM cabinet_relationship_history WHERE id=$1 AND version>$2 ORDER BY version LIMIT 100",
      [id, after],
    );
    if (!rows.length) break;
    for (const row of rows) {
      const h = RelationshipEntitySchema.parse(row.content);
      await authorize(tx, a, h);
      after = h.version;
    }
  }
  return e;
}
export async function persist(tx: Connection, e: RelationshipEntity) {
  if (Buffer.byteLength(JSON.stringify(e)) > 200 * 1024)
    fail(413, "ENTITY_LIMIT", "Réduisez la fiche.");
  await tx.query(
    "INSERT INTO cabinet_relationship(id,kind,content) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO UPDATE SET content=EXCLUDED.content",
    [e.id, e.data.kind, JSON.stringify(e)],
  );
  await tx.query(
    "INSERT INTO cabinet_relationship_history(id,version,content) VALUES($1,$2,$3::jsonb)",
    [e.id, e.version, JSON.stringify(e)],
  );
  return e;
}
export async function event(
  tx: Connection,
  a: SessionUser,
  e: RelationshipEntity,
  operationId: string,
  type: z.infer<typeof RelationshipEventSchema>["type"],
  model: RelationshipEntity | null,
  now: Date,
) {
  const id = stableId(
    e.id +
      ":" +
      type +
      (type === "quote_requested" || type === "letter_requested"
        ? ":" + operationId
        : ""),
  );
  const d = e.data;
  const value = RelationshipEventSchema.parse({
    id,
    entityId: e.id,
    version: e.version,
    actorId: a.id,
    operationId,
    at: now.toISOString(),
    type,
    state: type === "converted" ? "recorded" : "pending_producer",
    dossierId: "dossierId" in d ? d.dossierId : null,
    modelId: model?.id ?? null,
    modelVersion: model?.version ?? null,
  });
  await tx.query(
    "INSERT INTO cabinet_relationship_events(id,entity_id,content) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO NOTHING",
    [id, e.id, JSON.stringify(value)],
  );
}
async function validate(
  tx: Connection,
  a: SessionUser,
  d: RelationshipData,
  old: RelationshipEntity | null,
) {
  if (old && old.data.kind !== d.kind)
    fail(400, "IMMUTABLE_KIND", "Type immuable.");
  if (d.kind === "pipeline" && old?.data.kind === "pipeline")
    for (const stage of old.data.stages)
      if (
        !d.stages.some((s) => s.id === stage.id) &&
        (
          await tx.query(
            "SELECT id FROM cabinet_relationship_history WHERE content->'data'->>'pipelineId'=$1 AND content->'data'->>'stageId'=$2 LIMIT 1",
            [old.id, stage.id],
          )
        ).length
      )
        fail(
          409,
          "STAGE_IN_USE",
          "Cette étape est utilisée ; conservez son identité.",
        );
  if (d.kind === "onboarding_model" && old?.data.kind === "onboarding_model")
    for (const step of old.data.steps) {
      const next = d.steps.find((s) => s.id === step.id);
      if (
        step.source === "system" &&
        JSON.stringify(next) !== JSON.stringify(step)
      )
        fail(
          409,
          "SYSTEM_STEP_LOCKED",
          "Une étape système ne peut être modifiée ou supprimée.",
        );
      if (
        !next &&
        (
          await tx.query(
            "SELECT id FROM cabinet_relationship_history WHERE content->'data'->>'modelId'=$1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(content->'data'->'values') v WHERE v->>'stepId'=$2) LIMIT 1",
            [old.id, step.id],
          )
        ).length
      )
        fail(
          409,
          "STEP_IN_USE",
          "Désactivez cette étape utilisée pour conserver ses valeurs.",
        );
      if (
        next &&
        (step.stageTypeId !== next.stageTypeId ||
          step.stageTypeVersion !== next.stageTypeVersion ||
          step.statuses.some(
            (s) => !next.statuses.some((n) => n.id === s.id),
          )) &&
        (
          await tx.query(
            "SELECT id FROM cabinet_relationship_history WHERE content->'data'->>'modelId'=$1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(content->'data'->'values') v WHERE v->>'stepId'=$2) LIMIT 1",
            [old.id, step.id],
          )
        ).length
      )
        fail(
          409,
          "STEP_MIGRATION_REQUIRED",
          "Conservez le type versionné utilisé ; créez une nouvelle étape.",
        );
      if (
        next &&
        (step.type !== next.type ||
          step.semantic !== next.semantic ||
          step.source !== next.source)
      )
        fail(
          409,
          "STEP_MIGRATION_REQUIRED",
          "Conservez le type et créez une nouvelle étape.",
        );
    }
  if (d.kind === "onboarding_model")
    for (const step of d.steps) {
      if (step.stageTypeId) {
        const current = await loadProductionModel(tx, step.stageTypeId);
        await modelAccess(tx, a, current);
        const type = await loadProductionModel(
          tx,
          step.stageTypeId,
          step.stageTypeVersion ?? current.version,
        );
        await modelAccess(tx, a, type);
        if (step.type !== "status" || type.model.kind !== "stage_type")
          fail(400, "STAGE_TYPE_REQUIRED", "Type de statut canonique requis.");
        step.stageTypeVersion = type.version;
        step.statuses = type.model.statuses;
      } else if (step.type === "status" && !step.statuses.length)
        fail(
          400,
          "STATUSES_REQUIRED",
          "Définissez les statuts de cette étape.",
        );
    }
  if (
    d.kind === "onboarding" ||
    d.kind === "identity" ||
    (d.kind === "lab" && d.personId)
  ) {
    const person = await record(tx, a, d.personId!);
    if (
      person.kind !== "contact" ||
      !new Set([person.dossierId, ...person.data.relatedDossierIds]).has(
        d.dossierId,
      )
    )
      fail(
        400,
        "PERSON_DOSSIER_LINK_REQUIRED",
        "Rattachez cette personne au dossier avant cet examen.",
      );
  }
  if (d.kind === "prospect" || d.kind === "onboarding") {
    const previous = old?.data.kind === d.kind ? old.data : null;
    if (
      JSON.stringify([previous?.assigneeIds ?? [], previous?.teamIds ?? []]) !==
      JSON.stringify([d.assigneeIds, d.teamIds])
    )
      await record(
        tx,
        a,
        d.kind === "prospect" ? d.contactId : d.dossierId,
        "assign",
      );
    for (const id of d.assigneeIds)
      if (
        !(
          await tx.query(
            "SELECT id FROM cabinet_users WHERE id=$1 AND active=true",
            [id],
          )
        ).length
      )
        fail(400, "INVALID_ASSIGNEE", "Responsable inactif.");
    for (const id of d.teamIds)
      if (
        !(
          await tx.query(
            "SELECT id FROM cabinet_groups WHERE id=$1 AND content->>'kind'='team'",
            [id],
          )
        ).length
      )
        fail(400, "INVALID_TEAM", "Équipe inconnue.");
  }
  if (d.kind === "onboarding") {
    const m = await load(tx, a, d.modelId);
    if (m.data.kind !== "onboarding_model")
      fail(400, "MODEL_REQUIRED", "Modèle onboarding requis.");
    for (const value of d.values) {
      const step = m.data.steps.find((s) => s.id === value.stepId);
      if (!step) fail(400, "STEP_REQUIRED", "Étape inconnue.");
      if (
        step.type === "status" &&
        value.status === "done" &&
        !step.statuses.some((s) => s.id === value.value && s.final)
      )
        fail(
          400,
          "FINAL_STATUS_REQUIRED",
          "Choisissez un statut final pour terminer cette étape.",
        );
      if (step.source === "system")
        fail(
          403,
          "SOURCE_OBSERVATION_REQUIRED",
          "Cette étape est alimentée uniquement par une observation source qualifiée.",
        );
      if (
        value.value !== null &&
        ((step.type === "boolean" && typeof value.value !== "boolean") ||
          (step.type !== "boolean" && typeof value.value !== "string") ||
          (step.type === "date" &&
            !CivilDateSchema.safeParse(value.value).success) ||
          (step.type === "status" &&
            !step.statuses.some((s) => s.id === value.value)))
      )
        fail(400, "VALUE_TYPE", "Valeur incompatible avec le type d’étape.");
    }
  }
  if (d.kind === "lab") {
    const policy = await load(tx, a, d.policyId);
    if (
      policy.data.kind !== "lab_policy" ||
      !policy.data.active ||
      policy.version !== d.policyVersion
    )
      fail(409, "POLICY_CHANGED", "Politique inactive ou modifiée.");
  }
  if (d.kind !== "prospect") return;
  if (old?.data.kind === "prospect" && old.data.contactId !== d.contactId)
    fail(400, "IMMUTABLE_CONTACT", "Le prospect conserve son contact.");
  if (
    !old &&
    (
      await tx.query(
        "SELECT id FROM cabinet_relationship WHERE kind='prospect' AND content->'data'->>'contactId'=$1 LIMIT 1",
        [d.contactId],
      )
    ).length
  )
    fail(409, "PROSPECT_EXISTS", "Ce contact possède déjà une fiche prospect.");
  const model = await load(tx, a, d.pipelineId);
  if (
    model.data.kind !== "pipeline" ||
    !model.data.stages.some((s) => s.id === d.stageId)
  )
    fail(400, "INVALID_STAGE", "Étape absente du pipeline.");
  if (
    !model.data.active &&
    (!old ||
      old.data.kind !== "prospect" ||
      old.data.pipelineId !== d.pipelineId)
  )
    fail(400, "INACTIVE_MODEL", "Pipeline inactif.");
  for (const line of d.missions) {
    const m = await load(tx, a, line.missionId);
    if (m.data.kind !== "mission")
      fail(400, "MISSION_REQUIRED", "Mission requise.");
    const retained =
      old?.data.kind === "prospect" &&
      old.data.missions.some((x) => JSON.stringify(x) === JSON.stringify(line));
    if (!retained && (!m.data.active || line.missionVersion !== m.version))
      fail(409, "MISSION_UNAVAILABLE", "Mission inactive ou modifiée.");
  }
}
async function trigger(
  tx: Connection,
  a: SessionUser,
  e: RelationshipEntity,
  operationId: string,
  now: Date,
  old: RelationshipEntity | null,
) {
  if (e.data.kind !== "prospect") return e;
  const model = await load(tx, a, e.data.pipelineId),
    d = e.data;
  if (model.data.kind !== "pipeline")
    fail(400, "PIPELINE_REQUIRED", "Pipeline requis.");
  if (model.data.conversionStageId === d.stageId && !d.dossierId) {
    const c = await record(tx, a, d.contactId, "update");
    if (c.kind !== "contact") fail(400, "CONTACT_REQUIRED", "Contact requis.");
    const created = await saveRecord(
      tx,
      a,
      {
        operationId: stableId(operationId + ":dossier"),
        record: {
          kind: "dossier",
          title: c.title,
          confidential: c.confidential,
          data: {
            siren: c.data.siren,
            legalForm: c.data.legalForm,
            capital: c.data.capital,
            address: c.data.address,
            createdOn: d.createdOn,
            activity: d.activity,
            notes: d.notes,
          },
        },
      },
      now,
      undefined,
      "created",
      undefined,
      e.origin,
    );
    d.dossierId = created.id;
    await saveRecord(
      tx,
      a,
      {
        operationId: stableId(operationId + ":contact"),
        expectedVersion: c.version,
        record: {
          kind: c.kind,
          title: c.title,
          dossierId: c.dossierId,
          confidential: c.confidential,
          data: {
            ...c.data,
            relatedDossierIds: [
              ...new Set([...c.data.relatedDossierIds, created.id]),
            ],
          },
        },
      },
      now,
      c.id,
    );
    await event(tx, a, e, operationId, "converted", model, now);
  }
  const entered =
    old?.data.kind !== "prospect" ||
    old.data.stageId !== d.stageId ||
    old.data.pipelineId !== d.pipelineId;
  if (entered && model.data.triggers.quoteStageId === d.stageId)
    await event(tx, a, e, operationId, "quote_requested", model, now);
  if (entered && model.data.triggers.letterStageId === d.stageId)
    await event(tx, a, e, operationId, "letter_requested", model, now);
  return e;
}
export async function save(
  tx: Connection,
  a: SessionUser,
  input: RelationshipSave,
  now: Date,
  moving = false,
) {
  const i = RelationshipSaveSchema.parse(input),
    rows = await tx.query("SELECT id FROM cabinet_relationship WHERE id=$1", [
      i.id,
    ]);
  const old = rows.length ? await load(tx, a, i.id, "update") : null;
  const candidate = RelationshipEntitySchema.parse({
    id: i.id,
    version: (old?.version ?? 0) + 1,
    actorId: a.id,
    createdAt: old?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
    origin: {
      kind: "manual",
      reference: a.id,
      version: String((old?.version ?? 0) + 1),
      at: now.toISOString(),
    },
    data: i.data,
  });
  if (candidate.data.kind === "onboarding") {
    candidate.valueOrigins = { ...old?.valueOrigins };
    for (const value of candidate.data.values) {
      const previous =
        old?.data.kind === "onboarding"
          ? old.data.values.find((v) => v.stepId === value.stepId)
          : null;
      if (JSON.stringify(previous) !== JSON.stringify(value))
        candidate.valueOrigins[value.stepId] = candidate.origin;
    }
  }
  await authorize(tx, a, candidate, old ? "update" : "create");
  if (candidate.data.kind === "identity")
    candidate.identityFingerprint = identityFingerprint(
      await record(tx, a, candidate.data.personId),
    );
  if (
    (
      await tx.query(
        "SELECT operation_id FROM cabinet_operations WHERE actor_id=$1 AND operation_id=$2",
        [a.id, i.operationId],
      )
    ).length
  ) {
    const replay = RelationshipEntitySchema.parse(
      await idempotent(
        tx,
        a,
        i.operationId,
        { relationship: i, moving },
        async () => fail(409, "OPERATION_CONFLICT", "Opération absente."),
      ),
    );
    await load(tx, a, replay.id);
    await authorize(tx, a, replay);
    return replay;
  }
  if (i.data.kind === "prospect") {
    if (
      i.data.dossierId !==
      (old?.data.kind === "prospect" ? old.data.dossierId : null)
    )
      fail(400, "CONVERSION_REQUIRED", "Utiliser la conversion du pipeline.");
    if (
      !moving &&
      old?.data.kind === "prospect" &&
      (i.data.stageId !== old.data.stageId ||
        i.data.pipelineId !== old.data.pipelineId)
    )
      fail(400, "MOVE_REQUIRED", "Utiliser le déplacement du prospect.");
  }
  const result = await idempotent(
    tx,
    a,
    i.operationId,
    { relationship: i, moving },
    async () => {
      if ((old?.version ?? 0) !== i.expectedVersion)
        fail(409, "VERSION_CONFLICT", "La fiche a changé. Rechargez-la.");
      await validate(tx, a, candidate.data, old);
      await persist(tx, candidate);
      await trigger(tx, a, candidate, i.operationId, now, old);
      // Conversion events and canonical links share this transaction and the same version.
      await tx.query(
        "UPDATE cabinet_relationship SET content=$2::jsonb WHERE id=$1",
        [candidate.id, JSON.stringify(candidate)],
      );
      await tx.query(
        "UPDATE cabinet_relationship_history SET content=$3::jsonb WHERE id=$1 AND version=$2",
        [candidate.id, candidate.version, JSON.stringify(candidate)],
      );
      return candidate;
    },
  );
  await load(tx, a, result.id);
  await authorize(tx, a, result);
  return result;
}
export async function move(
  tx: Connection,
  a: SessionUser,
  id: string,
  i: { operationId: string; expectedVersion: number; stageId: string },
  now: Date,
) {
  const current = await load(tx, a, id, "update");
  if (current.data.kind !== "prospect")
    fail(400, "PROSPECT_REQUIRED", "Prospect requis.");
  // Replay uses the original immutable source version, while current and proposed targets are reauthorized.
  const rows = await tx.query(
    "SELECT content FROM cabinet_relationship_history WHERE id=$1 AND version=$2",
    [id, i.expectedVersion],
  );
  if (!rows[0]) fail(409, "VERSION_CONFLICT", "Version absente.");
  const prior = RelationshipEntitySchema.parse(rows[0].content);
  if (prior.data.kind !== "prospect")
    fail(400, "PROSPECT_REQUIRED", "Prospect requis.");
  await authorize(tx, a, prior, "update");
  const operation = await tx.query(
    "SELECT result FROM cabinet_operations WHERE actor_id=$1 AND operation_id=$2",
    [a.id, i.operationId],
  );
  const data = {
    ...prior.data,
    stageId: i.stageId,
    dossierId: current.data.dossierId,
  };
  if (operation.length) {
    const result = RelationshipEntitySchema.parse(
      await idempotent(
        tx,
        a,
        i.operationId,
        {
          relationship: {
            id,
            expectedVersion: i.expectedVersion,
            operationId: i.operationId,
            data: { ...prior.data, stageId: i.stageId },
          },
          moving: true,
        },
        async () => fail(409, "OPERATION_CONFLICT", "Opération absente."),
      ),
    );
    await authorize(tx, a, result);
    return result;
  }
  return save(
    tx,
    a,
    {
      id,
      expectedVersion: i.expectedVersion,
      operationId: i.operationId,
      data,
    },
    now,
    true,
  );
}
export async function page(
  tx: Connection,
  a: SessionUser,
  q: z.infer<typeof RelationshipQuerySchema>,
  action: Action = "read",
  today?: string,
) {
  const items: RelationshipEntity[] = [];
  let total = 0,
    scanOffset = 0;
  while (true) {
    const rows: Record<string, unknown>[] = await tx.query(
      `SELECT e.id,e.content FROM cabinet_relationship e LEFT JOIN cabinet_records r ON r.id=COALESCE(e.content->'data'->>'contactId',e.content->'data'->>'dossierId')::uuid WHERE ($1::text IS NULL OR e.kind=$1) ORDER BY ${q.sort === "updated" ? "e.content->>'updatedAt' DESC" : "lower(COALESCE(e.content->'data'->>'name',r.content->>'title',''))"},e.id LIMIT 100 OFFSET $2`,
      [q.kind ?? null, scanOffset],
    );
    if (!rows.length) break;
    for (const row of rows) {
      try {
        const e = await load(tx, a, String(row.id), action),
          d = e.data;
        if (
          q.active &&
          ("active" in d ? d.active : true) !== (q.active === "true")
        )
          continue;
        if (d.kind === "prospect") {
          if (
            (q.stageId && d.stageId !== q.stageId) ||
            (q.pipelineId && d.pipelineId !== q.pipelineId) ||
            (q.contactId && d.contactId !== q.contactId) ||
            (q.dossierId && d.dossierId !== q.dossierId) ||
            (q.tag && !d.tags.includes(q.tag)) ||
            (q.assigneeId && !d.assigneeIds.includes(q.assigneeId)) ||
            (q.teamId && !d.teamIds.includes(q.teamId))
          )
            continue;
          const c = await record(tx, a, d.contactId);
          if (
            q.q &&
            !JSON.stringify([c.title, c.data])
              .toLocaleLowerCase("fr")
              .includes(q.q.toLocaleLowerCase("fr"))
          )
            continue;
        } else {
          if (
            q.dossierId &&
            ("dossierId" in d ? d.dossierId : null) !== q.dossierId
          )
            continue;
          if (
            q.q &&
            !("name" in d ? d.name : (await record(tx, a, d.dossierId)).title)
              .toLocaleLowerCase("fr")
              .includes(q.q.toLocaleLowerCase("fr"))
          )
            continue;
        }
        if (d.kind === "onboarding") {
          if (
            (q.origin && d.origin !== q.origin) ||
            (q.followed === "true" && !d.followedBy.includes(a.id)) ||
            (q.tag && !d.tags.includes(q.tag)) ||
            (q.assigneeId && !d.assigneeIds.includes(q.assigneeId)) ||
            (q.teamId && !d.teamIds.includes(q.teamId))
          )
            continue;
          if (
            q.hideCompleted === "true" &&
            today &&
            (await onboardingStatus(tx, a, e.id, today)).complete
          )
            continue;
        }
        if (total >= q.offset && items.length < q.limit) items.push(e);
        total++;
      } catch (error) {
        if (!(error instanceof ApiFault && [403, 404].includes(error.status)))
          throw error;
      }
    }
    scanOffset += rows.length;
  }
  return { items, total, offset: q.offset, limit: q.limit };
}

export async function evidenceAccess(
  tx: Connection,
  a: SessionUser,
  p: { documentId: string; version: number; sha256: string },
) {
  const args: unknown[] = [p.documentId];
  const predicate = relationshipDocumentPredicate(
    a,
    (v) => {
      args.push(v);
      return "$" + args.length;
    },
    "$1::uuid",
  );
  if (!(await tx.query(`SELECT ${predicate} allowed`, args))[0]?.allowed)
    fail(404, "NOT_FOUND", "Pièce inaccessible.");
  const rows = await tx.query(
    "SELECT content,dossier_id FROM cabinet_documents WHERE id=$1",
    [p.documentId],
  );
  if (!rows[0]) fail(404, "NOT_FOUND", "Pièce inaccessible.");
  const d = rows[0].content as {
    version: number;
    sha256: string;
    confidential: boolean;
  };
  await record(tx, a, String(rows[0].dossier_id));
  if (
    d.confidential &&
    !(await scopedPermission(
      tx,
      a,
      "confidential",
      "dossier",
      String(rows[0].dossier_id),
    ))
  )
    fail(404, "NOT_FOUND", "Pièce inaccessible.");
  if (d.version !== p.version || d.sha256 !== p.sha256)
    fail(
      409,
      "EVIDENCE_CHANGED",
      "Identité ou version documentaire différente.",
    );
  return rows[0];
}

export function identityFingerprint(
  r: import("@memlia/contracts").CabinetRecord,
) {
  if (r.kind !== "contact") return null;
  const d = r.data;
  return digest(
    JSON.stringify({
      title: r.title,
      firstName: d.firstName,
      lastName: d.lastName,
      birthDate: d.birthDate,
      birthCity: d.birthCity,
      birthCountry: d.birthCountry,
      address: d.address,
    }),
  );
}
