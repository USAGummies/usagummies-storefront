/**
 * DOCS — Document Processing Hub for USA Gummies
 *
 * Unified pipeline for extracting structured data from:
 *   - PDFs (invoices, POs, statements)
 *   - Images (receipts, mileage photos)
 *   - Audio (voice memos from Slack)
 *
 * Handles: DOCREADER, TRANSCRIBER, RECEIPT PROCESSOR, INVOICE WATCHER
 *
 * Data persisted in Vercel KV under docs:* keys.
 */

import { kv } from "@vercel/kv";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DocType = "pdf" | "image" | "audio" | "unknown";

export interface ExtractedDocument {
  id: string;
  source_url: string;
  source_type: "gmail" | "slack" | "upload";
  doc_type: DocType;
  vendor?: string;
  date?: string;
  amount?: number;
  line_items?: ExtractedLineItem[];
  payment_terms?: string;
  payment_method?: string;
  category?: string;
  raw_text: string;
  confidence: "high" | "medium" | "low";
  processed_at: string;
  notes?: string;
}

export interface ExtractedLineItem {
  description: string;
  quantity?: number;
  unit_price?: number;
  total: number;
}

export interface TranscriptRecord {
  id: string;
  source_url: string;
  source_channel?: string;
  source_user?: string;
  audio_duration_seconds?: number;
  transcript: string;
  speaker?: string;
  topic?: string;
  action_items?: string[];
  processed_at: string;
}

export interface ReceiptRecord {
  id: string;
  source_url: string;
  source_channel: string;
  vendor?: string;
  date?: string;
  amount?: number;
  payment_method?: string;
  category?: string;
  subcategory?: string;
  mileage?: { start: number; end: number; total: number; rate: number; deduction: number };
  ledger_entry_id?: string; // linked to LEDGER entry if staged
  status: "needs_review" | "ready";
  missing_fields?: string[];
  processed_at: string;
  notes?: string;
}

export interface InvoiceWatchRule {
  id: string;
  vendor_name: string;
  vendor_email_patterns: string[]; // e.g. ["@albanese.com", "albanese"]
  auto_extract: boolean;
  auto_stage_entry: boolean;
  default_category?: string;
  default_debit_account?: string;
  default_credit_account?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// KV Keys
// ---------------------------------------------------------------------------

const KV_EXTRACTED_DOCS = "docs:extracted";
const KV_TRANSCRIPTS = "docs:transcripts";
const KV_RECEIPTS = "docs:receipts";
const KV_INVOICE_RULES = "docs:invoice_watch_rules";

// ---------------------------------------------------------------------------
// Document Extraction
// ---------------------------------------------------------------------------

/**
 * Extract structured data from a document URL (PDF, image).
 * Uses fetch to download, then parses text content.
 * For enhanced extraction, can call an AI API if OPENAI_API_KEY is set.
 */
export async function extractDocument(input: {
  source_url: string;
  source_type: "gmail" | "slack" | "upload";
  doc_type?: DocType;
  vendor_hint?: string;
}): Promise<ExtractedDocument> {
  const now = new Date().toISOString();
  const id = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  let rawText = "";
  let vendor: string | undefined;
  let date: string | undefined;
  let amount: number | undefined;
  let lineItems: ExtractedLineItem[] | undefined;
  let paymentTerms: string | undefined;
  let confidence: "high" | "medium" | "low" = "low";

  try {
    // Attempt to fetch and read the document
    const res = await fetch(input.source_url, {
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      rawText = `Failed to fetch document: ${res.status}`;
    } else {
      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("text") || contentType.includes("json")) {
        rawText = await res.text();
      } else {
        // Binary content — store metadata
        const buffer = await res.arrayBuffer();
        rawText = `[Binary content: ${contentType}, ${buffer.byteLength} bytes]`;
      }
    }

    // Basic pattern extraction from text
    if (rawText.length > 0 && !rawText.startsWith("[Binary")) {
      // Try to extract vendor
      vendor = input.vendor_hint || extractVendorFromText(rawText);

      // Try to extract date
      const dateMatch = rawText.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/);
      if (dateMatch) date = dateMatch[1];

      // Try to extract total amount
      const amountMatch = rawText.match(/(?:total|amount|balance)[:\s]*\$?([\d,]+\.?\d{0,2})/i);
      if (amountMatch) amount = parseFloat(amountMatch[1].replace(",", ""));

      // Try to extract payment terms
      const termsMatch = rawText.match(/(?:terms?|net|due)[:\s]*(net\s*\d+|due\s+on\s+receipt|cod|prepaid)/i);
      if (termsMatch) paymentTerms = termsMatch[1];

      confidence = vendor && amount ? "medium" : "low";
    }
  } catch (err) {
    rawText = `Extraction error: ${err instanceof Error ? err.message : String(err)}`;
  }

  const doc: ExtractedDocument = {
    id,
    source_url: input.source_url,
    source_type: input.source_type,
    doc_type: input.doc_type || "unknown",
    vendor,
    date,
    amount,
    line_items: lineItems,
    payment_terms: paymentTerms,
    raw_text: rawText.slice(0, 5000),
    confidence,
    processed_at: now,
  };

