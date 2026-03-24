import { uploadFileToSlack, type SpreadsheetData } from "@/lib/ops/slack-file-upload";

export const FINANCIALS_CHANNEL_ID = "C0AKG9FSC2J";
export const ABRA_CONTROL_CHANNEL_ID = "C0ALS6W7VB4";
export const RENE_SLACK_ID = "U0ALL27JM38";
export const BEN_SLACK_ID = "U08JY86Q508";

export type QBOInvoiceRow = {
  Id: string;
  Date?: string | null;
  DueDate?: string | null;
  Amount?: number;
  Balance?: number;
  Customer?: string | null;
  DocNumber?: string | null;
  Status?: string | null;
};

export type QBOBillRow = {
  Id: string;
  Date?: string | null;
  DueDate?: string | null;
  Amount?: number;
  Balance?: number;
  Vendor?: string | null;
  Status?: string | null;
};

export type QBOAccountRow = {
  Id: string;
  Name?: string;
  AccountType?: string;
  AccountSubType?: string;
  AcctNum?: string;
  CurrentBalance?: number;
  Active?: boolean;
};

type SlackPostResponse = {
  ok?: boolean;
  ts?: string;
};

export function getInternalBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
    "https://www.usagummies.com"
  );
}

export function getInternalHeaders(): HeadersInit {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  return cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {};
}

export function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function formatCurrency(value: number): string {
  return `$${round2(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function currentPtDateParts(date = new Date()): { isoDate: string; dayOfWeek: number; dayOfMonth: number } {
  const pt = new Date(date.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  return {
    isoDate: pt.toISOString().slice(0, 10),
    dayOfWeek: pt.getDay(),
    dayOfMonth: pt.getDate(),
  };
}

export function getPreviousMonthRange(date = new Date()): { label: string; start: string; end: string } {
  const pt = new Date(date.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const firstOfCurrent = new Date(Date.UTC(pt.getUTCFullYear(), pt.getUTCMonth(), 1));
  const lastOfPrevious = new Date(firstOfCurrent.getTime() - 24 * 60 * 60 * 1000);
  const firstOfPrevious = new Date(Date.UTC(lastOfPrevious.getUTCFullYear(), lastOfPrevious.getUTCMonth(), 1));
  return {
    label: lastOfPrevious.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/Los_Angeles" }),
    start: firstOfPrevious.toISOString().slice(0, 10),
    end: lastOfPrevious.toISOString().slice(0, 10),
  };
}

export function daysOutstanding(fromDate?: string | null, toDate = currentPtDateParts().isoDate): number {
  if (!fromDate) return 0;
  const start = new Date(`${fromDate}T00:00:00Z`).getTime();
  const end = new Date(`${toDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / (24 * 60 * 60 * 1000)));
}

export function truncateSlackText(text: string, max = 1800): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export async function qboQueryJson<T>(type: string, params: Record<string, string> = {}): Promise<T> {
  const query = new URLSearchParams({ type, ...params });
  const res = await fetch(`${getInternalBaseUrl()}/api/ops/qbo/query?${query.toString()}`, {
    headers: getInternalHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`QBO query ${type} failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function fetchPlaidCurrentBalance(): Promise<number> {
  const res = await fetch(`${getInternalBaseUrl()}/api/ops/plaid/balance`, {
    headers: getInternalHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return 0;
  const data = (await res.json().catch(() => ({}))) as {
    accounts?: Array<{ balances?: { current?: number; available?: number } }>;
  };
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  return round2(
    accounts.reduce(
      (sum, account) => sum + Number(account?.balances?.current ?? account?.balances?.available ?? 0),
      0,
    ),
  );
}

export async function postSlackMessage(channelId: string, text: string): Promise<SlackPostResponse> {
  const token = (process.env.SLACK_BOT_TOKEN || "").trim();
  if (!token) return { ok: false };
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: channelId,
      text: truncateSlackText(text, 3500),
      mrkdwn: true,
      unfurl_links: false,
    }),
    signal: AbortSignal.timeout(15000),
  });
  return (await res.json().catch(() => ({}))) as SlackPostResponse;
}

export async function uploadWorkbook(params: {
  channelId: string;
  filename: string;
  comment: string;
  sheets: SpreadsheetData[];
}): Promise<void> {
  const result = await uploadFileToSlack({
    channelId: params.channelId,
    filename: params.filename,
    title: params.filename.replace(/\.xlsx$/i, ""),
    comment: truncateSlackText(params.comment, 1900),
    format: "xlsx",
    data: params.sheets,
  });
  if (!result.ok) {
    throw new Error(result.error || "Slack file upload failed");
  }
}

export function findSummaryValue(
  summary: Record<string, string | number>,
  patterns: RegExp[],
): number {
  for (const [key, value] of Object.entries(summary)) {
    if (typeof value !== "number") continue;
    if (patterns.some((pattern) => pattern.test(key))) {
      return round2(value);
    }
  }
  return 0;
}

export function summarizeRowsByPrefix(
  summary: Record<string, string | number>,
  include: RegExp,
  exclude: RegExp[] = [],
): Array<{ label: string; value: number }> {
  return Object.entries(summary)
    .filter(([key, value]) => typeof value === "number" && include.test(key) && !exclude.some((pattern) => pattern.test(key)))
    .map(([key, value]) => ({
      label: key,
      value: round2(Number(value)),
    }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}
