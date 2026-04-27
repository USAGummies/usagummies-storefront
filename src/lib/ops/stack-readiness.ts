/**
 * Stack-readiness manifest — Phase 28L.3.
 *
 * One record per external service we depend on. Backs the
 * `/ops/stack-readiness` dashboard so an operator can see at a
 * glance which integrations are healthy vs degraded vs broken,
 * what each one's degraded-mode behavior is, and what the
 * replacement option looks like if it goes down for good.
 *
 * Inspired by Nate B. Jones, "You're Building AI Agents on Layers
 * That Won't Exist in 18 Months" (Apr 21, 2026): "stack literacy"
 * is the missing discipline. This module is our literacy artifact.
 *
 * Why this matters: Make.com being broken since ~Apr 13 was
 * silently undermining the wholesale lead → HubSpot deal hop for
 * two weeks. Nobody noticed because no surface displayed
 * "Make.com webhook failing." Stack-readiness closes that gap.
 *
 * Hard rules:
 *   - **Probes are bounded** (10s timeout). A slow service can't
 *     hang the dashboard.
 *   - **Probes are read-only.** No state changes; just an "are you
 *     alive" check.
 *   - **No probe means no fabrication.** Services without a probe
 *     surface as `status: "unprobed"` with a manual-check note.
 *   - **Maturity is honest.** 1 = well-maintained / 5 =
 *     deprecation-likely-within-18-months. Forces us to flag
 *     fragile dependencies.
 */
export type StackLayer =
  | "compute"
  | "storage"
  | "integration"
  | "auth"
  | "marketplace";

export type StackStatus = "ok" | "degraded" | "down" | "unprobed";

export type StackMaturity = 1 | 2 | 3 | 4 | 5;

export interface StackServiceManifest {
  /** Stable id, kebab-case. Used as a URL slug + audit key. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Which architectural layer this lives in. */
  layer: StackLayer;
  /** Env vars required for the service to function. */
  envVars: readonly string[];
  /**
   * Maturity rating 1-5:
   *   1 = battle-tested core (Vercel, Slack)
   *   2 = stable but watchable
   *   3 = working but signs of fragility
   *   4 = broken or known-flaky right now
   *   5 = on the deprecation runway / replacing soon
   */
  maturity: StackMaturity;
  /** Plain-language description of what breaks when this is down. */
  degradedMode: string;
  /** What we'd replace it with if it dies for good. */
  replacement: string;
  /** Optional last-known-issue note. */
  knownIssue?: string;
}

export interface StackProbeResult {
  status: StackStatus;
  /** Brief one-line message — surfaced on the row. */
  message: string;
  /** Latency in ms; null when unprobed. */
  latencyMs: number | null;
  /** ISO timestamp of the probe. */
  probedAt: string;
}

