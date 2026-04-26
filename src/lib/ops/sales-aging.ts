/**
 * Sales Command — pure SLA / aging helpers.
 *
 * Phase 3 of the Sales Command Center: turn pending queues into an
 * aging view so old approvals, old Faire follow-ups, old location
 * drafts, and old receipts surface before they drift. The helpers
 * are pure (no fetch / KV / network); the route caller fetches
 * underlying records, projects them into the AgingItem shape, then
 * passes the list through the composer.
 *
 * Hard rules (every one tested):
 *   - **Read-only.** No I/O at all in this module.
 *   - **Never fabricates an age** when the source has no timestamp.
 *     A missing or unparseable anchor produces a `MissingTimestampItem`
 *     instead of a synthetic 0/now/etc. — surfaced separately so
 *     operators see the data-integrity gap rather than a fake row at
 *     the top.
 *   - **Sort order is locked.** `selectTopAging` orders critical →
 *     overdue → watch → fresh, and within each tier oldest-first
 *     (largest `ageHours` first). The brief callout composer relies
 *     on this so its 3-row cap surfaces the most-urgent items.
 *   - **Bounded callouts.** `composeAgingBriefCallouts` caps at
 *     `maxCallouts` (default 3 for the morning brief).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Each source carries its own thresholds. */
export type AgingSource =
  | "approval"
  | "faire-followup"
  | "ap-packet"
  | "location-draft"
  | "receipt";

export type AgingTier = "fresh" | "watch" | "overdue" | "critical";

export interface AgingThresholds {
  /** Hours after which the row first lights up as "watch". */
  watchHours: number;
  /** Hours after which the row escalates to "overdue". */
  overdueHours: number;
  /** Hours after which the row escalates to "critical". */
  criticalHours: number;
}

/**
 * Locked threshold registry. AP packets carry no anchor timestamp in
 * today's data model — readers project ready-to-send-not-sent packets
 * into the missing-timestamp panel, never into the aging tiers.
 *
 * Hours are absolute wall-clock hours, not business hours. Future
 * refinement (business-hour math) is out of scope for Phase 3.
 */
export const AGING_THRESHOLDS: Record<
  Exclude<AgingSource, "ap-packet">,
  AgingThresholds
> = {
  approval: { watchHours: 4, overdueHours: 24, criticalHours: 48 },
  // Faire follow-ups inherit the existing 3-day due_soon / 7-day
  // overdue contract from `src/lib/faire/follow-ups.ts`. Critical
  // doubles overdue so a follow-up that's been ignored for 14 days
  // gets flagged separately from a fresh-overdue one.
  "faire-followup": {
    watchHours: 72,
    overdueHours: 168,
    criticalHours: 336,
  },
  "location-draft": {
    watchHours: 168, // 7d
    overdueHours: 336, // 14d
    criticalHours: 504, // 21d
  },
  "receipt": {
    watchHours: 48, // 2d
    overdueHours: 168, // 7d
    criticalHours: 336, // 14d
  },
};

/** Item carried through the aging pipeline. */
export interface AgingItem {
  source: AgingSource;
  /** Stable id within the source (e.g. approval id, invite id, draft slug). */
  id: string;
  /** Operator-facing label — retailer name, draft slug, vendor, etc. */
  label: string;
  /** Deep-link to the workflow surface that owns this row. */
  link: string;
  /** ISO timestamp the aging clock anchors on (createdAt / sentAt / etc.). */
  anchorAt: string;
  ageHours: number;
  ageDays: number;
  tier: AgingTier;
}

/**
 * A row whose underlying source had no usable anchor timestamp. The
 * caller can't compute an age, so we surface the gap honestly rather
 * than fabricating one.
 */
export interface MissingTimestampItem {
  source: AgingSource;
  id: string;
  label: string;
  link: string;
  /** Free-form reason — e.g. "AP packet config has no readyAt field." */
  reason: string;
}

/**
 * Either a classified item or a missing-timestamp marker. Used as the
 * caller-facing return of `classifyAgingInput`.
 */
export type ClassifyAgingResult =
  | { ok: true; item: AgingItem }
  | { ok: false; missing: MissingTimestampItem };

// ---------------------------------------------------------------------------
// Pure date helpers
// ---------------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Hours between an ISO timestamp and `now`. Returns `null` when the
 * input is missing / unparseable / future-dated. Future timestamps
 * are treated as "missing" because a future age doesn't make sense
 * in a queue-aging context — we'd rather flag it as a data gap.
 */
export function ageHours(iso: string | undefined | null, now: Date): number | null {
  if (typeof iso !== "string" || iso.trim().length === 0) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  const ms = now.getTime() - parsed;
  if (ms < 0) return null;
  return ms / HOUR_MS;
}

/**
 * Days between an ISO timestamp and `now`. Returns `null` on the same
 * conditions as `ageHours`. Wraps `ageHours` for consistency.
 */
export function ageDays(iso: string | undefined | null, now: Date): number | null {
  const h = ageHours(iso, now);
  return h === null ? null : h / 24;
}

/**
 * Whole-number day count for display purposes. Returns null when
 * `ageDays` is null. Floors so a 9.7-day row reads as "9 days old"
 * rather than "10 days" (which would be a slight over-statement).
 */
