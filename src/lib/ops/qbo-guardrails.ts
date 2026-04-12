/**
 * QBO GUARDRAILS — Pre-commit validation, dry run, and audit logging
 *
 * Intercepts all QBO write operations to:
 * 1. Validate amounts (flag negatives, >$10K, zero-amount lines)
 * 2. Detect duplicates (same vendor/customer + amount within 30 days)
 * 3. Enforce required fields per entity type
 * 4. Support dry_run mode (validate without executing)
 * 5. Log every write attempt to audit trail (Vercel KV)
 *
 * This prevents: fake invoices, accidental payments, duplicate entries,
 * and writes to production data during API exploration.
 */

import { kv } from "@vercel/kv";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QBOEntityType =
  | "invoice"
  | "bill"
  | "payment"
  | "bill-payment"
  | "purchaseorder"
  | "estimate"
  | "journal-entry"
  | "deposit"
  | "transfer"
  | "purchase"
  | "account"
  | "salesreceipt";

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  field?: string;
}

export interface ValidationResult {
  valid: boolean;
  dry_run: boolean;
  issues: ValidationIssue[];
  entity_type: QBOEntityType;
  amount?: number;
  summary: string;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  entity_type: QBOEntityType;
  action: "create" | "update" | "void" | "delete";
  endpoint: string;
  amount?: number;
  vendor_or_customer?: string;
  ref_number?: string;
  dry_run: boolean;
  validation_passed: boolean;
  issues: ValidationIssue[];
  result_id?: string; // QBO entity ID if write succeeded
  error?: string;
  caller: string; // "viktor" or "manual"
}

// ---------------------------------------------------------------------------
// KV Keys
// ---------------------------------------------------------------------------

const KV_AUDIT_LOG = "qbo:audit_log";
const KV_RECENT_WRITES = "qbo:recent_writes"; // for dedup checks

// ---------------------------------------------------------------------------
// Amount extraction from QBO payloads
// ---------------------------------------------------------------------------

function extractAmount(body: Record<string, unknown>): number | undefined {
  // Direct amount fields
  if (typeof body.TotalAmt === "number") return body.TotalAmt;
  if (typeof body.Amount === "number") return body.Amount;

  // Sum line items
  if (Array.isArray(body.Line)) {
    const lineTotal = (body.Line as Array<{ Amount?: number }>)
      .reduce((sum, line) => sum + (typeof line.Amount === "number" ? line.Amount : 0), 0);
    if (lineTotal > 0) return lineTotal;
  }

  return undefined;
}

function extractRef(body: Record<string, unknown>): string | undefined {
  if (typeof body.DocNumber === "string") return body.DocNumber;
  return undefined;
}

function extractVendorOrCustomer(body: Record<string, unknown>): string | undefined {
  const vendorRef = body.VendorRef as { value?: string; name?: string } | undefined;
  const customerRef = body.CustomerRef as { value?: string; name?: string } | undefined;
  if (vendorRef?.name) return vendorRef.name;
  if (vendorRef?.value) return `vendor:${vendorRef.value}`;
  if (customerRef?.name) return customerRef.name;
  if (customerRef?.value) return `customer:${customerRef.value}`;
  return undefined;
}

// ---------------------------------------------------------------------------
// Validation Rules
// ---------------------------------------------------------------------------

function validateAmount(amount: number | undefined, entityType: QBOEntityType): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (amount === undefined) return issues;

  if (amount < 0) {
    issues.push({
      severity: "error",
      code: "NEGATIVE_AMOUNT",
      message: `Negative amount ($${amount}). QBO amounts should be positive — use void/credit for reversals.`,
      field: "amount",
    });
  }

  if (amount === 0 && !["account", "journal-entry"].includes(entityType)) {
    issues.push({
      severity: "warning",
      code: "ZERO_AMOUNT",
      message: "Zero-amount transaction. Is this intentional?",
      field: "amount",
    });
  }

  if (amount > 100000) {
    issues.push({
      severity: "error",
      code: "AMOUNT_EXTREMELY_HIGH",
      message: `Amount $${amount.toLocaleString()} exceeds $100K safety limit. This is almost certainly an error for USA Gummies.`,
      field: "amount",
    });
  } else if (amount > 10000) {
    issues.push({
      severity: "warning",
      code: "AMOUNT_HIGH",
      message: `Amount $${amount.toLocaleString()} exceeds $10K — flagged for review. Our largest PO was ~$50K (Powers).`,
      field: "amount",
    });
  }

  return issues;
}

