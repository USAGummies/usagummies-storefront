/**
 * Abra Outcome Tracker — closes the action->result feedback loop.
 *
 * Tracks every action Abra executes, then checks later whether the
 * desired outcome was achieved (email reply received, deal moved forward,
 * Slack acknowledged, etc.). This data feeds back into Abra's learning
 * so it can prioritize what actually works.
 *
 * Storage: KV state key "abra-action-outcomes" (array, max 500, FIFO).
 */

import { readState, writeState } from "@/lib/ops/state";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TrackedOutcome = {
  action_id: string;         // approval ID or action reference
  action_type: string;       // e.g. "send_email", "b2b_outreach", "create_draft_order"
  target: string;            // e.g. email address, company name, order ID
  initiated_at: string;      // ISO timestamp
  expected_outcome: string;  // what we hoped would happen
  actual_outcome?: string;   // what actually happened
  outcome_detected_at?: string;
  success: boolean | null;   // null = pending
  notes?: string;
};

export type OutcomeSummary = {
  total: number;
  pending: number;
  succeeded: number;
  failed: number;
  success_rate: number | null; // null if no resolved outcomes
  by_action_type: Record<
    string,
    { total: number; succeeded: number; failed: number; pending: number }
  >;
};

export type OutcomeCheckResult = {
  checked: number;
  updated: number;
  results: Array<{
    action_id: string;
    action_type: string;
    target: string;
    success: boolean | null;
    actual_outcome?: string;
  }>;
};

const MAX_OUTCOMES = 500;