export function ageDaysFloor(
  iso: string | undefined | null,
  now: Date,
): number | null {
  const d = ageDays(iso, now);
  return d === null ? null : Math.floor(d);
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function classifyAge(
  hours: number,
  thresholds: AgingThresholds,
): AgingTier {
  if (hours >= thresholds.criticalHours) return "critical";
  if (hours >= thresholds.overdueHours) return "overdue";
  if (hours >= thresholds.watchHours) return "watch";
  return "fresh";
}

export interface ClassifyAgingInput {
  source: Exclude<AgingSource, "ap-packet">;
  id: string;
  label: string;
  link: string;
  anchorAt: string | undefined | null;
}

/**
 * Convert a single source row into either a classified `AgingItem` or
 * a `MissingTimestampItem` when the anchor is unusable.
 */
export function classifyAgingInput(
  input: ClassifyAgingInput,
  now: Date,
): ClassifyAgingResult {
  const hours = ageHours(input.anchorAt, now);
  if (hours === null) {
    return {
      ok: false,
      missing: {
        source: input.source,
        id: input.id,
        label: input.label,
        link: input.link,
        reason:
          input.anchorAt === undefined ||
          input.anchorAt === null ||
          (typeof input.anchorAt === "string" && input.anchorAt.trim().length === 0)
            ? "Source row has no anchor timestamp."
            : `Anchor timestamp "${input.anchorAt}" is unparseable or future-dated.`,
      },
    };
  }
  const thresholds = AGING_THRESHOLDS[input.source];
  return {
    ok: true,
    item: {
      source: input.source,
      id: input.id,
      label: input.label,
      link: input.link,
      anchorAt: input.anchorAt as string, // narrowed by the null check above
      ageHours: hours,
      ageDays: hours / 24,
      tier: classifyAge(hours, thresholds),
    },
  };
}

// ---------------------------------------------------------------------------
// Sort + select
// ---------------------------------------------------------------------------

const TIER_PRIORITY: Record<AgingTier, number> = {
  critical: 0,
  overdue: 1,
  watch: 2,
  fresh: 3,
};

/**
 * Sort: tier priority (critical first), then oldest-first within tier.
 * Stable on equal keys — preserves caller-supplied order so the
 * route's deterministic ordering carries through.
 */
export function sortAging(items: AgingItem[]): AgingItem[] {
  return [...items].sort((a, b) => {
    const t = TIER_PRIORITY[a.tier] - TIER_PRIORITY[b.tier];
    if (t !== 0) return t;
    return b.ageHours - a.ageHours;
  });
}

/**
 * Select the top-N actionable rows. By default only watch/overdue/
 * critical surface — fresh rows aren't aging yet and don't belong in
 * the panel. Callers wanting fresh rows pass `{ includeFresh: true }`.
 */
export function selectTopAging(
  items: AgingItem[],
  limit: number,
  options: { includeFresh?: boolean } = {},
): AgingItem[] {
  const filtered = options.includeFresh
    ? items
    : items.filter((i) => i.tier !== "fresh");
  return sortAging(filtered).slice(0, Math.max(0, limit));
}

/**
 * Brief callouts for the morning daily brief. Locked to 3 by default.
 *
 * Returns a list of pre-rendered Slack-mrkdwn lines (no leading
 * bullet — the caller adds it). Only critical / overdue / watch rows
 * surface here; fresh rows never make the brief.
 */
export interface AgingCallout {
  tier: Extract<AgingTier, "critical" | "overdue" | "watch">;
  source: AgingSource;
  text: string;
}

export function composeAgingBriefCallouts(
  items: AgingItem[],
  options: { maxCallouts?: number } = {},
): AgingCallout[] {
  const max = Math.max(0, options.maxCallouts ?? 3);
  const top = selectTopAging(items, max);
  return top
    .filter((i): i is AgingItem & { tier: "critical" | "overdue" | "watch" } =>
      i.tier === "critical" || i.tier === "overdue" || i.tier === "watch",
    )
    .map((i) => ({
      tier: i.tier,
      source: i.source,
      text: renderAgingCalloutText(i),
    }));
}

const SOURCE_LABELS: Record<AgingSource, string> = {
  approval: "Slack approval",
  "faire-followup": "Faire follow-up",
  "ap-packet": "AP packet",
  "location-draft": "Retail draft",
  receipt: "Receipt",
};

const TIER_BADGES: Record<
  Extract<AgingTier, "critical" | "overdue" | "watch">,
  string
> = {
  critical: ":rotating_light: CRITICAL",
  overdue: ":warning: OVERDUE",
  watch: ":hourglass_flowing_sand: WATCH",
};

/**
 * Pure renderer for a single aging callout line. Format:
 *   `:rotating_light: CRITICAL — Slack approval · 51h · <retailer>`
 * Caller wraps in a bullet/list as needed.
 */
export function renderAgingCalloutText(item: AgingItem): string {
  const tier = item.tier;
  if (tier === "fresh") {
    // Defensive: callouts shouldn't include fresh rows. If a caller
    // passes one anyway, render it without an alert badge so it's
    // still readable and easy to spot as a bug.
    return `${SOURCE_LABELS[item.source]} · ${formatAgeShort(item.ageHours)} · ${item.label}`;
  }
  const badge = TIER_BADGES[tier];
  return `${badge} — ${SOURCE_LABELS[item.source]} · ${formatAgeShort(item.ageHours)} · ${item.label}`;
}

/**
 * Compact age render: "3h" / "27h" / "5d" / "21d". Picks the most
 * natural unit for the magnitude.
 */
export function formatAgeShort(hours: number): string {
  if (hours < 48) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}
