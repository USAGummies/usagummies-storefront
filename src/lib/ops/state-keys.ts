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
  "supply-chain-orders": "supply-chain-orders.json",
  "supply-chain-cache": "supply-chain-cache.json",
  "transactions-cache": "transactions-cache.json",
  "marketing-cache": "marketing-cache.json",
  "alerts-cache": "alerts-cache.json",
  "alerts-resolved": "alerts-resolved.json",
  "alerts-action-log": "alerts-action-log.json",
  "audit-cache": "audit-cache.json",
  "budgets-cache": "budgets-cache.json",
  "audit-cash-baseline": "audit-cash-baseline.json",
  "audit-inventory-baseline": "audit-inventory-baseline.json",

  // Communications
  "inbox-unified-cache": "inbox-unified-cache.json",
  "slack-history-cache": "slack-history-cache.json",

  // Logs (text, not JSON — stored as string)
  "engine-log": "agentic-engine.log",
  "command-center-log": "command-center.log",
  "command-center-pid": "command-center.pid",
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
