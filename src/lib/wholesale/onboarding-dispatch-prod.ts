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
 *   - slack.post-financials-notif → `postMessage` to #finance
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
import { appendWholesaleInquiry } from "./inquiries";
import type { DispatchDeps } from "./onboarding-dispatch";
import type { OnboardingState } from "./onboarding-flow";
import {
  writeAuditEnvelope,
  writeOrderCapturedSnapshot,
} from "./onboarding-store";
import {
  buildApPacketEmail,
  type ApPacketEmailContext,
} from "./wholesale-ap-email";
import {
  HUBSPOT,
  createDeal,
  isHubSpotConfigured,
  updateDealStage,
  upsertContactByEmail,
} from "@/lib/ops/hubspot-client";
import { postMessage } from "@/lib/ops/control-plane/slack/client";
import { fetchDriveFile } from "@/lib/ops/drive-reader";
import { sendViaGmailApiDetailed } from "@/lib/ops/gmail-reader";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Slack channel id for #finance (canonical per channels.json). */
const SLACK_FINANCIALS_CHANNEL_ID = "C0ATF50QQ1M";

/**
 * BCC-Rene-on-new-customer rule (locked 2026-04-28).
 *
 * Per `/contracts/operating-memory.md` — every wholesale customer's
 * first-email send (AP onboarding packet, first invoice email)
 * BCCs Rene so Finance has full visibility on intent + thread state
 * without putting Rene on the To/CC line. Rule applies until the
 * customer is fully onboarded (NCS-001 returned + QBO customer
 * record finalized).
 */
const RENE_BCC_EMAIL = "rene@usagummies.com";

/** Sender CC. Mirrors the From, so Ben gets a copy in his sent items. */
const SENDER_CC_EMAIL = "ben@usagummies.com";

/** Sender display + envelope. Locked by Apr 13 Rene-approved CIF-001. */
const SENDER_FROM = "Ben Stutman <ben@usagummies.com>";

/**
 * Default Drive file IDs for the canonical Apr 13 Rene-approved
 * onboarding bundle. Overridable via env (so staging + production
 * can use different file IDs while the doc structure stays the same).
 *
 * - WHOLESALE_AP_PACKET_NCS001_DRIVE_ID — fillable Customer Setup Form
 * - WHOLESALE_AP_PACKET_CIF001_DRIVE_ID — our company info form
 * - WHOLESALE_AP_PACKET_WELCOME_DRIVE_ID — welcome packet (optional)
 *
 * If env not set, the handler returns ok:false with a clear
 * `bundle-not-configured` error rather than sending an empty packet.
 */
