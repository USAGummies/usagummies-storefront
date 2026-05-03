/**
 * POST /api/ops/finance/qbo-attachment/propose
 *
 * Class A wrapper around the existing /api/ops/qbo/attachment endpoint.
 *
 * Closes audit finding CB#24. Today the attachment endpoint exists
 * but every fire is a manual cURL by Ben — there's no audit envelope,
 * no Slack mirror, and no operator-friendly Class A card surface.
 * This wraps it so:
 *
 *   1. Operator hits propose with {entity_type, entity_id, file_name,
 *      file_base64, vendor_label?, source_url?, note?}
 *   2. Validates locally (entity_type allowlist, base64 sanity).
 *   3. Audits via record() with `qbo.attachment.create` slug + source
 *      citations so the un-attach path is documented.
 *   4. Calls the existing /api/ops/qbo/attachment endpoint internally.
 *   5. Mirrors a confirmation line to #finance so Rene sees the
 *      attachment land without manual hand-off.
 *
 * Hard rules:
 *   • No new QBO write logic — passes the body verbatim to the
 *     existing endpoint, which has its own auth + multipart logic.
 *   • Fail-soft on Slack mirror (audit captures regardless).
 *   • Class A: no approval card needed (read-only attachment, fully
 *     reversible). The OPERATOR is the gate; this route is the
 *     auditable execution path.
 *
 * Auth: session OR bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { record } from "@/lib/ops/control-plane/record";
import { getChannel, slackChannelRef } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ENTITY_TYPES = [
  "Vendor",
  "Invoice",
  "Bill",
  "PurchaseOrder",
  "SalesReceipt",
  "Purchase",
  "JournalEntry",
  "Customer",
  "Estimate",
  "Transfer",
  "BillPayment",
  "Payment",
  "Deposit",
] as const;
type ValidEntityType = (typeof VALID_ENTITY_TYPES)[number];

interface ProposeBody {
  entity_type: ValidEntityType;
  entity_id: string;
  file_name: string;
  content_type?: string;
  file_base64: string;
  /**
   * Display label (vendor name, invoice number) — surfaced on the
   * Slack mirror line so Rene sees "Snow Leopard W-9" rather than
   * "Vendor 78".
   */
  vendor_label?: string;
  /**
   * Source URL (gmail message id, drive file id) for the audit
   * citation. Optional but encouraged.
   */
  source_url?: string;
  note?: string;
  dryRun?: boolean;
}

function getBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "https://www.usagummies.com";
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ProposeBody;
  try {
    body = (await req.json()) as ProposeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!VALID_ENTITY_TYPES.includes(body.entity_type)) {
    return NextResponse.json(
      {
        error: `entity_type must be one of: ${VALID_ENTITY_TYPES.join(", ")}`,
      },
      { status: 400 },
    );
  }
  if (!body.entity_id || typeof body.entity_id !== "string") {
    return NextResponse.json(
      { error: "entity_id required" },
      { status: 400 },
    );
  }
  if (!body.file_name || typeof body.file_name !== "string") {
    return NextResponse.json(
      { error: "file_name required" },
      { status: 400 },
    );
  }
  if (!body.file_base64 || typeof body.file_base64 !== "string") {
    return NextResponse.json(
      { error: "file_base64 required (base64-encoded file content)" },
      { status: 400 },
    );
  }
  // Cheap base64 sanity check — accept padded base64 or url-safe variants.
  if (!/^[A-Za-z0-9+/=_-]+$/.test(body.file_base64.slice(0, 256))) {
    return NextResponse.json(
      { error: "file_base64 doesn't look like base64 content" },
      { status: 400 },
    );
  }

  if (body.dryRun) {
    return NextResponse.json({
      ok: true,
      posted: false,
      preview: {
        entity_type: body.entity_type,
        entity_id: body.entity_id,
        file_name: body.file_name,
        file_size_bytes: Math.floor((body.file_base64.length * 3) / 4),
        vendor_label: body.vendor_label,
      },
    });
  }

  const run = newRunContext({
    agentId: "qbo-attachment-propose",
    division: "financials",
    source: "event",
    trigger: `qbo-attachment:${body.entity_type}:${body.entity_id}`,
  });

  // Call the existing /api/ops/qbo/attachment route as a thin
  // pass-through. The existing route handles QBO multipart auth.
  const baseUrl = getBaseUrl();
  const cronSecret = (process.env.CRON_SECRET ?? "").trim();
  let httpStatus = 0;
  let upstream: { ok?: boolean; error?: string; attachment?: { Id?: string; FileName?: string }; result?: unknown } | null = null;
  try {
    const res = await fetch(`${baseUrl}/api/ops/qbo/attachment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({
        entity_type: body.entity_type,
        entity_id: body.entity_id,
        file_name: body.file_name,
        content_type: body.content_type,
        file_base64: body.file_base64,
        note: body.note,
      }),
    });
    httpStatus = res.status;
    try {
      upstream = await res.json();
    } catch {
      upstream = null;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await record(run, {
      actionSlug: "qbo.attachment.create",
      entityType: `qbo.${body.entity_type.toLowerCase()}`,
      entityId: body.entity_id,
      result: "error",
      after: {
        file_name: body.file_name,
        vendor_label: body.vendor_label,
        upstream_error: errMsg,
      },
      sourceCitations: [
        ...(body.source_url
          ? [{ system: "source", url: body.source_url }]
          : []),
      ],
      confidence: 1.0,
      error: { message: errMsg },
    }).catch(() => void 0);
    return NextResponse.json(
      { ok: false, error: `qbo/attachment fetch failed: ${errMsg}` },
      { status: 502 },
    );
  }

  // Upstream non-OK → record error envelope + return 502.
  if (httpStatus >= 400 || !upstream || upstream.error) {
    const errMsg =
      upstream?.error || `qbo/attachment returned HTTP ${httpStatus}`;
    await record(run, {
      actionSlug: "qbo.attachment.create",
      entityType: `qbo.${body.entity_type.toLowerCase()}`,
      entityId: body.entity_id,
      result: "error",
      after: {
        file_name: body.file_name,
        vendor_label: body.vendor_label,
        upstream_status: httpStatus,
        upstream_error: errMsg,
      },
      sourceCitations: [
        ...(body.source_url
          ? [{ system: "source", url: body.source_url }]
          : []),
      ],
      confidence: 1.0,
      error: { message: errMsg },
    }).catch(() => void 0);
    return NextResponse.json(
      { ok: false, error: errMsg, upstream_status: httpStatus },
      { status: 502 },
    );
  }

  // Success — audit + Slack mirror.
  const qboAttachmentId = upstream.attachment?.Id;
  await record(run, {
    actionSlug: "qbo.attachment.create",
    entityType: `qbo.${body.entity_type.toLowerCase()}`,
    entityId: body.entity_id,
    result: "ok",
    after: {
      qboAttachmentId,
      file_name: body.file_name,
      vendor_label: body.vendor_label,
    },
    sourceCitations: [
      ...(body.source_url
        ? [{ system: "source", url: body.source_url }]
        : []),
      ...(qboAttachmentId
        ? [{ system: "qbo:attachment", id: String(qboAttachmentId) }]
        : []),
    ],
    confidence: 1.0,
  }).catch(() => void 0);

  // Slack mirror to #finance — fail-soft.
  if (getChannel("finance")) {
    const label =
      body.vendor_label ||
      `${body.entity_type} ${body.entity_id}`;
    try {
      await postMessage({
        channel: slackChannelRef("finance"),
        text:
          `:paperclip: *QBO attachment landed — ${label}*\n` +
          `*File:* \`${body.file_name}\`\n` +
          `*Attached to:* ${body.entity_type} \`${body.entity_id}\`` +
          (qboAttachmentId
            ? ` · QBO attachment id \`${qboAttachmentId}\``
            : "") +
          (body.note ? `\n_${body.note}_` : ""),
      });
    } catch {
      /* fail-soft */
    }
  }

  return NextResponse.json({
    ok: true,
    posted: true,
    qboAttachmentId,
    upstream,
  });
}