function validateRequiredFields(body: Record<string, unknown>, entityType: QBOEntityType): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const vendorEntities: QBOEntityType[] = ["bill", "bill-payment", "purchaseorder"];
  const customerEntities: QBOEntityType[] = ["invoice", "payment", "estimate", "salesreceipt"];

  if (vendorEntities.includes(entityType) && !body.VendorRef) {
    issues.push({
      severity: "error",
      code: "MISSING_VENDOR",
      message: "VendorRef is required for this transaction type.",
      field: "VendorRef",
    });
  }

  if (customerEntities.includes(entityType) && !body.CustomerRef) {
    issues.push({
      severity: "error",
      code: "MISSING_CUSTOMER",
      message: "CustomerRef is required for this transaction type.",
      field: "CustomerRef",
    });
  }

  if (["invoice", "bill", "purchaseorder", "estimate", "salesreceipt"].includes(entityType)) {
    if (!Array.isArray(body.Line) || body.Line.length === 0) {
      issues.push({
        severity: "error",
        code: "MISSING_LINES",
        message: "At least one line item is required.",
        field: "Line",
      });
    }
  }

  // ── PO-SPECIFIC REQUIRED FIELDS (per Rene's process gates) ──
  if (entityType === "purchaseorder") {
    if (!body.DueDate) {
      issues.push({
        severity: "error",
        code: "PO_MISSING_DUE_DATE",
        message: "POs require a DueDate (expected delivery date). Calculate from terms or set explicitly.",
        field: "DueDate",
      });
    }
    if (!body.ShipAddr) {
      issues.push({
        severity: "error",
        code: "PO_MISSING_SHIP_TO",
        message: "POs require a ship-to address. Where is this being delivered?",
        field: "ShipAddr",
      });
    }
    if (!body.Memo && !body.CustomerMemo) {
      issues.push({
        severity: "warning",
        code: "PO_MISSING_MEMO",
        message: "POs should include a memo with payment terms and reference to the vendor email/agreement.",
        field: "Memo",
      });
    }
  }

  // ── INVOICE-SPECIFIC FIELDS ──
  if (entityType === "invoice") {
    if (!body.DueDate) {
      issues.push({
        severity: "warning",
        code: "INVOICE_MISSING_DUE_DATE",
        message: "Invoice should have a DueDate for AR tracking. Defaults to Net 30 if unset.",
        field: "DueDate",
      });
    }
  }

  return issues;
}

