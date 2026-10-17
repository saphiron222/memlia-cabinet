import {
  FiscalSituationSchema,
  FiscalProvenanceSchema,
  type FiscalTimelineEntry,
  type FiscalSituation,
  type FiscalEvent,
} from "@memlia/contracts";
/** Local approval cannot create an external receipt. A rejected correction leaves earlier accepted versions applicable. */
export function deriveFiscalSituation(
  initialAmount: string | null,
  timeline: FiscalTimelineEntry[],
): FiscalSituation {
  const result: FiscalSituation = {
    clientValidation: "not_requested",
    ifu: null,
    declarationVersion: 1,
    preparation: "a_preparer",
    approval: "not_requested",
    applicableAcceptedVersion: null,
    applicableAcceptedAmount: null,
    acceptanceRule: "all-declared-recipients-accepted-no-platform-rejection/v1",
    attempts: [],
    notices: [],
    manualMarks: [],
    anomalies: [],
    bankCandidates: [],
    debts: [],
    amount: initialAmount,
    paid: "0.00",
    remaining: initialAmount,
    ambiguities: [],
  };
  const versionAmounts = new Map<number, string | null>([[1, initialAmount]]);
  const debts = new Map<string, Extract<FiscalEvent, { kind: "debt" }>>(),
    payments = new Map<string, Extract<FiscalEvent, { kind: "payment" }>>(),
    apurements = new Map<string, Extract<FiscalEvent, { kind: "apurement" }>>();
  const observations = new Map<
      string,
      Extract<FiscalEvent, { kind: "observation" }>
    >(),
    resolutions = new Map<
      string,
      Extract<FiscalEvent, { kind: "resolution" }>
    >();
  for (const entry of timeline) {
    const { event } = entry;
    if (entry.ifu) {
      result.ifu = entry.ifu;
      result.approval = "not_requested";
      result.preparation = "a_preparer";
    }
    switch (event.kind) {
      case "notice": {
        const { kind, ...notice } = event;
        const prior = result.notices.findIndex((n) => n.id === notice.id);
        if (prior >= 0) result.notices[prior] = notice;
        else result.notices.push(notice);
        break;
      }
      case "manual_mark":
        result.manualMarks.push({
          id: event.id,
          state: event.state,
          cancelled: false,
          reason: event.reason,
        });
        break;
      case "cancel_mark": {
        const mark = result.manualMarks.find((m) => m.id === event.markId);
        if (mark) mark.cancelled = true;
        break;
      }
      case "observation":
        observations.set(event.id, event);
        break;
      case "resolution":
        resolutions.set(event.field, event);
        break;
      case "bank_candidate": {
        const reasons = [];
        if (!event.accountPresent) reasons.push("account_absent");
        if (!event.pdfParsed) reasons.push("pdf_unparsed");
        if (event.iban === "absent") reasons.push("iban_absent");
        if (event.iban === "masked_ambiguous") reasons.push("iban_ambiguous");
        if (!event.orderDate) reasons.push("order_date_unknown");
        else {
          const [year, month, day] = event.evaluatedOn.split("-").map(Number);
          const boundary = new Date(
            Date.UTC(year!, month! - 1 - event.rule.maximumMonths, 1),
          );
          const lastDay = new Date(
            Date.UTC(boundary.getUTCFullYear(), boundary.getUTCMonth() + 1, 0),
          ).getUTCDate();
          boundary.setUTCDate(Math.min(day!, lastDay));
          if (
            event.orderDate < boundary.toISOString().slice(0, 10) ||
            event.orderDate > event.evaluatedOn
          )
            reasons.push("order_outside_window");
        }
        if (event.rule.datedOn > event.evaluatedOn)
          reasons.push("rule_not_yet_applicable");
        result.bankCandidates.push({
          id: event.id,
          reasons,
          eligible: reasons.length === 0,
          confidence: event.confidence,
          confirmedPayment: false,
        });
        break;
      }
      case "debt":
        debts.set(event.id, event);
        break;
      case "payment":
        payments.set(event.id, event);
        break;
      case "apurement":
        apurements.set(event.id, event);
        break;
      case "preparation":
        result.preparation = event.state;
        break;
      case "approval_request":
        result.approval = "requested";
        break;
      case "client_validation":
        result.clientValidation = event.state;
        break;
      case "approval":
        result.approval = event.decision;
        break;
      case "revision":
        result.clientValidation = "not_requested";
        observations.set(entry.id, {
          kind: "observation",
          id: entry.id,
          field: "amount",
          value: event.amount,
          provenance: FiscalProvenanceSchema.parse({
            kind: "manual",
            source: "Saisie cabinet",
            account: "cabinet",
            reference: "revision",
            version: String(entry.version),
            observedAt: entry.at,
            sourceUpdatedAt: null,
            coverage: "complete",
            rawState: event.reason,
            amountPrecision: "exact",
          }),
        });
        result.declarationVersion++;
        versionAmounts.set(result.declarationVersion, event.amount);
        result.amount = event.amount;
        result.remaining = event.amount;
        result.preparation = "a_preparer";
        result.approval = "not_requested";
        break;
      case "attempt":
        result.attempts.push({
          id: event.id,
          declarationVersion: event.declarationVersion,
          platform: "pending",
          recipients: Object.fromEntries(
            event.recipients.map((r) => [r, "pending" as const]),
          ),
          accepted: false,
        });
        break;
      case "return": {
        const attempt = result.attempts.find((a) => a.id === event.attemptId);
        if (attempt) {
          if (event.target === "platform") attempt.platform = event.state;
          else if (event.recipient)
            attempt.recipients[event.recipient] = event.state;
        }
        break;
      }
    }
  }
  for (const attempt of result.attempts) {
    attempt.accepted =
      attempt.platform !== "rejected" &&
      Object.values(attempt.recipients).every((v) => v === "accepted");
    if (attempt.accepted)
      result.applicableAcceptedVersion = Math.max(
        result.applicableAcceptedVersion ?? 0,
        attempt.declarationVersion,
      );
  }
  result.applicableAcceptedAmount =
    result.applicableAcceptedVersion === null
      ? null
      : (versionAmounts.get(result.applicableAcceptedVersion) ?? null);
  for (const field of new Set([...observations.values()].map((o) => o.field))) {
    const values = [...observations.values()].filter((o) => o.field === field);
    const latest = new Map<string, (typeof values)[number]>();
    for (const value of values)
      latest.set(
        JSON.stringify([
          value.provenance.kind,
          value.provenance.source,
          value.provenance.account,
        ]),
        value,
      );
    const current = [...latest.values()],
      resolution = resolutions.get(field);
    const differs = new Set(current.map((o) => o.value)).size > 1;
    const missing = current.some((o) => o.value === null);
    if (!differs && !missing) continue;
    const resolved =
      resolution &&
      current.every((o) => resolution.observationIds.includes(o.id));
    result.anomalies.push({
      field,
      state: resolved ? "resolved" : missing && !differs ? "missing" : "open",
      retainedValue: resolved ? resolution.value : null,
      observations: values.map((o) => ({
        id: o.id,
        value: o.value,
        provenance: o.provenance,
      })),
    });
  }
  const acquired = [...payments.values()].filter((p) =>
    ["debit_confirmed", "settled_source"].includes(p.state),
  );
  const unknownPayment = acquired.some((p) => p.amount === null);
  const paid = acquired.reduce(
    (n, p) => n + (p.amount === null ? 0n : cents(p.amount)),
    0n,
  );
  result.paid = unknownPayment ? null : money(paid);
  if (unknownPayment)
    result.ambiguities.push("Montant d’un règlement acquis inconnu");
  result.remaining =
    result.amount === null || unknownPayment
      ? null
      : money(cents(result.amount) - paid);
  for (const debt of debts.values()) {
    const linked = acquired.filter((p) => p.debtId === debt.id);
    let reduced = linked.reduce(
        (n, p) => n + (p.amount === null ? 0n : cents(p.amount)),
        0n,
      ),
      other = 0n;
    const countedPayments = new Set(linked.map((p) => p.id));
    for (const a of apurements.values()) {
      if (a.debtId !== debt.id || !a.confirmed) continue;
      if (a.nature === "payment") {
        if (a.paymentId && countedPayments.has(a.paymentId)) continue;
        if (a.paymentId) countedPayments.add(a.paymentId);
      } else other += cents(a.amount);
      reduced += cents(a.amount);
    }
    const remaining =
      debt.amount === null || linked.some((p) => p.amount === null)
        ? null
        : money(cents(debt.amount) - reduced);
    const conflict =
      debt.sourceBalance !== null &&
      remaining !== null &&
      debt.sourceBalance !== remaining;
    if (conflict)
      result.ambiguities.push(
        "Solde source et calcul local divergents : " + debt.reference,
      );
    result.debts.push({
      id: debt.id,
      amount: debt.amount,
      remaining,
      paid: linked.some((p) => p.amount === null)
        ? null
        : money(
            linked.reduce(
              (n, p) => n + (p.amount === null ? 0n : cents(p.amount)),
              0n,
            ),
          ),
      otherApurements: money(other),
      sourceBalance: debt.sourceBalance,
      sourceConfirmedZero:
        debt.sourceBalance === "0.00" &&
        debt.provenance.coverage === "complete",
      conflict,
    });
  }
  return FiscalSituationSchema.parse(result);
}

