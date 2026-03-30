import crypto from "node:crypto";
import { after, NextResponse } from "next/server";
import {
  getSlackDisplayName,
  getRecentChannelContext,
  getThreadHistory,
  postSlackMessage,
} from "@/lib/ops/abra-slack-responder";
import { extractPdfTextFromBuffer } from "@/lib/ops/file-text-extraction";
import { executeRoutedAction, renderRoutedActionResponse } from "@/lib/ops/operator/action-executor";
import { routeMessage } from "@/lib/ops/operator/deterministic-router";
import { shouldClaimSlackMessageReply, shouldProcessSlackEvent } from "@/lib/ops/slack-dedup";
import { readState, writeState } from "@/lib/ops/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // after() needs time for chat API call (up to 55s)

type SlackFile = {
  id: string;
  name: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  url_private?: string;
  url_private_download?: string;
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FINANCIALS_CHANNEL_ID = "C0AKG9FSC2J";
const RECEIPTS_CHANNEL_ID = "C0APYNE9E73";

type SpreadsheetRow = Record<string, string>;
type FinancialImportPlanKind = "chart_of_accounts" | "vendor_list" | "transaction_list" | "unknown";
type FinancialImportPlan = {
  kind: FinancialImportPlanKind;
  channel: string;
  threadTs: string;
  fileName: string;
  createdAt: string;
  totalRows: number;
  headers: string[];
  accounts?: Array<{ name: string; type: string; number?: string; sub_type?: string; description?: string }>;
  vendors?: Array<{ name: string; company_name?: string; email?: string; phone?: string; address?: string; city?: string; state?: string; zip?: string }>;
  transactions?: Array<{ date: string; description: string; amount: number; accountName?: string; accountNumber?: string; isIncome?: boolean }>;
  previewLines: string[];
};

type SlackEventBody = {
  type?: string;
  challenge?: string;
  event_id?: string;
  event?: {
    type?: string;
    text?: string;
    user?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
    subtype?: string;
    files?: SlackFile[];
  };
};

function verifySlackSignature(req: Request, body: string): boolean {
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!timestamp || !signature || !signingSecret) return false;
  const timestampNum = Number(timestamp);
  if (!Number.isFinite(timestampNum)) return false;
  if (Math.abs(Date.now() / 1000 - timestampNum) > 300) return false;

  const sigBaseString = `v0:${timestamp}:${body}`;
  const hmac = crypto
    .createHmac("sha256", signingSecret)
    .update(sigBaseString)
    .digest("hex");
  const expected = `v0=${hmac}`;

  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

const EXTRACTABLE_TYPES = new Set([
  "xlsx", "xls", "csv", "tsv", "pdf", "doc", "docx", "txt", "json",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/pdf",
  "text/csv",
  "text/plain",
  "text/tab-separated-values",
  "application/json",
]);

function isExtractableFile(file: SlackFile): boolean {
  if (file.size && file.size > 10 * 1024 * 1024) return false; // 10MB limit
  const ext = (file.name || "").split(".").pop()?.toLowerCase() || "";
  return EXTRACTABLE_TYPES.has(ext) || EXTRACTABLE_TYPES.has(file.mimetype || "") || EXTRACTABLE_TYPES.has(file.filetype || "");
}

function isImageFile(file: SlackFile): boolean {
  return Boolean((file.mimetype || "").startsWith("image/"));
}

async function downloadSlackFile(url: string): Promise<Buffer | null> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken || !url) return null;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch {
    return null;
  }
}

async function downloadSlackImage(file: SlackFile): Promise<{ name: string; mimeType: string; buffer: Buffer } | null> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const url = file.url_private_download || file.url_private;
  if (!botToken || !url) return null;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || file.mimetype || "image/png";
    if (!contentType.startsWith("image/")) return null;
    const contentLength = parseInt(res.headers.get("content-length") || "0", 10);
    if (contentLength > MAX_IMAGE_BYTES) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.byteLength > MAX_IMAGE_BYTES) return null;
    return {
      name: file.name || "slack-image",
      mimeType: contentType,
      buffer,
    };
  } catch {
    return null;
  }
}

