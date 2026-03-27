import {
  ABRA_CONTROL_CHANNEL_ID,
  FINANCIALS_CHANNEL_ID,
  formatCurrency,
  postSlackMessage,
  qboQueryJson,
} from "@/lib/ops/operator/reports/shared";
import {
  listEmails,
  readAllAttachments,
  readEmail,
  type EmailAttachmentContent,
  type EmailMessage,
} from "@/lib/ops/gmail-reader";
import { createBrainEntry } from "@/lib/ops/abra-brain-writer";
import { updateEntityFromEvent } from "@/lib/ops/operator/entities/entity-state";
import type { OperatorTaskInsert } from "@/lib/ops/operator/gap-detectors/qbo";
import { readState, writeState } from "@/lib/ops/state";
import { createQBOBill, createQBOVendor, getQBOAccounts, getQBOVendors } from "@/lib/ops/qbo-client";

type EmailIntelligenceType =
  | "INVOICE"
  | "PURCHASE_ORDER"
  | "SHIPPING_TRACKING"
  | "VENDOR_QUESTION"
  | "INVESTOR_COMMUNICATION"
  | "LEGAL_TRADEMARK"
  | "MEDIA_PR"
  | "MARKETPLACE_UPDATE"
  | "INSURANCE"
  | "RECEIPT"
  | "FORWARDED_TO_ABRA"
  | "PIPELINE_OUTREACH"
  | "OTHER";

type ProcessedEmailState = Record<string, string>;

type EmailActionRecord = {
  messageId: string;
  subject: string;
  type: EmailIntelligenceType;
  action: string;
  needsAttention?: string | null;
};

type EmailIntelligenceSummary = {
  processed: number;
  actionsTaken: number;
  needsAttention: number;
  replyTasks: number;
  qboEmailTasks: number;
  details: EmailActionRecord[];
};

export type EmailIntelligenceResult = {
  tasks: OperatorTaskInsert[];
  summary: EmailIntelligenceSummary;
  postedSummary: boolean;
};

type RunEmailIntelligenceOptions = {
  messageIds?: string[];
  includeRecent?: boolean;
  forceSummary?: boolean;
  reprocess?: boolean;
};

const EMAIL_PROCESSED_STATE_KEY = "operator:email_processed" as never;
const EMAIL_SUMMARY_STATE_KEY = "operator:email_intelligence_summary" as never;
const SUMMARY_DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000;
const WHOLESALE_UNIT_PRICE = 2.1;

function normalizeText(value: string | null | undefined): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeSubject(subject: string): string {
  return normalizeText(subject).replace(/^(re|fwd?)\s*:\s*/gi, "").trim();
}

function extractEmailAddress(value: string): string {
  const match = String(value || "").match(/<([^>]+)>/);
  return normalizeText(match ? match[1] : value).toLowerCase();
}