  // Persist
  const all = (await kv.get<ExtractedDocument[]>(KV_EXTRACTED_DOCS)) || [];
  all.push(doc);
  if (all.length > 500) all.splice(0, all.length - 500);
  await kv.set(KV_EXTRACTED_DOCS, all);

  return doc;
}

function extractVendorFromText(text: string): string | undefined {
  const knownVendors = [
    "Albanese", "Belmark", "Powers", "King Henry",
    "NinjaPrintHouse", "Pirate Ship", "Shopify", "Amazon",
    "Dutch Valley", "Shaffer", "ARCO", "Costco",
  ];

  const lowerText = text.toLowerCase();
  for (const v of knownVendors) {
    if (lowerText.includes(v.toLowerCase())) return v;
  }
  return undefined;
}

export async function listExtractedDocs(
  filters?: { vendor?: string; limit?: number }
): Promise<ExtractedDocument[]> {
  const all = (await kv.get<ExtractedDocument[]>(KV_EXTRACTED_DOCS)) || [];
  let filtered = all;
  if (filters?.vendor) {
    const v = filters.vendor.toLowerCase();
    filtered = filtered.filter((d) => d.vendor?.toLowerCase().includes(v));
  }
  return filtered.slice(-(filters?.limit || 100));
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

/**
 * Transcribe an audio file. Stores the transcript for future reference.
 * Currently returns a placeholder if no transcription API key is configured.
 * Viktor has ElevenLabs speech-to-text; this endpoint provides server-side backup.
 */
export async function transcribeAudio(input: {
  source_url: string;
  source_channel?: string;
  source_user?: string;
  speaker?: string;
  topic?: string;
}): Promise<TranscriptRecord> {
  const now = new Date().toISOString();
  const id = `transcript-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  let transcript = "";
  let duration: number | undefined;
  const actionItems: string[] = [];

  try {
    // Check for OpenAI Whisper API
    const openaiKey = process.env.OPENAI_API_KEY;

    if (openaiKey) {
      // Download audio file
      const audioRes = await fetch(input.source_url, {
        signal: AbortSignal.timeout(60000),
      });

      if (audioRes.ok) {
        const audioBuffer = await audioRes.arrayBuffer();
        const blob = new Blob([audioBuffer]);

        // Call Whisper API
        const formData = new FormData();
        formData.append("file", blob, "audio.m4a");
        formData.append("model", "whisper-1");
        formData.append("language", "en");

        const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${openaiKey}` },
          body: formData,
          signal: AbortSignal.timeout(120000),
        });

        if (whisperRes.ok) {
          const data = (await whisperRes.json()) as { text: string; duration?: number };
          transcript = data.text;
          duration = data.duration;
        } else {
          transcript = `[Whisper API error: ${whisperRes.status}]`;
        }
      } else {
        transcript = `[Failed to download audio: ${audioRes.status}]`;
      }
    } else {
      transcript = `[No transcription API key configured. Set OPENAI_API_KEY for Whisper transcription. Viktor can transcribe via ElevenLabs and POST the result here.]`;
    }

    // Extract action items from transcript
    if (transcript.length > 0 && !transcript.startsWith("[")) {
      const sentences = transcript.split(/[.!?]+/);
      for (const s of sentences) {
        const lower = s.toLowerCase().trim();
        if (
          lower.includes("need to") ||
          lower.includes("make sure") ||
          lower.includes("don't forget") ||
          lower.includes("action item") ||
          lower.includes("follow up") ||
          lower.includes("we should") ||
          lower.includes("you should") ||
          lower.includes("let's")
        ) {
          actionItems.push(s.trim());
        }
      }
    }
  } catch (err) {
    transcript = `[Transcription error: ${err instanceof Error ? err.message : String(err)}]`;
  }

  const record: TranscriptRecord = {
    id,
    source_url: input.source_url,
    source_channel: input.source_channel,
    source_user: input.source_user,
    audio_duration_seconds: duration,
    transcript,
    speaker: input.speaker,
    topic: input.topic,
    action_items: actionItems.length > 0 ? actionItems : undefined,
    processed_at: now,
  };

  // Persist
  const all = (await kv.get<TranscriptRecord[]>(KV_TRANSCRIPTS)) || [];
  all.push(record);
  if (all.length > 200) all.splice(0, all.length - 200);
  await kv.set(KV_TRANSCRIPTS, all);

  return record;
}

export async function listTranscripts(
  filters?: { source_channel?: string; limit?: number }
): Promise<TranscriptRecord[]> {
  const all = (await kv.get<TranscriptRecord[]>(KV_TRANSCRIPTS)) || [];
  let filtered = all;
  if (filters?.source_channel) {
    filtered = filtered.filter((t) => t.source_channel === filters.source_channel);
  }
  return filtered.slice(-(filters?.limit || 50));
}

// ---------------------------------------------------------------------------
// Receipt Processing
// ---------------------------------------------------------------------------

