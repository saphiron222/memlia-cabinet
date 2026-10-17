import { productionValueFinal, productionPeriod } from "@memlia/contracts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ProductionModelSchema,
  ProductionModelCommandSchema,
  ProductionDuplicateSchema,
  ProductionRowSchema,
  ProductionTargetSchema,
  ProductionColumnSchema,
  ProductionCommandSchema,
  ProductionRowCreateSchema,
  ProductionMigrationSchema,
  RecordContentSchema,
  type ProductionModel,
  type ProductionRow,
  type SessionUser,
  type Action,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import {
  requireAccess,
  requireGlobal,
  hasPermission,
  scopedPermission,
} from "../records/permissions.js";
import { loadRecord, saveRecord } from "../records/service.js";
import { idempotent } from "../storage/operations.js";
import { fail } from "../errors.js";
import { stableId } from "../workflows/generation.js";
import { commandWork } from "../workflows/service.js";
export async function loadProductionModel(tx: Connection, id: string) {
  const r = await tx.query(
    "SELECT content FROM cabinet_production_models WHERE id=$1",
    [id],
  );
  if (!r[0]) fail(404, "NOT_FOUND", "Modèle inaccessible.");
  return ProductionModelSchema.parse(r[0].content);
}
export async function modelAccess(
  tx: Connection,
  actor: SessionUser,
  m: ProductionModel,
) {
  if (m.model.kind !== "stage_type") {
    for (const id of m.model.population)
      if (m.model.target !== "utilisateur")
        await requireAccess(tx, actor, "read", await loadRecord(tx, id));
      else {
        requireGlobal(actor, "read");
        await activeAssignee(tx, id);
      }
    for (const id of m.model.documentIds) {
      const docs = await tx.query(
        "SELECT dossier_id,content FROM cabinet_documents WHERE id=$1",
        [id],
      );
      if (!docs[0]) fail(404, "NOT_FOUND", "Pièce inaccessible.");
      await requireAccess(
        tx,
        actor,
        "read",
        await loadRecord(tx, String(docs[0].dossier_id)),
      );
      if (
        (docs[0].content as { confidential: boolean }).confidential &&
        !(await scopedPermission(
          tx,
          actor,
          "confidential",
          "dossier",
          String(docs[0].dossier_id),
        ))
      )
        fail(404, "NOT_FOUND", "Pièce inaccessible.");
    }
  }
}
export async function saveProductionModel(
  tx: Connection,
  actor: SessionUser,
  i: z.infer<typeof ProductionModelCommandSchema>,
  now: Date,
) {
  requireGlobal(actor, "manage_users");
  const rows = await tx.query(
    "SELECT content FROM cabinet_production_models WHERE id=$1",
    [i.id],
  );
  const old = rows[0] ? ProductionModelSchema.parse(rows[0].content) : null;
  const candidate = ProductionModelSchema.parse({
    id: i.id,
    version: i.expectedVersion + 1,
    actorId: actor.id,
    updatedAt: now.toISOString(),
    model: i.model,
  });
  if (old) await modelAccess(tx, actor, old);
  await modelAccess(tx, actor, candidate);
  const result = await idempotent(
    tx,
    actor,
    i.operationId,
    { productionModel: i },
    async () => {
      if ((old?.version ?? 0) !== i.expectedVersion)
        fail(409, "VERSION_CONFLICT", "Le modèle a changé. Rechargez.");
      if (old?.model.kind && old.model.kind !== i.model.kind)
        fail(409, "IMMUTABLE_KIND", "Le type du modèle est immuable.");
      if (
        old &&
        old.model.kind !== "stage_type" &&
        i.model.kind !== "stage_type"
      ) {
        const used = await tx.query(
          "SELECT id FROM cabinet_production_rows WHERE model_id=$1 LIMIT 1",
          [i.id],
        );
        if (used.length && old.model.target !== i.model.target)
          fail(
            409,
            "TARGET_MIGRATION_REQUIRED",
            "Migration explicite des cibles requise.",
          );
        if (
          used.length &&
          old.model.columns.some(
            (c) =>
              !i.model ||
              i.model.kind === "stage_type" ||
              !i.model.columns.some(
                (n) =>
                  n.id === c.id &&
                  n.type === c.type &&
                  n.frequency === c.frequency &&
                  n.stageTypeId === c.stageTypeId,
              ),
          )
        )
          fail(
            409,
            "COLUMN_IN_USE",
            "Conservez identité, type et fréquence des colonnes utilisées.",
          );
        if (
          used.length &&
          (old.model.year !== i.model.year ||
            old.model.family !== i.model.family)
        )
          fail(
            409,
            "IMMUTABLE_CAMPAIGN",
            "La campagne utilisée conserve année et famille.",
          );
      }
      if (old?.model.kind === "stage_type" && i.model.kind === "stage_type") {
        const used = await tx.query(
          "SELECT DISTINCT cell->>'value' AS status FROM cabinet_production_row_versions h JOIN cabinet_production_models m ON m.id=(h.content->>'modelId')::uuid CROSS JOIN LATERAL jsonb_array_elements(h.content->'cells') cell WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(m.content->'model'->'columns') col WHERE col->>'id'=cell->>'columnId' AND col->>'stageTypeId'=$1)",
          [old.id],
        );
        const usedIds = new Set(used.map((r) => String(r.status)));
        const next = i.model;
        if (
          old.model.statuses.some(
            (s) =>
              usedIds.has(s.id) &&
              !next.statuses.some((n) => n.id === s.id && n.final === s.final),
          )
        )
          fail(
            409,
            "STATUS_IN_USE",
            "Conservez les identités et états finaux existants.",
          );
      }
      if (i.model.kind !== "stage_type")
        for (const c of i.model.columns) {
          if (
            c.stageTypeId &&
            (await loadProductionModel(tx, c.stageTypeId)).model.kind !==
              "stage_type"
          )
            fail(400, "STAGE_TYPE_REQUIRED", "Type d’étape requis.");
          if (
            c.requiredRoleId &&
            !(
              await tx.query("SELECT id FROM cabinet_roles WHERE id=$1", [
                c.requiredRoleId,
              ])
            ).length
          )
            fail(400, "UNKNOWN_ROLE", "Rôle inconnu.");
          await activeAssignee(tx, c.assigneeId);
        }
      await persistModel(tx, candidate);
      return candidate;
    },
  );
  await modelAccess(tx, actor, result);
  return result;
}
export async function persistModel(tx: Connection, m: ProductionModel) {
  await tx.query(
    "INSERT INTO cabinet_production_models(id,content) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET content=EXCLUDED.content",
    [m.id, JSON.stringify(m)],
  );
  await tx.query(
    "INSERT INTO cabinet_production_model_versions(id,version,content) VALUES($1,$2,$3::jsonb)",
    [m.id, m.version, JSON.stringify(m)],
  );
}
export async function duplicateProductionModel(
  tx: Connection,
  actor: SessionUser,
  id: string,
  i: z.infer<typeof ProductionDuplicateSchema>,
  now: Date,
) {
  requireGlobal(actor, "manage_users");
  const old = await loadProductionModel(tx, id);
  await modelAccess(tx, actor, old);
  if (old.model.kind !== "balance")
    fail(400, "BALANCE_REQUIRED", "Configuration de bilan requise.");
  const m = old.model;
  const duplicateOperation = await tx.query(
    "SELECT operation_id FROM cabinet_operations WHERE actor_id=$1 AND operation_id=$2",
    [actor.id, i.operationId],
  );
  if (!duplicateOperation.length && old.version !== i.expectedVersion)
    fail(409, "VERSION_CONFLICT", "La configuration source a changé.");
  return saveProductionModel(
    tx,
    actor,
    {
      operationId: i.operationId,
      id: stableId(i.operationId + ":year"),
      expectedVersion: 0,
      model: {
        ...m,
        year: i.year,
        closed: false,
        columns: m.columns.map((c) => ({
          ...c,
          plannedDate: c.plannedDate
            ? c.plannedDate.endsWith("-02-29") &&
              !z.iso.date().safeParse(`${i.year}-02-29`).success
              ? `${i.year}-02-28`
              : `${i.year}${c.plannedDate.slice(4)}`
            : null,
        })),
      },
    },
    now,
  );
}
export async function activeAssignee(tx: Connection, id: string | null) {
  if (
    id &&
    !(
      await tx.query(
        "SELECT id FROM cabinet_users WHERE id=$1 AND active=true",
        [id],
      )
    ).length
  )
    fail(400, "INVALID_ASSIGNEE", "Responsable inactif ou inconnu.");
}
export async function targetScope(
  tx: Connection,
  actor: SessionUser,
  target: z.infer<typeof ProductionTargetSchema>,
  action: Action = "read",
) {
  if (target.kind === "libre" || target.kind === "utilisateur") {
    requireGlobal(actor, action);
    if (target.kind === "utilisateur") await activeAssignee(tx, target.id);
    return null;
  }
  const r = await loadRecord(tx, target.id!);
  if (r.kind !== target.kind)
    fail(400, "INVALID_TARGET", "Type de cible incompatible.");
  await requireAccess(tx, actor, action, r);
  return r;
}
export async function authorizeRow(
  tx: Connection,
  actor: SessionUser,
  row: ProductionRow,
  action: Action = "read",
) {
  await targetScope(tx, actor, row.target, action);
  if (row.scope) await requireAccess(tx, actor, action, row.scope);
  if (row.recordId)
    await requireAccess(tx, actor, action, await loadRecord(tx, row.recordId));
  await validateDocuments(tx, actor, row, [
    ...row.documentIds,
    ...row.observations.flatMap((o) => o.documentIds),
    ...row.cells.flatMap((c) => c.documentIds),
    ...row.deposit.attempts.flatMap((a) => [
      ...a.documentIds,
      ...(a.receiptDocumentId ? [a.receiptDocumentId] : []),
    ]),
  ]);
}
export async function loadProductionRow(
  tx: Connection,
  actor: SessionUser,
  id: string,
  action: Action = "read",
) {
  const rows = await tx.query(
    "SELECT content FROM cabinet_production_rows WHERE id=$1",
    [id],
  );
  if (!rows[0]) fail(404, "NOT_FOUND", "Ligne inaccessible.");
  const row = ProductionRowSchema.parse(rows[0].content);
  await authorizeRow(tx, actor, row, action);
  let after = 0;
  while (true) {
    const history = await tx.query(
      "SELECT version,content FROM cabinet_production_row_versions WHERE id=$1 AND version>$2 ORDER BY version LIMIT 100",
      [id, after],
    );
    if (!history.length) break;
    for (const h of history)
      await authorizeRow(
        tx,
        actor,
        ProductionRowSchema.parse(h.content),
        action,
      );
    after = Number(history.at(-1)!.version);
  }
  return row;
}
export async function validateDocuments(
  tx: Connection,
  actor: SessionUser,
  row: ProductionRow,
  ids: string[],
) {
  for (const id of new Set(ids)) {
    const docs = await tx.query(
      "SELECT dossier_id,content FROM cabinet_documents WHERE id=$1",
      [id],
    );
    if (!docs[0]) fail(404, "NOT_FOUND", "Pièce inaccessible.");
    const dossier = await loadRecord(tx, String(docs[0].dossier_id));
    await requireAccess(tx, actor, "read", dossier);
    if (
      (docs[0].content as { confidential: boolean }).confidential &&
      !(await scopedPermission(
        tx,
        actor,
        "confidential",
        "dossier",
        dossier.id,
      ))
    )
      fail(404, "NOT_FOUND", "Pièce inaccessible.");
    const scope = row.scope;
    const allowed =
      scope?.kind === "dossier"
        ? [scope.id]
        : scope?.kind === "contact"
          ? [scope.dossierId, ...scope.data.relatedDossierIds]
          : [];
    if (!allowed.includes(dossier.id))
      fail(
        400,
        "DOCUMENT_SCOPE",
        "La pièce doit appartenir à un dossier de cette cible.",
      );
  }
}
export async function persistRow(tx: Connection, row: ProductionRow) {
  ProductionRowSchema.parse(row);
  if (Buffer.byteLength(JSON.stringify(row)) > 400 * 1024)
    fail(
      413,
      "ROW_LIMIT",
      "Archivez cette période et ouvrez une nouvelle ligne.",
    );
  await tx.query(
    "INSERT INTO cabinet_production_rows(id,model_id,occurrence_key,record_id,content) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(id) DO UPDATE SET content=EXCLUDED.content",
    [row.id, row.modelId, row.occurrenceKey, row.recordId, JSON.stringify(row)],
  );
  await tx.query(
    "INSERT INTO cabinet_production_row_versions(id,version,content) VALUES($1,$2,$3::jsonb)",
    [row.id, row.version, JSON.stringify(row)],
  );
}
export async function createProductionRow(
  tx: Connection,
  actor: SessionUser,
  modelId: string,
  i: z.infer<typeof ProductionRowCreateSchema>,
  now: Date,
  dueDate: string | null = null,
  generation = false,
  checklistVersion?: number,
  frozenModel?: ProductionModel,
) {
  const m = frozenModel ?? (await loadProductionModel(tx, modelId));
  if (!generation) await modelAccess(tx, actor, m);
  if (m.model.kind === "stage_type")
    fail(400, "TEMPLATE_REQUIRED", "Modèle de production requis.");
  const template = m.model;
  if (template.kind === "balance" && i.period !== String(template.year))
    fail(
      400,
      "INVALID_ANNUAL_PERIOD",
      "La ligne doit appartenir à l’exercice configuré.",
    );
  const scope = await targetScope(tx, actor, i.target, "read");
  if (template.target !== i.target.kind)
    fail(400, "INVALID_TARGET", "La cible ne correspond pas au modèle.");
  if (scope && ["balance", "custom"].includes(template.kind)) {
    if (!(await scopedPermission(tx, actor, "create", "obligation", scope.id)))
      fail(403, "FORBIDDEN", "Création non autorisée.");
  } else if (scope) await requireAccess(tx, actor, "create", scope);
  else requireGlobal(actor, "create");
  const key =
    template.kind === "balance"
      ? `balance:${template.family}:${template.year}:${i.target.id}`
      : `${modelId}:${i.target.kind}:${i.target.id ?? i.target.label}:${i.period}${template.allowDuplicates && (template.kind === "process" || (template.kind === "custom" && !generation)) ? ":" + i.operationId : ""}`;
  const existing = await tx.query(
    "SELECT id FROM cabinet_production_rows WHERE occurrence_key=$1 OR ($2::boolean AND model_id=$3 AND content->'target'->>'kind'=$4 AND COALESCE(content->'target'->>'id',content->'target'->>'label')=$5 AND content->>'period'=$6) LIMIT 1",
    [
      key,
      !template.allowDuplicates,
      modelId,
      i.target.kind,
      i.target.id ?? i.target.label,
      i.period,
    ],
  );
  if (existing[0]) await loadProductionRow(tx, actor, String(existing[0].id));
  const result = await idempotent(
    tx,
    actor,
    i.operationId,
    { productionRow: { modelId, i, dueDate } },
    async () => {
      if (existing[0])
        return loadProductionRow(tx, actor, String(existing[0].id));
      if (m.version !== i.expectedVersion)
        fail(409, "VERSION_CONFLICT", "Le modèle a changé.");
      if (template.closed || template.paused)
        fail(409, "MODEL_PAUSED", "Modèle fermé ou génération suspendue.");
      let recordId: string | null = null;
      const dates = template.columns
        .map((c) => c.plannedDate)
        .filter((d): d is string => !!d)
        .sort();
      const date = dueDate ?? dates[0] ?? null;
      if (template.kind === "balance" || template.kind === "custom") {
        const record = await saveRecord(
          tx,
          actor,
          {
            operationId: stableId(i.operationId + ":record"),
            record: RecordContentSchema.parse({
              kind: "obligation",
              title: template.name + " · " + i.period,
              dossierId: i.target.id,
              data: {
                nature: template.kind === "balance" ? "bilan" : template.nature,
                period: i.period,
                dueDate: date,
              },
            }),
          },
          now,
          undefined,
          "created",
          undefined,
          {
            kind: generation ? "generated" : "manual",
            reference: generation ? m.id : actor.id,
            version: String(m.version),
            at: now.toISOString(),
          },
        );
        recordId = record.id;
      }
      const row = ProductionRowSchema.parse({
        id: recordId ?? randomUUID(),
        recordId,
        modelId,
        modelVersion: m.version,
        version: 1,
        target: { ...i.target, label: scope?.title ?? i.target.label },
        scope,
        period: i.period,
        occurrenceKey: key,
        dueDate: date,
        assigneeId: template.assigneeId,
        tags: template.tags,
        documentIds:
          scope?.kind === "dossier"
            ? (
                await tx.query(
                  "SELECT id FROM cabinet_documents WHERE id=ANY($1::uuid[]) AND dossier_id=$2",
                  [template.documentIds, scope.id],
                )
              ).map((d) => String(d.id))
            : template.documentIds,
        workVersionAtCreation: recordId && template.checklistModelId ? 1 : 0,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      await activeAssignee(tx, row.assigneeId);
      await validateDocuments(tx, actor, row, row.documentIds);
      await persistRow(tx, row);
      if (recordId && template.checklistModelId)
        await commandWork(
          tx,
          actor,
          recordId,
          {
            operationId: stableId(i.operationId + ":checklist"),
            expectedVersion: 0,
            command: {
              kind: "instantiate",
              modelId: template.checklistModelId,
              ...(checklistVersion ? { modelVersion: checklistVersion } : {}),
            },
          },
          now,
        );
      return row;
    },
  );
  await authorizeRow(tx, actor, result);
  return result;
}
export async function columnRole(
  tx: Connection,
  actor: SessionUser,
  role: string | null,
  dossierId: string | null,
) {
  if (!role) return;
  const roles = await tx.query(
    `SELECT 1 FROM cabinet_user_roles WHERE user_id=$1 AND role_id=$2 UNION ALL SELECT 1 FROM cabinet_assignments a WHERE a.role_id=$2 AND a.dossier_id=$3 AND ((a.subject_kind='user' AND a.subject_id=$1) OR (a.subject_kind IN ('team','site') AND EXISTS(SELECT 1 FROM cabinet_memberships m WHERE m.group_id=a.subject_id AND m.user_id=$1))) LIMIT 1`,
    [actor.id, role, dossierId],
  );
  if (!roles.length)
    fail(
      403,
      "STAGE_ROLE_REQUIRED",
      "Le rôle configuré est requis pour cette étape.",
    );
}
export async function commandProductionRow(
  tx: Connection,
  actor: SessionUser,
  id: string,
  i: z.infer<typeof ProductionCommandSchema>,
  now: Date,
  regeneration = false,
) {
  const old = await loadProductionRow(tx, actor, id, "update");
  const model = await loadProductionModel(tx, old.modelId);
  if (model.model.kind === "stage_type")
    fail(400, "TEMPLATE_REQUIRED", "Modèle requis.");
  const template = model.model,
    c = i.command;
  if (c.kind === "cell") {
    const column = template.columns.find((x) => x.id === c.columnId);
    if (!column) fail(400, "UNKNOWN_COLUMN", "Étape inconnue.");
    await columnRole(
      tx,
      actor,
      column.requiredRoleId,
      old.scope?.kind === "dossier"
        ? old.scope.id
        : (old.scope?.dossierId ?? null),
    );
    if (column.approval || c.approve)
      await authorizeRow(tx, actor, old, "approve");
  }
  const result = await idempotent(
    tx,
    actor,
    i.operationId,
    { productionCommand: { id, i } },
    async () => {
      if (old.version !== i.expectedVersion)
        fail(
          409,
          "VERSION_CONFLICT",
          "Cette ligne a changé. Rechargez avant de modifier.",
        );
      if (template.closed) fail(409, "MODEL_CLOSED", "Configuration fermée.");
      const row = structuredClone(old);
      if (c.kind === "cell") {
        const column = template.columns.find((x) => x.id === c.columnId)!;
        const periodPattern =
          column.frequency === "once"
            ? /^once$/
            : column.frequency === "yearly"
              ? /^\d{4}$/
              : column.frequency === "monthly"
                ? /^\d{4}-(0[1-9]|1[0-2])$/
                : /^\d{4}-Q[1-4]$/;
        if (!periodPattern.test(c.period))
          fail(
            400,
            "INVALID_CELL_PERIOD",
            "Période incompatible avec la fréquence de la colonne.",
          );
        if (c.value !== null) {
          let valid = false;
          switch (column.type) {
            case "boolean":
              valid = typeof c.value === "boolean";
              break;
            case "date":
              valid = z.iso.date().safeParse(c.value).success;
              break;
            case "decimal":
              valid =
                typeof c.value === "string" && /^-?\d+(\.\d+)?$/.test(c.value);
              break;
            case "text":
              valid = typeof c.value === "string";
              break;
            case "completion":
              valid = ["done", "not_done", "not_applicable"].includes(
                String(c.value),
              );
              break;
            case "status": {
              const st = await loadProductionModel(tx, column.stageTypeId!);
              valid =
                st.model.kind === "stage_type" &&
                st.model.statuses.some((s) => s.id === c.value);
              break;
            }
          }
          if (!valid)
            fail(
              400,
              "INVALID_CELL_VALUE",
              "Valeur incompatible avec le type de l’étape.",
            );
        }
        if (column.approval && !c.approve)
          fail(
            400,
            "APPROVAL_REQUIRED",
            "Validation explicite requise pour cette étape.",
          );
        await validateDocuments(tx, actor, row, c.documentIds);
        row.cells = row.cells.filter(
          (x) => x.columnId !== c.columnId || x.period !== c.period,
        );
        row.cells.push({
          columnId: c.columnId,
          period: c.period,
          value: c.value,
          approved: c.approve,
          actorId: actor.id,
          at: now.toISOString(),
          documentIds: c.documentIds,
          note: c.note,
        });
        if (template.kind === "balance" || template.kind === "custom") {
          const types = await Promise.all(
            [
              ...new Set(
                template.columns.flatMap((x) =>
                  x.stageTypeId ? [x.stageTypeId] : [],
                ),
              ),
            ].map((id) => loadProductionModel(tx, id)),
          );
          const date = row.dueDate ?? `${row.period.slice(0, 4)}-01-01`;
          const values = template.columns.map((column) => ({
            column,
            cell: row.cells.find(
              (x) =>
                x.columnId === column.id &&
                x.period === productionPeriod(column, date),
            ),
          }));
          row.state =
            values.length &&
            values.every((x) => x.cell?.value === "not_applicable")
              ? "not_applicable"
              : values.length &&
                  values.every(
                    (x) =>
                      productionValueFinal(
                        x.column,
                        x.cell?.value ?? null,
                        types,
                      ) &&
                      (!x.column.approval || x.cell?.approved),
                  )
                ? "done"
                : "not_done";
          if (template.kind === "balance") {
            const pending = values
              .filter(
                (x) =>
                  !productionValueFinal(
                    x.column,
                    x.cell?.value ?? null,
                    types,
                  ) ||
                  (x.column.approval && !x.cell?.approved),
              )
              .filter((x) => x.column.plannedDate)
              .sort((a, b) =>
                a.column.plannedDate!.localeCompare(b.column.plannedDate!),
              );
            row.dueDate = pending[0]?.column.plannedDate ?? null;
            row.assigneeId =
              pending[0]?.column.assigneeId ?? template.assigneeId;
          }
        }
      } else if (c.kind === "observation") {
        if (row.observations.some((x) => x.id === c.observation.id))
          fail(409, "OBSERVATION_EXISTS", "Observation déjà conservée.");
        await validateDocuments(tx, actor, row, c.observation.documentIds);
        row.observations.push(c.observation);
      } else if (c.kind === "properties") {
        if (row.assigneeId !== c.assigneeId)
          await authorizeRow(tx, actor, row, "assign");
        await activeAssignee(tx, c.assigneeId);
        await validateDocuments(tx, actor, row, c.documentIds);
        Object.assign(row, {
          dueDate: c.dueDate,
          assigneeId: c.assigneeId,
          tags: c.tags,
          state: c.state,
          documentIds: c.documentIds,
        });
      } else {
        if (template.kind !== "balance" && template.nature !== "depot_comptes")
          fail(400, "DEPOSIT_TARGET", "Campagne de dépôt requise.");
        const prior = new Map(row.deposit.attempts.map((a) => [a.id, a]));
        for (const a of c.deposit.attempts) {
          if (a.state === "accepted") {
            await authorizeRow(tx, actor, row, "approve");
            if (a.receiptDocumentId) {
              const proof = await tx.query(
                "SELECT content->'source'->>'kind' AS kind FROM cabinet_documents WHERE id=$1",
                [a.receiptDocumentId],
              );
              if (proof[0]?.kind !== a.source)
                fail(
                  400,
                  "RECEIPT_PROVENANCE",
                  "La provenance du reçu doit correspondre à l’observation.",
                );
            }
          }
          if (
            a.state === "accepted" &&
            (!a.receiptDocumentId || a.source === "manual")
          )
            fail(
              400,
              "OFFICIAL_RECEIPT_REQUIRED",
              "L’acceptation exige un reçu identifié provenant de la source.",
            );
          if (
            prior.has(a.id) &&
            JSON.stringify(prior.get(a.id)) !== JSON.stringify(a)
          )
            fail(
              409,
              "ATTEMPT_IMMUTABLE",
              "Conservez les observations antérieures ; ajoutez une nouvelle observation.",
            );
        }
        if (
          row.deposit.attempts.some(
            (a) => !c.deposit.attempts.some((n) => n.id === a.id),
          )
        )
          fail(
            409,
            "ATTEMPT_IMMUTABLE",
            "Une observation ne peut pas être supprimée.",
          );
        await validateDocuments(
          tx,
          actor,
          row,
          c.deposit.attempts.flatMap((a) => [
            ...a.documentIds,
            ...(a.receiptDocumentId ? [a.receiptDocumentId] : []),
          ]),
        );
        row.deposit = c.deposit;
      }
      row.touched = old.touched || !regeneration;
      row.version++;
      row.updatedAt = now.toISOString();
      row.modelVersion = model.version;
      if (row.recordId) {
        const record = await loadRecord(tx, row.recordId);
        if (record.kind !== "obligation")
          fail(400, "INVALID_TARGET", "Obligation requise.");
        await saveRecord(
          tx,
          actor,
          {
            operationId: stableId(i.operationId + ":record"),
            expectedVersion: record.version,
            record: {
              ...record,
              data: {
                ...record.data,
                dueDate: row.dueDate,
                preparation:
                  row.state === "done"
                    ? "preparee"
                    : row.state === "not_done"
                      ? "a_preparer"
                      : "en_cours",
              },
            },
          },
          now,
          record.id,
          "updated",
          undefined,
          undefined,
          { validate: async () => {}, commit: async () => {} },
        );
      }
      await persistRow(tx, row);
      return row;
    },
  );
  await authorizeRow(tx, actor, result);
  await loadProductionRow(tx, actor, id);
  return result;
}
export async function migrateProductionTargets(
  tx: Connection,
  actor: SessionUser,
  id: string,
  i: z.infer<typeof ProductionMigrationSchema>,
  now: Date,
) {
  requireGlobal(actor, "manage_users");
  const model = await loadProductionModel(tx, id);
  await modelAccess(tx, actor, model);
  if (model.model.kind !== "process" && model.model.kind !== "followup")
    fail(400, "MIGRATION_TARGET", "Migration réservée aux process et suivis.");
  if (
    model.model.kind === "followup" &&
    !["dossier", "contact"].includes(i.target)
  )
    fail(400, "MIGRATION_TARGET", "Un suivi concerne dossiers ou contacts.");
  for (const mapping of i.mappings) {
    await loadProductionRow(tx, actor, mapping.rowId, "update");
    await targetScope(tx, actor, mapping.target, "update");
    if (mapping.target.kind !== i.target)
      fail(400, "INVALID_TARGET", "Toutes les cibles doivent correspondre.");
  }
  const result = await idempotent(
    tx,
    actor,
    i.operationId,
    { productionMigration: { id, i } },
    async () => {
      if (model.version !== i.expectedVersion)
        fail(409, "VERSION_CONFLICT", "Le modèle a changé.");
      const rows = await tx.query(
        "SELECT id FROM cabinet_production_rows WHERE model_id=$1 ORDER BY id LIMIT 2001",
        [id],
      );
      if (
        rows.length > 2000 ||
        rows.length !== i.mappings.length ||
        new Set(i.mappings.map((x) => x.rowId)).size !== rows.length ||
        rows.some((r) => !i.mappings.some((x) => x.rowId === r.id))
      )
        fail(
          409,
          "INCOMPLETE_MIGRATION",
          "La migration doit décrire chaque ligne exactement une fois.",
        );
      const next = ProductionModelSchema.parse({
        ...model,
        version: model.version + 1,
        actorId: actor.id,
        updatedAt: now.toISOString(),
        model: { ...model.model, target: i.target, population: [] },
      });
      await persistModel(tx, next);
      const targets = new Set<string>();
      for (const mapping of i.mappings) {
        const row = await loadProductionRow(tx, actor, mapping.rowId, "update");
        if (row.version !== mapping.expectedVersion)
          fail(409, "VERSION_CONFLICT", "Une ligne a changé.");
        if (model.model.kind === "stage_type")
          fail(400, "INVALID_TARGET", "Modèle incompatible.");
        const key = `${mapping.target.id ?? mapping.target.label}:${row.period}`;
        if (!model.model.allowDuplicates && targets.has(key))
          fail(
            409,
            "DUPLICATE_TARGET",
            "La configuration interdit ces cibles dupliquées.",
          );
        targets.add(key);
        row.target = mapping.target;
        row.scope = await targetScope(tx, actor, row.target);
        await validateDocuments(tx, actor, row, [
          ...row.documentIds,
          ...row.observations.flatMap((o) => o.documentIds),
          ...row.cells.flatMap((c) => c.documentIds),
        ]);
        row.version++;
        row.modelVersion = next.version;
        row.updatedAt = now.toISOString();
        await persistRow(tx, row);
      }
      return next;
    },
  );
  await modelAccess(tx, actor, result);
  for (const mapping of i.mappings)
    await loadProductionRow(tx, actor, mapping.rowId);
  return result;
}
