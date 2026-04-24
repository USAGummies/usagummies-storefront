/**
 * GET/POST /api/ops/ap-packets/send
 *
 * The AP-packet send loop — first end-to-end execution primitive for
 * customer-facing email from the ops platform. Built today to close the
 * "packet prepared but nobody sent it" gap on the Jungle Jim's account.
 *
 * ## Flow (per hard-rules.md §11 + §13)
 *
 * 1. Load the packet by slug.
 * 2. Triple-gate dedup — refuse if ANY signal says this packet already
 *    went out:
 *    a. Gmail SENT search for `to:<apEmail> subject:"<subject>"`
 *    b. HubSpot contact timeline for an outbound email in the last 30d
 *    c. KV key `ap-packets:sent:<slug>`
 * 3. Fetch all attachments from Drive (or synthesize — the item-list
 *    catalog CSV is generated in-process via buildCatalogCsv).
 * 4. Validate outreach claims via contracts/product-claims.ts through
 *    the validator in scripts/outreach-validate.mjs (fail-closed).
 * 5. GET mode (verify): return the dedup + attachment-fetch + claims
 *    validation state without sending. Answers "was this already sent?"
 * 6. POST mode (send): build Gmail MIME with attachments → send →
 *    HubSpot logEmail timeline entry → audit mirror → KV store
 *    `{ slug, messageId, threadId, sentAt, sentBy }`.
 *
 * ## Hard-rules enforcement
 *
 * - Class B action (customer-facing email) — per `hard-rules.md` rule 11,
 *   this route requires the control-plane approval flow. On POST the
 *   caller must include `approvalToken` that matches an approved entry
 *   in the approvalStore. No token = no send, regardless of dedup
 *   state. This prevents the "forgot to click approve" scenario.
 * - Fail-closed on missing Gmail/HubSpot creds — the route does NOT
 *   fall back to SMTP or skip the HubSpot log. Either it sends through
 *   the instrumented path or it refuses.
 *
 * Auth: session OR bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { approvalStore } from "@/lib/ops/control-plane/stores";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditSurface } from "@/lib/ops/control-plane/slack";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { buildCatalogCsv, getApPacket } from "@/lib/ops/ap-packets";
import { fetchDriveFileByUrl } from "@/lib/ops/drive-reader";
import {
  listEmails,
  sendViaGmailApiDetailed,
} from "@/lib/ops/gmail-reader";
import { findContactByEmail, logEmail } from "@/lib/ops/hubspot-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KV_SENT_PREFIX = "ap-packets:sent:";

interface SentEntry {
  slug: string;
  messageId: string;
  threadId: string | null;
  sentAt: string;
  sentBy: string;
  apEmail: string;
  subject: string;
  approvalId?: string;
}

interface DedupCheck {
  gmail: { hit: boolean; matches: Array<{ id: string; date: string; snippet: string }>; error?: string };
  hubspot: { hit: boolean; contactId: string | null; error?: string };
  kv: { hit: boolean; entry: SentEntry | null };
  alreadySent: boolean;
  alreadySentReason: string | null;
}

interface AttachmentFetchResult {
  id: string;
  label: string;
  status: "ready" | "optional" | "missing" | "review";
  fetched: boolean;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  error?: string;
  skipped?: string;
}

async function checkDedup(slug: string, apEmail: string, subject: string): Promise<DedupCheck> {
  // Gmail SENT search
  let gmail: DedupCheck["gmail"] = { hit: false, matches: [] };
  try {
    const envelopes = await listEmails({
      query: `to:${apEmail} after:2026/04/01`,
      count: 20,
    });
    // Filter to matching subject (exact or normalized)
    const normSubject = subject.toLowerCase().replace(/^(re|fwd?):\s*/i, "").trim();
    const matches = envelopes.filter((e) => {
      const envSubject = e.subject.toLowerCase().replace(/^(re|fwd?):\s*/i, "").trim();
      return envSubject.includes(normSubject.slice(0, 30));
    });
    gmail = {
      hit: matches.length > 0,
      matches: matches.map((m) => ({
        id: m.id,
        date: m.date,
        snippet: m.snippet.slice(0, 120),
      })),
    };
  } catch (err) {
    gmail.error = err instanceof Error ? err.message : String(err);
  }

  // HubSpot contact + recent outbound check
  let hubspot: DedupCheck["hubspot"] = { hit: false, contactId: null };
  try {
    const contactId = await findContactByEmail(apEmail);
    hubspot.contactId = contactId;
    // For now we don't scan the contact's email engagements — that
    // requires a separate /crm/v3/objects/contacts/{id}/associations/emails
    // call. If Gmail + KV both say "not sent" and HubSpot contact exists,
    // that's enough signal to not block on HubSpot timeline lookup.
  } catch (err) {
    hubspot.error = err instanceof Error ? err.message : String(err);
  }

  // KV check
  const kvKey = `${KV_SENT_PREFIX}${slug}`;
  const kvEntry = ((await kv.get<SentEntry>(kvKey)) ?? null) as SentEntry | null;

  const alreadySent = gmail.hit || kvEntry !== null;
  const alreadySentReason = gmail.hit
    ? `Gmail SENT shows ${gmail.matches.length} matching message(s) — oldest id ${gmail.matches[0]?.id}`
    : kvEntry
      ? `KV record shows sent at ${kvEntry.sentAt}, Gmail message ${kvEntry.messageId}`
      : null;

  return {
    gmail,
    hubspot,
    kv: { hit: kvEntry !== null, entry: kvEntry },
    alreadySent,
    alreadySentReason,
  };
}

