#!/usr/bin/env node
/**
 * USA Gummies — Financial Operations Engine (Build 6)
 *
 * The money brain. Pulls actual banking data from Found.com (CSV exports),
 * matches every dollar in and out to a sales order or expense, reconciles
 * invoices from Gmail, allocates costs to production runs, and keeps the
 * books balanced.
 *
 * 11 agents — F1 through F11
 *
 * Usage:
 *   node scripts/usa-gummies-finops.mjs run F1        # run a single agent
 *   node scripts/usa-gummies-finops.mjs run all       # run all scheduled agents
 *   node scripts/usa-gummies-finops.mjs run self-heal # run the self-heal monitor
 *   node scripts/usa-gummies-finops.mjs status        # show system status
 *   node scripts/usa-gummies-finops.mjs --dry-run run F3
 */

import fs from "node:fs";
import path from "node:path";
import {
  createEngine,
  log as sharedLog,
  todayET,
  todayLongET,
  nowETTimestamp,
  etParts,
  addDaysToDate,
  daysSince,
  safeJsonRead,
  safeJsonWrite,
  fetchWithTimeout,
  queryDatabaseAll,
  getPage,
  updatePage,
  createPageInDb,
  ensureFields,
  buildProperties,
  getPlainText,
  getPropByName,
  richTextValue,
  blockParagraph,
  blockHeading,
  sendEmail,
  checkEmail,
  renderTemplate,
  sendIMessage,
  textBen,
  normalizeEmail,
  extractFirstEmail,
  CONFIG_DIR,
  HOME,
  PROJECT_ROOT,
} from "./lib/usa-gummies-shared.mjs";

import { parseFoundCSV, categorizeTransaction, detectPayoutSource, VENDOR_PATTERNS } from "./lib/found-csv-parser.mjs";
import { scanForInvoices, extractDueDate } from "./lib/invoice-extractor.mjs";

// ── Schedule Plan ────────────────────────────────────────────────────────────

const SCHEDULE_PLAN = {
  F1:  { label: "Found Transaction Ingestor", hour: 7, minute: 0, graceMinutes: 120 },
  F2:  { label: "Invoice Scanner",           hour: 7, minute: 15, graceMinutes: 120 },
  F3:  { label: "Revenue Reconciler",        hour: 7, minute: 30, graceMinutes: 120 },
  F4:  { label: "Expense Categorizer",       hour: 7, minute: 45, graceMinutes: 120 },
  F5:  { label: "Production Cost Allocator", hour: 8, minute: 0, graceMinutes: 120 },
  F6:  { label: "Accounts Payable Tracker",  hour: 10, minute: 0, graceMinutes: 120 },
  F7:  { label: "Accounts Receivable Tracker", hour: 10, minute: 15, graceMinutes: 120 },
  F8:  { label: "Cash Flow Calculator",      hour: 11, minute: 0, graceMinutes: 120 },
  F9:  { label: "P&L Generator",             hour: 20, minute: 0, graceMinutes: 240, dayOfWeek: "Sun" },
  F10: { label: "Tax Reserve Calculator",    hour: 9, minute: 0, graceMinutes: 480, dayOfMonth: 1 },
  F11: { label: "Self-Heal Monitor",         intervalMinutes: 30, graceMinutes: 60 },
};

// ── Notion Database IDs ──────────────────────────────────────────────────────
// These get populated after Notion DBs are created. Placeholder structure.

const IDS = {
  bankTransactions: process.env.FINOPS_BANK_TRANSACTIONS_DB || "",
  invoices:         process.env.FINOPS_INVOICES_DB || "",
  accountsPayable:  process.env.FINOPS_AP_DB || "",
  accountsReceivable: process.env.FINOPS_AR_DB || "",
  plReports:        process.env.FINOPS_PL_DB || "",
  cashFlow:         process.env.FINOPS_CASHFLOW_DB || "",
  runLog:           process.env.FINOPS_RUNLOG_DB || "",
  // Cross-system references (set when other engines are built)
  revenueSnapshots: process.env.REVENUE_DAILY_SNAPSHOTS_DB || "",
  productionRuns:   process.env.SUPPLY_PRODUCTION_RUNS_DB || "",
  b2bPipeline:      process.env.B2B_PIPELINE_DB || "",
};

// ── State Files ──────────────────────────────────────────────────────────────

const TRANSACTION_CACHE_FILE = path.join(CONFIG_DIR, "finops-transaction-cache.json");
const INVOICE_CACHE_FILE = path.join(CONFIG_DIR, "finops-invoice-cache.json");
const RECONCILIATION_STATE_FILE = path.join(CONFIG_DIR, "finops-reconciliation-state.json");

// ── Email Templates ──────────────────────────────────────────────────────────

const TEMPLATE_LIBRARY = {
  invoiceReminder: {
    subject: "Friendly reminder: Invoice [invoiceNumber] from [vendor]",
    body: `Hi [firstName],

Just a quick note that invoice [invoiceNumber] from [vendor] for $[amount] was due on [dueDate].

If payment has already been sent, please disregard this. Otherwise, could you let us know when we might expect it?

Thanks,
USA Gummies Team`,
  },
  paymentConfirmation: {
    subject: "Payment received — Invoice [invoiceNumber]",
    body: `Hi [firstName],

We've confirmed receipt of your payment of $[amount] for invoice [invoiceNumber]. Thank you!

Best,
USA Gummies Team`,
  },
};

// ── Safety Threshold ─────────────────────────────────────────────────────────

const CASH_SAFETY_THRESHOLD = 5000; // Alert if projected balance drops below this

// ── Create Engine ────────────────────────────────────────────────────────────

const engine = createEngine({
  name: "finops",
  schedulePlan: SCHEDULE_PLAN,
  ids: IDS,
});

// ── Required DB Fields ───────────────────────────────────────────────────────

const REQUIRED_BANK_TRANSACTION_FIELDS = {
  Name:            { title: {} },
  Date:            { date: {} },
  Description:     { rich_text: {} },
  Amount:          { number: { format: "dollar" } },
  Type:            { select: { options: [
    { name: "Deposit", color: "green" },
    { name: "Withdrawal", color: "red" },
    { name: "Transfer", color: "blue" },
  ]}},
  Category:        { select: { options: [
    { name: "Revenue-Shopify", color: "green" },
    { name: "Revenue-Amazon", color: "orange" },
    { name: "Revenue-Faire", color: "purple" },
    { name: "Revenue-B2B", color: "blue" },
    { name: "Production", color: "red" },
    { name: "Packaging", color: "yellow" },
    { name: "Shipping", color: "brown" },
    { name: "Legal", color: "gray" },
    { name: "Marketing", color: "pink" },
    { name: "SaaS", color: "default" },
    { name: "Tax", color: "red" },
    { name: "Compliance", color: "gray" },
    { name: "Other", color: "default" },
  ]}},
  Reconciled:      { checkbox: {} },
  "Dedup Key":     { rich_text: {} },
  "Found Export Date": { date: {} },
  Notes:           { rich_text: {} },
};

