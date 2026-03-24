/**
 * Email Response Tracker — surfaces emails that need replies.
 *
 * Scans recent inbound emails and checks if we've responded.
 * Posts to Slack: "Reid Mitchell emailed 6 hours ago asking for delivered costs —
 * want me to draft a response?"
 *
 * This is the proactive loop that prevents emails from falling through the cracks.
 */

import { notifyAlert } from "@/lib/ops/notify";

type EmailThread = {
  threadId: string;
  subject: string;
  from: string;
  fromEmail: string;
  lastMessageDate: string;
  lastMessageFrom: string;
  hoursAgo: number;
  needsResponse: boolean;
  snippet: string;
};

// Senders we should always track (vendors, distributors, brokers, partners)
const TRACKED_SENDERS = [
  "reid", "mitchell", "powers", "greg", "albanese", "belmark",
  "inderbitzin", "patrick", "pirate", "ninja", "ecoclose",
  "faire", "walmart", "mclane", "core-mark", "keHe", "unfi",
  "dutch valley", "vita west", "paulino",
];

// Senders we should ignore (newsletters, automated, internal)
const IGNORE_PATTERNS = [
  "noreply", "no-reply", "notifications", "mailer-daemon",
  "newsletter", "marketing", "support@shopify", "seller-notification",
  "quickbooks", "intuit", "anthropic", "claude", "vercel",
  "github", "google", "apple", "amazon.com", "uline",
];

export async function checkUnrespondedEmails(): Promise<{
  unresponded: EmailThread[];
  totalChecked: number;
}> {
  const gmailToken = process.env.GMAIL_ACCESS_TOKEN || process.env.GOOGLE_ACCESS_TOKEN;
  if (!gmailToken) {
    // Fall back to app password SMTP — can't read inbox this way
    // Would need OAuth. For now, use the brain entries from email sweep.
    return { unresponded: [], totalChecked: 0 };
  }

  // This function gets called by the scheduler.
  // Since we may not have direct Gmail API access (using SMTP for send),
  // we rely on the email sweep brain entries to know what came in.
  // The email sweep already ingests emails — we just need to check
  // which ones from tracked senders haven't been replied to.

  return { unresponded: [], totalChecked: 0 };
}

/**
 * Check brain entries for recent inbound emails from tracked senders
 * that don't have a corresponding outbound reply logged.
 */
export async function surfaceUnansweredEmails(): Promise<void> {
  const env = getSupabaseEnv();
  if (!env) return;

  // Query brain for recent email entries from tracked senders
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const res = await fetch(
    `${env.baseUrl}/rest/v1/open_brain_entries?source_type=eq.api&created_at=gte.${encodeURIComponent(twoDaysAgo)}&title=ilike.*email*&select=id,title,content,created_at&order=created_at.desc&limit=50`,
    {
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
      },
      signal: AbortSignal.timeout(10000),
    },
  );

  if (!res.ok) return;
  const entries = (await res.json()) as Array<{
    id: string;
    title: string;
    content: string;
    created_at: string;
  }>;

  // Find entries that mention tracked senders and look like they need a response
  const actionable: Array<{ sender: string; subject: string; hoursAgo: number; snippet: string }> = [];

  for (const entry of entries) {
    const content = (entry.content || entry.title || "").toLowerCase();
    const matchedSender = TRACKED_SENDERS.find((s) => content.includes(s.toLowerCase()));
    if (!matchedSender) continue;

    // Skip if it looks like our outbound email
    if (content.includes("sent by abra") || content.includes("draft sent") || content.includes("reply sent")) continue;

    // Check if it contains question indicators
    const hasQuestion = /\?|need to know|can you|please send|quote|price|cost|when|how soon|update|status/i.test(content);
    if (!hasQuestion) continue;

    // Skip ignored senders
    const isIgnored = IGNORE_PATTERNS.some((p) => content.includes(p.toLowerCase()));
    if (isIgnored) continue;

    const hoursAgo = Math.round((Date.now() - new Date(entry.created_at).getTime()) / 3600000);

    actionable.push({
      sender: matchedSender,
      subject: entry.title.slice(0, 60),
      hoursAgo,
      snippet: content.slice(0, 100),
    });
  }

  if (actionable.length === 0) return;

  // Deduplicate by sender
  const seen = new Set<string>();
  const unique = actionable.filter((a) => {
    if (seen.has(a.sender)) return false;
    seen.add(a.sender);
    return true;
  });

  // Post to Slack
  const lines = unique.map(
    (a) => `• *${a.sender}* (${a.hoursAgo}h ago): ${a.subject}`,
  );

  await notifyAlert(
    `📧 *Emails needing responses:*\n${lines.join("\n")}\n\nAsk me to draft a response to any of these.`,
  ).catch(() => {});
}

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}