async function extractSlackFiles(files: SlackFile[]): Promise<string> {
  const results: string[] = [];

  for (const file of files.slice(0, 5)) { // Max 5 files
    if (isImageFile(file)) {
      results.push(`📎 ${file.name || "image"} — image attached`);
      continue;
    }
    if (!isExtractableFile(file)) {
      results.push(`📎 ${file.name} (${file.filetype || "unknown"}) — skipped (unsupported type or too large)`);
      continue;
    }

    const url = file.url_private_download || file.url_private;
    if (!url) {
      results.push(`📎 ${file.name} — no download URL available`);
      continue;
    }

    const data = await downloadSlackFile(url);
    if (!data) {
      results.push(`📎 ${file.name} — download failed`);
      continue;
    }

    const ext = (file.name || "").split(".").pop()?.toLowerCase() || "";
    const mime = file.mimetype || "";

    try {
      // CSV / TSV / TXT / JSON — plain text
      if (ext === "csv" || ext === "tsv" || ext === "txt" || ext === "json" ||
          mime.startsWith("text/") || mime === "application/json") {
        const text = data.toString("utf-8").slice(0, 50000); // 50KB text limit
        results.push(`📎 **${file.name}** (${ext}):\n\`\`\`\n${text}\n\`\`\``);
        continue;
      }

      // Excel spreadsheets
      if (ext === "xlsx" || ext === "xls" || mime.includes("spreadsheet") || mime.includes("excel")) {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(data, { type: "buffer" });
        const sheets: string[] = [];
        for (const sheetName of workbook.SheetNames.slice(0, 10)) {
          const sheet = workbook.Sheets[sheetName];
          if (!sheet) continue;
          const csv = XLSX.utils.sheet_to_csv(sheet, { FS: "\t" });
          if (csv.trim()) {
            sheets.push(`Sheet "${sheetName}":\n${csv.slice(0, 15000)}`);
          }
        }
        results.push(`📎 **${file.name}** (Excel, ${workbook.SheetNames.length} sheet${workbook.SheetNames.length !== 1 ? "s" : ""}):\n${sheets.join("\n\n")}`);
        continue;
      }

      // PDF
      if (ext === "pdf" || mime === "application/pdf") {
        try {
          const extracted = await extractPdfTextFromBuffer(data, {
            maxPages: 30,
            maxChars: 50_000,
            scannedPlaceholder: "[Scanned PDF — no extractable text. Needs OCR or CSV export.]",
          });
          results.push(`📎 **${file.name}** (PDF):\n${extracted.text}`);
        } catch (pdfErr) {
          results.push(`📎 ${file.name} — PDF extraction failed: ${pdfErr instanceof Error ? pdfErr.message : "unknown error"}`);
        }
        continue;
      }

      results.push(`📎 ${file.name} — unsupported format for extraction`);
    } catch (err) {
      results.push(`📎 ${file.name} — extraction error: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  return results.join("\n\n");
}

function getInternalBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "https://www.usagummies.com"
  );
}

function getInternalAuthHeaders(contentType = true): Record<string, string> {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  return {
    ...(contentType ? { "Content-Type": "application/json" } : {}),
    ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
  };
}

function normalizeHeader(header: string): string {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function firstValue(row: SpreadsheetRow, keys: string[]): string {
  for (const key of keys) {
    const normalized = normalizeHeader(key);
    for (const [header, value] of Object.entries(row)) {
      if (normalizeHeader(header) === normalized && String(value || "").trim()) {
        return String(value || "").trim();
      }
    }
  }
  return "";
}

function parseSpreadsheetNumber(raw: string): number | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const normalized = text.replace(/[,$]/g, "").replace(/^\((.+)\)$/, "-$1");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

async function parseSpreadsheetRowsFromBuffer(buffer: Buffer, fileName: string): Promise<SpreadsheetRow[]> {
  try {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return [];
    const sheet = workbook.Sheets[firstSheetName];
    if (!sheet) return [];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    return rows.map((row) =>
      Object.entries(row).reduce<SpreadsheetRow>((acc, [key, value]) => {
        acc[String(key)] = typeof value === "string" ? value.trim() : String(value ?? "").trim();
        return acc;
      }, {}),
    ).filter((row) => Object.values(row).some((value) => String(value || "").trim()));
  } catch {
    const ext = (fileName || "").split(".").pop()?.toLowerCase() || "";
    const text = buffer.toString("utf8");
    const delimiter = ext === "tsv" ? "\t" : ",";
    const [headerLine, ...lines] = text.split(/\r?\n/).filter((line) => line.trim());
    if (!headerLine) return [];
    const headers = headerLine.split(delimiter).map((value) => value.trim());
    return lines.map((line) => {
      const values = line.split(delimiter);
      return headers.reduce<SpreadsheetRow>((acc, header, index) => {
        acc[header] = String(values[index] || "").trim();
        return acc;
      }, {});
    }).filter((row) => Object.values(row).some((value) => String(value || "").trim()));
  }
}

function classifySpreadsheet(rows: SpreadsheetRow[]): FinancialImportPlanKind {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row).map(normalizeHeader))));
  const has = (...keys: string[]) => keys.some((key) => headers.includes(normalizeHeader(key)));
  if (
    (has("account_name", "name", "description") && has("account_number", "number", "acctnum", "gl_account")) ||
    (has("account_name", "name", "description") && has("type", "account_type"))
  ) {
    return "chart_of_accounts";
  }
  if (has("vendor_name", "name") && has("email", "phone", "company_name", "address")) {
    return "vendor_list";
  }
  if (has("date") && has("amount") && has("description", "memo", "vendor", "account_name", "account_number")) {
    return "transaction_list";
  }
  return "unknown";
}

function previewLinesFromRows(rows: SpreadsheetRow[], limit = 5): string[] {
  return rows.slice(0, limit).map((row, index) => {
    const cells = Object.entries(row)
      .slice(0, 6)
      .map(([key, value]) => `${key}: ${String(value || "").slice(0, 60)}`);
    return `${index + 1}. ${cells.join(" | ")}`;
  });
}

/**
 * Map single-letter account type codes (A/L/C/P/I/E) used in Rene's
 * spreadsheets to QBO AccountType + AccountSubType. Also handles full QBO
 * type names passed through unchanged.
 */
function mapAccountTypeCode(
  rawType: string,
  name: string,
  number?: string,
): { type: string; sub_type?: string } {
  const code = rawType.trim().toUpperCase();
  const nameLower = (name || "").toLowerCase();
  const num = number || "";

  // If already a full QBO type name, pass through
  if (rawType.length > 2) return { type: rawType };

  switch (code) {
    case "A": {
      // Asset — determine subtype from name/number patterns
      if (/checking|bank of america/i.test(name)) return { type: "Bank", sub_type: "Checking" };
      if (/banking|found/i.test(name)) return { type: "Bank", sub_type: "Checking" };
      if (/money market/i.test(name)) return { type: "Bank", sub_type: "CashOnHand" };
      if (/certificate/i.test(name)) return { type: "Other Current Asset", sub_type: "EmployeeCashAdvances" };
      if (/accounts receivable|a\/?r/i.test(name)) return { type: "Accounts Receivable", sub_type: "AccountsReceivable" };
      if (/inventory/i.test(name)) return { type: "Other Current Asset", sub_type: "Inventory" };
      if (/allowance.*bad/i.test(name)) return { type: "Other Current Asset", sub_type: "AllowanceForBadDebts" };
      if (/prepaid/i.test(name)) return { type: "Other Current Asset", sub_type: "PrepaidExpenses" };
      if (/deposit/i.test(name)) return { type: "Other Current Asset", sub_type: "PrepaidExpenses" };
      if (/property tax/i.test(name)) return { type: "Other Current Asset", sub_type: "PrepaidExpenses" };
      if (num.startsWith("1")) return { type: "Other Current Asset", sub_type: "OtherCurrentAssets" };
      return { type: "Other Current Asset", sub_type: "OtherCurrentAssets" };
    }
    case "L": {
      if (/accounts payable|a\/?p/i.test(name)) return { type: "Accounts Payable", sub_type: "AccountsPayable" };
      if (/suspense/i.test(name)) return { type: "Other Current Liability", sub_type: "OtherCurrentLiabilities" };
      if (/long.?term|ltl/i.test(name) || num.startsWith("28") || num.startsWith("29")) return { type: "Long Term Liability", sub_type: "NotesPayable" };
      return { type: "Other Current Liability", sub_type: "OtherCurrentLiabilities" };
    }
    case "C": {
      if (/retained earnings/i.test(name)) return { type: "Equity", sub_type: "RetainedEarnings" };
      if (/distribution/i.test(name)) return { type: "Equity", sub_type: "PersonalIncome" };
      return { type: "Equity", sub_type: "CommonStock" };
    }
    case "P":
      // "P" = Equity/Prior period — typically retained earnings
      return { type: "Equity", sub_type: "RetainedEarnings" };
    case "I": {
      if (/interest income/i.test(name) || /discount/i.test(name) || /miscellaneous/i.test(name)) return { type: "Other Income", sub_type: "InterestEarned" };
      return { type: "Income", sub_type: "SalesOfProductIncome" };
    }
    case "E": {
      if (/cost of goods|cogs/i.test(name) || num.startsWith("5")) return { type: "Cost of Goods Sold", sub_type: "SuppliesMaterialsCogs" };
      if (/interest expense/i.test(name)) return { type: "Expense", sub_type: "InterestPaid" };
      if (/rent|lease/i.test(nameLower)) return { type: "Expense", sub_type: "RentOrLeaseOfBuildings" };
      if (/insurance/i.test(name)) return { type: "Expense", sub_type: "Insurance" };
      if (/vehicle|auto|fuel|car|truck/i.test(name)) return { type: "Expense", sub_type: "Auto" };
      if (/travel|air|lodging|parking/i.test(name)) return { type: "Expense", sub_type: "Travel" };
      if (/meal/i.test(name)) return { type: "Expense", sub_type: "Travel" };
      if (/office.*equip|furniture|supplies|stationary|printing.*copy|blue print/i.test(name)) return { type: "Expense", sub_type: "OfficeGeneralAdministrativeExpenses" };
      if (/postage|shipping|courier/i.test(name)) return { type: "Expense", sub_type: "ShippingFreightDelivery" };
      if (/utility/i.test(name)) return { type: "Expense", sub_type: "Utilities" };
      if (/software|computer|subscription/i.test(name)) return { type: "Expense", sub_type: "OtherMiscellaneousServiceCost" };
      if (/promotion|entertainment|sponsor|advertis|market|website|digital|photo/i.test(name)) return { type: "Expense", sub_type: "PromotionalMeals" };
      if (/legal|accounting|professional|license|fee|bank charge|hr|dues|charitable/i.test(name)) return { type: "Expense", sub_type: "LegalProfessionalFees" };
      if (/cellular|phone|safety|conference|seminar|meeting|pantry|swag/i.test(name)) return { type: "Expense", sub_type: "OtherBusinessExpenses" };
      return { type: "Expense", sub_type: "OtherMiscellaneousServiceCost" };
    }
    default:
      return { type: rawType };
  }
}

function buildFinancialImportPlan(
  fileName: string,
  channel: string,
  threadTs: string,
  rows: SpreadsheetRow[],
): FinancialImportPlan {
  const kind = classifySpreadsheet(rows);
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const previewLines = previewLinesFromRows(rows);
  const plan: FinancialImportPlan = {
    kind,
    channel,
    threadTs,
    fileName,
    createdAt: new Date().toISOString(),
    totalRows: rows.length,
    headers,
    previewLines,
  };

  if (kind === "chart_of_accounts") {
    plan.accounts = rows
      .map((row) => {
        const rawName = firstValue(row, ["Account Name", "Name", "Description"]);
        const rawType = firstValue(row, ["Type", "Account Type"]);
        const number = firstValue(row, ["Account Number", "Number", "AcctNum", "GL Account"]) || undefined;
        const sub_type = firstValue(row, ["Sub Type", "Subtype", "Account SubType"]) || undefined;
        const description = firstValue(row, ["Description", "Detail"]) || undefined;
        // Map single-letter type codes (A/L/C/P/I/E) to QBO AccountType
        const mapped = mapAccountTypeCode(rawType, rawName, number);
        return {
          name: rawName,
          type: mapped.type || rawType,
          number,
          sub_type: sub_type || mapped.sub_type || undefined,
          description: description !== rawName ? description : undefined,
        };
      })
      .filter((row) => row.name && row.type);
  } else if (kind === "vendor_list") {
    plan.vendors = rows
      .map((row) => ({
        name: firstValue(row, ["Vendor Name", "Name"]),
        company_name: firstValue(row, ["Company Name", "Company"]) || undefined,
        email: firstValue(row, ["Email", "Email Address"]) || undefined,
        phone: firstValue(row, ["Phone", "Phone Number"]) || undefined,
        address: firstValue(row, ["Address", "Street"]) || undefined,
        city: firstValue(row, ["City"]) || undefined,
        state: firstValue(row, ["State"]) || undefined,
        zip: firstValue(row, ["Zip", "Postal Code"]) || undefined,
      }))
      .filter((row) => row.name);
  } else if (kind === "transaction_list") {
    plan.transactions = rows
      .map((row) => ({
        date: firstValue(row, ["Date"]),
        description: firstValue(row, ["Description", "Memo", "Vendor", "Name"]),
        amount: parseSpreadsheetNumber(firstValue(row, ["Amount", "Total", "Value"])) || 0,
        accountName: firstValue(row, ["Account Name", "Account"]),
        accountNumber: firstValue(row, ["Account Number", "Account #", "Number"]),
        isIncome: (() => {
          const type = firstValue(row, ["Type", "Kind", "Category"]).toLowerCase();
          if (/(income|revenue|sale|deposit)/.test(type)) return true;
          if (/(expense|purchase|bill|vendor)/.test(type)) return false;
          return undefined;
        })(),
      }))
      .filter((row) => row.date && row.description && row.amount !== 0);
  }

  return plan;
}

function buildFinancialImportPreview(plan: FinancialImportPlan): string {
  const intro =
    plan.kind === "chart_of_accounts"
      ? `I see ${plan.accounts?.length || 0} accounts in this Chart of Accounts file.`
      : plan.kind === "vendor_list"
        ? `I see ${plan.vendors?.length || 0} vendors in this file.`
        : plan.kind === "transaction_list"
          ? `I see ${plan.transactions?.length || 0} transactions in this file.`
          : `I parsed ${plan.totalRows} rows from this spreadsheet, but I couldn't classify it confidently.`;
  const nextStep =
    plan.kind === "unknown"
      ? "Tell me what this file is supposed to represent, or upload a file with clearer headers."
      : "Reply in this thread with `import all` if you want me to push it into QuickBooks.";
  return [
    intro,
    `File: ${plan.fileName}`,
    "",
    "Preview:",
    ...plan.previewLines,
    "",
    nextStep,
  ].join("\n");
}

function buildFinancialPlanKey(channel: string, threadTs: string): string {
  return `${channel}:${threadTs}`;
}

async function readFinancialImportPlans(): Promise<Record<string, FinancialImportPlan>> {
  return readState("operator:financial_import_plans", {} as Record<string, FinancialImportPlan>);
}

async function writeFinancialImportPlans(plans: Record<string, FinancialImportPlan>): Promise<void> {
  await writeState("operator:financial_import_plans", plans);
}

function looksLikeFinancialImportConfirmation(text: string): boolean {
  return /\b(import all|yes import|yes, import|go ahead|do it|proceed|import them)\b/i.test(text);
}

async function maybeBuildFinancialImportPlan(files: SlackFile[], channel: string, threadTs: string): Promise<FinancialImportPlan | null> {
  if (channel !== FINANCIALS_CHANNEL_ID) return null;
  const spreadsheet = files.find((file) => {
    const name = (file.name || "").toLowerCase();
    const mime = (file.mimetype || "").toLowerCase();
    return name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv") || mime.includes("spreadsheet") || mime === "text/csv";
  });
  if (!spreadsheet) return null;
  const url = spreadsheet.url_private_download || spreadsheet.url_private;
  if (!url) return null;
  const buffer = await downloadSlackFile(url);
  if (!buffer) return null;
  const rows = await parseSpreadsheetRowsFromBuffer(buffer, spreadsheet.name || "financial-upload");
  if (rows.length === 0) return null;
  return buildFinancialImportPlan(spreadsheet.name || "financial-upload", channel, threadTs, rows);
}

async function importFinancialPlan(plan: FinancialImportPlan): Promise<string> {
  const baseUrl = getInternalBaseUrl();
  if (plan.kind === "chart_of_accounts") {
    const accounts = plan.accounts || [];
    // Fetch existing accounts to avoid duplicates
    const existingRes = await fetch(`${baseUrl}/api/ops/qbo/accounts`, {
      headers: getInternalAuthHeaders(false),
      signal: AbortSignal.timeout(30000),
    });
    const existingPayload = (await existingRes.json().catch(() => ({}))) as {
      accounts?: Array<{ AcctNum?: string; Name?: string }>;
    };
    const existingNums = new Set((existingPayload.accounts || []).map((a) => String(a.AcctNum || "")).filter(Boolean));
    const existingNames = new Set((existingPayload.accounts || []).map((a) => (a.Name || "").toLowerCase()).filter(Boolean));

    let created = 0;
    let skipped = 0;
    const failures: string[] = [];
    for (const account of accounts) {
      // Skip if account already exists (by number or exact name)
      if ((account.number && existingNums.has(account.number)) || existingNames.has(account.name.toLowerCase())) {
        skipped += 1;
        continue;
      }
      const res = await fetch(`${baseUrl}/api/ops/qbo/accounts`, {
        method: "POST",
        headers: getInternalAuthHeaders(),
        body: JSON.stringify(account),
        signal: AbortSignal.timeout(45000),
      });
      if (res.ok) {
        created += 1;
        // Track newly created to avoid creating dupes within same batch
        if (account.number) existingNums.add(account.number);
        existingNames.add(account.name.toLowerCase());
      } else {
        failures.push(account.name);
      }
    }
    const parts = [`Created ${created} new accounts in QuickBooks.`];
    if (skipped > 0) parts.push(`Skipped ${skipped} that already existed.`);
    if (failures.length > 0) parts.push(`Failed: ${failures.slice(0, 5).join(", ")}`);
    return parts.join(" ");
  }

  if (plan.kind === "vendor_list") {
    const vendors = plan.vendors || [];
    let created = 0;
    const failures: string[] = [];
    for (const vendor of vendors) {
      const res = await fetch(`${baseUrl}/api/ops/qbo/vendor`, {
        method: "POST",
        headers: getInternalAuthHeaders(),
        body: JSON.stringify(vendor),
        signal: AbortSignal.timeout(45000),
      });
      if (res.ok) {
        created += 1;
      } else {
        failures.push(vendor.name);
      }
    }
    return failures.length > 0
      ? `Imported ${created}/${vendors.length} vendors into QuickBooks. Failed: ${failures.slice(0, 5).join(", ")}`
      : `Imported all ${created} vendors into QuickBooks.`;
  }

  if (plan.kind === "transaction_list") {
    const accountRes = await fetch(`${baseUrl}/api/ops/qbo/accounts`, {
      headers: getInternalAuthHeaders(false),
      signal: AbortSignal.timeout(30000),
    });
    const accountPayload = (await accountRes.json().catch(() => ({}))) as {
      accounts?: Array<{ Id?: string; Name?: string; AccountType?: string; AcctNum?: string }>;
    };
    const accounts = accountPayload.accounts || [];
    const bankAccount = accounts.find((row) => row.AccountType === "Bank" && /checking|bofa|bank/i.test(String(row.Name || ""))) || accounts.find((row) => row.AccountType === "Bank");
    if (!bankAccount?.Id) {
      return "I parsed the transactions, but I couldn't resolve a QBO bank account for the import.";
    }
    const transactions = (plan.transactions || []).flatMap((row) => {
      const account =
        accounts.find((candidate) => row.accountNumber && String(candidate.AcctNum || "") === row.accountNumber) ||
        accounts.find((candidate) => row.accountName && String(candidate.Name || "").toLowerCase() === row.accountName.toLowerCase());
      if (!account?.Id) return [];
      const isIncome = typeof row.isIncome === "boolean" ? row.isIncome : row.amount > 0;
      return [{
        date: row.date,
        description: row.description,
        amount: Math.abs(row.amount),
        accountId: Number(account.Id),
        isIncome,
        bankAccountId: Number(bankAccount.Id),
      }];
    });
    if (transactions.length === 0) {
      return "I parsed the transaction list, but none of the rows had a resolvable QBO account reference. Add an account number or exact account name and try again.";
    }
    const res = await fetch(`${baseUrl}/api/ops/qbo/import-batch`, {
      method: "POST",
      headers: getInternalAuthHeaders(),
      body: JSON.stringify({ transactions }),
      signal: AbortSignal.timeout(45000),
    });
    const data = (await res.json().catch(() => ({}))) as { created?: number; total?: number; error?: string };
    if (!res.ok) {
      return `I parsed the transaction list, but the QBO import failed: ${String(data.error || res.status)}`;
    }
    return `Imported ${Number(data.created || 0)}/${Number(data.total || transactions.length)} transactions into QuickBooks.`;
  }

  return "I parsed the spreadsheet, but I couldn't classify it well enough to import safely.";
}

function stripAbraMention(text: string): string {
  return text.replace(/<@U0AKMSTL0GL>\s*/g, "").trim();
}

export function isRedundantMentionMirrorEvent(event: {
  type?: string;
  text?: string;
}): boolean {
  if (event.type !== "message") return false;
  return /<@U0AKMSTL0GL>/.test(event.text || "");
}

function normalizeConstraintText(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildThreadConstraintBlock(
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  fileContext: string,
): string {
  const userTexts = [...history.filter((item) => item.role === "user").map((item) => item.content), message]
    .map(normalizeConstraintText)
    .filter(Boolean);
  const joined = userTexts.join("\n");
  const constraints: string[] = [];

  if (/\b(?:do not|don't|dont|not)\b[\s\S]{0,50}\b(qbo|quickbooks)\b/i.test(joined) || /\bnot from qbo\b/i.test(joined)) {
    constraints.push("Do not use QBO or QuickBooks as the source.");
  }
  if (/\bexcel\b/i.test(joined) || /\bcsv\b/i.test(joined)) {
    constraints.push("Prefer Excel or CSV output if the user is asking for an export.");
  }
  if (/\bpdf\b/i.test(joined) || /PDF extraction failed/i.test(fileContext)) {
    constraints.push("Do not promise OCR. If the PDF text was extracted, use it. If the file is scanned/image-only, say that plainly and suggest OCR or CSV as the fallback.");
  }
  if (history.some((item) => item.role === "assistant")) {
    constraints.push("You are already participating in this Slack thread. Stay engaged even if Ben or other humans are mentioned. Do not go silent.");
  }

  if (constraints.length === 0) return "";
  return `[THREAD CONSTRAINTS]\n${constraints.map((item) => `- ${item}`).join("\n")}\n\n`;
}

type ChatRouteUpload = { name: string; mimeType: string; buffer: Buffer };

export async function buildReadOnlyChatRouteRequest(payload: {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  actorLabel: string;
  channel: string;
  slackChannelId: string;
  slackThreadTs: string;
  uploadedFiles?: ChatRouteUpload[];
}): Promise<{ headers: HeadersInit; body: string | FormData }> {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  const authHeaders: Record<string, string> = cronSecret
    ? { Authorization: `Bearer ${cronSecret}` }
    : {};
  if (payload.uploadedFiles && payload.uploadedFiles.length > 0) {
    const form = new FormData();
    form.set("message", payload.message);
    form.set("history", JSON.stringify(payload.history));
    form.set("actor_label", payload.actorLabel);
    form.set("channel", "slack");
    form.set("slack_channel_id", payload.slackChannelId);
    form.set("slack_thread_ts", payload.slackThreadTs);
    const firstFile = payload.uploadedFiles[0];
    const blob = new Blob([new Uint8Array(firstFile.buffer)], { type: firstFile.mimeType || "application/octet-stream" });
    form.set("file", blob, firstFile.name);
    return { headers: authHeaders, body: form };
  }

  return {
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({
      message: payload.message,
      history: payload.history,
      actor_label: payload.actorLabel,
      channel: "slack",
      slack_channel_id: payload.slackChannelId,
      slack_thread_ts: payload.slackThreadTs,
    }),
  };
}

async function callReadOnlyChatRoute(payload: {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  actorLabel: string;
  channel: string;
  slackChannelId: string;
  slackThreadTs: string;
  uploadedFiles?: ChatRouteUpload[];
}): Promise<{ reply: string; blocks?: Array<Record<string, unknown>> } | null> {
  const request = await buildReadOnlyChatRouteRequest(payload);
  const res = await fetch(`${getInternalBaseUrl()}/api/ops/abra/chat`, {
    method: "POST",
    headers: request.headers,
    body: request.body,
    cache: "no-store",
    signal: AbortSignal.timeout(55000),
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data || typeof data.reply !== "string" || !data.reply.trim()) return null;
  const blocks = Array.isArray(data.blocks) ? (data.blocks as Array<Record<string, unknown>>) : undefined;
  return { reply: data.reply.trim(), blocks };
}

export async function POST(req: Request) {
  if (!process.env.SLACK_SIGNING_SECRET) {
    return NextResponse.json(
      { error: "Slack events not configured (missing SLACK_SIGNING_SECRET)" },
      { status: 501 },
    );
  }

  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!verifySlackSignature(req, rawBody)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: SlackEventBody = {};
  try {
    body = rawBody ? (JSON.parse(rawBody) as SlackEventBody) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge || "" });
  }

  const event = body.event;
  const supportedEvent =
    body.type === "event_callback" &&
    event &&
    (event.type === "message" || event.type === "app_mention");
  if (!supportedEvent) {
    return NextResponse.json({ ok: true });
  }

  const { text, user, channel, ts, thread_ts, bot_id, subtype, files } = event;
  if (bot_id || subtype === "bot_message") {
    return NextResponse.json({ ok: true });
  }
  if (isRedundantMentionMirrorEvent(event)) {
    return NextResponse.json({ ok: true });
  }
  // Accept messages with text OR files (file-only messages have empty text)
  const hasText = Boolean(text?.trim());
  const hasFiles = Array.isArray(files) && files.length > 0;
  if ((!hasText && !hasFiles) || !user || !channel || !ts) {
    return NextResponse.json({ ok: true });
  }

  // Capture idempotency values before entering after() — the request object
  // may not be readable inside the background callback.
  const isRetry = Boolean(req.headers.get("x-slack-retry-num"));

  // Return 200 IMMEDIATELY so Slack never times out and retries.
  // All processing — including the dedup check — happens inside after().
  after(async () => {
    // Slack retries carry x-slack-retry-num. Since we already returned 200 on
    // the original request, skip retries to prevent double-processing.
    if (isRetry) return;

    if (!(await shouldProcessSlackEvent({
      eventId: body.event_id || null,
      channel,
      user,
      messageTs: ts,
      rootThreadTs: thread_ts || ts,
      text: text || "",
    }))) {
      return;
    }

    try {
      const [displayName, history] = await Promise.all([
        getSlackDisplayName(user),
        thread_ts
          ? getThreadHistory(channel, thread_ts)
          : getRecentChannelContext(channel, ts),
      ]);
      const rootThreadTs = thread_ts || ts;

      if (channel === FINANCIALS_CHANNEL_ID && text?.trim() && looksLikeFinancialImportConfirmation(text)) {
        const planKey = buildFinancialPlanKey(channel, rootThreadTs);
        const plans = await readFinancialImportPlans();
        const pendingPlan = plans[planKey];
        if (pendingPlan) {
          const importReply = await importFinancialPlan(pendingPlan);
          delete plans[planKey];
          await writeFinancialImportPlans(plans);
          await postSlackMessage(channel, importReply, {
            threadTs: rootThreadTs,
          });
          return;
        }
      }

      // If files are attached, download and extract their content
      let fileContext = "";
      let uploadedFiles: Array<{ name: string; mimeType: string; buffer: Buffer }> = [];
      if (hasFiles) {
        const [extracted, images] = await Promise.all([
          extractSlackFiles(files!),
          Promise.all((files || []).filter(isImageFile).slice(0, 1).map((file) => downloadSlackImage(file))),
        ]);
        if (extracted) {
          fileContext = extracted;
        }
        uploadedFiles = images.filter((value): value is { name: string; mimeType: string; buffer: Buffer } => Boolean(value));
      }

      if (channel === FINANCIALS_CHANNEL_ID && hasFiles) {
        const financialPlan = await maybeBuildFinancialImportPlan(files || [], channel, rootThreadTs);
        if (financialPlan) {
          const plans = await readFinancialImportPlans();
          plans[buildFinancialPlanKey(channel, rootThreadTs)] = financialPlan;
          await writeFinancialImportPlans(plans);
          await postSlackMessage(channel, buildFinancialImportPreview(financialPlan), {
            threadTs: rootThreadTs,
          });
          return;
        }
      }

      // Build the message text — include file context if present
      const explicitText = text?.trim() || "";
      const isReceiptsChannel = channel === RECEIPTS_CHANNEL_ID;
      const inferredPrompt =
        !explicitText && uploadedFiles.length > 0
          ? isReceiptsChannel
            ? "A receipt image was uploaded to #receipts-capture. Read/OCR this image and extract: vendor name, date, amount, payment method, and likely expense category. Present a structured summary and suggest the QBO category. Ask if the user wants it recorded."
            : "Please analyze the attached image from Slack and answer the user directly."
          : isReceiptsChannel && uploadedFiles.length > 0
            ? `[RECEIPTS CHANNEL] This image is a transaction receipt uploaded for reconciliation. Read/OCR the image and extract: vendor name, date, amount, payment method, and likely expense category. Present a structured summary. User message: ${explicitText}`
            : "";
      const messageText = [
        explicitText || inferredPrompt,
        fileContext ? `\n\n[ATTACHED FILES]\n${fileContext}` : "",
      ].filter(Boolean).join("");
      if (!(await shouldClaimSlackMessageReply({
        channel,
        rootThreadTs,
        user,
        messageTs: ts,
      }))) {
        return;
      }

      const normalizedMessage = stripAbraMention(messageText || "(file attachment — see attached files above)");
      const routed = routeMessage(normalizedMessage, user, {
        history,
      });

      if (routed) {
        const executed = await executeRoutedAction(routed, {
          actor: displayName,
          slackChannelId: channel,
          slackThreadTs: rootThreadTs,
          slackUserId: user,
          history,
        });
        const rendered = renderRoutedActionResponse(executed);
        await postSlackMessage(channel, rendered.reply, {
          threadTs: rootThreadTs,
          blocks: rendered.blocks,
        });
        return;
      }

      const conversationMessage = `${buildThreadConstraintBlock(normalizedMessage, history, fileContext)}${normalizedMessage}`.trim();
      const chatResult = await callReadOnlyChatRoute({
        message: conversationMessage,
        history,
        actorLabel: displayName,
        channel: "slack",
        slackChannelId: channel,
        slackThreadTs: rootThreadTs,
        uploadedFiles,
      });

      if (chatResult?.reply) {
        await postSlackMessage(channel, chatResult.reply, {
          threadTs: rootThreadTs,
          blocks: chatResult.blocks,
        });
        return;
      }

      await postSlackMessage(
        channel,
        "I hit an error while processing that. Send the next instruction and I’ll continue.",
        { threadTs: rootThreadTs },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Slack events processing error";
      console.error("[ops/slack/events] async processing failed:", message);
      if (event.type === "app_mention" || channel === "C0AKG9FSC2J" || channel === "C0ALS6W7VB4" || channel === "C0A9S88E1FT") {
        await postSlackMessage(channel, "I hit an error while processing that. Send the next instruction and I’ll continue.", {
          threadTs: thread_ts || ts,
        }).catch(() => {});
      }
    }
  });

  return NextResponse.json({ ok: true });
}