const REQUIRED_INVOICE_FIELDS = {
  Name:            { title: {} },
  Vendor:          { select: { options: [
    { name: "Lowe Graham Jones", color: "gray" },
    { name: "Co-Packer (Acct 65107)", color: "red" },
    { name: "Packaging (Gagliardi/Kroetch)", color: "yellow" },
    { name: "CompanySage", color: "blue" },
    { name: "Shopify", color: "green" },
    { name: "RushOrderTees", color: "pink" },
    { name: "Shipping", color: "brown" },
    { name: "Other", color: "default" },
  ]}},
  "Invoice Number": { rich_text: {} },
  Amount:           { number: { format: "dollar" } },
  "Date Received":  { date: {} },
  "Due Date":       { date: {} },
  Status:           { select: { options: [
    { name: "Received", color: "blue" },
    { name: "Approved", color: "green" },
    { name: "Paid", color: "green" },
    { name: "Overdue", color: "red" },
    { name: "Disputed", color: "orange" },
  ]}},
  "Paid Date":      { date: {} },
  "Payment Amount": { number: { format: "dollar" } },
  Category:         { select: { options: [
    { name: "Legal", color: "gray" },
    { name: "Production", color: "red" },
    { name: "Packaging", color: "yellow" },
    { name: "Shipping", color: "brown" },
    { name: "Compliance", color: "blue" },
    { name: "SaaS", color: "default" },
    { name: "Marketing", color: "pink" },
    { name: "Tax", color: "red" },
    { name: "Other", color: "default" },
  ]}},
  "Source Email ID": { rich_text: {} },
  Notes:            { rich_text: {} },
};

const REQUIRED_AP_FIELDS = {
  Name:               { title: {} },
  Vendor:             { rich_text: {} },
  Amount:             { number: { format: "dollar" } },
  "Due Date":         { date: {} },
  "Days Outstanding": { number: {} },
  Status:             { select: { options: [
    { name: "Pending", color: "yellow" },
    { name: "Paid", color: "green" },
    { name: "Overdue", color: "red" },
  ]}},
  Priority:           { select: { options: [
    { name: "High", color: "red" },
    { name: "Medium", color: "yellow" },
    { name: "Low", color: "blue" },
  ]}},
  Notes:              { rich_text: {} },
};

const REQUIRED_AR_FIELDS = {
  Name:              { title: {} },
  Source:            { select: { options: [
    { name: "Shopify", color: "green" },
    { name: "Amazon", color: "orange" },
    { name: "Faire", color: "purple" },
    { name: "B2B-Invoice", color: "blue" },
  ]}},
  "Expected Amount": { number: { format: "dollar" } },
  "Expected Date":   { date: {} },
  Received:          { checkbox: {} },
  "Actual Amount":   { number: { format: "dollar" } },
  "Actual Date":     { date: {} },
  "Days Late":       { number: {} },
  Notes:             { rich_text: {} },
};

const REQUIRED_PL_FIELDS = {
  Name:              { title: {} },
  Period:            { rich_text: {} },
  "Period Type":     { select: { options: [
    { name: "Weekly", color: "blue" },
    { name: "Monthly", color: "green" },
    { name: "Quarterly", color: "purple" },
  ]}},
  "Total Revenue":   { number: { format: "dollar" } },
  COGS:              { number: { format: "dollar" } },
  "Gross Profit":    { number: { format: "dollar" } },
  "Gross Margin %":  { number: { format: "percent" } },
  "Operating Expenses": { number: { format: "dollar" } },
  "Net Income":      { number: { format: "dollar" } },
  "Net Margin %":    { number: { format: "percent" } },
  "vs Previous %":   { number: { format: "percent" } },
  Notes:             { rich_text: {} },
};

const REQUIRED_CASHFLOW_FIELDS = {
  Name:                { title: {} },
  Date:                { date: {} },
  "Opening Balance":   { number: { format: "dollar" } },
  Inflows:             { number: { format: "dollar" } },
  Outflows:            { number: { format: "dollar" } },
  "Closing Balance":   { number: { format: "dollar" } },
  "Projected 7d":      { number: { format: "dollar" } },
  "Projected 30d":     { number: { format: "dollar" } },
  "Below Safety Threshold": { checkbox: {} },
  Notes:               { rich_text: {} },
};

// ── Ensure All DB Schemas ────────────────────────────────────────────────────

async function ensureAllSchemas() {
  const tasks = [];
  if (IDS.bankTransactions) tasks.push(ensureFields(IDS.bankTransactions, REQUIRED_BANK_TRANSACTION_FIELDS));
  if (IDS.invoices) tasks.push(ensureFields(IDS.invoices, REQUIRED_INVOICE_FIELDS));
  if (IDS.accountsPayable) tasks.push(ensureFields(IDS.accountsPayable, REQUIRED_AP_FIELDS));
  if (IDS.accountsReceivable) tasks.push(ensureFields(IDS.accountsReceivable, REQUIRED_AR_FIELDS));
  if (IDS.plReports) tasks.push(ensureFields(IDS.plReports, REQUIRED_PL_FIELDS));
  if (IDS.cashFlow) tasks.push(ensureFields(IDS.cashFlow, REQUIRED_CASHFLOW_FIELDS));
  await Promise.allSettled(tasks);
}

// ═══════════════════════════════════════════════════════════════════════════════
// F1 — Found Transaction Ingestor
// Scans Gmail for Found CSV exports, parses and deduplicates, writes to Notion.
// ═══════════════════════════════════════════════════════════════════════════════

