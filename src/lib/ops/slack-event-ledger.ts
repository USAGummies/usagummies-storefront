import { kv } from "@vercel/kv";

export interface SlackEventReceiptInput {
  eventId?: string;
  teamId?: string;
  eventType: string;
  channel?: string;
  messageTs?: string;
  subtype?: string;
  botIdPresent?: boolean;
  recognizedCommand?: string | null;
  skippedReason?: string | null;
  text?: string | null;
}

export interface SlackEventReceipt {
  id: string;
  eventId?: string;
  teamId?: string;
  eventType: string;
  channel?: string;
  messageTs?: string;
  subtype?: string;
  botIdPresent: boolean;
  recognized: boolean;
  recognizedCommand?: string;
  skippedReason?: string;
  textSnippet?: string;
  createdAt: string;
}

const INDEX_KEY = "ops:slack-events:index";
const RECORD_PREFIX = "ops:slack-events:";
const INDEX_CAP = 500;
const SNIPPET_MAX = 180;

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, SNIPPET_MAX);
}

function receiptId(input: SlackEventReceiptInput, createdAt: string): string {
  const eventPart = input.eventId?.trim();
  if (eventPart) return `slackevt_${eventPart}`;
  const channel = input.channel?.trim() || "unknown-channel";
  const ts = input.messageTs?.trim() || createdAt;
  return `slackevt_${channel}_${ts}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

export async function appendSlackEventReceipt(
  input: SlackEventReceiptInput,
  options: { now?: Date } = {},
): Promise<SlackEventReceipt> {
  const createdAt = (options.now ?? new Date()).toISOString();
  const recognizedCommand = input.recognizedCommand?.trim() || undefined;
  const skippedReason = input.skippedReason?.trim() || undefined;
  const textSnippet =
    typeof input.text === "string" && input.text.trim()
      ? compactText(input.text)
      : undefined;
  const record: SlackEventReceipt = {
    id: receiptId(input, createdAt),
    eventId: input.eventId?.trim() || undefined,
    teamId: input.teamId?.trim() || undefined,
    eventType: input.eventType.trim() || "unknown",
    channel: input.channel?.trim() || undefined,
    messageTs: input.messageTs?.trim() || undefined,
    subtype: input.subtype?.trim() || undefined,
    botIdPresent: Boolean(input.botIdPresent),
    recognized: Boolean(recognizedCommand),
    recognizedCommand,
    skippedReason,
    textSnippet,
    createdAt,
  };
  await kv.set(`${RECORD_PREFIX}${record.id}`, record);
  const existing = ((await kv.get<string[]>(INDEX_KEY)) ?? []).filter(
    (id) => id !== record.id,
  );
  await kv.set(INDEX_KEY, [record.id, ...existing].slice(0, INDEX_CAP));
  return record;
}

export async function listSlackEventReceipts(
  options: { limit?: number } = {},
): Promise<SlackEventReceipt[]> {
  const limit = Math.max(1, Math.min(100, options.limit ?? 25));
  const ids = ((await kv.get<string[]>(INDEX_KEY)) ?? []).slice(0, limit);
  const rows: SlackEventReceipt[] = [];
  for (const id of ids) {
    const row = await kv.get<SlackEventReceipt>(`${RECORD_PREFIX}${id}`);
    if (row) rows.push(row);
  }
  return rows;
}