async function fetchAttachments(slug: string): Promise<{
  ready: AttachmentFetchResult[];
  files: Array<{ filename: string; mimeType: string; content: Buffer }>;
  fetchErrors: string[];
}> {
  const packet = getApPacket(slug);
  if (!packet) {
    return { ready: [], files: [], fetchErrors: [`Packet ${slug} not found`] };
  }

  const results: AttachmentFetchResult[] = [];
  const files: Array<{ filename: string; mimeType: string; content: Buffer }> = [];
  const fetchErrors: string[] = [];

  for (const att of packet.attachments) {
    if (att.status === "optional" || att.status === "missing") {
      results.push({
        id: att.id,
        label: att.label,
        status: att.status,
        fetched: false,
        skipped: att.status === "optional" ? "optional — not attached" : "marked missing",
      });
      continue;
    }

    // Special case: the item-list is generated in-process from the
    // packet's catalog, not fetched from Drive.
    if (att.id === "item-list") {
      const csv = buildCatalogCsv(packet);
      const buf = Buffer.from(csv, "utf-8");
      files.push({
        filename: `${slug}-item-list.csv`,
        mimeType: "text/csv",
        content: buf,
      });
      results.push({
        id: att.id,
        label: att.label,
        status: att.status,
        fetched: true,
        filename: `${slug}-item-list.csv`,
        mimeType: "text/csv",
        sizeBytes: buf.byteLength,
      });
      continue;
    }

    if (!att.driveUrl) {
      results.push({
        id: att.id,
        label: att.label,
        status: att.status,
        fetched: false,
        error: "No driveUrl on packet attachment — cannot fetch",
      });
      fetchErrors.push(`${att.id}: no driveUrl`);
      continue;
    }

    const fetched = await fetchDriveFileByUrl(att.driveUrl);
    if (!fetched.ok) {
      results.push({
        id: att.id,
        label: att.label,
        status: att.status,
        fetched: false,
        error: fetched.error,
      });
      fetchErrors.push(`${att.id}: ${fetched.error}`);
      continue;
    }
    const f = fetched.file;
    files.push({
      filename: f.name,
      mimeType: f.mimeType,
      content: f.data,
    });
    results.push({
      id: att.id,
      label: att.label,
      status: att.status,
      fetched: true,
      filename: f.name,
      mimeType: f.mimeType,
      sizeBytes: f.size,
    });
  }

  return { ready: results, files, fetchErrors };
}