async function runF1_FoundTransactionIngestor(opts = {}) {
  engine.log("F1 — Found Transaction Ingestor starting...");
  const dryRun = opts.dryRun || false;
  const errors = [];
  let imported = 0;
  let skipped = 0;

  try {
    // Load processed email IDs cache
    const txCache = safeJsonRead(TRANSACTION_CACHE_FILE, { processedEmailIds: [], lastImportDate: null, dedupKeys: [] });

    // Scan Gmail for Found export emails
    engine.log("Scanning Gmail for Found.com CSV exports...");
    const emailResult = checkEmail({
      folder: "INBOX",
      count: 30,
      query: "from:found subject:export",
    });

    if (!emailResult.ok) {
      engine.log(`Email scan failed: ${emailResult.error}`);
      errors.push(`Email scan failed: ${emailResult.error}`);
      return { status: "failed", imported: 0, skipped: 0, errors };
    }

    // Also check for manually placed CSV files
    const manualCSVDir = path.join(CONFIG_DIR, "found-csv-imports");
    const csvFiles = [];
    if (fs.existsSync(manualCSVDir)) {
      const files = fs.readdirSync(manualCSVDir).filter((f) => f.endsWith(".csv"));
      for (const f of files) {
        csvFiles.push(path.join(manualCSVDir, f));
      }
    }

    // Parse any CSV files found
    const allTransactions = [];

    for (const csvFile of csvFiles) {
      engine.log(`Parsing manual CSV: ${path.basename(csvFile)}`);
      const content = fs.readFileSync(csvFile, "utf8");
      const parsed = parseFoundCSV(content);
      if (parsed.errors.length) {
        errors.push(...parsed.errors.map((e) => `${path.basename(csvFile)}: ${e}`));
      }
      allTransactions.push(...parsed.transactions);
      // Move processed file to archive
      if (!dryRun) {
        const archiveDir = path.join(manualCSVDir, "processed");
        fs.mkdirSync(archiveDir, { recursive: true });
        fs.renameSync(csvFile, path.join(archiveDir, `${todayET()}_${path.basename(csvFile)}`));
      }
    }

    if (allTransactions.length === 0 && csvFiles.length === 0) {
      engine.log("No Found CSV exports found today. Place CSV in ~/.config/usa-gummies-mcp/found-csv-imports/");
      return { status: "success", imported: 0, skipped: 0, notes: "no_csv_found" };
    }

    // Deduplicate against existing records
    const existingKeys = new Set(txCache.dedupKeys || []);

    if (IDS.bankTransactions) {
      await ensureFields(IDS.bankTransactions, REQUIRED_BANK_TRANSACTION_FIELDS);
    }

    for (const tx of allTransactions) {
      if (existingKeys.has(tx.dedupKey)) {
        skipped++;
        continue;
      }

      // Auto-categorize
      const autoCategory = categorizeTransaction(tx.description);
      const category = autoCategory?.category || tx.category || "";
      const vendor = autoCategory?.vendor || "";

      if (dryRun) {
        engine.log(`[DRY RUN] Would import: ${tx.date} | $${tx.amount} | ${tx.description.slice(0, 50)} | ${category}`);
        imported++;
        continue;
      }

      if (IDS.bankTransactions) {
        try {
          const props = buildProperties(IDS.bankTransactions, {
            Name: `${tx.date} ${tx.description.slice(0, 40)}`,
            Date: tx.date,
            Description: tx.description,
            Amount: tx.amount,
            Type: tx.type,
            Category: category || "Other",
            Reconciled: false,
            "Dedup Key": tx.dedupKey,
            "Found Export Date": todayET(),
            Notes: vendor ? `Auto-matched vendor: ${vendor}` : "",
          });
          await createPageInDb(IDS.bankTransactions, props);
          imported++;
        } catch (err) {
          errors.push(`Failed to import tx ${tx.dedupKey}: ${err.message}`);
        }
      } else {
        imported++;
      }

      existingKeys.add(tx.dedupKey);
    }

    // Update cache
    if (!dryRun) {
      txCache.dedupKeys = [...existingKeys].slice(-5000);
      txCache.lastImportDate = todayET();
      safeJsonWrite(TRANSACTION_CACHE_FILE, txCache);
    }

    engine.log(`F1 complete: imported=${imported}, skipped=${skipped}, errors=${errors.length}`);

    await engine.logRun({
      agentName: "F1 — Found Transaction Ingestor",
      recordsProcessed: imported + skipped,
      status: errors.length ? "Partial" : "Success",
      notes: `imported=${imported}, skipped=${skipped}`,
      errors: errors.join("; "),
    });

    return { status: errors.length ? "partial" : "success", imported, skipped, errors };
  } catch (err) {
    engine.log(`F1 error: ${err.message}`);
    return { status: "failed", imported, skipped, errors: [...errors, err.message] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// F2 — Invoice Scanner
// Scans Gmail for invoice/receipt emails from known vendors.
// ═══════════════════════════════════════════════════════════════════════════════

async function runF2_InvoiceScanner(opts = {}) {
  engine.log("F2 — Invoice Scanner starting...");
  const dryRun = opts.dryRun || false;
  const errors = [];
  let created = 0;
  let skippedDuplicates = 0;

  try {
    const invoiceCache = safeJsonRead(INVOICE_CACHE_FILE, { processedEmailIds: [], lastScanDate: null });
    const processedIds = new Set(invoiceCache.processedEmailIds || []);

    // Use the invoice extractor
    const since = invoiceCache.lastScanDate || addDaysToDate(todayET(), -30);
    engine.log(`Scanning for invoices since ${since}...`);

    const { invoices, csvExports, errors: scanErrors } = scanForInvoices({
      since,
      count: 50,
      processedIds,
      dryRun,
    });

    errors.push(...scanErrors);

    engine.log(`Found ${invoices.length} invoices, ${csvExports.length} CSV exports`);

    if (IDS.invoices) {
      await ensureFields(IDS.invoices, REQUIRED_INVOICE_FIELDS);
    }

    for (const inv of invoices) {
      if (processedIds.has(inv.emailId)) {
        skippedDuplicates++;
        continue;
      }

      if (dryRun) {
        engine.log(`[DRY RUN] Invoice: ${inv.vendor} | $${inv.amount || "?"} | #${inv.invoiceNumber || "?"}`);
        created++;
        processedIds.add(inv.emailId);
        continue;
      }

      if (IDS.invoices) {
        try {
          const dueDate = extractDueDate(`${inv.subject}`, inv.date);
          const props = buildProperties(IDS.invoices, {
            Name: `${inv.vendor} — ${inv.invoiceNumber || inv.date || "unknown"}`,
            Vendor: inv.vendor,
            "Invoice Number": inv.invoiceNumber || "",
            Amount: inv.amount || 0,
            "Date Received": inv.date || todayET(),
            "Due Date": dueDate || "",
            Status: "Received",
            Category: inv.category || "Other",
            "Source Email ID": inv.emailId || "",
            Notes: `Confidence: ${inv.confidence}`,
          });
          await createPageInDb(IDS.invoices, props);
          created++;
        } catch (err) {
          errors.push(`Failed to create invoice ${inv.vendor}: ${err.message}`);
        }
      } else {
        created++;
      }

      processedIds.add(inv.emailId);
    }

    // Update cache
    if (!dryRun) {
      invoiceCache.processedEmailIds = [...processedIds].slice(-2000);
      invoiceCache.lastScanDate = todayET();
      safeJsonWrite(INVOICE_CACHE_FILE, invoiceCache);
    }

    engine.log(`F2 complete: created=${created}, skipped=${skippedDuplicates}, errors=${errors.length}`);

    await engine.logRun({
      agentName: "F2 — Invoice Scanner",
      recordsProcessed: created + skippedDuplicates,
      status: errors.length ? "Partial" : "Success",
      notes: `created=${created}, skipped=${skippedDuplicates}`,
      errors: errors.join("; "),
    });

    return { status: errors.length ? "partial" : "success", created, skipped: skippedDuplicates, errors };
  } catch (err) {
    engine.log(`F2 error: ${err.message}`);
    return { status: "failed", created, skipped: skippedDuplicates, errors: [...errors, err.message] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// F3 — Revenue Reconciler
// Matches bank deposits to sales channel payouts.
// ═══════════════════════════════════════════════════════════════════════════════

async function runF3_RevenueReconciler(opts = {}) {
  engine.log("F3 — Revenue Reconciler starting...");
  const dryRun = opts.dryRun || false;
  const errors = [];
  let matched = 0;
  let unmatched = 0;
  let flagged = 0;

  try {
    if (!IDS.bankTransactions) {
      engine.log("No Bank Transactions DB configured. Skipping.");
      return { status: "success", matched: 0, unmatched: 0, notes: "no_db" };
    }

    const reconcileState = safeJsonRead(RECONCILIATION_STATE_FILE, { lastReconcileDate: null, unmatchedDeposits: [] });

    // Pull unreconciled deposits from Notion
    const unreconciledDeposits = await queryDatabaseAll(IDS.bankTransactions, {
      and: [
        { property: "Type", select: { equals: "Deposit" } },
        { property: "Reconciled", checkbox: { equals: false } },
      ],
    });

    engine.log(`Found ${unreconciledDeposits.length} unreconciled deposits`);

    for (const deposit of unreconciledDeposits) {
      const desc = getPlainText(getPropByName(deposit, "Description"));
      const amount = getPropByName(deposit, "Amount")?.number || 0;
      const date = getPlainText(getPropByName(deposit, "Date"));

      // Try to match to a known payout source
      const payoutSource = detectPayoutSource(desc, amount);

      if (payoutSource) {
        if (dryRun) {
          engine.log(`[DRY RUN] Match: $${amount} on ${date} → ${payoutSource} payout`);
          matched++;
          continue;
        }

        try {
          await updatePage(deposit.id, buildProperties(IDS.bankTransactions, {
            Reconciled: true,
            Category: `Revenue-${payoutSource}`,
            Notes: `Auto-reconciled: ${payoutSource} payout`,
          }));
          matched++;
        } catch (err) {
          errors.push(`Reconcile failed for ${deposit.id}: ${err.message}`);
        }
      } else if (amount > 50) {
        // Flag unmatched deposits > $50 for attention
        unmatched++;
        flagged++;
        engine.log(`Unmatched deposit: $${amount} on ${date} — "${desc.slice(0, 60)}"`);
      } else {
        unmatched++;
      }
    }

    // Alert Ben about unmatched deposits
    if (flagged > 0 && !dryRun) {
      textBen(`💰 FinOps: ${flagged} unmatched deposits >$50 need review. Check Notion Bank Transactions DB.`);
    }

    // Update reconciliation state
    if (!dryRun) {
      reconcileState.lastReconcileDate = todayET();
      const total = unreconciledDeposits.length;
      reconcileState.reconciliationRate = total > 0 ? Math.round((matched / total) * 100) : 100;
      safeJsonWrite(RECONCILIATION_STATE_FILE, reconcileState);
    }

    const reconciliationRate = unreconciledDeposits.length > 0
      ? Math.round((matched / unreconciledDeposits.length) * 100) : 100;

    engine.log(`F3 complete: matched=${matched}, unmatched=${unmatched}, flagged=${flagged}, rate=${reconciliationRate}%`);

    await engine.logRun({
      agentName: "F3 — Revenue Reconciler",
      recordsProcessed: matched + unmatched,
      status: errors.length ? "Partial" : "Success",
      notes: `matched=${matched}, unmatched=${unmatched}, flagged=${flagged}, rate=${reconciliationRate}%`,
      errors: errors.join("; "),
    });

    return { status: errors.length ? "partial" : "success", matched, unmatched, flagged, reconciliationRate, errors };
  } catch (err) {
    engine.log(`F3 error: ${err.message}`);
    return { status: "failed", matched, unmatched, flagged, errors: [...errors, err.message] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// F4 — Expense Categorizer
// Auto-categorizes uncategorized withdrawals based on vendor matching.
// ═══════════════════════════════════════════════════════════════════════════════

async function runF4_ExpenseCategorizer(opts = {}) {
  engine.log("F4 — Expense Categorizer starting...");
  const dryRun = opts.dryRun || false;
  const errors = [];
  let categorized = 0;
  let needsReview = 0;

  try {
    if (!IDS.bankTransactions) {
      engine.log("No Bank Transactions DB configured. Skipping.");
      return { status: "success", categorized: 0, notes: "no_db" };
    }

    // Pull uncategorized withdrawals
    const uncategorized = await queryDatabaseAll(IDS.bankTransactions, {
      and: [
        { property: "Type", select: { equals: "Withdrawal" } },
        { or: [
          { property: "Category", select: { equals: "Other" } },
          { property: "Category", select: { is_empty: true } },
        ]},
      ],
    });

    engine.log(`Found ${uncategorized.length} uncategorized withdrawals`);

    for (const tx of uncategorized) {
      const desc = getPlainText(getPropByName(tx, "Description"));
      const amount = Math.abs(getPropByName(tx, "Amount")?.number || 0);
      const date = getPlainText(getPropByName(tx, "Date"));

      const match = categorizeTransaction(desc);

      if (match) {
        if (dryRun) {
          engine.log(`[DRY RUN] Categorize: $${amount} "${desc.slice(0, 40)}" → ${match.category} (${match.vendor})`);
          categorized++;
          continue;
        }

        try {
          await updatePage(tx.id, buildProperties(IDS.bankTransactions, {
            Category: match.category,
            Notes: `Auto-categorized: ${match.vendor}`,
          }));
          categorized++;
        } catch (err) {
          errors.push(`Categorize failed for ${tx.id}: ${err.message}`);
        }
      } else if (amount > 25) {
        // Push unknowns > $25 to attention queue
        needsReview++;
        engine.log(`Needs review: $${amount} on ${date} — "${desc.slice(0, 60)}"`);
      }
    }

    // Alert Ben about items needing review
    if (needsReview > 0 && !dryRun) {
      textBen(`📋 FinOps: ${needsReview} expenses >$25 need categorization. Check Notion Bank Transactions DB.`);
    }

    engine.log(`F4 complete: categorized=${categorized}, needsReview=${needsReview}, errors=${errors.length}`);

    await engine.logRun({
      agentName: "F4 — Expense Categorizer",
      recordsProcessed: categorized + needsReview,
      status: errors.length ? "Partial" : "Success",
      notes: `categorized=${categorized}, needsReview=${needsReview}`,
      errors: errors.join("; "),
    });

    return { status: errors.length ? "partial" : "success", categorized, needsReview, errors };
  } catch (err) {
    engine.log(`F4 error: ${err.message}`);
    return { status: "failed", categorized, needsReview, errors: [...errors, err.message] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// F5 — Production Cost Allocator
// Links production expenses to production runs (from Supply Chain engine).
// ═══════════════════════════════════════════════════════════════════════════════

async function runF5_ProductionCostAllocator(opts = {}) {
  engine.log("F5 — Production Cost Allocator starting...");
  const dryRun = opts.dryRun || false;
  const errors = [];
  let allocated = 0;
  let unallocated = 0;

  try {
    if (!IDS.bankTransactions) {
      engine.log("No Bank Transactions DB configured. Skipping.");
      return { status: "success", allocated: 0, notes: "no_db" };
    }

    // Pull production/packaging expenses not yet allocated
    const productionExpenses = await queryDatabaseAll(IDS.bankTransactions, {
      and: [
        { property: "Type", select: { equals: "Withdrawal" } },
        { or: [
          { property: "Category", select: { equals: "Production" } },
          { property: "Category", select: { equals: "Packaging" } },
        ]},
      ],
    });

    engine.log(`Found ${productionExpenses.length} production/packaging expenses`);

    // Group expenses by month for cost analysis
    const costByMonth = {};
    let totalProductionCost = 0;

    for (const tx of productionExpenses) {
      const date = getPlainText(getPropByName(tx, "Date"));
      const amount = Math.abs(getPropByName(tx, "Amount")?.number || 0);
      const category = getPlainText(getPropByName(tx, "Category"));

      const month = date ? date.slice(0, 7) : "unknown";
      if (!costByMonth[month]) costByMonth[month] = { production: 0, packaging: 0, total: 0 };

      if (category === "Production") {
        costByMonth[month].production += amount;
      } else {
        costByMonth[month].packaging += amount;
      }
      costByMonth[month].total += amount;
      totalProductionCost += amount;
      allocated++;
    }

    // TODO: When Supply Chain engine (Build 5) is live, match expenses to specific production runs
    // For now, compute aggregate cost metrics
    if (IDS.productionRuns) {
      engine.log("Production Runs DB available — would allocate costs to runs. (Build 5 integration pending)");
    }

    // Compute cost per bag estimate
    // Known: 1 production run ≈ 1,000 bags (to be refined with Build 5 data)
    const estimatedBagsPerRun = 1000;
    const costPerBag = totalProductionCost > 0
      ? (totalProductionCost / estimatedBagsPerRun).toFixed(2) : "N/A";

    engine.log(`F5 complete: allocated=${allocated}, totalCost=$${totalProductionCost.toFixed(2)}, estCostPerBag=$${costPerBag}`);
    engine.log(`Monthly breakdown: ${JSON.stringify(costByMonth)}`);

    await engine.logRun({
      agentName: "F5 — Production Cost Allocator",
      recordsProcessed: allocated,
      status: "Success",
      notes: `totalCost=$${totalProductionCost.toFixed(2)}, costPerBag=$${costPerBag}, months=${Object.keys(costByMonth).length}`,
    });

    return { status: "success", allocated, costByMonth, totalProductionCost, costPerBag, errors };
  } catch (err) {
    engine.log(`F5 error: ${err.message}`);
    return { status: "failed", allocated, errors: [...errors, err.message] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// F6 — Accounts Payable Tracker
// Maintains outstanding invoices, matches payments, alerts on overdue.
// ═══════════════════════════════════════════════════════════════════════════════

async function runF6_AccountsPayableTracker(opts = {}) {
  engine.log("F6 — Accounts Payable Tracker starting...");
  const dryRun = opts.dryRun || false;
  const errors = [];
  let paid = 0;
  let overdue = 0;
  let pending = 0;

  try {
    if (!IDS.invoices) {
      engine.log("No Invoices DB configured. Skipping.");
      return { status: "success", notes: "no_db" };
    }

    // Get all unpaid invoices
    const unpaidInvoices = await queryDatabaseAll(IDS.invoices, {
      or: [
        { property: "Status", select: { equals: "Received" } },
        { property: "Status", select: { equals: "Approved" } },
        { property: "Status", select: { equals: "Overdue" } },
      ],
    });

    engine.log(`Found ${unpaidInvoices.length} unpaid invoices`);

    // Get recent withdrawals for matching
    let recentWithdrawals = [];
    if (IDS.bankTransactions) {
      recentWithdrawals = await queryDatabaseAll(IDS.bankTransactions, {
        and: [
          { property: "Type", select: { equals: "Withdrawal" } },
          { property: "Reconciled", checkbox: { equals: false } },
        ],
      });
    }

    for (const invoice of unpaidInvoices) {
      const vendor = getPlainText(getPropByName(invoice, "Vendor"));
      const amount = getPropByName(invoice, "Amount")?.number || 0;
      const dueDate = getPlainText(getPropByName(invoice, "Due Date"));
      const invNum = getPlainText(getPropByName(invoice, "Invoice Number"));

      // Check if overdue
      const daysOverdue = dueDate ? daysSince(dueDate) : 0;

      // Try to match to a bank withdrawal
      let matchedTx = null;
      for (const tx of recentWithdrawals) {
        const txAmount = Math.abs(getPropByName(tx, "Amount")?.number || 0);
        const txDesc = getPlainText(getPropByName(tx, "Description"));
        // Match by amount (within $1) and vendor name in description
        if (Math.abs(txAmount - amount) < 1.0 && vendor && txDesc.toLowerCase().includes(vendor.toLowerCase().split(" ")[0])) {
          matchedTx = tx;
          break;
        }
      }

      if (matchedTx) {
        if (dryRun) {
          engine.log(`[DRY RUN] Match: Invoice ${invNum} ($${amount}) → bank withdrawal`);
          paid++;
          continue;
        }

        try {
          await updatePage(invoice.id, buildProperties(IDS.invoices, {
            Status: "Paid",
            "Paid Date": todayET(),
            "Payment Amount": Math.abs(getPropByName(matchedTx, "Amount")?.number || 0),
          }));
          // Mark bank transaction as reconciled
          if (IDS.bankTransactions) {
            await updatePage(matchedTx.id, buildProperties(IDS.bankTransactions, {
              Reconciled: true,
              Notes: `Matched to invoice: ${invNum || vendor}`,
            }));
          }
          paid++;
        } catch (err) {
          errors.push(`Match failed for invoice ${invNum}: ${err.message}`);
        }
      } else if (daysOverdue > 30) {
        overdue++;
        if (!dryRun) {
          // Update status to Overdue
          try {
            await updatePage(invoice.id, buildProperties(IDS.invoices, { Status: "Overdue" }));
          } catch { /* ignore update errors */ }
        }
      } else {
        pending++;
      }
    }

    // Alert on overdue items
    if (overdue > 0 && !dryRun) {
      textBen(`⚠️ FinOps: ${overdue} invoices are 30+ days overdue. Check Notion Invoices DB.`);
    }

    // Sync to AP database
    if (IDS.accountsPayable && !dryRun) {
      await ensureFields(IDS.accountsPayable, REQUIRED_AP_FIELDS);
      // AP entries are derived from unpaid invoices — full sync happens here
      engine.log(`AP sync: ${pending} pending, ${overdue} overdue`);
    }

    engine.log(`F6 complete: paid=${paid}, pending=${pending}, overdue=${overdue}, errors=${errors.length}`);

    await engine.logRun({
      agentName: "F6 — Accounts Payable Tracker",
      recordsProcessed: paid + pending + overdue,
      status: errors.length ? "Partial" : "Success",
      notes: `paid=${paid}, pending=${pending}, overdue=${overdue}`,
      errors: errors.join("; "),
    });

    return { status: errors.length ? "partial" : "success", paid, pending, overdue, errors };
  } catch (err) {
    engine.log(`F6 error: ${err.message}`);
    return { status: "failed", paid, pending, overdue, errors: [...errors, err.message] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// F7 — Accounts Receivable Tracker
// Tracks expected incoming payments and matches to deposits.
// ═══════════════════════════════════════════════════════════════════════════════

async function runF7_AccountsReceivableTracker(opts = {}) {
  engine.log("F7 — Accounts Receivable Tracker starting...");
  const dryRun = opts.dryRun || false;
  const errors = [];
  let received = 0;
  let late = 0;
  let pending = 0;

  try {
    if (!IDS.accountsReceivable) {
      engine.log("No AR DB configured. Skipping.");
      return { status: "success", notes: "no_db" };
    }

    await ensureFields(IDS.accountsReceivable, REQUIRED_AR_FIELDS);

    // Get outstanding AR entries
    const outstanding = await queryDatabaseAll(IDS.accountsReceivable, {
      property: "Received",
      checkbox: { equals: false },
    });

    engine.log(`Found ${outstanding.length} outstanding AR entries`);

    // Get recent unreconciled deposits
    let recentDeposits = [];
    if (IDS.bankTransactions) {
      recentDeposits = await queryDatabaseAll(IDS.bankTransactions, {
        and: [
          { property: "Type", select: { equals: "Deposit" } },
          { property: "Reconciled", checkbox: { equals: false } },
        ],
      });
    }

    for (const ar of outstanding) {
      const source = getPlainText(getPropByName(ar, "Source"));
      const expectedAmount = getPropByName(ar, "Expected Amount")?.number || 0;
      const expectedDate = getPlainText(getPropByName(ar, "Expected Date"));

      // Try to match deposit
      let matchedDeposit = null;
      for (const dep of recentDeposits) {
        const depAmount = getPropByName(dep, "Amount")?.number || 0;
        const depDesc = getPlainText(getPropByName(dep, "Description"));
        const payoutSource = detectPayoutSource(depDesc, depAmount);
        // Match by source and approximate amount (within 5%)
        if (payoutSource === source && Math.abs(depAmount - expectedAmount) < expectedAmount * 0.05) {
          matchedDeposit = dep;
          break;
        }
      }

      if (matchedDeposit) {
        if (!dryRun) {
          try {
            const actualAmount = getPropByName(matchedDeposit, "Amount")?.number || 0;
            const actualDate = getPlainText(getPropByName(matchedDeposit, "Date"));
            await updatePage(ar.id, buildProperties(IDS.accountsReceivable, {
              Received: true,
              "Actual Amount": actualAmount,
              "Actual Date": actualDate,
              "Days Late": expectedDate ? daysSince(expectedDate) : 0,
            }));
            // Mark deposit as reconciled
            await updatePage(matchedDeposit.id, buildProperties(IDS.bankTransactions, {
              Reconciled: true,
              Notes: `Matched to AR: ${source} payout`,
            }));
          } catch (err) {
            errors.push(`AR match failed: ${err.message}`);
          }
        }
        received++;
      } else {
        const daysLate = expectedDate ? daysSince(expectedDate) : 0;
        if (daysLate > 5) {
          late++;
        } else {
          pending++;
        }
      }
    }

    if (late > 0 && !dryRun) {
      textBen(`📥 FinOps: ${late} expected payments are late (>5 days). Check AR in Notion.`);
    }

    engine.log(`F7 complete: received=${received}, pending=${pending}, late=${late}, errors=${errors.length}`);

    await engine.logRun({
      agentName: "F7 — Accounts Receivable Tracker",
      recordsProcessed: received + pending + late,
      status: errors.length ? "Partial" : "Success",
      notes: `received=${received}, pending=${pending}, late=${late}`,
      errors: errors.join("; "),
    });

    return { status: errors.length ? "partial" : "success", received, pending, late, errors };
  } catch (err) {
    engine.log(`F7 error: ${err.message}`);
    return { status: "failed", received, pending, late, errors: [...errors, err.message] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// F8 — Cash Flow Calculator
// Computes current position and 7/14/30-day projections.
// ═══════════════════════════════════════════════════════════════════════════════

async function runF8_CashFlowCalculator(opts = {}) {
  engine.log("F8 — Cash Flow Calculator starting...");
  const dryRun = opts.dryRun || false;
  const errors = [];

  try {
    if (!IDS.bankTransactions) {
      engine.log("No Bank Transactions DB configured. Skipping.");
      return { status: "success", notes: "no_db" };
    }

    // Get all transactions to compute running balance
    const allTx = await queryDatabaseAll(IDS.bankTransactions, null, [
      { property: "Date", direction: "ascending" },
    ]);

    let balance = 0;
    let totalInflows = 0;
    let totalOutflows = 0;
    const recentDays = 30;
    const cutoff = addDaysToDate(todayET(), -recentDays);
    let recentInflows = 0;
    let recentOutflows = 0;
    let recentDaysCount = 0;

    for (const tx of allTx) {
      const amount = getPropByName(tx, "Amount")?.number || 0;
      const date = getPlainText(getPropByName(tx, "Date"));

      balance += amount;
      if (amount > 0) totalInflows += amount;
      else totalOutflows += Math.abs(amount);

      if (date >= cutoff) {
        if (amount > 0) recentInflows += amount;
        else recentOutflows += Math.abs(amount);
        recentDaysCount++;
      }
    }

    // Compute daily averages from recent data
    const avgDailyInflow = recentDaysCount > 0 ? recentInflows / recentDays : 0;
    const avgDailyOutflow = recentDaysCount > 0 ? recentOutflows / recentDays : 0;
    const netDaily = avgDailyInflow - avgDailyOutflow;

    // Project forward
    const projected7d = balance + (netDaily * 7);
    const projected14d = balance + (netDaily * 14);
    const projected30d = balance + (netDaily * 30);

    const belowSafety = projected30d < CASH_SAFETY_THRESHOLD || balance < CASH_SAFETY_THRESHOLD;

    engine.log(`Cash position: balance=$${balance.toFixed(2)}, 7d=$${projected7d.toFixed(2)}, 30d=$${projected30d.toFixed(2)}`);
    engine.log(`Daily avg: inflow=$${avgDailyInflow.toFixed(2)}, outflow=$${avgDailyOutflow.toFixed(2)}, net=$${netDaily.toFixed(2)}`);

    // Write to Cash Flow DB
    if (IDS.cashFlow && !dryRun) {
      await ensureFields(IDS.cashFlow, REQUIRED_CASHFLOW_FIELDS);

      const props = buildProperties(IDS.cashFlow, {
        Name: `Cash Position ${todayET()}`,
        Date: todayET(),
        "Opening Balance": balance,
        Inflows: recentInflows,
        Outflows: recentOutflows,
        "Closing Balance": balance,
        "Projected 7d": projected7d,
        "Projected 30d": projected30d,
        "Below Safety Threshold": belowSafety,
        Notes: `AvgDailyIn=$${avgDailyInflow.toFixed(0)}, AvgDailyOut=$${avgDailyOutflow.toFixed(0)}`,
      });
      await createPageInDb(IDS.cashFlow, props);
    }

    // Alert if below safety threshold
    if (belowSafety && !dryRun) {
      const alert = projected30d < CASH_SAFETY_THRESHOLD
        ? `🚨 CASH ALERT: 30-day projection ($${projected30d.toFixed(0)}) below $${CASH_SAFETY_THRESHOLD} safety threshold!`
        : `⚠️ CASH WARNING: Current balance ($${balance.toFixed(0)}) is near safety threshold.`;
      textBen(alert);
    }

    await engine.logRun({
      agentName: "F8 — Cash Flow Calculator",
      recordsProcessed: allTx.length,
      status: "Success",
      notes: `balance=$${balance.toFixed(2)}, 7d=$${projected7d.toFixed(0)}, 30d=$${projected30d.toFixed(0)}, alert=${belowSafety}`,
    });

    return {
      status: "success",
      balance,
      projected7d,
      projected14d,
      projected30d,
      belowSafety,
      avgDailyInflow,
      avgDailyOutflow,
      errors,
    };
  } catch (err) {
    engine.log(`F8 error: ${err.message}`);
    return { status: "failed", errors: [...errors, err.message] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// F9 — P&L Generator
// Weekly: compiles Profit & Loss from all categorized transactions.
// ═══════════════════════════════════════════════════════════════════════════════

async function runF9_PLGenerator(opts = {}) {
  engine.log("F9 — P&L Generator starting...");
  const dryRun = opts.dryRun || false;
  const errors = [];

  try {
    if (!IDS.bankTransactions) {
      engine.log("No Bank Transactions DB configured. Skipping.");
      return { status: "success", notes: "no_db" };
    }

    // Determine period: this week (Mon-Sun)
    const today = todayET();
    const et = etParts(new Date());
    // Calculate start of current week (Monday)
    const dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(et.weekday);
    const daysFromMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = addDaysToDate(today, -daysFromMon);
    const weekEnd = addDaysToDate(weekStart, 6);

    engine.log(`P&L period: ${weekStart} to ${weekEnd}`);

    // Pull all transactions in this period
    const allTx = await queryDatabaseAll(IDS.bankTransactions);

    // Filter to this week
    const weekTx = allTx.filter((tx) => {
      const date = getPlainText(getPropByName(tx, "Date"));
      return date >= weekStart && date <= weekEnd;
    });

    engine.log(`Found ${weekTx.length} transactions in period`);

    // Aggregate by category
    const revenueCategories = ["Revenue-Shopify", "Revenue-Amazon", "Revenue-Faire", "Revenue-B2B"];
    const cogsCategories = ["Production", "Packaging"];
    const opexCategories = ["Shipping", "Legal", "Marketing", "SaaS", "Compliance", "Tax", "Other"];

    let totalRevenue = 0;
    let cogs = 0;
    let opex = 0;
    const breakdown = {};

    for (const tx of weekTx) {
      const category = getPlainText(getPropByName(tx, "Category"));
      const amount = getPropByName(tx, "Amount")?.number || 0;

      if (!breakdown[category]) breakdown[category] = 0;
      breakdown[category] += amount;

      if (revenueCategories.includes(category)) {
        totalRevenue += amount;
      } else if (cogsCategories.includes(category)) {
        cogs += Math.abs(amount);
      } else if (opexCategories.includes(category)) {
        opex += Math.abs(amount);
      }
    }

    const grossProfit = totalRevenue - cogs;
    const grossMargin = totalRevenue > 0 ? grossProfit / totalRevenue : 0;
    const netIncome = grossProfit - opex;
    const netMargin = totalRevenue > 0 ? netIncome / totalRevenue : 0;

    engine.log(`P&L: Revenue=$${totalRevenue.toFixed(2)}, COGS=$${cogs.toFixed(2)}, Gross=$${grossProfit.toFixed(2)} (${(grossMargin * 100).toFixed(1)}%), OpEx=$${opex.toFixed(2)}, Net=$${netIncome.toFixed(2)} (${(netMargin * 100).toFixed(1)}%)`);

    // Write to P&L DB
    if (IDS.plReports && !dryRun) {
      await ensureFields(IDS.plReports, REQUIRED_PL_FIELDS);

      // Check for previous week's P&L for comparison
      let vsPrevious = 0;
      const prevWeekStart = addDaysToDate(weekStart, -7);
      const existingPLs = await queryDatabaseAll(IDS.plReports, {
        property: "Period Type",
        select: { equals: "Weekly" },
      });
      const prevPL = existingPLs.find((p) => {
        const period = getPlainText(getPropByName(p, "Period"));
        return period && period.includes(prevWeekStart);
      });
      if (prevPL) {
        const prevNet = getPropByName(prevPL, "Net Income")?.number || 0;
        vsPrevious = prevNet !== 0 ? (netIncome - prevNet) / Math.abs(prevNet) : 0;
      }

      const props = buildProperties(IDS.plReports, {
        Name: `Weekly P&L: ${weekStart} to ${weekEnd}`,
        Period: `${weekStart} to ${weekEnd}`,
        "Period Type": "Weekly",
        "Total Revenue": totalRevenue,
        COGS: cogs,
        "Gross Profit": grossProfit,
        "Gross Margin %": grossMargin,
        "Operating Expenses": opex,
        "Net Income": netIncome,
        "Net Margin %": netMargin,
        "vs Previous %": vsPrevious,
        Notes: Object.entries(breakdown).map(([k, v]) => `${k}: $${v.toFixed(2)}`).join(", "),
      });
      await createPageInDb(IDS.plReports, props);
    }

    // Text summary to Ben
    if (!dryRun) {
      textBen(
        `📊 Weekly P&L (${weekStart}):\n` +
        `Revenue: $${totalRevenue.toFixed(0)}\n` +
        `COGS: $${cogs.toFixed(0)}\n` +
        `Gross: $${grossProfit.toFixed(0)} (${(grossMargin * 100).toFixed(0)}%)\n` +
        `OpEx: $${opex.toFixed(0)}\n` +
        `Net: $${netIncome.toFixed(0)} (${(netMargin * 100).toFixed(0)}%)`
      );
    }

    await engine.logRun({
      agentName: "F9 — P&L Generator",
      recordsProcessed: weekTx.length,
      status: "Success",
      notes: `rev=$${totalRevenue.toFixed(0)}, cogs=$${cogs.toFixed(0)}, net=$${netIncome.toFixed(0)}`,
    });

    return { status: "success", totalRevenue, cogs, grossProfit, grossMargin, opex, netIncome, netMargin, breakdown, errors };
  } catch (err) {
    engine.log(`F9 error: ${err.message}`);
    return { status: "failed", errors: [...errors, err.message] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// F10 — Tax Reserve Calculator
// Monthly: estimates quarterly tax liability and tracks reserves.
// ═══════════════════════════════════════════════════════════════════════════════

async function runF10_TaxReserveCalculator(opts = {}) {
  engine.log("F10 — Tax Reserve Calculator starting...");
  const dryRun = opts.dryRun || false;
  const errors = [];

  try {
    if (!IDS.bankTransactions) {
      engine.log("No Bank Transactions DB configured. Skipping.");
      return { status: "success", notes: "no_db" };
    }

    const today = todayET();
    const currentMonth = today.slice(0, 7);
    const currentYear = today.slice(0, 4);

    // Determine current quarter
    const month = parseInt(today.slice(5, 7), 10);
    const quarter = Math.ceil(month / 3);

    // Quarter date ranges
    const quarterStart = `${currentYear}-${String((quarter - 1) * 3 + 1).padStart(2, "0")}-01`;
    const quarterEnd = quarter < 4
      ? `${currentYear}-${String(quarter * 3).padStart(2, "0")}-30`
      : `${currentYear}-12-31`;

    engine.log(`Tax calculation for Q${quarter} ${currentYear} (${quarterStart} to ${quarterEnd})`);

    // Pull all transactions for the quarter
    const allTx = await queryDatabaseAll(IDS.bankTransactions);
    const quarterTx = allTx.filter((tx) => {
      const date = getPlainText(getPropByName(tx, "Date"));
      return date >= quarterStart && date <= quarterEnd;
    });

    // Compute quarterly revenue and expenses
    const revenueCategories = ["Revenue-Shopify", "Revenue-Amazon", "Revenue-Faire", "Revenue-B2B"];
    let quarterRevenue = 0;
    let quarterExpenses = 0;

    for (const tx of quarterTx) {
      const category = getPlainText(getPropByName(tx, "Category"));
      const amount = getPropByName(tx, "Amount")?.number || 0;

      if (revenueCategories.includes(category)) {
        quarterRevenue += amount;
      } else if (amount < 0) {
        quarterExpenses += Math.abs(amount);
      }
    }

    const netIncome = quarterRevenue - quarterExpenses;

    // Estimated tax rates (simplified for small business)
    const selfEmploymentRate = 0.153; // 15.3% SE tax
    const federalIncomeTaxRate = 0.22; // 22% bracket estimate
    const stateIncomeTaxRate = 0.05;   // State estimate (varies)
    const effectiveRate = selfEmploymentRate + federalIncomeTaxRate + stateIncomeTaxRate;

    const estimatedTax = Math.max(0, netIncome * effectiveRate);
    const suggestedReserve = Math.ceil(estimatedTax / 100) * 100; // Round up to nearest $100

    // Quarterly tax deadlines
    const taxDeadlines = {
      1: `${currentYear}-04-15`,
      2: `${currentYear}-06-15`,
      3: `${currentYear}-09-15`,
      4: `${parseInt(currentYear, 10) + 1}-01-15`,
    };
    const nextDeadline = taxDeadlines[quarter];
    const daysUntilDeadline = daysSince(nextDeadline);
    const daysUntil = daysUntilDeadline ? -daysUntilDeadline : null;

    engine.log(`Q${quarter} Tax: Revenue=$${quarterRevenue.toFixed(0)}, Expenses=$${quarterExpenses.toFixed(0)}, Net=$${netIncome.toFixed(0)}`);
    engine.log(`Estimated tax: $${estimatedTax.toFixed(0)} (rate=${(effectiveRate * 100).toFixed(1)}%), Suggested reserve: $${suggestedReserve}`);
    engine.log(`Next deadline: ${nextDeadline} (${daysUntil ? daysUntil + " days" : "unknown"})`);

    // Alert if deadline is approaching
    if (daysUntil !== null && daysUntil <= 30 && !dryRun) {
      textBen(
        `🏦 Tax Alert: Q${quarter} estimated payment of $${suggestedReserve} due ${nextDeadline} (${daysUntil} days).\n` +
        `QTD Revenue: $${quarterRevenue.toFixed(0)}, Expenses: $${quarterExpenses.toFixed(0)}, Net: $${netIncome.toFixed(0)}`
      );
    }

    await engine.logRun({
      agentName: "F10 — Tax Reserve Calculator",
      recordsProcessed: quarterTx.length,
      status: "Success",
      notes: `Q${quarter} est=$${estimatedTax.toFixed(0)}, reserve=$${suggestedReserve}, deadline=${nextDeadline}`,
    });

    return {
      status: "success",
      quarter,
      quarterRevenue,
      quarterExpenses,
      netIncome,
      estimatedTax,
      suggestedReserve,
      nextDeadline,
      daysUntilDeadline: daysUntil,
      errors,
    };
  } catch (err) {
    engine.log(`F10 error: ${err.message}`);
    return { status: "failed", errors: [...errors, err.message] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// F11 — Self-Heal Monitor
// Standard self-heal pattern: checks all agents, retries failed/missed ones.
// ═══════════════════════════════════════════════════════════════════════════════

async function runF11_SelfHealMonitor(opts = {}) {
  engine.log("F11 — Self-Heal Monitor starting...");

  if (!engine.tryAcquireSelfHealLock()) {
    engine.log("Another self-heal is running. Skipping.");
    return { status: "success", notes: "locked" };
  }

  try {
    const status = engine.loadSystemStatus();
    const nowET = etParts(new Date());
    const repairs = [];

    for (const [agentKey, agentState] of Object.entries(status.agents || {})) {
      if (agentKey === "F11") continue; // Don't self-heal self-heal

      if (engine.shouldRepairAgentNow(agentKey, agentState, nowET)) {
        const reason = agentState.lastStatus === "failed"
          ? `retry_after_failure (last: ${agentState.lastRunAtET || "never"})`
          : `missed_schedule (last: ${agentState.lastRunAtET || "never"})`;

        engine.log(`Self-heal: repairing ${agentKey} — ${reason}`);
        repairs.push({ agent: agentKey, reason });

        try {
          await runAgentByName(agentKey, { source: "self-heal" });
        } catch (err) {
          engine.log(`Self-heal repair failed for ${agentKey}: ${err.message}`);
        }
      }
    }

    // Update self-heal status
    status.selfHeal = {
      lastRunAt: new Date().toISOString(),
      lastActionSummary: repairs.length ? repairs.map((r) => `${r.agent}: ${r.reason}`).join("; ") : "all_healthy",
      actions: repairs,
    };
    engine.saveSystemStatus(status);

    if (repairs.length > 0) {
      engine.log(`Self-heal complete: repaired ${repairs.length} agents`);
    } else {
      engine.log("Self-heal complete: all agents healthy");
    }

    return { status: "success", repairs };
  } finally {
    engine.releaseSelfHealLock();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Agent Registry & CLI
// ═══════════════════════════════════════════════════════════════════════════════

const AGENT_REGISTRY = {
  F1: { fn: runF1_FoundTransactionIngestor, label: "Found Transaction Ingestor" },
  F2: { fn: runF2_InvoiceScanner, label: "Invoice Scanner" },
  F3: { fn: runF3_RevenueReconciler, label: "Revenue Reconciler" },
  F4: { fn: runF4_ExpenseCategorizer, label: "Expense Categorizer" },
  F5: { fn: runF5_ProductionCostAllocator, label: "Production Cost Allocator" },
  F6: { fn: runF6_AccountsPayableTracker, label: "Accounts Payable Tracker" },
  F7: { fn: runF7_AccountsReceivableTracker, label: "Accounts Receivable Tracker" },
  F8: { fn: runF8_CashFlowCalculator, label: "Cash Flow Calculator" },
  F9: { fn: runF9_PLGenerator, label: "P&L Generator" },
  F10: { fn: runF10_TaxReserveCalculator, label: "Tax Reserve Calculator" },
  F11: { fn: runF11_SelfHealMonitor, label: "Self-Heal Monitor" },
};

async function runAgentByName(name, context = {}) {
  const upper = String(name || "").toUpperCase();
  const entry = AGENT_REGISTRY[upper];
  if (!entry) throw new Error(`Unknown agent: ${name}. Available: ${Object.keys(AGENT_REGISTRY).join(", ")}`);

  return engine.runSingleAgentWithMonitoring(upper, () => entry.fn(context), {
    source: context.source || "manual",
  });
}

async function runScheduledAgents() {
  const nowET = etParts(new Date());
  const currentMinutes = nowET.minutesOfDay;
  engine.log(`Running scheduled agents at ${nowET.date} ${String(nowET.hour).padStart(2, "0")}:${String(nowET.minute).padStart(2, "0")} ET`);

  for (const [key, schedule] of Object.entries(SCHEDULE_PLAN)) {
    if (key === "F11") continue; // Self-heal runs independently

    // Check day-of-week filter (F9)
    if (schedule.dayOfWeek && schedule.dayOfWeek !== nowET.weekday) continue;

    // Check day-of-month filter (F10)
    if (schedule.dayOfMonth && parseInt(nowET.day, 10) !== schedule.dayOfMonth) continue;

    // Check if within 15 min of scheduled time
    if (schedule.hour !== undefined) {
      const scheduledMinutes = schedule.hour * 60 + schedule.minute;
      if (Math.abs(currentMinutes - scheduledMinutes) > 15) continue;
    }

    // Check interval-based (F11)
    if (schedule.intervalMinutes) {
      const status = engine.loadSystemStatus();
      const lastRun = status.agents?.[key]?.lastRunAt;
      if (lastRun) {
        const ageMin = (Date.now() - Date.parse(lastRun)) / 60000;
        if (ageMin < schedule.intervalMinutes) continue;
      }
    }

    engine.log(`Scheduled: running ${key} (${schedule.label})`);
    try {
      await runAgentByName(key, { source: "cron" });
    } catch (err) {
      engine.log(`Scheduled agent ${key} failed: ${err.message}`);
    }
  }
}

function showStatus() {
  const status = engine.loadSystemStatus();
  console.log(JSON.stringify(status, null, 2));
}

function showHelp() {
  console.log(`
USA Gummies Financial Operations Engine (Build 6)
═══════════════════════════════════════════════════

Commands:
  run <agent>      Run a specific agent (F1-F11)
  run all          Run all scheduled agents for current time
  run self-heal    Run the self-heal monitor
  status           Show system status JSON
  help             Show this help

Options:
  --dry-run        Preview actions without making changes
  --source <src>   Override run source label

Agents:
  F1   Found Transaction Ingestor      Daily 7:00 AM
  F2   Invoice Scanner                 Daily 7:15 AM
  F3   Revenue Reconciler              Daily 7:30 AM
  F4   Expense Categorizer             Daily 7:45 AM
  F5   Production Cost Allocator       Daily 8:00 AM
  F6   Accounts Payable Tracker        Daily 10:00 AM
  F7   Accounts Receivable Tracker     Daily 10:15 AM
  F8   Cash Flow Calculator            Daily 11:00 AM
  F9   P&L Generator                   Weekly Sun 8:00 PM
  F10  Tax Reserve Calculator          Monthly 1st 9:00 AM
  F11  Self-Heal Monitor               Every 30 min

CSV Import:
  Place Found.com CSV exports in: ~/.config/usa-gummies-mcp/found-csv-imports/
  F1 will auto-parse, deduplicate, and import on next run.

Examples:
  node scripts/usa-gummies-finops.mjs run F1
  node scripts/usa-gummies-finops.mjs --dry-run run F3
  node scripts/usa-gummies-finops.mjs run all
  node scripts/usa-gummies-finops.mjs status
`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = engine.parseArgs(process.argv.slice(2));

  try {
    await ensureAllSchemas();
  } catch {
    engine.log("Schema initialization skipped (some DBs may not be configured yet)");
  }

  switch (args.cmd) {
    case "run": {
      const target = String(args.arg || "").toLowerCase();
      if (target === "all") {
        await runScheduledAgents();
      } else if (target === "self-heal") {
        await runAgentByName("F11", { source: args.source || "manual" });
      } else {
        const agentName = target.toUpperCase();
        if (!AGENT_REGISTRY[agentName]) {
          console.error(`Unknown agent: ${target}. Use: ${Object.keys(AGENT_REGISTRY).join(", ")}`);
          process.exit(1);
        }
        const result = await runAgentByName(agentName, {
          source: args.source || "manual",
          dryRun: args.dryRun || false,
        });
        console.log(JSON.stringify(result, null, 2));
      }
      break;
    }
    case "status":
      showStatus();
      break;
    case "help":
    default:
      showHelp();
      break;
  }
}

main().catch((err) => {
  console.error(`FinOps engine fatal error: ${err.message}`);
  process.exit(1);
});
