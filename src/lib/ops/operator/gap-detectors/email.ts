import { listEmails, readEmail, searchEmails, type EmailEnvelope } from "@/lib/ops/gmail-reader";
import type { OperatorTaskInsert } from "@/lib/ops/operator/gap-detectors/qbo";
import { updateEntityFromEvent } from "@/lib/ops/operator/entities/entity-state";

type EmailGapDetectorResult = {
  tasks: OperatorTaskInsert[];
  summary: {
    replyTasks: number;
    qboEmailTasks: number;
  };
};

const TRACKED_SENDER_RULES: Array<{
  name: string;
  match: RegExp;
  priority: "high" | "medium";
}> = [
  { name: "Powers", match: /greg|powers/i, priority: "high" },
  { name: "Albanese", match: /bill|albanese/i, priority: "high" },
  { name: "Belmark", match: /jonathan|belmark/i, priority: "high" },
  { name: "Inderbitzin", match: /patrick|inderbitzin/i, priority: "high" },
  { name: "Reid Mitchell", match: /reid|mitchell/i, priority: "high" },
  { name: "EcoEnclose", match: /ecoenclose|ecoenclose/i, priority: "high" },
  { name: "Dutch Valley", match: /dutch valley/i, priority: "high" },
  { name: "Rene", match: /rene|gonzalez/i, priority: "medium" },
  { name: "USA Gummies", match: /@usagummies\.com/i, priority: "medium" },
];

const FINANCIAL_EMAIL_PATTERN = /\b(invoice|receipt|payment|paid|remit|bill)\b|\$\s?\d[\d,]*(?:\.\d{2})?/i;

function normalizeText(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function extractEmailAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return normalizeText(match ? match[1] : value);
}

function extractSenderRule(from: string) {
  const haystack = `${from} ${extractEmailAddress(from)}`;
  return TRACKED_SENDER_RULES.find((rule) => rule.match.test(haystack));
}

function hoursAgo(dateHeader: string): number {
  const time = new Date(dateHeader).getTime();
  if (!Number.isFinite(time)) return 999;
  return Math.max(0, Math.floor((Date.now() - time) / 3600000));
}

function buildNaturalKey(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => String(part || "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
}

function extractAmount(text: string): number | null {
  const match = text.match(/\$\s?([\d,]+(?:\.\d{2})?)/);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function extractDate(text: string, fallback: string): string {
  const isoMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];
  return fallback.slice(0, 10);
}

function buildBodyPreview(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 400);
}

async function hasSentReply(envelope: EmailEnvelope): Promise<boolean> {
  const senderEmail = extractEmailAddress(envelope.from);
  const subject = envelope.subject.replace(/^re:\s*/i, "").trim();
  const sentResults = await searchEmails(
    `in:sent to:${senderEmail} subject:"${subject.replace(/"/g, "")}" newer_than:14d`,
    10,
  );

  return sentResults.some((message) => {
    const sentAt = new Date(message.date).getTime();
    const inboundAt = new Date(envelope.date).getTime();
    return Number.isFinite(sentAt) && Number.isFinite(inboundAt) && sentAt > inboundAt;
  });
}

async function buildReplyTask(envelope: EmailEnvelope): Promise<OperatorTaskInsert | null> {
  const senderRule = extractSenderRule(envelope.from);
  if (!senderRule) return null;
  if (hoursAgo(envelope.date) < 24) return null;

  const replied = await hasSentReply(envelope);
  if (replied) return null;

  const message = await readEmail(envelope.id);
  if (!message) return null;

  return {
    task_type: "email_draft_response",
    title: `Draft reply to ${senderRule.name} re: ${envelope.subject}`,
    description: `No sent reply found after 24h for tracked sender ${senderRule.name}.`,
    priority: senderRule.priority,
    source: "gap_detector:email",
    assigned_to: "abra",
    requires_approval: true,
    execution_params: {
      natural_key: buildNaturalKey(["email_draft_response", envelope.id]),
      message_id: envelope.id,
      thread_id: envelope.threadId,
      sender: envelope.from,
      sender_email: extractEmailAddress(envelope.from),
      subject: envelope.subject,
      body_preview: buildBodyPreview(message.body || envelope.snippet || ""),
    },
    tags: ["email", "approval", "reply"],
  };
}

async function buildFinancialTask(envelope: EmailEnvelope): Promise<OperatorTaskInsert | null> {
  const message = await readEmail(envelope.id);
  if (!message) return null;

  const content = `${message.subject}\n${message.body}`;
  if (!FINANCIAL_EMAIL_PATTERN.test(content)) return null;

  const amount = extractAmount(content);
  if (!amount) return null;

  return {
    task_type: "qbo_record_from_email",
    title: `Record ${extractSenderRule(envelope.from)?.name || extractEmailAddress(envelope.from)} invoice/payment from email`,
    description: `Financial email appears to reference a recordable payment or invoice.`,
    priority: amount > 500 ? "high" : "medium",
    source: "gap_detector:email",
    assigned_to: "abra",
    requires_approval: amount > 500,
    execution_params: {
      natural_key: buildNaturalKey(["qbo_record_from_email", envelope.id, amount.toFixed(2)]),
      message_id: envelope.id,
      thread_id: envelope.threadId,
      vendor: extractSenderRule(envelope.from)?.name || extractEmailAddress(envelope.from),
      amount,
      date: extractDate(content, envelope.date),
      description: message.subject || "Email financial record",
      sender_email: extractEmailAddress(envelope.from),
      body_preview: buildBodyPreview(message.body || envelope.snippet || ""),
    },
    tags: ["email", "qbo", "finance"],
  };
}

export async function detectEmailOperatorGaps(): Promise<EmailGapDetectorResult> {
  const emails = await listEmails({
    folder: "INBOX",
    count: 100,
    query: "newer_than:2d",
  });

  const replyTasks: OperatorTaskInsert[] = [];
  const qboEmailTasks: OperatorTaskInsert[] = [];

  for (const envelope of emails) {
    const senderRule = extractSenderRule(envelope.from);
    if (senderRule) {
      await updateEntityFromEvent(senderRule.name, {
        type: "email_received",
        summary: envelope.subject || envelope.snippet || "Email received",
        date: envelope.date.slice(0, 10),
        channel: "email",
      }).catch(() => {});
    }
    const replyTask = await buildReplyTask(envelope);
    if (replyTask) replyTasks.push(replyTask);

    const qboTask = await buildFinancialTask(envelope);
    if (qboTask) qboEmailTasks.push(qboTask);
  }

  return {
    tasks: [...replyTasks, ...qboEmailTasks],
    summary: {
      replyTasks: replyTasks.length,
      qboEmailTasks: qboEmailTasks.length,
    },
  };
}
