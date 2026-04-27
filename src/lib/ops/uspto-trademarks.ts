/**
 * USPTO trademark tracking — Phase 31.1.
 *
 * The lock on this module is the **deadline math**, not the data.
 * Trademark prosecution + maintenance has well-defined windows:
 *
 *   - **§8 declaration of continued use:** between the 5th and 6th
 *     anniversary of registration. Miss it → mark is canceled.
 *   - **§8 + §9 combined filing:** between the 9th and 10th
 *     anniversary, AND every 10 years after that. The §9 is the
 *     renewal; the §8 is "still in use" continued attestation.
 *   - **Office action response:** typically 6 months from issuance,
 *     with a one-time 3-month extension request available.
 *
 * Doctrine for this module:
 *
 *   - **Empty manifest by default** — we never fabricate registration
 *     numbers, filing dates, or deadlines. Ben (or counsel) drops in
 *     real serial numbers as filings happen. The math is locked, the
 *     data is operator-curated.
 *   - **Urgency tiers driven from the deadline gap:** ≤30d critical,
 *     ≤90d high, ≤180d medium, otherwise low. This matches how a
 *     trademark attorney would queue a reminder backlog.
 *   - **Pure helpers, no I/O.** Selectors that the GET route + the
 *     weekly cron reminder both consume — same shape, no drift.
 *
 * What this module is NOT:
 *
 *   - It does NOT scrape USPTO TESS. TESS scraping is brittle (the
 *     status-page HTML changes, the API gates behind a paid
 *     application), and a manual "post-registration update the
 *     status field" is cheaper than a brittle live integration. If
 *     volume justifies it later, layer a TESS poller on top of this
 *     manifest as a separate module.
 *   - It does NOT track FDA Food Facility Registration — that's
 *     already in `compliance-doctrine.ts` (`fda-facility-registration`
 *     biennial). Don't duplicate.
 *
 * Inspired by the same "stack literacy" doctrine as Phase 28L.3:
 * make the dependency visible (in this case the legal
 * dependency on TM maintenance) so it can't quietly lapse.
 */
export type TrademarkStatus =
  | "not-filed" // mark identified but no application filed yet
  | "pending" // application filed, awaiting examination/publication
  | "registered" // §1051 / §1126 registered — on the principal register
  | "office-action" // examiner issued an OA; response window open
  | "supplemental" // on the supplemental register
  | "abandoned" // lapsed / abandoned / canceled
  | "expired"; // registration expired (§9 renewal missed)

export type TrademarkUrgency = "critical" | "high" | "medium" | "low";

export interface TrademarkRecord {
  /** Stable id, kebab-case. e.g. "usg-wordmark". */
  id: string;
  /** Mark text or short description (e.g. "USA GUMMIES (wordmark)"). */
  mark: string;
  /** USPTO serial number (e.g. "97/123,456"). null until filed. */
  serialNumber: string | null;
  /** USPTO registration number (e.g. "7,123,456"). null until registered. */
  registrationNumber: string | null;
  status: TrademarkStatus;
  /** ISO date the application was filed (or null). */
  filedAt: string | null;
  /** ISO date the mark was registered (or null). */
  registeredAt: string | null;
  /**
   * For `office-action`: the deadline by which a response is due
   * (typically 6 months from issuance). null otherwise.
   */
  officeActionResponseDueAt: string | null;
  /** Optional operator-supplied notes (e.g. counsel name, class numbers). */
  notes?: string;
}

/**
 * Live registry. **Empty by default — Ben + counsel drop in actual
 * filings as they happen.** Adding entries here is the registration
 * step; the math + the surface come along for free.
 *
 * Convention when adding an entry:
 *
 *   1. Use a stable kebab-case id (e.g. "usg-wordmark", "aagb-name").
 *   2. Prefer registration date once it lands; before that, leave
 *      `registeredAt: null` and the deadlines surface as "n/a until
 *      registered."
 *   3. For office-action mode: set `status: "office-action"` AND
 *      `officeActionResponseDueAt: <ISO>` so the urgency math
 *      considers the OA window.
 *   4. NEVER fabricate serial / registration numbers. Use null when
 *      unknown — the surface honestly displays "(not assigned)".
 */
export const TRADEMARK_REGISTRY: readonly TrademarkRecord[] = [] as const;

// ---------------------------------------------------------------------------
// Deadline math
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Add `years` years to an ISO date and return ISO. Handles leap-year
 * edge cases (Feb 29 → Feb 28 in non-leap years) the same way
 * JavaScript's `Date` does.
 */
export function addYearsIso(iso: string, years: number): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/**
 * Days between an ISO target date and `now`. Positive = future.
 * Negative = overdue. Returns null if the input is missing/invalid.
 */
export function daysUntil(targetIso: string | null, now: Date): number | null {
  if (!targetIso) return null;
  const t = Date.parse(targetIso);
  if (!Number.isFinite(t)) return null;
  return Math.round((t - now.getTime()) / DAY_MS);
}