export interface StackServiceRow extends StackServiceManifest, StackProbeResult {
  /** Whether all required env vars are configured. */
  envOk: boolean;
  /** Names of missing env vars (subset of envVars). */
  envMissing: readonly string[];
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export const STACK_SERVICES: readonly StackServiceManifest[] = [
  {
    id: "vercel",
    name: "Vercel (hosting + cron)",
    layer: "compute",
    envVars: [],
    maturity: 1,
    degradedMode: "Site offline. Cron jobs don't fire. EVERYTHING blocked.",
    replacement: "Self-hosted Next.js on Fly.io / Railway. ~1 day migration.",
  },
  {
    id: "vercel-kv",
    name: "Vercel KV (Upstash Redis)",
    layer: "storage",
    envVars: ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
    maturity: 1,
    degradedMode:
      "Dedup locks fail open (auto-ship may double-buy). Audit log writes silently drop. Customer registry stops upserting.",
    replacement: "Upstash directly, or Postgres + Redis on the host.",
  },
  {
    id: "slack",
    name: "Slack (chat.write + files.write + channels.history)",
    layer: "integration",
    envVars: ["SLACK_BOT_TOKEN"],
    maturity: 1,
    degradedMode:
      "#shipping label upload fails — labels still buy in ShipStation, but operator must reprint manually from ShipStation. Daily brief skips. Approvals click handler degraded.",
    replacement:
      "No real replacement; Slack IS the operator surface. Outages are recoverable via direct ShipStation reprint.",
  },
  {
    id: "shipstation",
    name: "ShipStation v1 API",
    layer: "marketplace",
    envVars: ["SHIPSTATION_API_KEY", "SHIPSTATION_API_SECRET"],
    maturity: 2,
    degradedMode:
      "Auto-ship pipeline halts. No new labels buy. Recent-shipments lookup fails. Existing labels still printable from ShipStation web.",
    replacement:
      "Stamps.com direct + Easypost as a unified label-buy. Multi-week migration.",
  },
  {
    id: "amazon-sp-api",
    name: "Amazon SP-API",
    layer: "marketplace",
    envVars: [
      "LWA_CLIENT_ID",
      "LWA_CLIENT_SECRET",
      "LWA_REFRESH_TOKEN",
      "AMAZON_SELLER_ID",
    ],
    maturity: 2,
    degradedMode:
      "Order-item quantity lookup fails (would compromise packing-slip qty). FBM unshipped queue stops. ShipStation channel sync still mirrors orders.",
    replacement:
      "ShipStation alone (loses precision on quantity / SKU details).",
  },
  {
    id: "shopify-storefront",
    name: "Shopify Storefront API",
    layer: "marketplace",
    envVars: ["SHOPIFY_STOREFRONT_ACCESS_TOKEN", "SHOPIFY_STORE_DOMAIN"],
    maturity: 1,
    degradedMode: "Public storefront product pages + cart degrade. Checkout still functions via Shop Pay.",
    replacement: "None — Shopify IS the storefront.",
  },
  {
    id: "shopify-admin",
    name: "Shopify Admin API",
    layer: "marketplace",
    envVars: ["SHOPIFY_ADMIN_TOKEN", "SHOPIFY_STORE_DOMAIN"],
    maturity: 1,
    degradedMode:
      "Order management / fulfillment tracking sync fails. Booth-order Shopify mirror skips. Manual order queries via Shopify Admin UI still work.",
    replacement: "None — Shopify IS the order system.",
  },
  {
    id: "hubspot",
    name: "HubSpot (CRM + Deals)",
    layer: "integration",
    envVars: ["HUBSPOT_PRIVATE_APP_TOKEN"],
    maturity: 2,
    degradedMode:
      "/api/leads HubSpot deal-create fails (silent skip; Notion mirror + KV archive still capture). /api/booth-order HubSpot writes degrade. Faire send-on-approve mirror goes blind.",
    replacement: "Pipedrive or Attio + a thin sync layer. ~1 week migration.",
  },
  {
    id: "make-com",
    name: "Make.com (legacy automation bridge)",
    layer: "integration",
    envVars: ["LEADS_WEBHOOK_URL"],
    maturity: 4,
    degradedMode:
      "Was the bridge for /wholesale → HubSpot. Eliminated as a hard dependency in Phase 1.b — direct HubSpot wire bypasses it. Now legacy: only impacts automation Ben hasn't migrated.",
    replacement: "Already replaced for the wholesale path. Other Make.com scenarios should migrate to direct API calls.",
    knownIssue: "Broken since ~Apr 13, 2026 per project memory. Ben to fix or fully retire.",
  },
  {
    id: "quickbooks-online",
    name: "QuickBooks Online (QBO)",
    layer: "integration",
    envVars: [
      "QBO_CLIENT_ID",
      "QBO_CLIENT_SECRET",
      "QBO_REALM_ID",
      "QBO_REFRESH_TOKEN",
    ],
    maturity: 3,
    degradedMode:
      "All accounting writes (vendor master, invoice, bill, deposit) fail. Receipt-review packet flow blocks at the QBO-write boundary. Booth-order invoice creation skips.",
    replacement: "Xero (multi-month migration).",
    knownIssue:
      "Chart-of-accounts rebuild in progress; qbo.bill.create.from-receipt slug PARKED awaiting Rene's mapping.",
  },
  {
    id: "google-drive",
    name: "Google Drive (durable artifact storage)",
    layer: "storage",
    envVars: [
      "GMAIL_OAUTH_CLIENT_ID",
      "GMAIL_OAUTH_CLIENT_SECRET",
      "GMAIL_OAUTH_REFRESH_TOKEN",
      "GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID",
    ],
    maturity: 2,
    degradedMode:
      "Shipping artifact PDFs land in Slack only (60-day audit window). NCS / vendor-doc uploads fail. AP packet attachments fail.",
    replacement: "Vercel Blob or Cloudflare R2. ~1 day migration.",
  },
  {
    id: "gmail",
    name: "Gmail (outbound + draft)",
    layer: "integration",
    envVars: [
      "GMAIL_OAUTH_CLIENT_ID",
      "GMAIL_OAUTH_CLIENT_SECRET",
      "GMAIL_OAUTH_REFRESH_TOKEN",
    ],
    maturity: 1,
    degradedMode:
      "All outbound email (Faire send-on-approve, AP packet send, customer support reply) fails. Drafts can't be created.",
    replacement: "Postmark / Resend for transactional; manual for ad-hoc.",
  },
  {
    id: "notion",
    name: "Notion (B2B pipeline + doctrine)",
    layer: "integration",
    envVars: ["NOTION_API_KEY"],
    maturity: 2,
    degradedMode:
      "B2B pipeline writes from /api/leads silently drop (non-fatal — KV archive backs it up). Vendor dossier creation fails. Notion canon read-only.",
    replacement: "Local markdown archive + manual sync. Already partially the case via /contracts/.",
  },
  {
    id: "nextauth",
    name: "NextAuth (operator session)",
    layer: "auth",
    envVars: ["NEXTAUTH_SECRET", "AUTH_SECRET"],
    maturity: 1,
    degradedMode:
      "Operator dashboard /ops/* unauthenticated. CRON_SECRET still works for API routes. Public storefront unaffected.",
    replacement: "Lucia / WorkOS / Auth.js v5. Same surface, different implementation.",
  },
  {
    id: "ga4",
    name: "Google Analytics 4 (analytics + reporting)",
    layer: "integration",
    envVars: ["GA4_PROPERTY_ID", "GA4_SERVICE_ACCOUNT_JSON"],
    maturity: 2,
    degradedMode:
      "Daily report traffic numbers go null. Public storefront still tracks (client-side gtag). KPI dashboards lose the traffic component.",
    replacement: "Plausible / Fathom. ~few hours migration but loses goal/conversion history.",
  },
  {
    id: "stamps-com",
    name: "Stamps.com (USPS label provider via ShipStation)",
    layer: "marketplace",
    envVars: [],
    maturity: 1,
    degradedMode:
      "USPS labels fail. UPS labels still buy via UPS Walleted carrier. Auto-ship falls back to UPS-only.",
    replacement: "EasyPost / Pirate Ship for direct USPS.",
  },
  {
    id: "plaid",
    name: "Plaid (bank balance for cash gates)",
    layer: "integration",
    envVars: ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ACCESS_TOKEN"],
    maturity: 2,
    degradedMode:
      "Wallet check on auto-ship goes blind (still buys labels — no cash gate). Daily brief cash-position line goes null.",
    replacement: "Manual BoA pull or QBO bank-feed sync.",
  },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute env-var presence for a single service. Pure. */
export function checkEnvVars(
  service: StackServiceManifest,
  env: Record<string, string | undefined> = process.env,
): { envOk: boolean; envMissing: string[] } {
  if (service.envVars.length === 0) {
    return { envOk: true, envMissing: [] };
  }
  const missing = service.envVars.filter(
    (name) => !((env[name] ?? "").trim().length > 0),
  );
  return { envOk: missing.length === 0, envMissing: missing };
}

/**
 * Combine a probe result + env check into the final per-row status.
 *
 * Rules:
 *   - envMissing → status="down", because no probe can succeed without env.
 *   - probe="ok" + env ok → "ok"
 *   - probe="degraded" → "degraded" (probe ran but partial response)
 *   - probe="down" → "down"
 *   - probe="unprobed" → "unprobed"
 */
export function combineProbeAndEnv(
  service: StackServiceManifest,
  probe: StackProbeResult,
  envCheck: { envOk: boolean; envMissing: string[] },
): StackServiceRow {
  const status: StackStatus = !envCheck.envOk ? "down" : probe.status;
  const message = !envCheck.envOk
    ? `Env vars not configured: ${envCheck.envMissing.join(", ")}`
    : probe.message;
  return {
    ...service,
    ...probe,
    status,
    message,
    envOk: envCheck.envOk,
    envMissing: envCheck.envMissing,
  };
}

export interface StackReadinessSummary {
  total: number;
  ok: number;
  degraded: number;
  down: number;
  unprobed: number;
  /** Average maturity score across services. */
  averageMaturity: number;
}

/** Pure summarizer. */
export function summarizeStack(
  rows: readonly StackServiceRow[],
): StackReadinessSummary {
  let ok = 0,
    degraded = 0,
    down = 0,
    unprobed = 0,
    maturitySum = 0;
  for (const r of rows) {
    if (r.status === "ok") ok += 1;
    else if (r.status === "degraded") degraded += 1;
    else if (r.status === "down") down += 1;
    else unprobed += 1;
    maturitySum += r.maturity;
  }
  return {
    total: rows.length,
    ok,
    degraded,
    down,
    unprobed,
    averageMaturity: rows.length === 0 ? 0 : maturitySum / rows.length,
  };
}

/**
 * Build a no-probe result for services we don't actively check.
 * `unprobed` is honest — we don't fabricate a "probably ok" status.
 */
export function noProbe(message: string): StackProbeResult {
  return {
    status: "unprobed",
    message,
    latencyMs: null,
    probedAt: new Date().toISOString(),
  };
}

/**
 * Build a probe result wrapping a fetch call. Bounds the call at
 * 10s, captures latency, and never throws — failures map to
 * `status: "down"`.
 */
export async function probeFetch(opts: {
  url: string;
  init?: RequestInit;
  okPredicate?: (status: number, body: string) => boolean;
}): Promise<StackProbeResult> {
  const start = Date.now();
  const probedAt = new Date(start).toISOString();
  try {
    const res = await fetch(opts.url, {
      ...opts.init,
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text().catch(() => "");
    const latencyMs = Date.now() - start;
    const ok = opts.okPredicate
      ? opts.okPredicate(res.status, text)
      : res.ok;
    return {
      status: ok ? "ok" : "down",
      message: ok ? `${res.status} OK in ${latencyMs}ms` : `HTTP ${res.status}`,
      latencyMs,
      probedAt,
    };
  } catch (err) {
    return {
      status: "down",
      message: `Probe failed: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: Date.now() - start,
      probedAt,
    };
  }
}
