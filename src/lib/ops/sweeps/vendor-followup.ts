/**
 * Autonomous Vendor Follow-Up Sweep
 *
 * Tracks open vendor email threads. When a thread goes cold >5 days,
 * auto-drafts a contextual follow-up email and queues it for one-tap
 * approval in Slack.
 */

import { proposeAndMaybeExecute } from "@/lib/ops/abra-actions";

type VendorThread = {
  vendor: string;
  contact: string;
  email: string;
  lastSubject: string;
  lastDate: string;
  daysSince: number;
};

const VENDOR_CONTACTS: Record<string, { name: string; email: string }> = {
  powers: { name: "Greg Kroetch", email: "gregk@powers-inc.com" },
  albanese: { name: "Bill Thurner", email: "" }, // no confirmed email
  belmark: { name: "Belmark Contact", email: "" },
  inderbitzin: { name: "Patrick McDonald", email: "" },
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function findStaleVendorThreads(staleDays = 5): Promise<VendorThread[]> {
  const env = getSupabaseEnv();
  if (!env) return [];

  const cutoff = new Date(Date.now() - staleDays * 86400000).toISOString();

  try {
    // Find the most recent email per vendor
    const res = await fetch(
      `${env.baseUrl}/rest/v1/email_events?direction=eq.inbound&select=from_address,subject,received_at&order=received_at.desc&limit=200`,
      {
        headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) return [];

    const emails = (await res.json()) as Array<{ from_address: string; subject: string; received_at: string }>;

    const staleThreads: VendorThread[] = [];
    const seen = new Set<string>();

    for (const [vendorKey, contact] of Object.entries(VENDOR_CONTACTS)) {
      if (!contact.email || seen.has(vendorKey)) continue;

      const vendorEmails = emails.filter((e) =>
        (e.from_address || "").toLowerCase().includes(vendorKey),
      );

      if (vendorEmails.length === 0) continue;

      const latest = vendorEmails[0];
      const daysSince = Math.floor((Date.now() - new Date(latest.received_at).getTime()) / 86400000);

      if (daysSince >= staleDays) {
        seen.add(vendorKey);
        staleThreads.push({
          vendor: vendorKey,
          contact: contact.name,
          email: contact.email,
          lastSubject: latest.subject || "(no subject)",
          lastDate: latest.received_at,
          daysSince,
        });
      }
    }

    return staleThreads;
  } catch {
    return [];
  }
}

function generateFollowUpBody(thread: VendorThread): string {
  const templates: Record<string, string> = {
    powers: `Hi Greg,\n\nJust checking in on our last conversation. Wanted to make sure we're aligned on next steps for the production run.\n\nLet me know if you need anything from our end.\n\nBest,\nBen Stutman\nUSA Gummies`,
    inderbitzin: `Hi Patrick,\n\nFollowing up on our PO discussion. Wanted to confirm the delivery timeline and see if you need any additional information.\n\nLooking forward to hearing from you.\n\nBest,\nBen Stutman\nUSA Gummies`,
  };

  return templates[thread.vendor] ||
    `Hi ${thread.contact.split(" ")[0]},\n\nJust following up on our last conversation from ${new Date(thread.lastDate).toLocaleDateString("en-US", { month: "long", day: "numeric" })}. Wanted to check if there are any updates or if you need anything from our side.\n\nBest,\nBen Stutman\nUSA Gummies`;
}

export type VendorFollowUpResult = {
  checked: number;
  stale: number;
  drafted: number;
  errors: string[];
};

export async function runVendorFollowUpSweep(staleDays = 5): Promise<VendorFollowUpResult> {
  const result: VendorFollowUpResult = { checked: 0, stale: 0, drafted: 0, errors: [] };

  const staleThreads = await findStaleVendorThreads(staleDays);
  result.checked = Object.keys(VENDOR_CONTACTS).length;
  result.stale = staleThreads.length;

  for (const thread of staleThreads) {
    if (!thread.email) {
      result.errors.push(`${thread.vendor}: no email address configured`);
      continue;
    }

    try {
      const body = generateFollowUpBody(thread);
      const subject = `Re: ${thread.lastSubject}`;

      await proposeAndMaybeExecute({
        action_type: "draft_email_reply",
        title: `Follow-up: ${thread.contact} (${thread.daysSince}d since last contact)`,
        description: `Auto-generated vendor follow-up. Last email from ${thread.contact} was ${thread.daysSince} days ago.`,
        department: "operations",
        risk_level: "medium",
        requires_approval: true,
        confidence: 0.8,
        params: {
          to: thread.email,
          subject,
          body,
          vendor: thread.vendor,
          auto_generated: true,
        },
      });

      result.drafted++;
    } catch (err) {
      result.errors.push(`${thread.vendor}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