/**
 * Classify a day-gap into an urgency bucket.
 *
 *   - ≤ 30 days (or overdue) → critical
 *   - ≤ 90 days              → high
 *   - ≤ 180 days             → medium
 *   - otherwise              → low
 *
 * Pure.
 */
export function classifyUrgency(daysUntilDeadline: number | null): TrademarkUrgency {
  if (daysUntilDeadline === null) return "low";
  if (daysUntilDeadline <= 30) return "critical";
  if (daysUntilDeadline <= 90) return "high";
  if (daysUntilDeadline <= 180) return "medium";
  return "low";
}

export interface NextAction {
  /** Human-readable description of what to do next. */
  label: string;
  /** ISO date the action becomes due. null when not applicable. */
  dueAt: string | null;
  /** Days until dueAt (positive = future, negative = overdue). null when N/A. */
  daysUntilDue: number | null;
  urgency: TrademarkUrgency;
}

/**
 * Compute the next action + deadline for a given record. Pure.
 *
 * Decision order:
 *   1. office-action → respond by `officeActionResponseDueAt`.
 *   2. registered + within §8 declaration window (year 5-6) → file §8.
 *   3. registered + within §8+§9 window (year 9-10, then every 10y) → file §8+§9.
 *   4. registered + outside any window → next §8 anniversary as the
 *      forward-looking checkpoint (low urgency).
 *   5. pending → "await examination" (no deadline).
 *   6. not-filed → "draft + file" (no deadline; Ben's discretion).
 *   7. abandoned / expired / supplemental → no action.
 */
export function computeNextAction(
  rec: TrademarkRecord,
  now: Date = new Date(),
): NextAction {
  if (rec.status === "office-action") {
    const days = daysUntil(rec.officeActionResponseDueAt, now);
    return {
      label: rec.officeActionResponseDueAt
        ? `Respond to office action (or request extension)`
        : "Respond to office action — set response deadline",
      dueAt: rec.officeActionResponseDueAt,
      daysUntilDue: days,
      urgency: classifyUrgency(days),
    };
  }

  if (rec.status === "abandoned" || rec.status === "expired") {
    return {
      label: "No action — mark is no longer maintained",
      dueAt: null,
      daysUntilDue: null,
      urgency: "low",
    };
  }

  if (rec.status === "supplemental") {
    return {
      label:
        "On the supplemental register — consider re-filing on the principal register if distinctiveness has built up",
      dueAt: null,
      daysUntilDue: null,
      urgency: "low",
    };
  }

  if (rec.status === "not-filed") {
    return {
      label: "Draft application + file with USPTO",
      dueAt: null,
      daysUntilDue: null,
      urgency: "low",
    };
  }

  if (rec.status === "pending") {
    return {
      label: "Await USPTO examination + publication",
      dueAt: null,
      daysUntilDue: null,
      urgency: "low",
    };
  }

  // status === "registered"
  if (!rec.registeredAt) {
    return {
      label: "Status=registered but registeredAt is null — populate the date",
      dueAt: null,
      daysUntilDue: null,
      urgency: "medium",
    };
  }

  // §8 declaration window: between years 5 and 6 of registration.
  // §8+§9 combined window: between years 9 and 10, then every 10 years.
  const fifth = addYearsIso(rec.registeredAt, 5);
  const sixth = addYearsIso(rec.registeredAt, 6);
  const ninth = addYearsIso(rec.registeredAt, 9);
  const tenth = addYearsIso(rec.registeredAt, 10);
  const fifthMs = fifth ? Date.parse(fifth) : NaN;
  const sixthMs = sixth ? Date.parse(sixth) : NaN;
  const ninthMs = ninth ? Date.parse(ninth) : NaN;
  const tenthMs = tenth ? Date.parse(tenth) : NaN;
  const t = now.getTime();

  // Year 5-6: §8 declaration window.
  if (Number.isFinite(fifthMs) && Number.isFinite(sixthMs) && t >= fifthMs && t <= sixthMs) {
    const days = daysUntil(sixth, now);
    return {
      label: "File §8 declaration of continued use (5-6 year window)",
      dueAt: sixth,
      daysUntilDue: days,
      urgency: classifyUrgency(days),
    };
  }

  // Year 9-10: §8 + §9 combined.
  if (Number.isFinite(ninthMs) && Number.isFinite(tenthMs) && t >= ninthMs && t <= tenthMs) {
    const days = daysUntil(tenth, now);
    return {
      label: "File §8 + §9 (10-year renewal window)",
      dueAt: tenth,
      daysUntilDue: days,
      urgency: classifyUrgency(days),
    };
  }

  // Past 10y: every 10y window (compute next §8+§9 window from year-10 + 10n).
  if (Number.isFinite(tenthMs) && t > tenthMs) {
    const yearsSinceTen = Math.floor((t - tenthMs) / (DAY_MS * 365.25));
    const nextWindowYearsAfterTen =
      Math.floor(yearsSinceTen / 10) * 10 + 10; // next decade boundary
    const nextRenewal = addYearsIso(rec.registeredAt, 10 + nextWindowYearsAfterTen);
    const days = daysUntil(nextRenewal, now);
    return {
      label: "File §8 + §9 (10-year renewal cycle)",
      dueAt: nextRenewal,
      daysUntilDue: days,
      urgency: classifyUrgency(days),
    };
  }

  // Pre-§8 window — surface the upcoming §8 as a forward-looking note.
  if (fifth) {
    const days = daysUntil(fifth, now);
    return {
      label: "Forward-looking: §8 declaration window opens at year 5",
      dueAt: fifth,
      daysUntilDue: days,
      urgency: classifyUrgency(days),
    };
  }

  return {
    label: "Status=registered but registeredAt is unparseable",
    dueAt: null,
    daysUntilDue: null,
    urgency: "low",
  };
}