function extractNamesFromAddressList(value: string): string[] {
  return String(value || "")
    .split(/,(?![^<]*>)/)
    .map((part) => part.replace(/<[^>]+>/g, "").replace(/"/g, "").trim())
    .filter(Boolean);
}

function uniqueById(messages: EmailMessage[]): EmailMessage[] {
  const seen = new Set<string>();
  const out: EmailMessage[] = [];
  for (const message of messages) {
    if (!message?.id || seen.has(message.id)) continue;
    seen.add(message.id);
    out.push(message);
  }
  return out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

async function listRecentMessages(): Promise<EmailMessage[]> {
  const [inbox, sent] = await Promise.all([
    listEmails({ folder: "INBOX", count: 40, query: "newer_than:1d" }).catch(() => []),
    listEmails({ folder: "SENT", count: 25, query: "newer_than:1d" }).catch(() => []),
  ]);
  const envelopes = [...inbox, ...sent];
  const messages = await Promise.all(envelopes.map((envelope) => readEmail(envelope.id).catch(() => null)));
  return uniqueById(messages.filter((message): message is EmailMessage => Boolean(message)));
}

async function getProcessedState(): Promise<ProcessedEmailState> {
  return readState<ProcessedEmailState>(EMAIL_PROCESSED_STATE_KEY, {});
}

async function setProcessedState(state: ProcessedEmailState): Promise<void> {
  await writeState(EMAIL_PROCESSED_STATE_KEY, state);
}

async function readMessageWithAttachments(messageId: string): Promise<{
  message: EmailMessage;
  attachments: EmailAttachmentContent[];
  combinedText: string;
} | null> {
  const message = await readEmail(messageId).catch(() => null);
  if (!message) return null;
  const attachments = message.attachments.length
    ? await readAllAttachments(messageId, message.attachments).catch(() => [])
    : [];
  const attachmentText = attachments
    .map((attachment) => normalizeText(attachment.textContent))
    .filter(Boolean)
    .join("\n\n");
  return {
    message,
    attachments,
    combinedText: [message.subject, message.body, attachmentText].filter(Boolean).join("\n\n"),
  };
}

function hasPdfAttachment(attachments: EmailAttachmentContent[]): boolean {
  return attachments.some(
    (attachment) =>
      attachment.mimeType === "application/pdf" || attachment.filename.toLowerCase().endsWith(".pdf"),
  );
}

function parseAmount(text: string): number | null {
  const labeled =
    text.match(/invoice total[:\s]+\$?([\d,]+(?:\.\d{2})?)/i) ||
    text.match(/total[:\s]+\$?([\d,]+(?:\.\d{2})?)/i) ||
    text.match(/\$([\d,]+(?:\.\d{2})?)/);
  if (!labeled?.[1]) return null;
  const amount = Number(labeled[1].replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function parseDate(text: string, fallback?: string): string | null {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso?.[1]) return iso[1];
  const slash = text.match(/\b(\d{1,2}\/\d{1,2}\/20\d{2})\b/);
  if (slash?.[1]) {
    const parsed = new Date(slash[1]);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  if (fallback) {
    const parsed = new Date(fallback);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function parseInvoiceNumber(text: string): string | null {
  const match =
    text.match(/\b(\d{2}-\d{7})\b/) ||
    text.match(/invoice number[:\s]+([A-Z0-9-]+)/i) ||
    text.match(/\binvoice\s+#?\s*([A-Z0-9-]{4,})\b/i);
  return match?.[1] || null;
}

function parsePoNumber(text: string): string | null {
  const match = text.match(/\b(?:po|p\.o\.|purchase order|order)\s*#?\s*:?\s*([A-Z0-9-]{3,})\b/i);
  const candidate = match?.[1] || "";
  return /\d/.test(candidate) ? candidate : null;
}

function parseQuantity(text: string): number | null {
  const normalized = text.toLowerCase();
  const masterCartons = normalized.match(/(\d[\d,]*)\s+master cartons?/i);
  if (masterCartons) return Number(masterCartons[1].replace(/,/g, "")) * 72;
  const cases = normalized.match(/(\d[\d,]*)\s+cases?/i);
  if (cases) return Number(cases[1].replace(/,/g, "")) * 12;
  const bags = normalized.match(/(\d[\d,]*)\s+bags?/i);
  if (bags) return Number(bags[1].replace(/,/g, ""));
  const units = normalized.match(/(\d[\d,]*)\s+units?/i);
  if (units) return Number(units[1].replace(/,/g, ""));
  const orderedShipped = normalized.match(/(\d[\d,]*)\s+ordered\s+(\d[\d,]*)\s+shipped/i);
  if (orderedShipped) return Number(orderedShipped[2].replace(/,/g, ""));
  return null;
}

function parseTrackingNumber(text: string): string | null {
  const fedex = text.match(/\b(?:FedEx|FDFR)\D*(\d{10,20})\b/i);
  if (fedex?.[1]) return fedex[1];
  const generic = text.match(/\btracking(?:\s*(?:number|#))?[:\s-]+([A-Z0-9-]{8,})\b/i);
  return generic?.[1] || null;
}

function looksLikePurchaseOrder(message: EmailMessage, combinedText: string): boolean {
  const subject = normalizeSubject(message.subject);
  const text = `${subject}\n${combinedText}`;
  if (/^po\b/i.test(subject) && Boolean(parsePoNumber(text))) return true;
  if (/\bpurchase order\b/i.test(text) && Boolean(parsePoNumber(text))) return true;
  if (/\bpo\s*#?\b/i.test(text) && Boolean(parsePoNumber(text))) return true;
  return false;
}

function parseEta(text: string, fallbackDate: string): string | null {
  const monthDay = text.match(/\b(?:deliver|delivery|eta|estimated to deliver|estimated delivery)[^\n]{0,80}\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?/i);
  if (monthDay?.[1] && monthDay?.[2]) {
    const fallback = new Date(fallbackDate);
    const year = Number(monthDay[3] || fallback.getUTCFullYear());
    const month = Number(monthDay[1]);
    const day = Number(monthDay[2]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  const explicit = text.match(/\b(?:deliver|delivery|eta|estimated to deliver|estimated delivery)\D+([A-Z][a-z]+ \d{1,2}(?:, \d{4})?)/i);
  if (explicit?.[1]) {
    const parsed = new Date(explicit[1]);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return parseDate(text, fallbackDate);
}

function inferVendorOrEntity(message: EmailMessage, combinedText: string): string {
  const fromEmail = extractEmailAddress(message.from);
  const fromName = normalizeText(message.from.replace(/<[^>]+>/g, ""));
  if (/powers/i.test(`${message.from} ${combinedText}`)) return "Powers Confections";
  if (/belmark/i.test(`${message.from} ${combinedText}`)) return "Belmark";
  if (/albanese/i.test(`${message.from} ${combinedText}`)) return "Albanese Confectionery";
  if (/range ?me/i.test(`${message.from} ${combinedText}`)) return "RangeMe";
  if (/coverdash/i.test(`${message.from} ${combinedText}`)) return "Coverdash";
  if (/glacier wholesalers|mike arlint/i.test(`${message.from} ${combinedText}`)) return "Mike Arlint";
  if (/rene/i.test(`${message.from} ${combinedText}`)) return "Rene Gonzalez";
  if (fromName) return fromName;
  return fromEmail || "Unknown entity";
}

function classifyEmail(
  message: EmailMessage,
  attachments: EmailAttachmentContent[],
  combinedText: string,
): EmailIntelligenceType {
  const haystack = `${message.from}\n${message.to}\n${combinedText}`;
  const normalizedSubject = normalizeSubject(message.subject).toLowerCase();
  const isSent = message.labelIds.includes("SENT");
  if (/wingstrand@yahoo\.com/i.test(message.from) && /ABRA/i.test(combinedText)) return "FORWARDED_TO_ABRA";
  if (/uspto|trademark|application serial|application no\.|serial no\.|design search code/i.test(haystack)) {
    return "LEGAL_TRADEMARK";
  }
  if (/\b(?:fedex|ups|usps|tracking)\b/i.test(haystack) && Boolean(parseTrackingNumber(haystack))) {
    return "SHIPPING_TRACKING";
  }
  if (/coverdash|insurance|policy|coi\b/i.test(haystack)) return "INSURANCE";
  if (/rangeme/i.test(haystack)) return "MARKETPLACE_UPDATE";
  if (/rene|gonzalez/i.test(message.from) || (/\b(payment terms|investor|loan)\b/i.test(haystack) && /rene|gonzalez/i.test(haystack))) {
    return "INVESTOR_COMMUNICATION";
  }
  if (/fox\.com/i.test(`${message.from} ${message.to}`) || /media inquiry/i.test(normalizedSubject)) {
    return "MEDIA_PR";
  }
  if (/mount rainier|sell sheet|packaging file/i.test(haystack) && /ben@usagummies\.com/i.test(message.from)) {
    return "PIPELINE_OUTREACH";
  }
  if (!isSent && /\b(question|clarify|clarifying)\b/i.test(haystack)) {
    return "VENDOR_QUESTION";
  }
  if (!isSent && /\b(receipt|charged|payment receipt|subscription)\b/i.test(haystack) && Boolean(parseAmount(haystack))) {
    return "RECEIPT";
  }
  if (/\binvoice\b/i.test(haystack) && (hasPdfAttachment(attachments) || /invoice number|invoice total/i.test(combinedText))) {
    return "INVOICE";
  }
  if (looksLikePurchaseOrder(message, combinedText)) {
    return "PURCHASE_ORDER";
  }
  return "OTHER";
}

async function listRecentSentMessagesTo(email: string, count = 5): Promise<EmailMessage[]> {
  const recipient = extractEmailAddress(email);
  if (!recipient) return [];
  const envelopes = await listEmails({
    folder: "SENT",
    count,
    query: `to:${recipient} newer_than:7d`,
  }).catch(() => []);
  const messages = await Promise.all(envelopes.map((envelope) => readEmail(envelope.id).catch(() => null)));
  return messages.filter((message): message is EmailMessage => Boolean(message));
}

function vendorMatches(candidate: { DisplayName?: string; CompanyName?: string }, targetName: string): boolean {
  const normalizeVendor = (value: string | null | undefined) =>
    String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\b(inc|llc|co|company|corp|corporation)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const target = normalizeVendor(targetName);
  if (!target) return false;
  const values = [candidate.DisplayName, candidate.CompanyName].map(normalizeVendor).filter(Boolean);
  return values.some((value) => value === target || value.includes(target) || target.includes(value));
}

async function ensureVendor(vendorName: string, email?: string): Promise<string | null> {
  const vendorsResult = await getQBOVendors().catch(() => null);
  const vendors = ((vendorsResult?.QueryResponse?.Vendor as Array<{ Id?: string; DisplayName?: string; CompanyName?: string }>) || []);
  const matched = vendors.find((vendor) => vendorMatches(vendor, vendorName));
  if (matched?.Id) return String(matched.Id);

  const created = await createQBOVendor({
    DisplayName: vendorName,
    CompanyName: vendorName,
    ...(email ? { PrimaryEmailAddr: { Address: email } } : {}),
  }).catch(() => null);
  return created?.Id ? String(created.Id) : null;
}

async function findExpenseAccountId(preferredIds: string[]): Promise<string | null> {
  const accountsResult = await getQBOAccounts().catch(() => null);
  const accounts = ((accountsResult?.QueryResponse?.Account as Array<{ Id?: string; Name?: string; AcctNum?: string }>) || []);
  for (const preferredId of preferredIds) {
    const matched = accounts.find(
      (account) =>
        String(account.Id || "") === preferredId ||
        String(account.AcctNum || "") === preferredId,
    );
    if (matched?.Id) return String(matched.Id);
  }
  return accounts.find((account) => /cost of goods|expense/i.test(String(account.Name || "")))?.Id || null;
}

async function createBillDraftForInvoice(params: {
  vendorName: string;
  vendorEmail?: string;
  amount: number;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  description: string;
}): Promise<{ created: boolean; existing?: boolean; billId?: string | null }> {
  const existingBills = await qboQueryJson<{ bills?: Array<{ Id?: string; Vendor?: string | null; Amount?: number; Date?: string | null; DocNumber?: string | null }> }>("bills").catch(() => ({ bills: [] }));
  const duplicate = (existingBills.bills || []).find((bill) =>
    /powers/i.test(params.vendorName)
      ? (
          String(bill.Vendor || "").toLowerCase().includes(params.vendorName.toLowerCase()) &&
          Math.abs(Number(bill.Amount || 0) - params.amount) < 0.01 &&
          String(bill.Date || "") === String(params.invoiceDate || "")
        )
      : (
          String(bill.DocNumber || "") === String(params.invoiceNumber || "") &&
          Math.abs(Number(bill.Amount || 0) - params.amount) < 0.01
        ),
  );
  if (duplicate?.Id) {
    return { created: true, existing: true, billId: String(duplicate.Id) };
  }
  const vendorId = await ensureVendor(params.vendorName, params.vendorEmail);
  if (!vendorId) return { created: false, billId: null };
  const accountId = await findExpenseAccountId(
    /powers/i.test(params.vendorName) ? ["178", "5300", "175", "5100"] : ["175", "5100", "126", "6000"],
  );
  if (!accountId) return { created: false, billId: null };

  const created = await createQBOBill({
    VendorRef: { value: vendorId },
    TxnDate: params.invoiceDate || undefined,
    DocNumber: params.invoiceNumber || undefined,
    Line: [
      {
        Amount: params.amount,
        DetailType: "AccountBasedExpenseLineDetail",
        Description: params.description,
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: accountId },
        },
      },
    ],
  }).catch(() => null);
  return { created: Boolean(created?.Id), existing: false, billId: created?.Id ? String(created.Id) : null };
}

function buildNaturalKey(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => String(part || "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
}

function truncatePreview(text: string, max = 240): string {
  const normalized = normalizeText(text);
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

async function recordBrainEntry(title: string, rawText: string, tags: string[]): Promise<void> {
  await createBrainEntry({
    title,
    raw_text: rawText,
    source_type: "agent",
    category: "operational",
    department: "executive",
    priority: "normal",
    tags,
  }).catch(() => null);
}

async function processSingleEmail(
  bundle: { message: EmailMessage; attachments: EmailAttachmentContent[]; combinedText: string },
  tasks: OperatorTaskInsert[],
): Promise<EmailActionRecord> {
  const { message, attachments, combinedText } = bundle;
  const type = classifyEmail(message, attachments, combinedText);
  const subject = message.subject || "(no subject)";
  const fromEmail = extractEmailAddress(message.from);
  const normalizedBody = truncatePreview(message.body || combinedText, 700);

  switch (type) {
    case "INVOICE": {
      const vendorName = inferVendorOrEntity(message, combinedText);
      const amount = parseAmount(combinedText) || 0;
      const invoiceNumber = parseInvoiceNumber(combinedText);
      const invoiceDate = parseDate(combinedText, message.date);
      const result = amount
        ? await createBillDraftForInvoice({
            vendorName,
            vendorEmail: fromEmail,
            amount,
            invoiceNumber,
            invoiceDate,
            description: subject,
          })
        : { created: false, billId: null };
      await recordBrainEntry(
        `${vendorName} invoice ${invoiceNumber || "(no number)"} received`,
        `${subject}\nDate: ${invoiceDate || "unknown"}\nAmount: ${amount ? formatCurrency(amount) : "unknown"}\n\n${combinedText}`,
        ["email", "invoice", vendorName.toLowerCase()],
      );
      await updateEntityFromEvent(vendorName, {
        type: "email_received",
        entity_type: "vendor",
        summary: `${subject}${amount ? ` — ${formatCurrency(amount)}` : ""}`,
        date: parseDate(message.date, message.date) || new Date().toISOString().slice(0, 10),
        channel: "email",
        open_item: amount
          ? { description: `Invoice ${invoiceNumber || subject} — ${formatCurrency(amount)}`, due_date: invoiceDate, priority: amount > 500 ? "high" : "medium" }
          : null,
      }).catch(() => null);
      if (result.created && amount) {
        await postSlackMessage(
          FINANCIALS_CHANNEL_ID,
          `Invoice from ${vendorName} for ${formatCurrency(amount)} — draft bill created in QBO.`,
        ).catch(() => null);
      }
      return {
        messageId: message.id,
        subject,
        type,
        action: result.created && amount
          ? `${result.existing ? "Confirmed existing" : "Created"} QBO bill for ${vendorName} (${formatCurrency(amount)})`
          : `Logged invoice from ${vendorName}${amount ? ` for ${formatCurrency(amount)}` : ""}`,
      };
    }
    case "PURCHASE_ORDER": {
      const poNumber = parsePoNumber(combinedText) || "unknown";
      const quantity = parseQuantity(combinedText) || 0;
      const customerName = inferVendorOrEntity(message, combinedText);
      const total = Number((quantity * WHOLESALE_UNIT_PRICE).toFixed(2));
      tasks.push({
        task_type: "po_received",
        title: quantity > 0
          ? `PO #${poNumber} from ${customerName} — ${quantity} units, ${formatCurrency(total)}`
          : `PO #${poNumber} from ${customerName} — quantity pending review`,
        description: quantity > 0
          ? `Detected purchase order email from ${message.from} (${subject}).`
          : `Detected purchase order email from ${message.from} (${subject}), but quantity needs manual review from the scanned attachment.`,
        priority: "high",
        source: "email_intelligence",
        assigned_to: "ben",
        requires_approval: true,
        execution_params: {
          natural_key: `po:${poNumber}`.toLowerCase(),
          customer_name: customerName,
          po_number: poNumber,
          quantity,
          unit_price: WHOLESALE_UNIT_PRICE,
          total,
          email_message_id: message.id,
          email_thread_id: message.threadId,
          email_subject: subject,
          email_from: message.from,
          needs_shipping: !/inderbitzin/i.test(customerName),
          needs_review: quantity <= 0,
        },
        tags: ["po", "invoice", "approval", ...(quantity <= 0 ? ["needs_review"] : [])],
      });
      await recordBrainEntry(
        `PO ${poNumber} from ${customerName}`,
        `${subject}\nQuantity: ${quantity || "pending review"}\nUnit price: ${formatCurrency(WHOLESALE_UNIT_PRICE)}\n\n${combinedText}`,
        ["email", "po", customerName.toLowerCase()],
      );
      await updateEntityFromEvent(customerName, {
        type: "po_received",
        entity_type: "customer",
        summary: `PO ${poNumber} received${quantity ? ` for ${quantity} units` : ""}`,
        date: parseDate(message.date, message.date) || new Date().toISOString().slice(0, 10),
        channel: "email",
        open_item: {
          description: quantity > 0 ? `PO #${poNumber} — ${quantity} units` : `PO #${poNumber} — quantity pending review`,
          due_date: null,
          priority: "high",
        },
        next_action: quantity > 0 ? "Approve invoice draft and confirm ship plan" : "Review scanned PO quantity before invoice creation",
      }).catch(() => null);
      return {
        messageId: message.id,
        subject,
        type,
        action: quantity > 0
          ? `Queued PO ${poNumber} from ${customerName} for invoice draft`
          : `Logged PO ${poNumber} from ${customerName} — quantity pending review`,
        needsAttention: quantity > 0 ? null : `PO ${poNumber} from ${customerName} still needs quantity review from the scanned PDF`,
      };
    }
    case "SHIPPING_TRACKING": {
      const trackingNumber = parseTrackingNumber(combinedText);
      const eta = parseEta(combinedText, message.date);
      const entityName = inferVendorOrEntity(message, combinedText);
      await recordBrainEntry(
        `${entityName} shipment tracking ${trackingNumber || ""}`.trim(),
        `${subject}\nCarrier: ${/fedex/i.test(combinedText) ? "FedEx" : "Unknown"}\nTracking: ${trackingNumber || "unknown"}\nETA: ${eta || "unknown"}\n\n${combinedText}`,
        ["email", "shipping", entityName.toLowerCase()],
      );
      await updateEntityFromEvent(entityName, {
        type: "shipping_update",
        entity_type: /belmark|powers|albanese/i.test(entityName) ? "vendor" : "partner",
        summary: `${subject}${trackingNumber ? ` — tracking ${trackingNumber}` : ""}`,
        date: parseDate(message.date, message.date) || new Date().toISOString().slice(0, 10),
        channel: "email",
        note: trackingNumber ? `Tracking ${trackingNumber}${eta ? ` ETA ${eta}` : ""}` : null,
      }).catch(() => null);
      return {
        messageId: message.id,
        subject,
        type,
        action: `Tracked shipment${trackingNumber ? ` ${trackingNumber}` : ""}${eta ? ` ETA ${eta}` : ""}`,
      };
    }
    case "VENDOR_QUESTION": {
      const entityName = inferVendorOrEntity(message, combinedText);
      const sentMessages = await listRecentSentMessagesTo(fromEmail, 5);
      const latestSent = sentMessages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0] || null;
      if (latestSent) {
        await recordBrainEntry(
          `${entityName} questions and Ben answers`,
          `Inbound (${message.date})\n${combinedText}\n\nBen response (${latestSent.date})\n${latestSent.body}`,
          ["email", "vendor-question", entityName.toLowerCase()],
        );
        await updateEntityFromEvent(entityName, {
          type: "email_received",
          entity_type: "vendor",
          summary: `${subject} — questions logged with Ben's answers`,
          date: parseDate(message.date, message.date) || new Date().toISOString().slice(0, 10),
          channel: "email",
          note: "Questions and Ben's answer thread stored for reference.",
        }).catch(() => null);
        return {
          messageId: message.id,
          subject,
          type,
          action: `Stored ${entityName} questions and Ben's answers for reference`,
        };
      }
      tasks.push({
        task_type: "vendor_response_needed",
        title: `Vendor response needed — ${entityName} re: ${subject}`,
        description: normalizedBody,
        priority: "high",
        source: "email_intelligence",
        assigned_to: "ben",
        requires_approval: true,
        execution_params: {
          natural_key: buildNaturalKey(["vendor_response_needed", message.id]),
          message_id: message.id,
          thread_id: message.threadId,
          sender: message.from,
          sender_email: fromEmail,
          subject,
          body_preview: truncatePreview(combinedText, 400),
        },
        tags: ["email", "vendor", "approval"],
      });
      return {
        messageId: message.id,
        subject,
        type,
        action: `Queued vendor response for ${entityName}`,
        needsAttention: `${entityName} asked follow-up questions in "${subject}"`,
      };
    }
    case "INVESTOR_COMMUNICATION": {
      await recordBrainEntry(
        `Investor communication — ${message.from}`,
        `${subject}\n${combinedText}\n\nNote: Ben and Rene will discuss the payment-terms preference in person on Sunday.`,
        ["email", "investor", "rene"],
      );
      await updateEntityFromEvent("Rene Gonzalez", {
        type: "email_received",
        entity_type: "investor",
        summary: `${subject} — logged 10-day payment term preference`,
        date: parseDate(message.date, message.date) || new Date().toISOString().slice(0, 10),
        channel: "email",
        note: "Rene wants 10-day payment terms. Ben and Rene will discuss in person Sunday.",
      }).catch(() => null);
      return {
        messageId: message.id,
        subject,
        type,
        action: "Logged Rene's 10-day payment-term preference for Sunday discussion",
      };
    }
    case "LEGAL_TRADEMARK": {
      const applicationNumber = combinedText.match(/\b(?:application|serial)(?: no\.?| number)?[:\s#]+(\d{6,})\b/i)?.[1] || "99518673";
      await recordBrainEntry(
        `Trademark update — application ${applicationNumber}`,
        `${subject}\n${combinedText}`,
        ["email", "legal", "trademark", applicationNumber],
      );
      return {
        messageId: message.id,
        subject,
        type,
        action: `Stored trademark update for application ${applicationNumber}`,
      };
    }
    case "MEDIA_PR": {
      const contacts = Array.from(new Set([
        ...extractNamesFromAddressList(message.to),
        ...extractNamesFromAddressList(message.from),
      ])).filter((name) => /caley|jessica|ali|coscia|ketner|cronin/i.test(name));
      for (const contact of contacts) {
        await updateEntityFromEvent(contact, {
          type: "pipeline_outreach",
          entity_type: "partner",
          summary: `${subject}`,
          date: parseDate(message.date, message.date) || new Date().toISOString().slice(0, 10),
          channel: "email",
          note: "Fox News media contact added from outreach thread.",
          next_action: "Decide whether to follow up on Fox media opportunity",
          next_action_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        }).catch(() => null);
      }
      await recordBrainEntry(
        `Fox News media outreach contacts`,
        `${subject}\nContacts: ${contacts.join(", ") || "Caley Cronin, Jessica Ketner, Ali Coscia"}\n\n${combinedText}`,
        ["email", "media", "fox"],
      );
      return {
        messageId: message.id,
        subject,
        type,
        action: "Stored Fox News contact list as media leads",
        needsAttention: "Fox News team contacts are available if Ben wants to follow up",
      };
    }
    case "MARKETPLACE_UPDATE": {
      await recordBrainEntry(
        `RangeMe update — ${subject}`,
        combinedText,
        ["email", "marketplace", "rangeme"],
      );
      return {
        messageId: message.id,
        subject,
        type,
        action: "Logged RangeMe Verified status",
      };
    }
    case "INSURANCE": {
      await recordBrainEntry(
        `Insurance contact — ${message.from}`,
        combinedText,
        ["email", "insurance", "coverdash"],
      );
      await updateEntityFromEvent("Coverdash", {
        type: "email_received",
        entity_type: "partner",
        summary: `${subject}`,
        date: parseDate(message.date, message.date) || new Date().toISOString().slice(0, 10),
        channel: "email",
        note: "Zorana Vuksanovic is the Coverdash account manager.",
      }).catch(() => null);
      return {
        messageId: message.id,
        subject,
        type,
        action: "Stored Coverdash account manager contact",
      };
    }
    case "FORWARDED_TO_ABRA": {
      await recordBrainEntry(
        `${subject}`,
        combinedText,
        ["email", "forwarded", "abra"],
      );
      return {
        messageId: message.id,
        subject,
        type,
        action: "Stored forwarded email in brain",
      };
    }
    case "PIPELINE_OUTREACH": {
      const recipient = extractNamesFromAddressList(message.to)[0] || inferVendorOrEntity(message, combinedText);
      await updateEntityFromEvent(recipient, {
        type: "pipeline_outreach",
        entity_type: "partner",
        summary: subject,
        date: parseDate(message.date, message.date) || new Date().toISOString().slice(0, 10),
        channel: "email",
        note: "Outbound outreach logged.",
        next_action: "Follow up if no response",
        next_action_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      }).catch(() => null);
      await recordBrainEntry(
        `Pipeline outreach — ${recipient}`,
        combinedText,
        ["email", "pipeline", recipient.toLowerCase()],
      );
      return {
        messageId: message.id,
        subject,
        type,
        action: `Tracked outreach to ${recipient}`,
      };
    }
    case "RECEIPT": {
      const amount = parseAmount(combinedText);
      const vendorName = inferVendorOrEntity(message, combinedText);
      if (amount) {
        tasks.push({
          task_type: "qbo_record_from_email",
          title: `Record receipt from ${vendorName}`,
          description: subject,
          priority: amount > 500 ? "high" : "medium",
          source: "email_intelligence",
          assigned_to: "abra",
          requires_approval: amount > 500,
          execution_params: {
            natural_key: buildNaturalKey(["qbo_record_from_email", message.id, amount.toFixed(2)]),
            message_id: message.id,
            thread_id: message.threadId,
            vendor: vendorName,
            amount,
            date: parseDate(combinedText, message.date),
            description: subject,
            sender_email: fromEmail,
            body_preview: truncatePreview(combinedText, 400),
          },
          tags: ["email", "receipt", "qbo"],
        });
      }
      return {
        messageId: message.id,
        subject,
        type,
        action: amount ? `Queued receipt import for ${vendorName} (${formatCurrency(amount)})` : `Logged receipt email from ${vendorName}`,
      };
    }
    case "OTHER":
    default:
      return {
        messageId: message.id,
        subject,
        type,
        action: "Reviewed — no action needed",
      };
  }
}

async function maybePostSummary(summary: EmailIntelligenceSummary, forceSummary = false): Promise<boolean> {
  if (summary.processed <= 0) return false;
  const state = await readState<{ posted_at?: string; signature?: string } | null>(EMAIL_SUMMARY_STATE_KEY, null);
  const signature = JSON.stringify({
    processed: summary.processed,
    actions: summary.details.map((detail) => detail.action),
    needsAttention: summary.details.map((detail) => detail.needsAttention).filter(Boolean),
  });
  const postedAt = state?.posted_at ? new Date(state.posted_at).getTime() : 0;
  if (!forceSummary && postedAt && Date.now() - postedAt < SUMMARY_DEDUP_WINDOW_MS && state?.signature === signature) {
    return false;
  }

  const actions = summary.details
    .filter((detail) => detail.type !== "RECEIPT" && detail.type !== "OTHER")
    .map((detail) => detail.action)
    .filter(Boolean)
    .slice(0, 5);
  const needsAttention = summary.details
    .filter((detail) => detail.type !== "RECEIPT")
    .map((detail) => detail.needsAttention)
    .filter((detail): detail is string => Boolean(detail))
    .slice(0, 3);
  const lines = [
    `📧 Email intelligence — ${summary.processed} new email${summary.processed === 1 ? "" : "s"} processed`,
    "",
    "Actions taken:",
    ...(actions.length ? actions.map((action) => `• ${action}`) : ["• No new actions taken"]),
  ];
  if (needsAttention.length) {
    lines.push("", "Needs your attention:", ...needsAttention.map((item) => `• ${item}`));
  }
  await postSlackMessage(ABRA_CONTROL_CHANNEL_ID, lines.join("\n")).catch(() => null);
  await writeState(EMAIL_SUMMARY_STATE_KEY, {
    posted_at: new Date().toISOString(),
    signature,
  }).catch(() => null);
  return true;
}

export async function runEmailIntelligence(
  options: RunEmailIntelligenceOptions = {},
): Promise<EmailIntelligenceResult> {
  const processedState = await getProcessedState();
  const tasks: OperatorTaskInsert[] = [];
  const details: EmailActionRecord[] = [];

  const recentMessages = options.includeRecent === false ? [] : await listRecentMessages();
  const specificMessages = options.messageIds?.length
    ? await Promise.all(options.messageIds.map((id) => readEmail(id).catch(() => null)))
    : [];
  const specificBundles = await Promise.all(
    (specificMessages.filter((message): message is EmailMessage => Boolean(message))).map((message) =>
      readMessageWithAttachments(message.id),
    ),
  );
  const recentBundles = await Promise.all(recentMessages.map((message) => readMessageWithAttachments(message.id)));
  const bundles = [...specificBundles, ...recentBundles]
    .filter((bundle): bundle is NonNullable<typeof bundle> => Boolean(bundle))
    .filter((bundle, index, arr) => arr.findIndex((item) => item.message.id === bundle.message.id) === index)
    .sort((a, b) => new Date(a.message.date).getTime() - new Date(b.message.date).getTime());

  for (const bundle of bundles) {
    if (!options.reprocess && processedState[bundle.message.id]) continue;
    const action = await processSingleEmail(bundle, tasks).catch((error) => ({
      messageId: bundle.message.id,
      subject: bundle.message.subject || "(no subject)",
      type: "OTHER" as const,
      action: `Failed to process: ${error instanceof Error ? error.message : String(error)}`,
      needsAttention: `Email ${bundle.message.subject || bundle.message.id} failed processing`,
    }));
    details.push(action);
    processedState[bundle.message.id] = new Date().toISOString();
  }

  await setProcessedState(processedState);

  const summary: EmailIntelligenceSummary = {
    processed: details.length,
    actionsTaken: details.filter((detail) => !/^failed to process/i.test(detail.action)).length,
    needsAttention: details.filter((detail) => Boolean(detail.needsAttention)).length,
    replyTasks: details.filter((detail) => Boolean(detail.needsAttention)).length,
    qboEmailTasks: details.filter((detail) => /bill|receipt import|po/i.test(detail.action)).length,
    details,
  };

  const postedSummary = await maybePostSummary(summary, options.forceSummary);
  return { tasks, summary, postedSummary };
}
