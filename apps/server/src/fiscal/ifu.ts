import {
  FiscalIfuSchema,
  type FiscalEvent,
  type CabinetRecord,
  type SessionUser,
} from "@memlia/contracts";
import type { Connection } from "../storage/database.js";
import { requireAccess } from "../records/permissions.js";
import { loadRecord } from "../records/service.js";
import { fail } from "../errors.js";
import { fiscalTimeline } from "./service.js";
import { cents, money } from "./situation.js";
export async function prepareIfu(
  tx: Connection,
  actor: SessionUser,
  record: CabinetRecord,
  event: Extract<FiscalEvent, { kind: "ifu_prepare" }>,
) {
  if (
    record.kind !== "obligation" ||
    record.data.nature !== "IFU_2561" ||
    !record.data.fiscal ||
    record.data.fiscal.period.campaign !== event.rule.campaign
  )
    fail(400, "INVALID_IFU", "Campagne IFU cohérente requise.");
  const result = FiscalIfuSchema.parse({
    sourceVersions: [],
    payer: event.payer,
    rule: event.rule,
    coverage: {
      missingMonths: [],
      zeroMonths: [],
      incompleteMonths: [],
      duplicateMonths: [],
    },
    lines: [],
    grossTotal: null,
    complete: false,
    stale: false,
    certifiedExport: false,
  });
  const months = new Map<number, number>();
  for (const id of event.sourceIds) {
    const source = await loadRecord(tx, id);
    await requireAccess(tx, actor, "read", source);
    if (
      source.kind !== "obligation" ||
      source.data.nature !== "RCM_2777" ||
      !source.data.fiscal ||
      source.dossierId !== record.dossierId ||
      source.data.fiscal.period.start.slice(0, 4) !==
        record.data.fiscal.period.start.slice(0, 4)
    )
      fail(
        400,
        "INVALID_RCM_SOURCE",
        "RCM du même payeur et de la même année requis.",
      );
    const month = Number(source.data.fiscal.period.start.slice(5, 7));
    months.set(month, (months.get(month) ?? 0) + 1);
    result.sourceVersions.push({ id, version: source.version });
    const income = (await fiscalTimeline(tx, id)).findLast(
      (e) => e.event.kind === "income",
    )?.event;
    if (!income || income.kind !== "income" || income.coverage === "partial") {
      result.coverage.incompleteMonths.push(month);
      continue;
    }
    if (income.coverage === "confirmed_zero") {
      result.coverage.zeroMonths.push(month);
      continue;
    }
    result.lines.push(...income.lines);
    if (
      !income.lines.length ||
      income.lines.some(
        (l) =>
          !l.beneficiary.identity ||
          !l.beneficiary.address ||
          (l.beneficiary.type === "organisation"
            ? !l.beneficiary.siret
            : !l.beneficiary.birthDate) ||
          !l.category ||
          l.gross === null,
      )
    )
      result.coverage.incompleteMonths.push(month);
  }
  for (let month = 1; month <= 12; month++) {
    if (!months.has(month)) result.coverage.missingMonths.push(month);
    if ((months.get(month) ?? 0) > 1)
      result.coverage.duplicateMonths.push(month);
  }
  result.complete =
    Boolean(event.payer.identity && event.payer.address && event.payer.siret) &&
    !result.coverage.missingMonths.length &&
    !result.coverage.incompleteMonths.length &&
    !result.coverage.duplicateMonths.length;
  if (result.complete)
    result.grossTotal = money(
      result.lines.reduce((n, l) => n + cents(l.gross!), 0n),
    );
  return FiscalIfuSchema.parse(result);
}
