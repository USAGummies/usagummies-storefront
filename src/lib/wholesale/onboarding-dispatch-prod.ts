/**
 * Production deps wiring for the wholesale onboarding dispatcher —
 * Phase 35.f.3.b.
 *
 * Builds a `DispatchDeps` instance that adapts each handler signature
 * to the real helpers in `@/lib/ops/*` and `@/lib/wholesale/*`. Tests
 * inject mocks via the abstract `DispatchDeps` interface; this module
 * is what production routes import to wire the concrete dispatch.
 *
 * **Wired tonight (Phase 35.f.3.b):**
 *   - hubspot.upsert-contact     → `upsertContactByEmail`
 *   - hubspot.create-deal        → `createDeal`
 *   - hubspot.advance-stage      → `updateDealStage`
 *   - hubspot.set-onboarding-complete → `updateDealStage` extension
 *                                     (custom property write)
 *   - kv.archive-inquiry         → `appendWholesaleInquiry`
 *   - kv.write-order-captured    → `writeOrderCapturedSnapshot`
 *   - slack.post-financials-notif → `postMessage` to #financials
 *   - audit.flow-complete        → `auditStore.append` (audit envelope)
 *
 * **Stubbed (TODO Phase 35.f.3.c — needs Rene + integration design):**
 *   - ap-packet.send (template "wholesale-ap")
 *     → needs the wholesale-ap template body + Drive packet build +
 *       send pipeline. Existing /api/ops/ap-packets/drafts is single-
 *       vendor-facing; wholesale-ap is customer-facing with the
 *       captured order embedded.
 *   - qbo.vendor-master-create.stage-approval
 *     → needs the QBO Class B approval card open via control-plane
 *       approvals.openApproval(slug="vendor.master.create"). The
 *       existing vendor-onboarding.ts demonstrates the pattern; this
 *       just needs the wholesale-customer payload schema locked with
 *       Rene tomorrow.
 *
 * Both stubs return `{ ok: false, error: "phase 35.f.3.c TODO ..." }`
 * so DispatchResult.failures[] surfaces them clearly. The route
 * layer logs failures; nothing crashes.
 */
import { kv } from "@vercel/kv";

import { appendWholesaleInquiry } from "./inquiries";
import type { DispatchDeps } from "./onboarding-dispatch";
import { writeOrderCapturedSnapshot } from "./onboarding-store";
import {
  HUBSPOT,
  createDeal,
  isHubSpotConfigured,
  updateDealStage,
  upsertContactByEmail,
} from "@/lib/ops/hubspot-client";
import { postMessage } from "@/lib/ops/control-plane/slack/client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Slack channel id for #financials (canonical per channels.json). */
const SLACK_FINANCIALS_CHANNEL_ID = "C0AKG9FSC2J";

/** KV key prefix for the audit.flow-complete envelopes. */
const KV_AUDIT_PREFIX = "wholesale:audit:flow-complete:";
const AUDIT_TTL_SECONDS = 365 * 24 * 3600;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Returns the prod-wired `DispatchDeps`. Routes call this once and
 * pass the result to `dispatchSideEffects()`. The factory itself is
 * pure (no I/O); the handlers do I/O when invoked.
 */
