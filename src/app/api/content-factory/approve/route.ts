/**
 * GET /api/content-factory/approve?id=<imageId>&token=<secret>
 *
 * Marks a generated image as APPROVED in the content-factory registry.
 * Called when Ben clicks the green "✅ Approve" button in Slack.
 *
 * The registry is a JSON file in the repo (data/content-factory/registry.json)
 * that we write back via the GitHub API. This keeps approval state in git
 * and makes it possible to roll back if needed.
 *
 * Auth: optional CONTENT_FACTORY_APPROVAL_SECRET. If unset, anyone with the
 * URL can approve (acceptable for internal Slack-only use). If set, the
 * Slack message includes the token in the URL — same security model as a
 * Stripe webhook.
 */

import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APPROVAL_SECRET = process.env.CONTENT_FACTORY_APPROVAL_SECRET || "";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const token = url.searchParams.get("token") || "";
  const reason = url.searchParams.get("reason") || "";

  if (!id) {
    return htmlResponse("Missing image id", 400);
  }
  if (APPROVAL_SECRET && token !== APPROVAL_SECRET) {
    return htmlResponse("Invalid token", 403);
  }

  const decision = url.pathname.endsWith("/reject") ? "rejected" : "approved";

  // Pull pending entry from KV (set by the generator)
  const kvKey = `content-factory:pending:${id}`;
  const pending = await kv.get<Record<string, unknown>>(kvKey);

  if (!pending) {
    return htmlResponse(
      `Image \`${id}\` not found in pending queue. It may have already been processed, or never registered.`,
      404
    );
  }

  // Build the registry entry
  const entry = {
    ...pending,
    decision,
    decided_at: new Date().toISOString(),
    decided_by: "ben@usagummies.com",
    decision_reason: reason || null,
  };

  // Write to KV registry (separate from pending)
  await kv.set(`content-factory:registry:${decision}:${id}`, entry);
  await kv.del(kvKey);

  // Append to a sortable index (so we can list all approved/rejected later)
  const indexKey = `content-factory:index:${decision}`;
  const existing = (await kv.get<string[]>(indexKey)) || [];
  if (!existing.includes(id)) {
    existing.push(id);
    await kv.set(indexKey, existing);
  }

  // ──────────────────────────────────────────────────────────────────────
  // If approved and the style profile lists Buffer-eligible channels,
  // queue the post in Buffer for distribution to social channels (FB,
  // IG, Google Business). Failures here don't block the approval — they
  // just get logged to KV for later inspection.
  // ──────────────────────────────────────────────────────────────────────
  if (decision === "approved") {
    try {
      const bufferResult = await maybeQueueInBuffer(entry);
      if (bufferResult) {
        await kv.set(`content-factory:buffer-result:${id}`, bufferResult);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await kv.set(`content-factory:buffer-error:${id}`, { error: msg, at: new Date().toISOString() });
    }
  }

  // Respond with a friendly HTML page so Ben sees confirmation in his browser
  const emoji = decision === "approved" ? "✅" : "❌";
  const color = decision === "approved" ? "#16a34a" : "#dc2626";
  const action = decision === "approved" ? "approved" : "rejected";
  const title = decision === "approved" ? "Image Approved" : "Image Rejected";
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title} — USA Gummies Content Factory</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; background: #fff7ed; padding: 2rem; max-width: 640px; margin: 0 auto; color: #1f2937; }
      h1 { color: ${color}; margin-bottom: 0.5rem; }
      pre { background: #f3f4f6; padding: 1rem; border-radius: 0.5rem; font-size: 0.85rem; overflow-x: auto; }
      .ok { color: ${color}; font-weight: bold; }
      .id { font-family: monospace; background: #e5e7eb; padding: 0.1rem 0.4rem; border-radius: 0.2rem; }
      a { color: #2563eb; }
    </style>
  </head>
  <body>
    <h1>${emoji} ${title}</h1>
    <p>The image <span class="id">${escapeHtml(id)}</span> has been <span class="ok">${action}</span> and recorded in the Content Factory registry.</p>
    <p><strong>Style profile:</strong> ${escapeHtml(String(pending.profile || "unknown"))}</p>
    <p><strong>Concept:</strong></p>
    <pre>${escapeHtml(String(pending.concept || "(no concept text saved)"))}</pre>
    <p>You can now close this tab.${decision === "approved" ? ' This image is available for any future ad campaign — see <span class="id">data/content-factory/registry.json</span>.' : ""}</p>
    <p><a href="https://usagummies.slack.com/archives/C0ATWJDHS74">← Back to Slack #ops-approvals</a></p>
  </body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function htmlResponse(message: string, status: number) {
  return new NextResponse(
    `<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem;"><h1>Error ${status}</h1><p>${escapeHtml(message)}</p></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * If the approved entry's style profile lists `default_channels` that
 * include any Buffer-eligible channel (fb, ig, gbp), queue the post in
 * Buffer. Skips silently if Buffer creds are missing or the profile
 * doesn't request social channels.
 */
async function maybeQueueInBuffer(entry: Record<string, unknown>): Promise<unknown | null> {
  const apiToken = process.env.BUFFER_API_TOKEN;
  const orgId = process.env.BUFFER_ORGANIZATION_ID;
  if (!apiToken || !orgId) return null;

  // Load style profile to find default_channels
  const profileKey = String(entry.profile || "");
  if (!profileKey) return null;

  // Read style profiles JSON (bundled with the deploy)
  const fs = await import("node:fs");
  const path = await import("node:path");
  const profilesPath = path.resolve(process.cwd(), "data/content-factory/style-profiles.json");
  if (!fs.existsSync(profilesPath)) return null;
  const profiles = JSON.parse(fs.readFileSync(profilesPath, "utf-8"));
  const profile = profiles[profileKey];
  if (!profile) return null;

  const requestedChannels = (profile.default_channels || []) as string[];
  // Buffer-eligible aliases
  const bufferAliases = requestedChannels.filter((c) => ["fb", "ig", "gbp", "facebook", "instagram", "google-business", "googlebusiness"].includes(c.toLowerCase()));
  if (!bufferAliases.length) return null;

  const imageUrl = String(entry.image_url || "");
  if (!imageUrl) return null;

  // Use the concept text as a starter caption — Ben can refine in Buffer
  const caption = String(entry.concept || "").slice(0, 280) || "USA Gummies — All American Gummy Bears";

  const { publishToBuffer } = await import("@/lib/content-factory/buffer");
  const result = await publishToBuffer({
    apiToken,
    organizationId: orgId,
    channels: bufferAliases,
    imageUrl,
    caption,
    mode: profile.default_buffer_mode || "queue",
  });
  return { ...result, channels: bufferAliases, queued_at: new Date().toISOString() };
}