export async function processReceipt(input: {
  source_url: string;
  source_channel: string;
  vendor?: string;
  date?: string;
  amount?: number;
  payment_method?: string;
  category?: string;
  subcategory?: string;
  mileage?: { start: number; end: number; total: number; rate: number; deduction: number };
  notes?: string;
  status?: "needs_review" | "ready";
}): Promise<ReceiptRecord> {
  const now = new Date().toISOString();
  const id = `receipt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const amount =
    typeof input.amount === "number" && Number.isFinite(input.amount)
      ? input.amount
      : undefined;
  const missingFields = [
    input.vendor ? null : "vendor",
    input.date ? null : "date",
    amount === undefined ? "amount" : null,
    input.category ? null : "category",
  ].filter(Boolean) as string[];
  const requestedStatus =
    input.status === "needs_review" || input.status === "ready"
      ? input.status
      : undefined;
  const status = requestedStatus || (missingFields.length > 0 ? "needs_review" : "ready");

  const record: ReceiptRecord = {
    id,
    source_url: input.source_url,
    source_channel: input.source_channel,
    vendor: input.vendor,
    date: input.date,
    amount,
    payment_method: input.payment_method,
    category: input.category,
    subcategory: input.subcategory,
    mileage: input.mileage,
    status,
    missing_fields: missingFields.length > 0 ? missingFields : undefined,
    processed_at: now,
    notes: input.notes,
  };

  const all = (await kv.get<ReceiptRecord[]>(KV_RECEIPTS)) || [];
  all.push(record);
  if (all.length > 500) all.splice(0, all.length - 500);
  await kv.set(KV_RECEIPTS, all);

  return record;
}

export async function listReceipts(
  filters?: {
    vendor?: string;
    category?: string;
    /** Narrow by review status. Accepts the same union as `ReceiptRecord.status`. */
    status?: ReceiptRecord["status"];
    limit?: number;
  }
): Promise<ReceiptRecord[]> {
  const all = (await kv.get<ReceiptRecord[]>(KV_RECEIPTS)) || [];
  let filtered = all;
  if (filters?.vendor) {
    const v = filters.vendor.toLowerCase();
    filtered = filtered.filter((r) => r.vendor?.toLowerCase().includes(v));
  }
  if (filters?.category) {
    filtered = filtered.filter((r) => r.category === filters.category);
  }
  if (filters?.status) {
    filtered = filtered.filter((r) => r.status === filters.status);
  }
  return filtered.slice(-(filters?.limit || 100));
}

export async function getReceiptSummary(): Promise<{
  total_receipts: number;
  needs_review: number;
  ready: number;
  total_amount: number;
  by_vendor: Record<string, { count: number; total: number }>;
  by_category: Record<string, { count: number; total: number }>;
}> {
  const all = (await kv.get<ReceiptRecord[]>(KV_RECEIPTS)) || [];
  const byVendor: Record<string, { count: number; total: number }> = {};
  const byCategory: Record<string, { count: number; total: number }> = {};
  let totalAmount = 0;
  let needsReview = 0;
  let ready = 0;

  for (const r of all) {
    const amount = typeof r.amount === "number" && Number.isFinite(r.amount) ? r.amount : 0;
    totalAmount += amount;
    if (r.status === "needs_review") needsReview++;
    if (r.status === "ready") ready++;
    const vendor = r.vendor || "UNREVIEWED";
    if (!byVendor[vendor]) byVendor[vendor] = { count: 0, total: 0 };
    byVendor[vendor].count++;
    byVendor[vendor].total += amount;
    const category = r.category || "unreviewed";
    if (!byCategory[category]) byCategory[category] = { count: 0, total: 0 };
    byCategory[category].count++;
    byCategory[category].total += amount;
  }

  return {
    total_receipts: all.length,
    needs_review: needsReview,
    ready,
    total_amount: totalAmount,
    by_vendor: byVendor,
    by_category: byCategory,
  };
}

// ---------------------------------------------------------------------------
// Invoice Watch Rules
// ---------------------------------------------------------------------------

export async function listInvoiceWatchRules(): Promise<InvoiceWatchRule[]> {
  return (await kv.get<InvoiceWatchRule[]>(KV_INVOICE_RULES)) || [];
}

export async function upsertInvoiceWatchRule(rule: InvoiceWatchRule): Promise<InvoiceWatchRule[]> {
  const all = (await kv.get<InvoiceWatchRule[]>(KV_INVOICE_RULES)) || [];
  const idx = all.findIndex((r) => r.id === rule.id);
  if (idx >= 0) {
    all[idx] = rule;
  } else {
    all.push(rule);
  }
  await kv.set(KV_INVOICE_RULES, all);
  return all;
}

export async function matchInvoiceRule(senderEmail: string): Promise<InvoiceWatchRule | null> {
  const rules = await listInvoiceWatchRules();
  const lower = senderEmail.toLowerCase();

  for (const rule of rules) {
    for (const pattern of rule.vendor_email_patterns) {
      if (lower.includes(pattern.toLowerCase())) return rule;
    }
  }
  return null;
}
