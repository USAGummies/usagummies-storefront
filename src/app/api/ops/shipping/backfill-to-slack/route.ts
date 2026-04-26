/**
 * POST /api/ops/shipping/backfill-to-slack
 *
 * Phase 27 Stage D — one-shot backfill of recent shipping audit
 * entries into `#shipping`. Reads `shipping:auto-shipped` (KV), looks
 * up each artifact record, and posts a v1.0 SHIPPING PROTOCOL
 * message per order. Idempotent — skips orders that already have
 * `slackPermalink` set on their artifact record.
 *
 * For each missing-from-Slack shipment:
 *   - When the Drive label PDF is available → fetch bytes + upload
 *     to `#shipping` with the v1.0 layout comment + (when present)
 *     thread the packing slip PDF as a reply.
 *   - When Drive failed → post a text-only message with the v1.0
 *     layout AND a "Label is in ShipStation — Reprint required"
 *     footer (links to Seller Central / Shopify admin when known).
 *
 * The route NEVER fabricates data:
 *   - Missing recipient → "(unknown)" via the locked
 *     `formatShipmentComment` helper.
 *   - Missing tracking → "(no tracking)".
 *   - Missing PDF → text-only mode with a clear gap signal.
 *
 * Hard rules:
 *   - **Auth-gated.** `isAuthorized()` (session OR CRON_SECRET).
 *   - **Idempotent.** Re-running the route will skip orders whose
 *     artifact record already has `slackPermalink` (the previous
 *     backfill run, or live auto-ship pipeline, populated it).
 *   - **Read-only on ShipStation / QBO / HubSpot.** No labels are
 *     bought, no orders are mutated. The only writes are Slack
 *     uploads + `attachSlackPermalink` to the artifact record.
 *   - **Class B side-effect (Slack post).** Auth gate is the human
 *     approval — the operator manually invokes the route when ready.
 *
 * Body (all optional):
 *   {
 *     dryRun?: boolean,        // preview without uploading (default false)
 *     limit?: number,          // 1..50, default 20 — cap on entries to process
 *     orderNumbers?: string[]  // restrict to specific order numbers
 *   }
 *
 * Response (200):
 *   {
 *     ok: true,
 *     dryRun: boolean,
 *     processed: number,
 *     results: Array<BackfillResult>
 *   }
 *
 * Each result:
 *   - status: "already-in-slack" | "posted-with-pdf" | "posted-text-only"
 *             | "skipped-no-artifact" | "error"
 *   - orderNumber, source
 *   - permalink (when posted)
 *   - error (when status === "error")
 */
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getChannel } from "@/lib/ops/control-plane/channels";
import { getPermalink, postMessage } from "@/lib/ops/control-plane/slack/client";
import type { ChannelId } from "@/lib/ops/control-plane/types";
import {
  attachSlackPermalink,
  getShippingArtifact,
} from "@/lib/ops/shipping-artifacts";
import { uploadBufferToSlack } from "@/lib/ops/slack-file-upload";
import { formatPackingSlipComment, formatShipmentComment } from "@/lib/ops/auto-ship-format";
import { fetchDriveFile, parseDriveRef } from "@/lib/ops/drive-reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KV_AUTO_SHIPPED = "shipping:auto-shipped";
const BACKFILL_PREFIX = "[BACKFILL] ";

interface AutoShippedEntry {
  orderNumber: string;
  source: string;
  dispatchedAt: string;
  trackingNumber?: string | null;
}

interface BackfillBody {
  dryRun?: boolean;
  limit?: number;
  orderNumbers?: string[];
}

type BackfillStatus =
  | "already-in-slack"
  | "would-post-with-pdf"
  | "would-post-text-only"
  | "posted-with-pdf"
  | "posted-text-only"
  | "skipped-no-artifact"
  | "skipped-no-channel"
  | "error";

interface BackfillResult {
  orderNumber: string;
  source: string;
  dispatchedAt: string;
  status: BackfillStatus;
  /** Slack permalink when posted (or already in slack). */
  permalink?: string;
  /** True when the post included an attached label PDF. */
  hadLabelPdf?: boolean;
  /** True when a packing slip was threaded under the label post. */
  hadPackingSlip?: boolean;
  error?: string;
}

