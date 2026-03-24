import { searchEmails, type EmailMessage } from "@/lib/ops/gmail-reader";
import type { OperatorTaskInsert } from "@/lib/ops/operator/gap-detectors/qbo";

type PipelineGapDetectorResult = {
  tasks: OperatorTaskInsert[];
  summary: {
    distributorFollowups: number;
    vendorFollowups: number;
  };
};

type BrainRow = {
  id: string;
  title: string;
  raw_text: string | null;
  summary_text: string | null;
  created_at: string;
};

const DISTRIBUTOR_TITLE_PATTERN = /^(Distributor Prospects|B2B Prospects):\s*/i;
const INVALID_DISTRIBUTOR_NAME_PATTERN =
  /(https?:\/\/|www\.|\.com\b|\.co\.id\b|›|&ndash;|company overview|contact details|aktivasi windows|generador de video|katadata|invideo|asani)/i;
const VALID_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const TRACKED_VENDOR_QUERIES = [
  { vendor: "Powers", query: 'newer_than:30d (from:(powers-inc.com) OR gregk@powers-inc.com)' },
  { vendor: "Albanese", query: 'newer_than:30d albanese' },
  { vendor: "Belmark", query: 'newer_than:30d belmark' },
  { vendor: "Reid Mitchell", query: 'newer_than:30d ("Reid Mitchell" OR reid)' },
];

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials");
  }
  return { baseUrl, serviceKey };
}

async function sbFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const env = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(15000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return json as T;
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function buildNaturalKey(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => String(part || "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
}

function parseField(text: string, label: string): string | null {
  const regex = new RegExp(`${label}:\\s*([^\\n]+)`, "i");
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

function parseShipDate(text: string, fallback: string): string {
  const explicit =
    text.match(/sample (?:shipped|delivered)\s+(\d{4}-\d{2}-\d{2})/i)?.[1] ||
    text.match(/sent initial outreach\s+(\d{4}-\d{2}-\d{2})/i)?.[1] ||
    text.match(/date first contacted:\s*(\d{4}-\d{2}-\d{2})/i)?.[1];
  return explicit || fallback.slice(0, 10);
}

function looksLikeActionableDistributorName(value: string): boolean {
  const name = value.trim();
  if (!name || name.length < 3 || name.length > 120) return false;
  if (INVALID_DISTRIBUTOR_NAME_PATTERN.test(name)) return false;
  if (!/[a-z]/i.test(name)) return false;
  return true;
}

function parseDistributorName(row: BrainRow, text: string): string | null {
  const candidates = [
    row.title.replace(DISTRIBUTOR_TITLE_PATTERN, "").trim(),
    parseField(text, "Distributor"),
    parseField(text, "Company"),
  ];

  for (const candidate of candidates) {
    if (candidate && looksLikeActionableDistributorName(candidate)) {
      return candidate;
    }
  }
  return null;
}

function parseDistributorEmail(text: string): string | null {
  const explicit = parseField(text, "Email");
  if (explicit && VALID_EMAIL_PATTERN.test(explicit.trim())) {
    return explicit.trim();
  }

  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match && VALID_EMAIL_PATTERN.test(match[0]) ? match[0] : null;
}

function daysAgo(dateIso: string): number {
  const time = new Date(`${dateIso.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.max(0, Math.floor((Date.now() - time) / 86400000));
}

async function detectDistributorSampleTasks(): Promise<OperatorTaskInsert[]> {
  const rows = await sbFetch<BrainRow[]>(
    `/rest/v1/open_brain_entries?source_type=eq.api&or=(title.ilike.*distributor%20prospects*,title.ilike.*b2b%20prospects*)&select=id,title,raw_text,summary_text,created_at&order=created_at.desc&limit=150`,
  ).catch(() => []);

  const tasks: OperatorTaskInsert[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const text = `${row.title}\n${row.raw_text || row.summary_text || ""}`;
    if (!/sample/i.test(text) && !/outreach status:\s*sample sent/i.test(text)) continue;

    const distributorName = parseDistributorName(row, text);
    const email = parseDistributorEmail(text);
    if (!distributorName || !email) continue;

    const replyReceived = parseField(text, "Reply Received");
    if (/^yes$/i.test(String(replyReceived || "").trim())) continue;

    const shipDate = parseShipDate(text, row.created_at);
    if (daysAgo(shipDate) < 10) continue;

    const followupRows = await sbFetch<Array<{ id: string }>>(
      `/rest/v1/open_brain_entries?select=id&created_at=gte.${encodeURIComponent(shipDate)}&or=(title.ilike.*${encodeURIComponent(distributorName)}*,raw_text.ilike.*${encodeURIComponent(distributorName)}*)&limit=20`,
    ).catch(() => []);

    const hasFollowup = (Array.isArray(followupRows) ? followupRows : []).some((entry) => entry.id !== row.id);
    if (hasFollowup) continue;

    tasks.push({
      task_type: "distributor_followup",
      title: `Follow up with ${distributorName} — sample delivered ~${shipDate}`,
      description: `No follow-up brain entry found for ${distributorName} after the sample/outreach date.`,
      priority: "high",
      source: "gap_detector:pipeline",
      assigned_to: "abra",
      requires_approval: true,
      execution_params: {
        natural_key: buildNaturalKey(["distributor_followup", distributorName, shipDate]),
        distributor_name: distributorName,
        email,
        ship_date: shipDate,
        sample_details: text.slice(0, 1000),
      },
      tags: ["pipeline", "distributor", "approval"],
    });
  }

  return tasks;
}

function latestMessageAgeDays(message: EmailMessage): number {
  return daysAgo(new Date(message.date).toISOString().slice(0, 10));
}

async function detectVendorFollowupTasks(): Promise<OperatorTaskInsert[]> {
  const tasks: OperatorTaskInsert[] = [];

  for (const vendor of TRACKED_VENDOR_QUERIES) {
    const messages = await searchEmails(vendor.query, 10);
    if (!messages.length) continue;

    const latest = messages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    const ageDays = latestMessageAgeDays(latest);
    if (ageDays <= 5) continue;

    const senderEmailMatch = latest.from.match(/<([^>]+)>/);
    const email = senderEmailMatch ? senderEmailMatch[1] : latest.from;

    tasks.push({
      task_type: "vendor_followup",
      title: `Follow up with ${vendor.vendor} — last contact ${ageDays} days ago`,
      description: `Tracked vendor thread has been quiet for ${ageDays} days.`,
      priority: "high",
      source: "gap_detector:pipeline",
      assigned_to: "abra",
      requires_approval: true,
      execution_params: {
        natural_key: buildNaturalKey(["vendor_followup", vendor.vendor, latest.threadId, latest.date]),
        vendor: vendor.vendor,
        contact_email: email,
        last_subject: latest.subject,
        last_date: latest.date,
        days_since: ageDays,
        thread_id: latest.threadId,
        body_preview: normalizeText(latest.body).slice(0, 400),
      },
      tags: ["pipeline", "vendor", "approval"],
    });
  }

  return tasks;
}

export async function detectPipelineOperatorGaps(): Promise<PipelineGapDetectorResult> {
  const [distributorTasks, vendorTasks] = await Promise.all([
    detectDistributorSampleTasks(),
    detectVendorFollowupTasks(),
  ]);

  return {
    tasks: [...distributorTasks, ...vendorTasks],
    summary: {
      distributorFollowups: distributorTasks.length,
      vendorFollowups: vendorTasks.length,
    },
  };
}