async function checkDuplicates(
  amount: number | undefined,
  vendorOrCustomer: string | undefined,
  entityType: QBOEntityType,
): Promise<ValidationIssue[]> {
  if (!amount || !vendorOrCustomer) return [];

  const issues: ValidationIssue[] = [];

  try {
    const recent = (await kv.get<Array<{
      amount: number;
      vendor_or_customer: string;
      entity_type: string;
      timestamp: string;
    }>>(KV_RECENT_WRITES)) || [];

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const matches = recent.filter((r) =>
      r.amount === amount &&
      r.vendor_or_customer === vendorOrCustomer &&
      r.entity_type === entityType &&
      new Date(r.timestamp).getTime() > thirtyDaysAgo
    );

    if (matches.length > 0) {
      const lastMatch = matches[matches.length - 1];
      issues.push({
        severity: "warning",
        code: "POSSIBLE_DUPLICATE",
        message: `Same ${entityType} for ${vendorOrCustomer} @ $${amount} was created on ${lastMatch.timestamp.split("T")[0]}. Possible duplicate.`,
      });
    }
  } catch {
    // Dedup check failure is non-blocking
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Main Validation Function
// ---------------------------------------------------------------------------

/**
 * Validate a QBO write operation before execution.
 * Returns { valid, issues, dry_run, summary }.
 *
 * If dry_run is true, the caller should NOT execute the write.
 * If valid is false, the caller should NOT execute the write.
 */
export async function validateQBOWrite(
  entityType: QBOEntityType,
  body: Record<string, unknown>,
  options?: { dry_run?: boolean; caller?: string },
): Promise<ValidationResult> {
  const dryRun = options?.dry_run || false;
  const amount = extractAmount(body);
  const vendorOrCustomer = extractVendorOrCustomer(body);
  const allIssues: ValidationIssue[] = [];

  // Run all validation checks
  allIssues.push(...validateAmount(amount, entityType));
  allIssues.push(...validateRequiredFields(body, entityType));
  allIssues.push(...(await checkDuplicates(amount, vendorOrCustomer, entityType)));

  const hasErrors = allIssues.some((i) => i.severity === "error");
  const hasWarnings = allIssues.some((i) => i.severity === "warning");
  const valid = !hasErrors;

  let summary: string;
  if (dryRun) {
    summary = `DRY RUN: ${entityType} for ${vendorOrCustomer || "unknown"}` +
      (amount !== undefined ? ` @ $${amount}` : "") +
      `. ${allIssues.length} issues found. No write executed.`;
  } else if (!valid) {
    summary = `BLOCKED: ${entityType} has ${allIssues.filter((i) => i.severity === "error").length} errors. Fix before retrying.`;
  } else if (hasWarnings) {
    summary = `APPROVED WITH WARNINGS: ${entityType} for ${vendorOrCustomer || "unknown"}` +
      (amount !== undefined ? ` @ $${amount}` : "") +
      `. ${allIssues.filter((i) => i.severity === "warning").length} warnings.`;
  } else {
    summary = `APPROVED: ${entityType} for ${vendorOrCustomer || "unknown"}` +
      (amount !== undefined ? ` @ $${amount}` : "");
  }

  return { valid, dry_run: dryRun, issues: allIssues, entity_type: entityType, amount, summary };
}

// ---------------------------------------------------------------------------
// Audit Logging
// ---------------------------------------------------------------------------

/**
 * Log a QBO write attempt to the audit trail.
 * Called AFTER validation (and optionally after execution).
 */
export async function logQBOAudit(entry: Omit<AuditEntry, "id" | "timestamp">): Promise<AuditEntry> {
  const full: AuditEntry = {
    ...entry,
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
  };

  try {
    const log = (await kv.get<AuditEntry[]>(KV_AUDIT_LOG)) || [];
    log.push(full);

    // Keep last 500 entries
    if (log.length > 500) log.splice(0, log.length - 500);
    await kv.set(KV_AUDIT_LOG, log);

    // Also track for dedup
    if (entry.amount && entry.vendor_or_customer && !entry.dry_run && entry.validation_passed) {
      const recent = (await kv.get<Array<{
        amount: number;
        vendor_or_customer: string;
        entity_type: string;
        timestamp: string;
      }>>(KV_RECENT_WRITES)) || [];

      recent.push({
        amount: entry.amount,
        vendor_or_customer: entry.vendor_or_customer,
        entity_type: entry.entity_type,
        timestamp: full.timestamp,
      });

      // Keep last 200 entries for dedup window
      if (recent.length > 200) recent.splice(0, recent.length - 200);
      await kv.set(KV_RECENT_WRITES, recent);
    }
  } catch (err) {
    console.error("[qbo-guardrails] Audit log write failed:", err instanceof Error ? err.message : err);
  }

  return full;
}

/**
 * Get audit log entries.
 */
export async function getQBOAuditLog(
  filters?: { entity_type?: QBOEntityType; limit?: number; errors_only?: boolean }
): Promise<AuditEntry[]> {
  const all = (await kv.get<AuditEntry[]>(KV_AUDIT_LOG)) || [];
  let filtered = all;

  if (filters?.entity_type) {
    filtered = filtered.filter((e) => e.entity_type === filters.entity_type);
  }
  if (filters?.errors_only) {
    filtered = filtered.filter((e) => !e.validation_passed || e.error);
  }

  return filtered.slice(-(filters?.limit || 100));
}

// ---------------------------------------------------------------------------
// Alert Dedup Registry
// ---------------------------------------------------------------------------

const KV_ALERT_DEDUP = "alerts:dedup";

interface AlertRecord {
  hash: string;
  channel: string;
  sent_at: string;
}

function hashAlert(content: string, channel: string): string {
  // Simple hash — normalize whitespace/numbers for fuzzy matching
  const normalized = content
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}/g, "DATE") // normalize dates
    .replace(/\$[\d,.]+/g, "AMOUNT") // normalize dollar amounts
    .replace(/\s+/g, " ")
    .trim();

  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `${channel}:${hash}`;
}

/**
 * Check if an alert with similar content was already sent within the TTL window.
 * Returns true if the alert should be SKIPPED (duplicate).
 */
export async function isAlertDuplicate(
  content: string,
  channel: string,
  ttlHours: number = 8,
): Promise<{ duplicate: boolean; last_sent?: string }> {
  const hash = hashAlert(content, channel);

  try {
    const records = (await kv.get<AlertRecord[]>(KV_ALERT_DEDUP)) || [];
    const cutoff = Date.now() - ttlHours * 60 * 60 * 1000;

    const match = records.find(
      (r) => r.hash === hash && new Date(r.sent_at).getTime() > cutoff
    );

    if (match) {
      return { duplicate: true, last_sent: match.sent_at };
    }
  } catch { /* non-blocking */ }

  return { duplicate: false };
}

/**
 * Record that an alert was sent (for future dedup checks).
 */
export async function recordAlertSent(
  content: string,
  channel: string,
): Promise<void> {
  const hash = hashAlert(content, channel);

  try {
    const records = (await kv.get<AlertRecord[]>(KV_ALERT_DEDUP)) || [];
    records.push({ hash, channel, sent_at: new Date().toISOString() });

    // Keep last 500 records, prune old ones
    const cutoff = Date.now() - 48 * 60 * 60 * 1000; // 48h window
    const pruned = records.filter((r) => new Date(r.sent_at).getTime() > cutoff);
    if (pruned.length > 500) pruned.splice(0, pruned.length - 500);

    await kv.set(KV_ALERT_DEDUP, pruned);
  } catch { /* non-blocking */ }
}
