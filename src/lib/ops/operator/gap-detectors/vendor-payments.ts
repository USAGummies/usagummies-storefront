import { readState, writeState } from "@/lib/ops/state";
import type { OperatorTaskInsert } from "@/lib/ops/operator/gap-detectors/qbo";

type VendorPaymentsResult = {
  tasks: OperatorTaskInsert[];
  summary: {
    dueSoonCount: number;
    dueSoonAmount: number;
    overdueCount: number;
    overdueAmount: number;
  };
};

type BillRow = {
  Id?: string;
  Date?: string | null;
  DueDate?: string | null;
  Amount?: number | null;
  Balance?: number | null;
  Vendor?: string | null;
  Status?: string | null;
};

const FINANCIALS_CHANNEL_ID = "C0AKG9FSC2J";
const AP_SUMMARY_STATE_KEY = "abra-operator-ap-summary-last-run" as never;

function getInternalBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
    "https://www.usagummies.com"
  );
}

function getInternalHeaders(): HeadersInit {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  return cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {};
}

function buildNaturalKey(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => String(part || "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatCurrency(value: number): string {
  return `$${round2(value).toFixed(2)}`;
}

function daysUntil(dateValue: string | null | undefined): number {
  if (!dateValue) return Number.POSITIVE_INFINITY;
  const target = new Date(`${String(dateValue).slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(target)) return Number.POSITIVE_INFINITY;
  return Math.floor((target - Date.now()) / 86400000);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchBills(): Promise<BillRow[]> {
  const res = await fetch(`${getInternalBaseUrl()}/api/ops/qbo/query?type=bills`, {
    headers: getInternalHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { bills?: BillRow[] };
  return Array.isArray(data.bills) ? data.bills : [];
}

async function postFinancialsSummary(text: string): Promise<void> {
  const token = (process.env.SLACK_BOT_TOKEN || "").trim();
  if (!token) return;
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: FINANCIALS_CHANNEL_ID,
      text,
      mrkdwn: true,
      unfurl_links: false,
    }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => {});
}

async function maybePostWeeklySummary(summary: VendorPaymentsResult["summary"]): Promise<void> {
  const now = new Date();
  if (now.getUTCDay() !== 1) return;

  const key = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
  const lastRun = await readState<{ date?: string } | null>(AP_SUMMARY_STATE_KEY, null);
  if (lastRun?.date === key) return;

  await postFinancialsSummary(
    `📌 *AP Aging* — ${formatCurrency(summary.dueSoonAmount)} due this week across ${summary.dueSoonCount} bill(s), ` +
      `${formatCurrency(summary.overdueAmount)} overdue across ${summary.overdueCount} bill(s).`,
  );
  await writeState(AP_SUMMARY_STATE_KEY, { date: key });
}

export async function detectVendorPaymentTasks(): Promise<VendorPaymentsResult> {
  const bills = await fetchBills();
  const tasks: OperatorTaskInsert[] = [];
  let dueSoonAmount = 0;
  let overdueAmount = 0;
  let dueSoonCount = 0;
  let overdueCount = 0;

  for (const bill of bills) {
    const balance = Number(bill.Balance || 0);
    if (balance <= 0) continue;

    const days = daysUntil(bill.DueDate || bill.Date || null);
    const vendor = String(bill.Vendor || "Vendor");
    const billId = String(bill.Id || "");
    const dueDate = String(bill.DueDate || bill.Date || todayIso()).slice(0, 10);

    if (days < 0) {
      overdueCount += 1;
      overdueAmount += balance;
      tasks.push({
        task_type: "vendor_payment_overdue",
        title: `Pay overdue bill — ${vendor} ${formatCurrency(balance)}`,
        description: `${vendor} bill ${billId || "unknown"} was due ${dueDate} and remains unpaid.`,
        priority: "critical",
        source: "gap_detector:vendor_payments",
        assigned_to: "rene",
        requires_approval: true,
        execution_params: {
          natural_key: buildNaturalKey(["vendor_payment_overdue", billId || vendor, dueDate, balance.toFixed(2)]),
          bill_id: billId || null,
          vendor,
          amount: round2(balance),
          due_date: dueDate,
          days_overdue: Math.abs(days),
        },
        tags: ["finance", "ap", "vendor-payment"],
      });
      continue;
    }

    if (days <= 5) {
      dueSoonCount += 1;
      dueSoonAmount += balance;
      tasks.push({
        task_type: "vendor_payment_due",
        title: `Vendor payment due — ${vendor} ${formatCurrency(balance)}`,
        description: `${vendor} bill ${billId || "unknown"} is due in ${days} day(s) on ${dueDate}.`,
        priority: "high",
        source: "gap_detector:vendor_payments",
        assigned_to: "rene",
        requires_approval: true,
        execution_params: {
          natural_key: buildNaturalKey(["vendor_payment_due", billId || vendor, dueDate, balance.toFixed(2)]),
          bill_id: billId || null,
          vendor,
          amount: round2(balance),
          due_date: dueDate,
          days_until_due: days,
        },
        tags: ["finance", "ap", "vendor-payment"],
      });
    }
  }

  const summary = {
    dueSoonCount,
    dueSoonAmount: round2(dueSoonAmount),
    overdueCount,
    overdueAmount: round2(overdueAmount),
  };

  await maybePostWeeklySummary(summary);

  return { tasks, summary };
}
