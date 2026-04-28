/**
 * Wholesale onboarding side-effect dispatcher — Phase 35.f.3.
 *
 * Pure orchestration: takes (state, effects, deps) and dispatches
 * each `SideEffect` to its bound handler. The route layer (Phase
 * 35.f.1 — `POST /api/wholesale/onboarding/advance`) returns
 * `sideEffectsPending`; this module is what the caller (or a
 * separate dispatcher route) invokes to actually fire HubSpot /
 * QBO / Slack / AP-packet writes.
 *
 * **Dependency injection:** all external integrations are passed
 * via `deps`. Tests pass mocks; production passes real helpers
 * (Phase 35.f.3.b wires the prod deps).
 *
 * **Failure-isolation:** each effect runs independently. A failed
 * Slack post does NOT block a HubSpot upsert from firing. Failures
 * are collected into `DispatchResult.failures[]` so the caller can
 * log + retry. Successful effects are NOT re-fired — at-least-once
 * semantics, but the route already serializes per-step so dupes
 * are bounded.
 *
 * **Idempotency:** since `sideEffectsPending` is computed from
 * `state` (not stored as a queue), a redeliver-after-failure is
 * safe — calling dispatchSideEffects again on the same (state,
 * effects) pair re-runs every effect. Each handler must therefore
 * be idempotent (HubSpot upsertContact handles that; Slack/KV/
 * audit accept dupes; QBO approval card open is the only one that
 * needs care — handled in 35.f.3.b).
 */
import type {
  OnboardingState,
  SideEffect,
} from "./onboarding-flow";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Production deps wire each handler to the real helper. Tests pass
 * mocks. All handlers are async + return `{ ok, ...details }`.
 *
 * Convention: every handler returns the data the *caller* needs to
 * continue (e.g. `hubspotDealId` from the create-deal handler so
 * the route can persist it). The dispatcher relays this back via
 * `DispatchResult.outputs`.
 */
export interface DispatchDeps {
  /** HubSpot upsertContactByEmail. */
  hubspotUpsertContact: (params: {
    email: string;
    firstname?: string;
    lastname?: string;
    company?: string;
    phone?: string;
  }) => Promise<{ ok: true; contactId: string } | { ok: false; error: string }>;

  /** HubSpot createDeal. */
  hubspotCreateDeal: (params: {
    dealName: string;
    stage: string;
    contactId?: string;
    amount?: number;
    properties?: Record<string, string>;
  }) => Promise<{ ok: true; dealId: string } | { ok: false; error: string }>;