/**
 * Best-effort tracking + service hint from the AutoShippedEntry.
 * Service isn't on the entry — the audit log has it but we don't
 * re-read the audit here. Pass `(unknown)` and let the v1.0 formatter
 * surface the gap.
 */
function carrierFromEntry(entry: AutoShippedEntry): {
  service: string;
  trackingNumber: string | null;
  costUsd: number;
} {
  return {
    service: "(see attached label)",
    trackingNumber: entry.trackingNumber ?? null,
    costUsd: Number.NaN, // formatter renders as "(unknown)"
  };
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: BackfillBody = {};
  try {
    body = (await req.json()) as BackfillBody;
  } catch {
    body = {};
  }
  const dryRun = body.dryRun === true;
  const limit = Math.max(1, Math.min(50, body.limit ?? 20));
  const orderFilter = Array.isArray(body.orderNumbers)
    ? new Set(body.orderNumbers)
    : null;

  // Resolve the destination channel once. If the registry doesn't
  // have it, refuse — better to surface the gap than post nowhere.
  const shippingChannel = getChannel("shipping");
  const destChannel =
    shippingChannel?.slackChannelId ??
    shippingChannel?.name ??
    shippingChannel?.id ??
    null;
  if (!destChannel) {
    return NextResponse.json(
      {
        ok: false,
        error: "shipping_channel_not_in_registry",
        reason:
          "src/lib/ops/control-plane/channels.ts has no `shipping` entry; cannot backfill.",
      },
      { status: 500 },
    );
  }

  // Load the auto-shipped log; slice to most-recent N (or filter).
  let entries: AutoShippedEntry[];
  try {
    entries = ((await kv.get<AutoShippedEntry[]>(KV_AUTO_SHIPPED)) ??
      []) as AutoShippedEntry[];
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "kv_read_failed",
        reason: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  const candidates = entries
    .filter((e) =>
      orderFilter ? orderFilter.has(e.orderNumber) : true,
    )
    .slice(-limit)
    .reverse(); // most-recent first

  const results: BackfillResult[] = [];

  for (const entry of candidates) {
    const baseResult: Omit<BackfillResult, "status"> = {
      orderNumber: entry.orderNumber,
      source: entry.source,
      dispatchedAt: entry.dispatchedAt,
    };

    let artifact;
    try {
      artifact = await getShippingArtifact(entry.source, entry.orderNumber);
    } catch (err) {
      results.push({
        ...baseResult,
        status: "error",
        error: `artifact_lookup_failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    // Idempotent — skip if already in #shipping.
    if (artifact?.slackPermalink) {
      results.push({
        ...baseResult,
        status: "already-in-slack",
        permalink: artifact.slackPermalink,
      });
      continue;
    }

    const labelDriveLink = artifact?.label?.webViewLink ?? null;
    const packingSlipDriveLink = artifact?.packingSlip?.webViewLink ?? null;
    const hasDrivePdf = Boolean(labelDriveLink && artifact?.label?.fileId);

    // Build the v1.0 comment. shipTo is empty here — the address is
    // visibly printed on the label PDF (which gets attached when
    // available). Operators reading the channel still get the order
    // ID + tracking + cost-from-audit + Drive backup link.
    const comment =
      BACKFILL_PREFIX +
      "Label was bought but never reached `#shipping` due to bot scope outage Apr 23-26.\n" +
      formatShipmentComment({
        orderNumber: entry.orderNumber,
        source: entry.source,
        bags: 0, // unknown at backfill time — bag count audit field absent on AutoShippedEntry
        shipTo: {
          name: null,
          company: null,
          street1: null,
          street2: null,
          city: null,
          state: null,
          postalCode: null,
          country: null,
        },
        carrier: carrierFromEntry(entry),
        driveLinks: {
          label: labelDriveLink,
          packingSlip: packingSlipDriveLink,
        },
      });

    // Dry-run: report what WOULD post without actually uploading.
    if (dryRun) {
      results.push({
        ...baseResult,
        status: hasDrivePdf ? "would-post-with-pdf" : "would-post-text-only",
        hadLabelPdf: hasDrivePdf,
        hadPackingSlip: Boolean(packingSlipDriveLink && artifact?.packingSlip?.fileId),
      });
      continue;
    }

    // Drive-backed path: download PDF + upload to Slack with attachment.
    if (hasDrivePdf && labelDriveLink) {
      const ref = parseDriveRef(labelDriveLink);
      const fetchRes = await fetchDriveFile(ref);
      if (!fetchRes.ok) {
        // Fall through to text-only mode if Drive fetch fails.
        const sent = await postMessage({
          channel: destChannel,
          text:
            comment +
            `\n\n:warning: Tried to fetch label PDF from Drive but failed: \`${fetchRes.error}\`. Reprint from ShipStation.`,
        });
        const textPermalink = sent.ok && sent.ts
          ? await getPermalink({
              channel: shippingChannel?.id as ChannelId,
              message_ts: sent.ts,
            })
          : null;
        results.push({
          ...baseResult,
          status: "posted-text-only",
          permalink: textPermalink ?? undefined,
          error: `drive_fetch_failed: ${fetchRes.error}`,
        });
        if (textPermalink) {
          await attachSlackPermalink({
            source: entry.source,
            orderNumber: entry.orderNumber,
            slackPermalink: textPermalink,
          });
        }
        continue;
      }

      // Upload label PDF.
      const uploadRes = await uploadBufferToSlack({
        channelId: destChannel,
        filename: `label-${entry.orderNumber}.pdf`,
        buffer: fetchRes.file.data,
        mimeType: "application/pdf",
        title: `Label ${entry.orderNumber}`,
        comment,
      });

      if (!uploadRes.ok) {
        results.push({
          ...baseResult,
          status: "error",
          error: `slack_upload_failed: ${uploadRes.error ?? "unknown"}`,
          hadLabelPdf: false,
        });
        continue;
      }

      const labelPermalink = uploadRes.permalink;
      const parentTs = uploadRes.messageTs;

      // Persist permalink so the next backfill run + the live
      // recent-labels enrichment both see this entry as "in-slack".
      if (labelPermalink) {
        await attachSlackPermalink({
          source: entry.source,
          orderNumber: entry.orderNumber,
          slackPermalink: labelPermalink,
        });
      }

      // Thread packing slip when available.
      let hadPackingSlip = false;
      if (packingSlipDriveLink && artifact?.packingSlip?.fileId && parentTs) {
        const psRef = parseDriveRef(packingSlipDriveLink);
        const psFetch = await fetchDriveFile(psRef);
        if (psFetch.ok) {
          const psUpload = await uploadBufferToSlack({
            channelId: destChannel,
            filename: `packing-slip-${entry.orderNumber}.pdf`,
            buffer: psFetch.file.data,
            mimeType: "application/pdf",
            title: `Packing slip ${entry.orderNumber}`,
            comment: formatPackingSlipComment(entry.orderNumber),
            threadTs: parentTs,
          });
          hadPackingSlip = psUpload.ok;
        }
      }

      results.push({
        ...baseResult,
        status: "posted-with-pdf",
        permalink: labelPermalink,
        hadLabelPdf: true,
        hadPackingSlip,
      });
      continue;
    }

    // No Drive PDF: post text-only. Operator clicks → ShipStation Reprint.
    const sent = await postMessage({
      channel: destChannel,
      text:
        comment +
        `\n\n:no_entry: Label PDF is in ShipStation only (Drive write failed). Open the order in ShipStation → Reprint Label. Do NOT re-buy.`,
    });
    const textPermalink =
      sent.ok && sent.ts
        ? await getPermalink({
            channel: shippingChannel?.id as ChannelId,
            message_ts: sent.ts,
          })
        : null;
    results.push({
      ...baseResult,
      status: sent.ok ? "posted-text-only" : "error",
      permalink: textPermalink ?? undefined,
      error: sent.ok ? undefined : `chat_post_failed`,
      hadLabelPdf: false,
    });
    if (textPermalink) {
      await attachSlackPermalink({
        source: entry.source,
        orderNumber: entry.orderNumber,
        slackPermalink: textPermalink,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    processed: results.length,
    results,
  });
}