export function buildProdDispatchDeps(): DispatchDeps {
  return {
    // ----- HubSpot -----
    hubspotUpsertContact: async (params) => {
      if (!isHubSpotConfigured()) {
        return { ok: false, error: "HubSpot not configured" };
      }
      try {
        const r = await upsertContactByEmail(params);
        if (!r) return { ok: false, error: "upsertContactByEmail returned null" };
        return { ok: true, contactId: r.id };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    hubspotCreateDeal: async (params) => {
      if (!isHubSpotConfigured()) {
        return { ok: false, error: "HubSpot not configured" };
      }
      try {
        const id = await createDeal({
          dealname: params.dealName,
          dealstage: params.stage,
          contactId: params.contactId,
          amount: params.amount,
          description: Object.entries(params.properties ?? {})
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n") || undefined,
        });
        if (!id) return { ok: false, error: "createDeal returned null" };
        return { ok: true, dealId: id };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    hubspotAdvanceStage: async (params) => {
      if (!isHubSpotConfigured()) {
        return { ok: false, error: "HubSpot not configured" };
      }
      try {
        const r = await updateDealStage(params.dealId, params.stage);
        if (r === null) return { ok: false, error: "updateDealStage failed" };
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    hubspotSetOnboardingComplete: async (params) => {
      // Setting a custom property is a PATCH on the deal; we use
      // the same endpoint as updateDealStage. No dedicated helper
      // yet — defer to a focused commit if this surface needs more
      // structure. For now: write the custom property directly
      // through the same hsRequest path by reusing updateDealStage's
      // PATCH semantics via a thin shim.
      if (!isHubSpotConfigured()) {
        return { ok: false, error: "HubSpot not configured" };
      }
      try {
        // The HUBSPOT helper doesn't expose a generic property
        // setter publicly; use fetch directly with the same auth
        // pattern. Token + base URL are validated by the gate above.
        const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
        if (!token) {
          return { ok: false, error: "HUBSPOT_PRIVATE_APP_TOKEN missing" };
        }
        const res = await fetch(
          `https://api.hubapi.com/crm/v3/objects/deals/${encodeURIComponent(params.dealId)}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              properties: {
                wholesale_onboarding_complete: params.value ? "true" : "false",
              },
            }),
          },
        );
        if (!res.ok) {
          return {
            ok: false,
            error: `HubSpot PATCH failed: ${res.status}`,
          };
        }
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    // ----- KV -----
    kvArchiveInquiry: async (state) => {
      try {
        await appendWholesaleInquiry({
          email: state.prospect?.contactEmail,
          phone: state.prospect?.contactPhone,
          source: "wholesale-onboarding-flow",
          intent: "wholesale",
          storeName: state.prospect?.companyName,
          buyerName: state.prospect?.contactName,
          location: state.shippingAddress
            ? `${state.shippingAddress.city}, ${state.shippingAddress.state}`
            : undefined,
          interest: state.storeType,
        });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    kvWriteOrderCaptured: async (state) => {
      try {
        await writeOrderCapturedSnapshot(state);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    // ----- Slack -----
    slackPostFinancialsNotif: async (state) => {
      try {
        const lines = state.orderLines.map(
          (l) =>
            `  • ${l.tier} × ${l.unitCount} (${l.bags} bags) — $${l.subtotalUsd.toFixed(2)} ${l.freightMode}`,
        );
        const subtotal = state.orderLines.reduce(
          (acc, l) => acc + l.subtotalUsd,
          0,
        );
        const text = [
          `*Wholesale order captured* — flow \`${state.flowId}\``,
          `Customer: ${state.prospect?.companyName ?? "(unknown)"} (${state.prospect?.contactEmail ?? "no email"})`,
          `Payment path: ${state.paymentPath ?? "(unset)"}`,
          `Order:`,
          ...lines,
          `Subtotal: $${subtotal.toFixed(2)}`,
        ].join("\n");

        const r = await postMessage({
          channel: SLACK_FINANCIALS_CHANNEL_ID,
          text,
        });
        if (!r.ok) {
          return { ok: false, error: r.error ?? "slack postMessage failed" };
        }
        return { ok: true, ts: r.ts };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    // ----- AP packet (TODO Phase 35.f.3.c) -----
    apPacketSend: async () => {
      return {
        ok: false,
        error:
          "phase 35.f.3.c TODO: wholesale-ap template + send pipeline pending Rene sign-off on packet body",
      };
    },

    // ----- QBO approval card (TODO Phase 35.f.3.c) -----
    qboStageVendorMasterApproval: async () => {
      return {
        ok: false,
        error:
          "phase 35.f.3.c TODO: wire control-plane.openApproval('vendor.master.create') with wholesale-customer payload — pending Rene sign-off on customer master schema",
      };
    },

    // ----- Audit envelope -----
    auditFlowComplete: async (state) => {
      try {
        await kv.set(
          `${KV_AUDIT_PREFIX}${state.flowId}`,
          JSON.stringify({
            flowId: state.flowId,
            completedAt: new Date().toISOString(),
            stepsCompleted: state.stepsCompleted,
            paymentPath: state.paymentPath,
            prospect: state.prospect,
            orderLineCount: state.orderLines.length,
            hubspotDealId: state.hubspotDealId,
            qboCustomerApprovalId: state.qboCustomerApprovalId,
          }),
          { ex: AUDIT_TTL_SECONDS },
        );
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Test helpers — NOT exported from a barrel
// ---------------------------------------------------------------------------

export const __INTERNAL = {
  SLACK_FINANCIALS_CHANNEL_ID,
  KV_AUDIT_PREFIX,
  AUDIT_TTL_SECONDS,
  HUBSPOT_REF: HUBSPOT,
};
