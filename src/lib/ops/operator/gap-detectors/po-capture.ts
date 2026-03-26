import { readAllAttachments, readEmail, searchEmails } from "@/lib/ops/gmail-reader";
import type { OperatorTaskInsert } from "@/lib/ops/operator/gap-detectors/qbo";

type PoCaptureResult = {
  tasks: OperatorTaskInsert[];
  summary: {
    detected: number;
  };
};

type ParsedPo = {
  customerName: string;
  poNumber: string;
  quantity: number;
  unitPrice: number;
  total: number;
  deliveryDate: string | null;
  shippingAddress: string | null;
  emailMessageId: string;
  emailThreadId: string;
  emailSubject: string;
  emailFrom: string;
  needsShipping: boolean;
  needsReview: boolean;
};

const WHOLESALE_UNIT_PRICE = 2.1;
const RETAIL_UNIT_PRICE = 3.49;
const KNOWN_WHOLESALE_RE = /(inderbitzin|patrick|mike arlint|glacier wholesalers|wholesale|distributor)/i;

function normalizeText(value: string | null | undefined): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildNaturalKey(poNumber: string): string {
  return `po:${poNumber}`.toLowerCase();
}

function extractCustomerName(from: string, body: string): string {
  if (/inderbitzin|patrick/i.test(`${from} ${body}`)) return "Inderbitzin";
  const shipTo = body.match(/ship\s+to[:\s]+([^\n]+)/i)?.[1]?.trim();
  if (shipTo) return shipTo.replace(/\s{2,}/g, " ");
  const fromName = normalizeText(from.replace(/<[^>]+>/g, ""));
  return fromName || "Wholesale customer";
}

function extractPoNumber(text: string): string | null {
  const match = text.match(/\b(?:po|p\.o\.|purchase order|order)\s*#?\s*:?\s*([A-Z0-9-]{3,})\b/i);
  const candidate = match?.[1]?.trim() || null;
  if (!candidate) return null;
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
  return null;
}

function extractUnitPrice(text: string, wholesale = true): number {
  const perUnit = text.match(/\$([\d.]+)\s*(?:\/|per)\s*(?:unit|bag)/i);
  if (perUnit) return Number(perUnit[1]) || (wholesale ? WHOLESALE_UNIT_PRICE : RETAIL_UNIT_PRICE);
  return wholesale ? WHOLESALE_UNIT_PRICE : RETAIL_UNIT_PRICE;
}

function extractDeliveryDate(text: string): string | null {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const monthDay = text.match(/\b(?:deliver|delivery|ship|arrive|arrival|deadline).*?\b(on|by)?\s*([A-Z][a-z]+ \d{1,2}(?:, \d{4})?)/i);
  if (!monthDay?.[2]) return null;
  const parsed = new Date(monthDay[2]);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function extractShippingAddress(text: string): string | null {
  const match = text.match(/(?:ship to|shipping address|deliver to)[:\s]+([\s\S]{0,220})/i);
  if (!match?.[1]) return null;
  return normalizeText(match[1].split(/\n\n|\r\n\r\n/)[0]).slice(0, 220) || null;
}

function looksLikePoEmail(subject: string, body: string, from: string): boolean {
  const haystack = `${subject}\n${body}\n${from}`;
  return /\b(po|p\.o\.|purchase order|order confirmation|po number|po #)\b/i.test(haystack);
}

function parsePoFromEmail(message: {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  body: string;
}): ParsedPo | null {
  if (!looksLikePoEmail(message.subject, message.body, message.from)) return null;
  const text = `${message.subject}\n${message.body}`;
  const poNumber = extractPoNumber(text);
  const quantity = parseQuantity(text);
  if (!poNumber) return null;

  const wholesale = KNOWN_WHOLESALE_RE.test(`${message.from}\n${text}`);
  const unitPrice = extractUnitPrice(text, wholesale);
  const customerName = extractCustomerName(message.from, message.body);
  const normalizedQuantity = quantity || 0;
  const total = Number((normalizedQuantity * unitPrice).toFixed(2));
  return {
    customerName,
    poNumber,
    quantity: normalizedQuantity,
    unitPrice,
    total,
    deliveryDate: extractDeliveryDate(text),
    shippingAddress: extractShippingAddress(text),
    emailMessageId: message.id,
    emailThreadId: message.threadId,
    emailSubject: message.subject,
    emailFrom: message.from,
    needsShipping: !/inderbitzin/i.test(customerName),
    needsReview: normalizedQuantity <= 0,
  };
}

async function enrichPoCandidate(message: {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  body: string;
}): Promise<ParsedPo | null> {
  const fullMessage = await readEmail(message.id).catch(() => null);
  const attachments = fullMessage?.attachments || [];
  const extracted = attachments.length
    ? await readAllAttachments(message.id, attachments).catch(() => [])
    : [];
  const attachmentText = extracted
    .map((attachment) => String(attachment.textContent || ""))
    .filter((text) => text && !text.startsWith("["))
    .join("\n\n");
  const merged = {
    ...message,
    body: [message.body, attachmentText].filter(Boolean).join("\n\n"),
  };
  return parsePoFromEmail(merged);
}

export async function detectPoCaptureTasks(): Promise<PoCaptureResult> {
  const emails = await searchEmails(
    'newer_than:1d (subject:(PO OR "Purchase Order" OR "P.O.") OR "purchase order" OR "PO #" OR "PO ")',
    50,
  ).catch(() => []);

  const parsed = await Promise.all(
    (Array.isArray(emails) ? emails : []).map((message) => enrichPoCandidate(message)),
  );

  const tasks = parsed
    .filter((parsed): parsed is ParsedPo => Boolean(parsed))
    .map((po) => ({
      task_type: "po_received",
      title: po.needsReview
        ? `PO #${po.poNumber} from ${po.customerName} — quantity pending review`
        : `PO #${po.poNumber} from ${po.customerName} — ${po.quantity} units, $${po.total.toFixed(2)}`,
      description: po.needsReview
        ? `Detected purchase order email from ${po.emailFrom} (${po.emailSubject}), but quantity needs manual review from the scanned attachment.`
        : `Detected purchase order email from ${po.emailFrom} (${po.emailSubject}).`,
      priority: "high" as const,
      source: "gap_detector:po_capture",
      assigned_to: "ben",
      requires_approval: true,
      execution_params: {
        natural_key: buildNaturalKey(po.poNumber),
        customer_name: po.customerName,
        po_number: po.poNumber,
        quantity: po.quantity,
        unit_price: po.unitPrice,
        total: po.total,
        delivery_date: po.deliveryDate,
        shipping_address: po.shippingAddress,
        email_message_id: po.emailMessageId,
        email_thread_id: po.emailThreadId,
        email_subject: po.emailSubject,
        email_from: po.emailFrom,
        needs_shipping: po.needsShipping,
        needs_review: po.needsReview,
      },
      tags: ["po", "invoice", "approval", ...(po.needsReview ? ["needs_review"] : [])],
    }));

  return {
    tasks,
    summary: {
      detected: tasks.length,
    },
  };
}
