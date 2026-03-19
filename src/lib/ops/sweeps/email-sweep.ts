import { listEmails } from "@/lib/ops/gmail-reader";
import { getVipSender } from "@/lib/ops/abra-vip-senders";
import { proactiveMessage } from "@/lib/ops/abra-slack-responder";

export type EmailSweepResult = {
  scanned: number;
  commands: number;
  triaged: number;
  actionable: number;
  urgent: number;
  noise: number;
};

function resolveInternalHost(): string {
  return (
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000")
  );
}

function parseSenderEmail(fromHeader: string): string {
  const bracket = fromHeader.match(/<([^>]+)>/);
  const extracted = bracket?.[1] || fromHeader;
  return extracted.trim().toLowerCase();
}

function estimateUrgency(from: string, subject: string, snippet: string): number {
  const searchable = `${from} ${subject} ${snippet}`.toLowerCase();
  let score = 1;
  if (/\b(urgent|asap|today|pricing|quote|po|invoice|production|shipment|reply)\b/i.test(searchable)) {
    score += 4;
  }
  if (/\b(brent|overman|rene|bill turley|powers|inderbitzin)\b/i.test(searchable)) {
    score += 4;
  }
  if (/\b(newsletter|unsubscribe|marketing|promo)\b/i.test(searchable)) {
    score -= 3;
  }
  return Math.max(0, Math.min(10, score));
}

export async function runEmailSweep(): Promise<EmailSweepResult> {
  const preview = await listEmails({
    count: 20,
    query: "newer_than:15m",
    unreadOnly: true,
  }).catch(() => []);

  const actionable = preview.filter((email) => {
    const vip = getVipSender(parseSenderEmail(email.from));
    if (vip && vip.priority !== "noise") return true;
    return estimateUrgency(email.from, email.subject, email.snippet) >= 6;
  });
  const urgent = actionable.filter((email) => {
    const vip = getVipSender(parseSenderEmail(email.from));
    return vip?.priority === "critical" || estimateUrgency(email.from, email.subject, email.snippet) >= 8;
  }).length;
  const noise = preview.filter((email) => {
    const vip = getVipSender(parseSenderEmail(email.from));
    return vip?.priority === "noise" || /\b(newsletter|unsubscribe|marketing|promo)\b/i.test(email.subject);
  }).length;

  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret) {
    throw new Error("CRON_SECRET not configured");
  }

  const res = await fetch(`${resolveInternalHost()}/api/ops/abra/inbox-scan`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ source: "scheduled-email-sweep" }),
    signal: AbortSignal.timeout(55_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : `Inbox scan failed (${res.status})`,
    );
  }

  const result: EmailSweepResult = {
    scanned: typeof data.scanned === "number" ? data.scanned : preview.length,
    commands: typeof data.commands === "number" ? data.commands : 0,
    triaged: typeof data.triaged === "number" ? data.triaged : 0,
    actionable: actionable.length,
    urgent,
    noise,
  };

  if (result.scanned > 0 || result.actionable > 0) {
    const summary = [
      `📬 Email sweep: ${result.scanned} scanned`,
      result.urgent > 0 ? `${result.urgent} urgent` : null,
      result.actionable > 0 ? `${result.actionable} actionable` : null,
      result.commands > 0 ? `${result.commands} Abra commands` : null,
      result.noise > 0 ? `${result.noise} likely noise` : null,
    ]
      .filter(Boolean)
      .join(", ");
    await proactiveMessage({
      target: "channel",
      channelOrUserId: process.env.SLACK_CHANNEL_ALERTS || "C0ALS6W7VB4",
      message: summary,
    }).catch(() => {});
  }

  return result;
}