export interface TrademarkRow extends TrademarkRecord {
  nextAction: NextAction;
}

/** Project the registry into per-row rows with computed action. Pure. */
export function buildTrademarkRows(
  registry: readonly TrademarkRecord[] = TRADEMARK_REGISTRY,
  now: Date = new Date(),
): TrademarkRow[] {
  return registry.map((rec) => ({ ...rec, nextAction: computeNextAction(rec, now) }));
}

export interface TrademarkSummary {
  total: number;
  registered: number;
  pending: number;
  notFiled: number;
  officeAction: number;
  abandonedOrExpired: number;
  supplemental: number;
  /** Counts by urgency of the row's nextAction. */
  byUrgency: Record<TrademarkUrgency, number>;
}

/** Pure summarizer. */
export function summarizeTrademarks(
  rows: readonly TrademarkRow[],
): TrademarkSummary {
  const byUrgency: Record<TrademarkUrgency, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  let registered = 0,
    pending = 0,
    notFiled = 0,
    officeAction = 0,
    abandonedOrExpired = 0,
    supplemental = 0;
  for (const r of rows) {
    byUrgency[r.nextAction.urgency] += 1;
    switch (r.status) {
      case "registered":
        registered += 1;
        break;
      case "pending":
        pending += 1;
        break;
      case "not-filed":
        notFiled += 1;
        break;
      case "office-action":
        officeAction += 1;
        break;
      case "abandoned":
      case "expired":
        abandonedOrExpired += 1;
        break;
      case "supplemental":
        supplemental += 1;
        break;
    }
  }
  return {
    total: rows.length,
    registered,
    pending,
    notFiled,
    officeAction,
    abandonedOrExpired,
    supplemental,
    byUrgency,
  };
}

const URGENCY_RANK: Record<TrademarkUrgency, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Pick top-K rows that need attention, urgency-first then earliest
 * deadline first. Excludes `low` urgency unless `includeLow` is true.
 * Pure.
 */
export function pickActionableTrademarks(
  rows: readonly TrademarkRow[],
  opts: { limit?: number; includeLow?: boolean } = {},
): TrademarkRow[] {
  const limit = Math.max(1, Math.floor(opts.limit ?? 5));
  const includeLow = opts.includeLow === true;
  return rows
    .filter((r) => includeLow || r.nextAction.urgency !== "low")
    .slice()
    .sort((a, b) => {
      const ur =
        URGENCY_RANK[a.nextAction.urgency] -
        URGENCY_RANK[b.nextAction.urgency];
      if (ur !== 0) return ur;
      const ad = a.nextAction.daysUntilDue ?? Number.POSITIVE_INFINITY;
      const bd = b.nextAction.daysUntilDue ?? Number.POSITIVE_INFINITY;
      return ad - bd;
    })
    .slice(0, limit);
}

/**
 * One-line Slack/brief renderer. Quiet collapse: empty registry OR
 * zero non-low rows → empty string.
 *
 * Format:
 *   :scales: *USPTO trademarks:* N actionable (X critical, Y high)
 *     · Top: USA GUMMIES (wordmark) — §8 declaration in 24 days (critical)
 */
export function renderTrademarkBriefLine(
  rows: readonly TrademarkRow[],
): string {
  const actionable = pickActionableTrademarks(rows, { limit: 1 });
  if (actionable.length === 0) return "";
  const summary = summarizeTrademarks(rows);
  const top = actionable[0];
  const days = top.nextAction.daysUntilDue;
  const dayPhrase =
    days === null
      ? "(no deadline set)"
      : days < 0
        ? `${Math.abs(days)}d overdue`
        : `in ${days}d`;
  return `:scales: *USPTO trademarks:* ${
    summary.byUrgency.critical + summary.byUrgency.high + summary.byUrgency.medium
  } actionable (${summary.byUrgency.critical} critical, ${summary.byUrgency.high} high) · Top: ${top.mark} — ${top.nextAction.label} ${dayPhrase} (${top.nextAction.urgency}).`;
}