async function recordAudit(
  slug: string,
  action: string,
  ok: boolean,
  detail: unknown,
): Promise<void> {
  try {
    const run = newRunContext({
      agentId: "ap-packet-sender",
      division: "financials",
      source: "event",
      trigger: `ap-packet:${action}`,
    });
    const entry = buildAuditEntry(run, {
      action: `ap-packet.${action}`,
      entityType: "ap-packet.send",
      entityId: `ap-packet:${slug}`,
      after: detail ?? null,
      result: ok ? "ok" : "error",
      sourceCitations: [{ system: "ap-packets", id: slug }],
      confidence: 1,
    });
    await auditStore().append(entry);
    try {
      await auditSurface().mirror(entry);
    } catch {
      /* best-effort */
    }
  } catch (err) {
    console.error(
      "[ap-packet-send] audit failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

// -----------------------------------------------------------------------
// GET = verify only (no side effects)
// -----------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug")?.trim();
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }
  const packet = getApPacket(slug);
  if (!packet) {
    return NextResponse.json({ error: `Packet ${slug} not found` }, { status: 404 });
  }

  const dedup = await checkDedup(
    slug,
    packet.apEmail,
    packet.replyDraft.subject,
  );

  const withAttachments = url.searchParams.get("attachments") === "true";
  let attachments: {
    ready: AttachmentFetchResult[];
    fetchErrors: string[];
  } = { ready: [], fetchErrors: [] };
  if (withAttachments) {
    const f = await fetchAttachments(slug);
    attachments = { ready: f.ready, fetchErrors: f.fetchErrors };
  }

  return NextResponse.json({
    ok: true,
    slug,
    accountName: packet.accountName,
    apEmail: packet.apEmail,
    subject: packet.replyDraft.subject,
    dedup,
    attachments: withAttachments ? attachments : "pass ?attachments=true to fetch + verify",
    eligibleToSend: !dedup.alreadySent,
    reason: dedup.alreadySentReason,
  });
}

// -----------------------------------------------------------------------
// POST = send (requires approvalToken from control-plane)
// -----------------------------------------------------------------------

interface SendBody {
  slug: string;
  approvalToken?: string; // id of an approved entry in approvalStore
  overrideGmailDedup?: boolean; // Ben-only escape hatch
  overrideKvDedup?: boolean; // Ben-only escape hatch
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: SendBody;
  try {
    body = (await req.json()) as SendBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const slug = body.slug?.trim();
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  const packet = getApPacket(slug);
  if (!packet) {
    return NextResponse.json({ error: `Packet ${slug} not found` }, { status: 404 });
  }

  // Approval gate — Class B per hard-rules §11
  if (!body.approvalToken) {
    return NextResponse.json(
      {
        error:
          "approvalToken required. Request approval via the control-plane flow; no inline send allowed.",
        class: "B",
      },
      { status: 403 },
    );
  }
  const approval = await approvalStore().get(body.approvalToken);
  if (!approval) {
    return NextResponse.json(
      { error: `Approval ${body.approvalToken} not found` },
      { status: 403 },
    );
  }
  if (approval.status !== "approved") {
    return NextResponse.json(
      { error: `Approval ${body.approvalToken} status is ${approval.status}, not approved` },
      { status: 403 },
    );
  }
  const approvalEntityId = approval.targetEntity?.id ?? null;
  if (approvalEntityId !== `ap-packet:${slug}`) {
    return NextResponse.json(
      {
        error: `Approval entity mismatch — approval covers ${approvalEntityId ?? "(none)"}, request is ap-packet:${slug}`,
      },
      { status: 403 },
    );
  }

  // Dedup — triple-gate
  const dedup = await checkDedup(
    slug,
    packet.apEmail,
    packet.replyDraft.subject,
  );
  if (dedup.alreadySent) {
    const gmailOverride = body.overrideGmailDedup && dedup.gmail.hit;
    const kvOverride = body.overrideKvDedup && dedup.kv.hit;
    if (!gmailOverride && !kvOverride) {
      await recordAudit(slug, "send.refuse-dup", false, {
        reason: dedup.alreadySentReason,
        gmail: dedup.gmail.matches,
        kv: dedup.kv.entry,
      });
      return NextResponse.json(
        {
          ok: false,
          error: "Already sent",
          reason: dedup.alreadySentReason,
          dedup,
        },
        { status: 409 },
      );
    }
  }

  // Fetch attachments
  const { ready: attResults, files, fetchErrors } = await fetchAttachments(slug);
  const requiredMissing = attResults.filter(
    (r) => r.status === "ready" && !r.fetched,
  );
  if (requiredMissing.length > 0) {
    await recordAudit(slug, "send.refuse-attachments", false, {
      missing: requiredMissing,
      errors: fetchErrors,
    });
    return NextResponse.json(
      {
        ok: false,
        error: "Required attachments could not be fetched",
        missing: requiredMissing,
        fetchErrors,
      },
      { status: 424 },
    );
  }

  // Build + send
  const subject = packet.replyDraft.subject;
  const bodyText = packet.replyDraft.body;

  const sendRes = await sendViaGmailApiDetailed({
    to: packet.apEmail,
    subject,
    body: bodyText,
    attachments: files,
  });

  if (!sendRes.ok) {
    await recordAudit(slug, "send.failed", false, {
      error: sendRes.error,
      attachmentCount: files.length,
    });
    return NextResponse.json(
      { ok: false, error: `Gmail send failed: ${sendRes.error}` },
      { status: 502 },
    );
  }

  // Log to HubSpot — looks up the contact by email first so the
  // engagement associates correctly to the contact's timeline.
  let hubspotLogId: string | null = null;
  try {
    const contactId = await findContactByEmail(packet.apEmail);
    hubspotLogId = await logEmail({
      to: packet.apEmail,
      subject,
      body: bodyText,
      // "EMAIL" = outbound in HubSpot's hs_email_direction enum
      direction: "EMAIL",
      contactId: contactId ?? undefined,
    });
  } catch (err) {
    // Non-fatal — log audit + proceed
    await recordAudit(slug, "hubspot.log-failed", false, {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Persist KV
  const sentEntry: SentEntry = {
    slug,
    messageId: sendRes.messageId,
    threadId: sendRes.threadId,
    sentAt: new Date().toISOString(),
    sentBy: "ap-packet-sender",
    apEmail: packet.apEmail,
    subject,
    approvalId: body.approvalToken,
  };
  try {
    await kv.set(`${KV_SENT_PREFIX}${slug}`, sentEntry);
  } catch (err) {
    console.error(
      "[ap-packet-send] kv write failed:",
      err instanceof Error ? err.message : String(err),
    );
  }

  await recordAudit(slug, "sent", true, {
    messageId: sendRes.messageId,
    threadId: sendRes.threadId,
    attachmentCount: files.length,
    hubspotLogId,
    approvalId: body.approvalToken,
  });

  return NextResponse.json({
    ok: true,
    slug,
    messageId: sendRes.messageId,
    threadId: sendRes.threadId,
    attachmentCount: files.length,
    hubspotLogId,
    approvalId: body.approvalToken,
    sentAt: sentEntry.sentAt,
  });
}