  /** HubSpot updateDealStage. */
  hubspotAdvanceStage: (params: {
    dealId: string;
    stage: string;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;

  /** HubSpot set property `wholesale_onboarding_complete`. */
  hubspotSetOnboardingComplete: (params: {
    dealId: string;
    value: boolean;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;

  /** Append wholesale inquiry to KV archive. */
  kvArchiveInquiry: (
    state: OnboardingState,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;

  /** Persist the captured-order envelope. */
  kvWriteOrderCaptured: (
    state: OnboardingState,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;

  /** Post a Slack message to #financials. */
  slackPostFinancialsNotif: (
    state: OnboardingState,
  ) => Promise<{ ok: true; ts?: string } | { ok: false; error: string }>;

  /**
   * Send the wholesale-AP onboarding packet.
   *
   * The dispatcher's state machine fires this with `template:
   * "wholesale-ap"` only. Explicit per-call routes (e.g. one-off
   * sends like the first-customer Mike at Thanksgiving Point) can
   * pass an `invoiceContext` override to embed an invoice number +
   * total in the email body.
   *
   * Returns the Gmail message id on success so the caller can
   * audit-log the linkage.
   */
  apPacketSend: (params: {
    state: OnboardingState;
    template: "wholesale-ap";
    invoiceContext?: {
      invoiceNumber?: string;
      invoiceDriveFileId?: string;
      totalUsdOverride?: number;
      personalNote?: string;
    };
  }) => Promise<
    | { ok: true; gmailMessageId?: string }
    | { ok: false; error: string }
  >;

  /** Stage a QBO `vendor.master.create` Class B approval card. */
  qboStageVendorMasterApproval: (
    state: OnboardingState,
  ) => Promise<{ ok: true; approvalId: string } | { ok: false; error: string }>;

  /** Write the audit.flow-complete envelope. */
  auditFlowComplete: (
    state: OnboardingState,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

/** One row of dispatch outcome — the audit trail of what fired. */
export interface DispatchOutcome {
  kind: SideEffect["kind"];
  ok: boolean;
  error?: string;
  /** Side-effect-specific output (dealId, contactId, approvalId, ts). */
  output?: Record<string, unknown>;
}

export interface DispatchResult {
  /** Number of effects that fired successfully. */
  successCount: number;
  /** Number of effects that failed. */
  failureCount: number;
  /** Full ordered outcome list (one entry per effect input). */
  outcomes: readonly DispatchOutcome[];
  /** Convenience: failed outcomes only. */
  failures: readonly DispatchOutcome[];
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatch every `SideEffect` to its bound handler in `deps`.
 * Effects run sequentially in input order — the route layer
 * already produces them in canonical order, and KV/Slack writes
 * benefit from being serialized for audit-trail consistency.
 *
 * Each handler runs inside a try/catch so a thrown exception
 * doesn't abort the batch. Failures are collected into
 * `failures[]`. The caller decides whether to retry.
 */
export async function dispatchSideEffects(
  state: OnboardingState,
  effects: readonly SideEffect[],
  deps: DispatchDeps,
): Promise<DispatchResult> {
  const outcomes: DispatchOutcome[] = [];

  for (const effect of effects) {
    const outcome = await runOne(state, effect, deps);
    outcomes.push(outcome);
  }

  const failures = outcomes.filter((o) => !o.ok);
  return {
    successCount: outcomes.length - failures.length,
    failureCount: failures.length,
    outcomes,
    failures,
  };
}

async function runOne(
  state: OnboardingState,
  effect: SideEffect,
  deps: DispatchDeps,
): Promise<DispatchOutcome> {
  try {
    switch (effect.kind) {
      case "hubspot.upsert-contact": {
        const p = state.prospect;
        if (!p) {
          return {
            kind: effect.kind,
            ok: false,
            error: "state.prospect missing — cannot upsert contact",
          };
        }
        const [firstname, ...rest] = p.contactName.split(/\s+/);
        const lastname = rest.join(" ");
        const r = await deps.hubspotUpsertContact({
          email: p.contactEmail,
          firstname,
          lastname: lastname || undefined,
          company: p.companyName,
          phone: p.contactPhone,
        });
        return r.ok
          ? { kind: effect.kind, ok: true, output: { contactId: r.contactId } }
          : { kind: effect.kind, ok: false, error: r.error };
      }

      case "hubspot.create-deal": {
        const p = state.prospect;
        if (!p) {
          return {
            kind: effect.kind,
            ok: false,
            error: "state.prospect missing — cannot create deal",
          };
        }
        const r = await deps.hubspotCreateDeal({
          dealName: `${p.companyName} — Wholesale Onboarding`,
          stage: effect.stage,
          properties: {
            wholesale_flow_id: state.flowId,
            wholesale_onboarding_step: state.currentStep,
          },
        });
        return r.ok
          ? { kind: effect.kind, ok: true, output: { dealId: r.dealId } }
          : { kind: effect.kind, ok: false, error: r.error };
      }

      case "hubspot.advance-stage": {
        if (!state.hubspotDealId) {
          return {
            kind: effect.kind,
            ok: false,
            error: "state.hubspotDealId missing — create-deal must run first",
          };
        }
        const r = await deps.hubspotAdvanceStage({
          dealId: state.hubspotDealId,
          stage: effect.stage,
        });
        return r.ok
          ? { kind: effect.kind, ok: true }
          : { kind: effect.kind, ok: false, error: r.error };
      }

      case "hubspot.set-onboarding-complete": {
        if (!state.hubspotDealId) {
          return {
            kind: effect.kind,
            ok: false,
            error: "state.hubspotDealId missing",
          };
        }
        const r = await deps.hubspotSetOnboardingComplete({
          dealId: state.hubspotDealId,
          value: effect.value,
        });
        return r.ok
          ? { kind: effect.kind, ok: true }
          : { kind: effect.kind, ok: false, error: r.error };
      }

      case "kv.archive-inquiry": {
        const r = await deps.kvArchiveInquiry(state);
        return r.ok
          ? { kind: effect.kind, ok: true }
          : { kind: effect.kind, ok: false, error: r.error };
      }

      case "kv.write-order-captured": {
        const r = await deps.kvWriteOrderCaptured(state);
        return r.ok
          ? { kind: effect.kind, ok: true }
          : { kind: effect.kind, ok: false, error: r.error };
      }

      case "slack.post-financials-notif": {
        const r = await deps.slackPostFinancialsNotif(state);
        return r.ok
          ? { kind: effect.kind, ok: true, output: r.ts ? { ts: r.ts } : {} }
          : { kind: effect.kind, ok: false, error: r.error };
      }

      case "ap-packet.send": {
        const r = await deps.apPacketSend({ state, template: effect.template });
        return r.ok
          ? {
              kind: effect.kind,
              ok: true,
              output: r.gmailMessageId
                ? { gmailMessageId: r.gmailMessageId }
                : {},
            }
          : { kind: effect.kind, ok: false, error: r.error };
      }

      case "qbo.vendor-master-create.stage-approval": {
        const r = await deps.qboStageVendorMasterApproval(state);
        return r.ok
          ? {
              kind: effect.kind,
              ok: true,
              output: { approvalId: r.approvalId },
            }
          : { kind: effect.kind, ok: false, error: r.error };
      }

      case "audit.flow-complete": {
        const r = await deps.auditFlowComplete(state);
        return r.ok
          ? { kind: effect.kind, ok: true }
          : { kind: effect.kind, ok: false, error: r.error };
      }

      default: {
        // Exhaustiveness — TS catches missing cases at compile time.
        const _exhaustive: never = effect;
        return {
          kind: (_exhaustive as { kind: SideEffect["kind"] }).kind,
          ok: false,
          error: "unknown SideEffect kind",
        };
      }
    }
  } catch (err) {
    return {
      kind: effect.kind,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