// Action types we consider trackable (have measurable outcomes)
const TRACKABLE_ACTION_TYPES = new Set([
  "send_email",
  "create_draft_order",
  "b2b_outreach",
  "send_slack",
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function loadOutcomes(): Promise<TrackedOutcome[]> {
  return readState("abra-action-outcomes", []);
}

async function saveOutcomes(outcomes: TrackedOutcome[]): Promise<void> {
  // FIFO: keep only the most recent MAX_OUTCOMES
  const trimmed = outcomes.slice(-MAX_OUTCOMES);
  await writeState("abra-action-outcomes", trimmed);
}

// ---------------------------------------------------------------------------
// trackAction — record a new action for future outcome checking
// ---------------------------------------------------------------------------

export type TrackActionParams = {
  action_id: string;
  action_type: string;
  target: string;
  expected_outcome: string;
  notes?: string;
};

export async function trackAction(params: TrackActionParams): Promise<void> {
  if (!TRACKABLE_ACTION_TYPES.has(params.action_type)) return;

  const outcome: TrackedOutcome = {
    action_id: params.action_id,
    action_type: params.action_type,
    target: params.target,
    initiated_at: new Date().toISOString(),
    expected_outcome: params.expected_outcome,
    success: null,
  };
  if (params.notes) outcome.notes = params.notes;

  const outcomes = await loadOutcomes();
  outcomes.push(outcome);
  await saveOutcomes(outcomes);
}

// ---------------------------------------------------------------------------
// checkEmailOutcome — did an email get a reply?
// ---------------------------------------------------------------------------

export async function checkEmailOutcome(
  actionId: string,
): Promise<{ replied: boolean; replySnippet?: string } | null> {
  // Find the tracked outcome to get the target email address
  const outcomes = await loadOutcomes();
  const outcome = outcomes.find(
    (o) => o.action_id === actionId && o.action_type === "send_email",
  );
  if (!outcome) return null;

  try {
    const { listEmails } = await import("@/lib/ops/gmail-reader");
    // Search for replies from the target email address after the action was initiated
    const targetEmail = outcome.target;
    const sinceDate = outcome.initiated_at.slice(0, 10); // YYYY-MM-DD
    const query = `from:${targetEmail} after:${sinceDate}`;
    const replies = await listEmails({ query, count: 5 });

    if (replies.length > 0) {
      return {
        replied: true,
        replySnippet: replies[0].snippet?.slice(0, 200),
      };
    }
    return { replied: false };
  } catch (err) {
    // Gmail API not configured or failed — return null to indicate check unavailable
    console.warn(
      "[outcome-tracker] checkEmailOutcome failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// checkDealOutcome — did a B2B deal move forward?
// ---------------------------------------------------------------------------

export async function checkDealOutcome(
  actionId: string,
  companyName: string,
): Promise<{ progressed: boolean; currentStatus?: string } | null> {
  const notionToken = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
  const b2bDb = process.env.NOTION_B2B_PROSPECTS_DB;
  if (!notionToken || !b2bDb) return null;

  try {
    const { queryNotionDatabase } = await import(
      "@/lib/ops/abra-notion-write"
    );
    const pages = await queryNotionDatabase({
      database_id: b2bDb,
      filter: {
        property: "Company",
        rich_text: { contains: companyName },
      },
      page_size: 5,
    });

    if (pages.length === 0) return null;

    // Extract status from the first matching page
    const page = pages[0] as Record<string, unknown>;
    const props = page.properties as Record<string, unknown> | undefined;
    if (!props) return { progressed: false };

    // Try common status property names
    for (const statusKey of ["Status", "Stage", "Deal Stage", "Pipeline Stage"]) {
      const prop = props[statusKey] as Record<string, unknown> | undefined;
      if (!prop) continue;

      // Select property
      if (prop.select && typeof prop.select === "object") {
        const sel = prop.select as { name?: string };
        if (sel.name) {
          const status = sel.name.toLowerCase();
          const positiveStatuses = [
            "replied",
            "interested",
            "meeting scheduled",
            "negotiating",
            "won",
            "closed won",
            "sample sent",
            "quote sent",
            "in progress",
          ];
          const progressed = positiveStatuses.some((s) => status.includes(s));
          return { progressed, currentStatus: sel.name };
        }
      }

      // Status property (Notion status type)
      if (prop.status && typeof prop.status === "object") {
        const st = prop.status as { name?: string };
        if (st.name) {
          const status = st.name.toLowerCase();
          const positiveStatuses = [
            "replied",
            "interested",
            "meeting",
            "negotiating",
            "won",
            "sample",
            "quote",
          ];
          const progressed = positiveStatuses.some((s) => status.includes(s));
          return { progressed, currentStatus: st.name };
        }
      }
    }

    return { progressed: false };
  } catch (err) {
    console.warn(
      "[outcome-tracker] checkDealOutcome failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// runOutcomeCheck — iterate over pending outcomes and check for results
// ---------------------------------------------------------------------------

export async function runOutcomeCheck(): Promise<OutcomeCheckResult> {
  const outcomes = await loadOutcomes();
  const now = Date.now();
  const twentyFourHoursMs = 24 * 60 * 60 * 1000;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  let checked = 0;
  let updated = 0;
  const results: OutcomeCheckResult["results"] = [];

  for (const outcome of outcomes) {
    if (outcome.success !== null) continue; // Already resolved

    const ageMs = now - new Date(outcome.initiated_at).getTime();

    // Only check outcomes older than 24 hours (give time for responses)
    if (ageMs < twentyFourHoursMs) continue;

    // Auto-expire outcomes older than 7 days with no result
    if (ageMs > sevenDaysMs) {
      outcome.success = false;
      outcome.actual_outcome = "No outcome detected within 7 days";
      outcome.outcome_detected_at = new Date().toISOString();
      updated++;
      results.push({
        action_id: outcome.action_id,
        action_type: outcome.action_type,
        target: outcome.target,
        success: false,
        actual_outcome: outcome.actual_outcome,
      });
      continue;
    }

    checked++;

    try {
      if (outcome.action_type === "send_email" || outcome.action_type === "b2b_outreach") {
        const emailResult = await checkEmailOutcome(outcome.action_id);
        if (emailResult?.replied) {
          outcome.success = true;
          outcome.actual_outcome = `Reply received: ${emailResult.replySnippet || "(snippet unavailable)"}`;
          outcome.outcome_detected_at = new Date().toISOString();
          updated++;
          results.push({
            action_id: outcome.action_id,
            action_type: outcome.action_type,
            target: outcome.target,
            success: true,
            actual_outcome: outcome.actual_outcome,
          });
          continue;
        }

        // For b2b_outreach, also check deal progression in Notion
        if (outcome.action_type === "b2b_outreach") {
          const dealResult = await checkDealOutcome(outcome.action_id, outcome.target);
          if (dealResult?.progressed) {
            outcome.success = true;
            outcome.actual_outcome = `Deal progressed to: ${dealResult.currentStatus}`;
            outcome.outcome_detected_at = new Date().toISOString();
            updated++;
            results.push({
              action_id: outcome.action_id,
              action_type: outcome.action_type,
              target: outcome.target,
              success: true,
              actual_outcome: outcome.actual_outcome,
            });
            continue;
          }
        }
      }

      if (outcome.action_type === "send_slack") {
        // Slack messages don't have a clear "outcome" signal — mark as success
        // if it was sent (it already executed successfully to be tracked here)
        outcome.success = true;
        outcome.actual_outcome = "Slack message delivered (no reply tracking available)";
        outcome.outcome_detected_at = new Date().toISOString();
        updated++;
        results.push({
          action_id: outcome.action_id,
          action_type: outcome.action_type,
          target: outcome.target,
          success: true,
          actual_outcome: outcome.actual_outcome,
        });
        continue;
      }

      if (outcome.action_type === "create_draft_order") {
        // TODO: Check Shopify for order completion status
        // For now, leave as pending until 7-day expiry
        results.push({
          action_id: outcome.action_id,
          action_type: outcome.action_type,
          target: outcome.target,
          success: null,
        });
      }
    } catch (err) {
      console.warn(
        `[outcome-tracker] Error checking outcome for ${outcome.action_id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Save updated outcomes
  await saveOutcomes(outcomes);

  return { checked, updated, results };
}

// ---------------------------------------------------------------------------
// getOutcomeSummary — aggregate stats over the last N days
// ---------------------------------------------------------------------------

export function getOutcomeSummary(
  outcomes: TrackedOutcome[],
  days: number,
): OutcomeSummary {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffISO = cutoff.toISOString();

  const recent = outcomes.filter((o) => o.initiated_at >= cutoffISO);

  const byType: OutcomeSummary["by_action_type"] = {};
  let succeeded = 0;
  let failed = 0;
  let pending = 0;

  for (const o of recent) {
    if (!byType[o.action_type]) {
      byType[o.action_type] = { total: 0, succeeded: 0, failed: 0, pending: 0 };
    }
    byType[o.action_type].total++;

    if (o.success === true) {
      succeeded++;
      byType[o.action_type].succeeded++;
    } else if (o.success === false) {
      failed++;
      byType[o.action_type].failed++;
    } else {
      pending++;
      byType[o.action_type].pending++;
    }
  }

  const resolved = succeeded + failed;

  return {
    total: recent.length,
    pending,
    succeeded,
    failed,
    success_rate: resolved > 0 ? Math.round((succeeded / resolved) * 100) : null,
    by_action_type: byType,
  };
}

// ---------------------------------------------------------------------------
// getOutcomeSummaryFromState — convenience wrapper that loads from state
// ---------------------------------------------------------------------------

export async function getOutcomeSummaryFromState(
  days: number,
): Promise<OutcomeSummary> {
  const outcomes = await loadOutcomes();
  return getOutcomeSummary(outcomes, days);
}

// ---------------------------------------------------------------------------
// isTrackableAction — used by executeAction to decide whether to track
// ---------------------------------------------------------------------------

export function isTrackableAction(actionType: string): boolean {
  return TRACKABLE_ACTION_TYPES.has(actionType);
}
