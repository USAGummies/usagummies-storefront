/**
 * State key registry — maps logical keys to local file paths.
 *
 * On Vercel (cloud), keys are stored in KV as `usag:{key}`.
 * On laptop (local dev), keys map to JSON/text files under CONFIG_DIR.
 */

import path from "node:path";

const HOME = process.env.HOME || "/Users/ben";
const CONFIG_DIR = path.join(HOME, ".config/usa-gummies-mcp");

/** All known state keys used across the agentic system */
export const STATE_KEYS = {
  // Core system
  "system-status": "agentic-system-status.json",
  "run-ledger": "agentic-run-ledger.json",
  "self-heal-lock": "agentic-self-heal.lock",

  // Reply / inbox pipeline
  "reply-queue": "reply-attention-queue.json",
  "approved-sends": "reply-approved-sends.json",
  "reply-action-audit": "reply-action-audit.json",
  "processed-emails": "processed-emails.json",
  "inbox-responder-log": "inbox-responder-log.json",
  "inbox-processed": "agentic-inbox-processed.json",
  "inbox-backfill-processed": "agentic-inbox-backfill-processed.json",

  // Deliverability & sending
  "deliverability-guard": "agentic-deliverability-guard.json",
  "send-reconcile": "agentic-send-reconcile.json",

  // KPI & performance
  "kpi-tuning": "agentic-kpi-tuning.json",
  "template-performance": "agentic-template-performance.json",

  // Business data
  "quotes-pending": "agentic-quotes-pending.json",
  "reengagement-log": "agentic-reengagement-log.json",
  "faire-orders": "agentic-faire-orders.json",

  // FinOps
  "finops-transaction-cache": "finops-transaction-cache.json",
  "finops-invoice-cache": "finops-invoice-cache.json",
  "finops-reconciliation-state": "finops-reconciliation-state.json",

  // Scheduler
  "run-ledger-recent": "agentic-run-ledger-recent.json",

  // Amazon KPI caches
  "amazon-kpi-cache": "amazon-kpi-cache.json",
  "amazon-inventory-cache": "amazon-inventory-cache.json",
  "amazon-orders-cache": "amazon-orders-cache.json",

  // Notion integration
  "notion-kpi-snapshot": "notion-kpi-snapshot.json",
  "cash-position": "cash-position.json",

  // Finance / Banking
  "plaid-access-token": "plaid-access-token.json",
  "plaid-balance-cache": "plaid-balance-cache.json",
  "manual-cash-override": "manual-cash-override.json",
  "shopify-payments-cache": "shopify-payments-cache.json",
  "amazon-finance-cache": "amazon-finance-cache.json",

  // Pipeline
  "pipeline-cache": "pipeline-cache.json",
  "deal-emails-cache": "deal-emails-cache.json",

  // Forecasting & P&L
  "forecast-cache": "forecast-cache.json",
  "pnl-cache": "pnl-cache.json",

  // Ops dashboard caches
  "inventory-cache": "inventory-cache.json",
  "home-stock-baseline": "home-stock-baseline.json",
  "supply-chain-orders": "supply-chain-orders.json",
  "supply-chain-cache": "supply-chain-cache.json",
  "transactions-cache": "transactions-cache.json",
  "marketing-cache": "marketing-cache.json",
  "customers-cache": "customers-cache.json",
  "content-cache": "content-cache.json",
  "social-cache": "social-cache.json",
  "social-action-log": "social-action-log.json",
  "image-library-cache": "image-library-cache.json",
  "marketing-tests-cache": "marketing-tests-cache.json",
  "marketing-alerted-high-roas": "marketing-alerted-high-roas.json",
  "ad-campaigns-cache": "ad-campaigns-cache.json",
  "meta-ads-cache": "meta-ads-cache.json",
  "tiktok-ads-cache": "tiktok-ads-cache.json",
  "google-ads-cache": "google-ads-cache.json",
  "alerts-cache": "alerts-cache.json",
  "alerts-resolved": "alerts-resolved.json",
  "alerts-action-log": "alerts-action-log.json",
  "approvals-cache": "approvals-cache.json",
  "audit-cache": "audit-cache.json",
  "budgets-cache": "budgets-cache.json",
  "audit-cash-baseline": "audit-cash-baseline.json",
  "audit-inventory-baseline": "audit-inventory-baseline.json",
  "amazon-profitability": "amazon-profitability-cache.json",
  "supabase-circuit-state": "supabase-circuit-state.json",
  "integration-sla-report": "integration-sla-report.json",
  "chaos-suite-report": "chaos-suite-report.json",

  // Marketing auto-post
  "auto-post-log": "auto-post-log.json",

  // Communications
  "inbox-unified-cache": "inbox-unified-cache.json",
  "slack-history-cache": "slack-history-cache.json",

  // Abra brain sync
  "abra-email-ingest-cursor": "abra-email-ingest-cursor.json",
  "abra-notion-sync-cursor": "abra-notion-sync-cursor.json",
  "abra-model-governor": "abra-model-governor.json",
  "abra-scheduler-lock": "abra-scheduler-lock.json",
  "abra-vip-slack-threads": "abra-vip-slack-threads.json",
  "abra-awaiting-reply-alerts": "abra-awaiting-reply-alerts.json",
  "abra-stalled-deal-alerts": "abra-stalled-deal-alerts.json",

  // Logs (text, not JSON — stored as string)
  "engine-log": "agentic-engine.log",
  "command-center-log": "command-center.log",
  "command-center-pid": "command-center.pid",
  "command-center-status-log": "command-center-status-log.json",
  "command-center-status-cache": "command-center-status-cache.json",
} as const;

export type StateKey = keyof typeof STATE_KEYS;

/** Resolve a state key to its local filesystem path */
export function keyToFilePath(key: StateKey): string {
  return path.join(CONFIG_DIR, STATE_KEYS[key]);
}

/** KV key prefix for Vercel KV */
export function kvKey(key: StateKey): string {
  return `usag:${key}`;
}