function readBundleIdsFromEnv(): {
  ncs001Id: string | null;
  cif001Id: string | null;
  welcomeId: string | null;
} {
  return {
    ncs001Id: (process.env.WHOLESALE_AP_PACKET_NCS001_DRIVE_ID ?? "").trim() || null,
    cif001Id: (process.env.WHOLESALE_AP_PACKET_CIF001_DRIVE_ID ?? "").trim() || null,
    welcomeId: (process.env.WHOLESALE_AP_PACKET_WELCOME_DRIVE_ID ?? "").trim() || null,
  };
}

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

    // ----- AP packet (Phase 35.f.3.c — wired 2026-04-28) -----
    //
    // Sends the Rene-approved Apr 13 onboarding bundle (NCS-001 v2 +
    // CIF-001 + optional Welcome Packet) to the customer's contact
    // email. Body is composed via wholesale-ap-email.ts; attachments
    // are fetched from Drive at send time.
    //
    // Mail flow:
    //   From:  ben@usagummies.com
    //   To:    state.prospect.contactEmail (or apInfo.apEmail if AP path)
    //   CC:    ben@usagummies.com  (Ben's own sent-items copy)
    //   BCC:   rene@usagummies.com (locked 2026-04-28 doctrine)
    apPacketSend: async (params) => {
      try {
        const result = await sendWholesaleApPacket(params);
        return result;
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
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
        const totalSubtotalUsd = state.orderLines.reduce(
          (acc, l) => acc + l.subtotalUsd,
          0,
        );
        await writeAuditEnvelope({
          flowId: state.flowId,
          completedAt: new Date().toISOString(),
          stepsCompleted: state.stepsCompleted,
          paymentPath: state.paymentPath,
          prospect: state.prospect,
          orderLineCount: state.orderLines.length,
          hubspotDealId: state.hubspotDealId,
          qboCustomerApprovalId: state.qboCustomerApprovalId,
          totalSubtotalUsd: Math.round(totalSubtotalUsd * 100) / 100,
        });
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
// Wholesale AP packet send — wired Phase 35.f.3.c
// ---------------------------------------------------------------------------

interface SendWholesaleApPacketParams {
  state: OnboardingState;
  template: "wholesale-ap";
  invoiceContext?: {
    invoiceNumber?: string;
    invoiceDriveFileId?: string;
    totalUsdOverride?: number;
    personalNote?: string;
  };
  /**
   * Optional per-call override of the bundle Drive file IDs.
   *
   * Used by the explicit-context route (`POST /api/ops/wholesale/
   * send-ap-packet`) for one-off sends where the operator wants to
   * skip Vercel env config (e.g. first-customer Mike where the
   * agents resolved the Drive IDs in real time).
   *
   * State-machine fired sends always use env defaults — the override
   * is for explicit-context callers only.
   *
   * If both `ncs001Id` and `cif001Id` are provided, env vars are
   * ignored entirely. If only some are provided, env still fills
   * the gaps (defensive — partial-override is unlikely but cheap
   * to support).
   */
  attachmentBundleOverride?: {
    ncs001Id?: string;
    cif001Id?: string;
    welcomeId?: string;
  };
}

/**
 * Public entry point for the wholesale-AP packet send. Used by:
 *   1. The dispatcher's `apPacketSend` handler (state-machine fired)
 *   2. The one-off `/api/ops/wholesale/send-ap-packet` route
 *      (explicit-context fired — used for first-customer Mike at
 *      Thanksgiving Point + any other manual sends until the full
 *      flow runs end-to-end)
 *
 * Idempotent only at the message level — Gmail won't dedupe sends.
 * Caller is responsible for dedup gates (e.g. KV "ap-packet-sent:<flowId>").
 */
export async function sendWholesaleApPacket(
  params: SendWholesaleApPacketParams,
): Promise<
  | { ok: true; gmailMessageId?: string }
  | { ok: false; error: string }
> {
  const { state, invoiceContext } = params;

  // 1. Validate required fields up front. Honest reads — fail-fast
  //    with a clear error rather than send a half-formed email.
  if (!state.prospect) {
    return {
      ok: false,
      error: "state.prospect missing — no recipient email available",
    };
  }
  if (!state.prospect.contactEmail.trim()) {
    return {
      ok: false,
      error: "state.prospect.contactEmail empty — no recipient email available",
    };
  }
  if (state.orderLines.length === 0) {
    return {
      ok: false,
      error:
        "state.orderLines empty — packet must reference a captured order",
    };
  }

  // 2. Resolve attachment Drive IDs. Per-call override takes priority
  //    (explicit-context route use case); env vars fill any gaps.
  const envBundle = readBundleIdsFromEnv();
  const override = params.attachmentBundleOverride ?? {};
  const bundle = {
    ncs001Id: (override.ncs001Id ?? envBundle.ncs001Id ?? "").trim() || null,
    cif001Id: (override.cif001Id ?? envBundle.cif001Id ?? "").trim() || null,
    welcomeId:
      (override.welcomeId ?? envBundle.welcomeId ?? "").trim() || null,
  };
  if (!bundle.ncs001Id || !bundle.cif001Id) {
    return {
      ok: false,
      error:
        "wholesale-ap bundle not configured — set WHOLESALE_AP_PACKET_NCS001_DRIVE_ID and WHOLESALE_AP_PACKET_CIF001_DRIVE_ID on Vercel, or pass attachmentBundleOverride with both ncs001Id + cif001Id",
    };
  }

  // 3. Fetch each attachment from Drive.
  const attachmentRefs: { driveId: string; label: string; required: boolean }[] = [
    {
      driveId: bundle.ncs001Id,
      label: "New_Customer_Setup_Form_USA_Gummies.pdf (please complete + return)",
      required: true,
    },
    {
      driveId: bundle.cif001Id,
      label: "Customer_Information_Form_USA_Gummies.pdf (our W-9 + ACH info — for your records)",
      required: true,
    },
  ];
  if (bundle.welcomeId) {
    attachmentRefs.push({
      driveId: bundle.welcomeId,
      label: "Welcome_Packet_USA_Gummies.pdf (orientation)",
      required: false,
    });
  }
  if (invoiceContext?.invoiceDriveFileId) {
    const invLabel = invoiceContext.invoiceNumber
      ? `Invoice_${invoiceContext.invoiceNumber}_USA_Gummies.pdf (draft)`
      : "Invoice_Draft_USA_Gummies.pdf";
    attachmentRefs.push({
      driveId: invoiceContext.invoiceDriveFileId,
      label: invLabel,
      required: false,
    });
  }

  const attachments: {
    filename: string;
    mimeType: string;
    content: Buffer;
  }[] = [];
  const labelsForBody: string[] = [];

  for (const ref of attachmentRefs) {
    const r = await fetchDriveFile({ kind: "file", fileId: ref.driveId });
    if (!r.ok) {
      if (ref.required) {
        return {
          ok: false,
          error: `Drive fetch failed for required attachment ${ref.label}: ${r.error}`,
        };
      }
      // Optional attachment — skip but log to body label list.
      labelsForBody.push(`${ref.label} (NOT ATTACHED — Drive fetch failed)`);
      continue;
    }
    attachments.push({
      filename: r.file.name,
      mimeType: r.file.mimeType,
      content: r.file.data,
    });
    labelsForBody.push(ref.label);
  }

  // 4. Compose the email body via the pure builder.
  const emailCtx: ApPacketEmailContext = {
    invoiceNumber: invoiceContext?.invoiceNumber,
    totalUsdOverride: invoiceContext?.totalUsdOverride,
    personalNote: invoiceContext?.personalNote,
    attachmentLabels: labelsForBody,
  };
  let draft;
  try {
    draft = buildApPacketEmail(state, emailCtx);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 5. Resolve recipient. If AP path + AP team email is on file,
  //    that's the primary; otherwise the prospect's contact email.
  const apEmail = state.apInfo?.apEmail?.trim();
  const recipient =
    state.paymentPath === "accounts-payable" && apEmail
      ? apEmail
      : state.prospect.contactEmail;

  // 6. Send via Gmail API. CC: ben@ (sender's own copy). BCC: rene@
  //    (locked doctrine 2026-04-28).
  const sendResult = await sendViaGmailApiDetailed({
    from: SENDER_FROM,
    to: recipient,
    cc: SENDER_CC_EMAIL,
    bcc: RENE_BCC_EMAIL,
    subject: draft.subject,
    body: draft.body,
    attachments,
  });

  if (!sendResult.ok) {
    return {
      ok: false,
      error: `Gmail send failed: ${sendResult.error ?? "unknown"}`,
    };
  }

  // 7. Audit envelope. Per `/contracts/operating-memory.md` no-silent-
  //    action rule, every autonomous send produces an audit envelope.
  try {
    await writeAuditEnvelope({
      flowId: state.flowId,
      completedAt: new Date().toISOString(),
      stepsCompleted: state.stepsCompleted,
      paymentPath: state.paymentPath,
      prospect: state.prospect,
      orderLineCount: state.orderLines.length,
      hubspotDealId: state.hubspotDealId,
      qboCustomerApprovalId: state.qboCustomerApprovalId,
      totalSubtotalUsd:
        Math.round(
          state.orderLines.reduce((acc, l) => acc + l.subtotalUsd, 0) *
            100,
        ) / 100,
    });
  } catch {
    // Audit-write failure is non-fatal — the email already sent.
    // Log loud + continue (per the operating-memory drift-detection
    // rule, the absence of an audit envelope will surface in Slack
    // corrections).
    console.warn(
      `[wholesale-ap-packet] audit envelope write failed for flow ${state.flowId} (email sent successfully)`,
    );
  }

  return { ok: true, gmailMessageId: sendResult.messageId };
}

// ---------------------------------------------------------------------------
// Test helpers — NOT exported from a barrel
// ---------------------------------------------------------------------------

export const __INTERNAL = {
  SLACK_FINANCIALS_CHANNEL_ID,
  RENE_BCC_EMAIL,
  SENDER_CC_EMAIL,
  SENDER_FROM,
  HUBSPOT_REF: HUBSPOT,
  readBundleIdsFromEnv,
};