export function cents(amount: string): bigint {
  const negative = amount.startsWith("-");
  const [whole, fraction] = amount.replace("-", "").split(".");
  const value = BigInt(whole!) * 100n + BigInt(fraction!);
  return negative ? -value : value;
}
export function money(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

/** Read-model projection only: conflicting observations require an explicit current resolution. */
export function fiscalObservedValues(timeline: FiscalTimelineEntry[]) {
  const result: Record<
    "gross" | "net" | "estimate" | "referenceTurnover",
    string | null
  > = { gross: null, net: null, estimate: null, referenceTurnover: null };
  for (const field of Object.keys(result) as (keyof typeof result)[]) {
    const observations = new Map<
      string,
      Extract<FiscalEvent, { kind: "observation" }>
    >();
    let resolution: Extract<FiscalEvent, { kind: "resolution" }> | undefined;
    for (const { event } of timeline) {
      if (event.kind === "observation" && event.field === field)
        observations.set(
          JSON.stringify([
            event.provenance.kind,
            event.provenance.source,
            event.provenance.account,
          ]),
          event,
        );
      if (event.kind === "resolution" && event.field === field)
        resolution = event;
    }
    const values = [...observations.values()];
    const resolved =
      resolution &&
      values.every((o) => resolution!.observationIds.includes(o.id));
    result[field] = resolved
      ? resolution!.value
      : new Set(values.map((o) => o.value)).size === 1
        ? values[0]!.value
        : null;
  }
  return result;
}
