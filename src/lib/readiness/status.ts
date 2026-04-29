/**
 * Pure helpers for the read-only Production Readiness dashboard.
 *
 * These helpers take a snapshot of *which* env vars are present
 * (boolean flags only — never values) and produce the structured
 * status the dashboard renders. They also shape route-probe results
 * (`{ ok, status, error? }`) into a consistent display row.
 *
 * Hard rules locked by tests:
 *   - The output NEVER includes raw env values. Inputs are booleans
 *     and tests assert no actual secret strings appear in
 *     JSON.stringify(output).
 *   - Fallback chains are surfaced explicitly ("UPLOAD parent serves
 *     as the fallback for shipping artifacts"). Operators see what's
 *     covering for what.
 *   - Empty / missing input fails closed: a missing flag is
 *     "missing", never "ready by default".
 */

// ----- Env status ----------------------------------------------------

/**
 * Environment fingerprint. Each field is a boolean — `true` means the
 * env var is set to a non-empty trimmed string in the runtime, `false`
 * means it isn't. The dashboard's API route reads `process.env` and
 * builds this fingerprint without ever exposing the actual values.
 */
export interface EnvFingerprint {
  // OAuth + Drive — required for durable uploads + AP packet sends.
  GMAIL_OAUTH_CLIENT_ID: boolean;
  GMAIL_OAUTH_CLIENT_SECRET: boolean;
  GMAIL_OAUTH_REFRESH_TOKEN: boolean;
  // Drive parent folders — fallback chain.
  GOOGLE_DRIVE_UPLOAD_PARENT_ID: boolean;
  GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID: boolean;
  GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID: boolean;
  // Wholesale inquiry portal — token mint secret.
  WHOLESALE_INQUIRY_SECRET: boolean;
  // OpenAI / ChatGPT workspace connector — dedicated bearer secret.
  OPENAI_WORKSPACE_CONNECTOR_SECRET: boolean;
  // Slack — bot token + signing secret.
  SLACK_BOT_TOKEN: boolean;
  SLACK_SIGNING_SECRET: boolean;
  // Cron + KV — cross-platform basics.
  CRON_SECRET: boolean;
  KV_REST_API_URL: boolean;
  KV_REST_API_TOKEN: boolean;
}

export type EnvFlagStatus = "ready" | "missing" | "fallback";

export interface EnvFlagRow {
  key: keyof EnvFingerprint | string;
  status: EnvFlagStatus;
  /** Human-readable explanation of what this env unblocks. */
  purpose: string;
  /**
   * When `status === "fallback"`, the human-readable name of the env
   * var actually in use. Operators see "shipping artifacts: using
   * GOOGLE_DRIVE_UPLOAD_PARENT_ID as fallback".
   */
  fallbackFrom?: string;
  /** When `status === "missing"`, the impact in plain English. */
  impactWhenMissing?: string;
}

export interface EnvStatus {
  /** Per-env rows in stable display order. */
  rows: EnvFlagRow[];
  /** Counts for the dashboard summary band. */
  totals: {
    ready: number;
    fallback: number;
    missing: number;
  };
}

const PURPOSES: Record<string, { purpose: string; impactWhenMissing: string }> =
  {
    GMAIL_OAUTH_CLIENT_ID: {
      purpose: "OAuth client id shared by Gmail + Drive primitives.",
      impactWhenMissing:
        "AP packet sends, email-intel drafts, and Drive uploads cannot authenticate.",
    },
    GMAIL_OAUTH_CLIENT_SECRET: {
      purpose: "OAuth client secret shared by Gmail + Drive primitives.",
      impactWhenMissing:
        "AP packet sends, email-intel drafts, and Drive uploads cannot authenticate.",
    },
    GMAIL_OAUTH_REFRESH_TOKEN: {
      purpose:
        "Long-lived refresh token granting drive + gmail.modify + gmail.send.",
      impactWhenMissing:
        "Every Gmail / Drive write fails. Re-mint via /api/ops/fulfillment/oauth-consent-url.",
    },
    GOOGLE_DRIVE_UPLOAD_PARENT_ID: {
      purpose:
        "Drive folder where the public NCS-001 / W-9 / COI / vendor-form / receipt uploads land.",
      impactWhenMissing:
        "/upload/ncs and /wholesale/inquiry doc-upload widgets fail closed with HTTP 503.",
    },
    GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID: {
      purpose: "Drive folder for auto-ship label + packing-slip artifacts.",
      impactWhenMissing:
        "Auto-ship continues to buy labels and post to Slack, but no Drive backup is written. Falls back to GOOGLE_DRIVE_UPLOAD_PARENT_ID when set.",
    },
    GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID: {
      purpose: "Drive folder for vendor-onboarding dossiers.",
      impactWhenMissing:
        "Vendor onboarding's per-vendor folder is silently skipped. Approval flow + QBO write still work.",
    },
    WHOLESALE_INQUIRY_SECRET: {
      purpose:
        "HMAC secret that signs the sticky wholesale inquiry receipt URL.",
      impactWhenMissing:
        "/api/leads omits inquiryUrl on wholesale submissions; the form's existing success state still works, but no bookmarkable receipt page.",
    },
    OPENAI_WORKSPACE_CONNECTOR_SECRET: {
      purpose:
        "Bearer secret for the ChatGPT workspace MCP connector. Existing ops session/CRON auth still works internally.",
      impactWhenMissing:
        "ChatGPT custom connector cannot authenticate with a stable bearer token; internal ops users can still access the route through normal ops auth.",
    },
    SLACK_BOT_TOKEN: {
      purpose: "Bot token used for Slack file uploads + thread posts.",
      impactWhenMissing:
        "Slack file upload + canonical channel posts fail. Approvals still record in the store; only the mirror is degraded.",
    },
    SLACK_SIGNING_SECRET: {
      purpose:
        "Verifies inbound Slack interactivity signatures on /api/slack/approvals.",
      impactWhenMissing:
        "Slack approve/reject clicks fail closed (503). Approvals can still be opened and decided server-side.",
    },
    CRON_SECRET: {
      purpose: "Bearer token for scheduled jobs + cross-route auth fallbacks.",
      impactWhenMissing:
        "Vercel cron + ops scripts cannot authenticate. Most ops routes 401 from CLI / scheduler.",
    },
    KV_REST_API_URL: {
      purpose: "Vercel KV REST endpoint.",
      impactWhenMissing:
        "Every KV-backed feature degrades: receipts, drafts, dedup, freight-comp queue, approval store cache.",
    },
    KV_REST_API_TOKEN: {
      purpose: "Vercel KV REST token.",
      impactWhenMissing:
        "Every KV-backed feature degrades: receipts, drafts, dedup, freight-comp queue, approval store cache.",
    },
  };

const ENV_DISPLAY_ORDER: Array<keyof EnvFingerprint> = [
  "CRON_SECRET",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "GMAIL_OAUTH_CLIENT_ID",
  "GMAIL_OAUTH_CLIENT_SECRET",
  "GMAIL_OAUTH_REFRESH_TOKEN",
  "GOOGLE_DRIVE_UPLOAD_PARENT_ID",
  "GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID",
  "GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID",
  "WHOLESALE_INQUIRY_SECRET",
  "OPENAI_WORKSPACE_CONNECTOR_SECRET",
];

export function deriveEnvStatus(fingerprint: EnvFingerprint): EnvStatus {
  const rows: EnvFlagRow[] = ENV_DISPLAY_ORDER.map((key) => {
    const present = Boolean(fingerprint[key]);
    const meta = PURPOSES[key] ?? {
      purpose: "(no description)",
      impactWhenMissing: "Feature unavailable.",
    };

    // Fallback handling for the Drive parent chain.
    if (key === "GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID" && !present) {
      const uploadParent = Boolean(
        fingerprint.GOOGLE_DRIVE_UPLOAD_PARENT_ID,
      );
      const vendorParent = Boolean(
        fingerprint.GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID,
      );
      if (uploadParent || vendorParent) {
        return {
          key,
          status: "fallback",
          purpose: meta.purpose,
          fallbackFrom: uploadParent
            ? "GOOGLE_DRIVE_UPLOAD_PARENT_ID"
            : "GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID",
        };
      }
    }
    if (key === "GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID" && !present) {
      const uploadParent = Boolean(fingerprint.GOOGLE_DRIVE_UPLOAD_PARENT_ID);
      if (uploadParent) {
        return {
          key,
          status: "fallback",
          purpose: meta.purpose,
          fallbackFrom: "GOOGLE_DRIVE_UPLOAD_PARENT_ID",
        };
      }
    }

    if (present) {
      return { key, status: "ready", purpose: meta.purpose };
    }
    return {
      key,
      status: "missing",
      purpose: meta.purpose,
      impactWhenMissing: meta.impactWhenMissing,
    };
  });

  const totals = rows.reduce(
    (acc, r) => {
      acc[r.status] += 1;
      return acc;
    },
    { ready: 0, fallback: 0, missing: 0 },
  );
  return { rows, totals };
}

// ----- Probe status --------------------------------------------------

export type ProbeOutcome = "ready" | "degraded" | "error" | "skipped";

export interface ProbeRow {
  url: string;
  /** Operator-friendly label. */
  label: string;
  outcome: ProbeOutcome;
  /** HTTP status if a fetch happened. */
  httpStatus?: number;
  /** Short detail string; never raw response bodies / never PII. */
  detail?: string;
}

export interface ProbeInput {
  url: string;
  label: string;
  /** Raw fetch result — `null` when the fetch was deliberately skipped. */
  response: { ok: boolean; status: number } | null;
  /** Network / parse error if the fetch threw. */
  error?: string | null;
}

/**
 * Convert a fetch result into a stable ProbeRow. Pure — caller is
 * responsible for actually doing the network call.
 */
export function deriveProbeStatus(input: ProbeInput): ProbeRow {
  if (input.error) {
    return {
      url: input.url,
      label: input.label,
      outcome: "error",
      detail: truncate(input.error, 200),
    };
  }
  if (input.response === null) {
    return {
      url: input.url,
      label: input.label,
      outcome: "skipped",
      detail: "Probe deliberately skipped (auth-gated public surface).",
    };
  }
  const { ok, status } = input.response;
  if (ok) {
    return {
      url: input.url,
      label: input.label,
      outcome: "ready",
      httpStatus: status,
    };
  }
  // 503 and 5xx → "degraded" (server says "I'm not ready") rather than
  // "error" (network failure). Lets the dashboard distinguish "config
  // missing" from "route doesn't exist."
  if (status >= 500 && status <= 599) {
    return {
      url: input.url,
      label: input.label,
      outcome: "degraded",
      httpStatus: status,
      detail: `HTTP ${status} — server reports a configuration or upstream issue.`,
    };
  }
  return {
    url: input.url,
    label: input.label,
    outcome: "error",
    httpStatus: status,
    detail: `HTTP ${status}`,
  };
}

// ----- Manual smoke checklist ---------------------------------------

export interface SmokeCheckItem {
  href: string;
  label: string;
  description: string;
  /** Surface category. */
  surface: "public" | "operator";
}

/**
 * Stable list of smoke-test surfaces operators visit by hand.
 * The dashboard renders these as a checklist with click-through links.
 */
export const SMOKE_CHECKLIST: readonly SmokeCheckItem[] = [
  // Public — clickable from any browser.
  {
    href: "/where-to-buy",
    label: "/where-to-buy",
    description:
      "Store locator: count + states + grouped list render. Empty state copy if RETAILERS were empty.",
    surface: "public",
  },
  {
    href: "/wholesale",
    label: "/wholesale",
    description:
      "Wholesale lead form. After submit with WHOLESALE_INQUIRY_SECRET set, redirects to /wholesale/inquiry/<token>.",
    surface: "public",
  },
  {
    href: "/account/login",
    label: "/account/login",
    description:
      "Customer login form. Posts to /api/member action=login. Use a real Shopify customer for a smoke.",
    surface: "public",
  },
  {
    href: "/account/recover",
    label: "/account/recover",
    description: "Password recover flow. Always shows a success state.",
    surface: "public",
  },
  // Operator — auth-gated.
  {
    href: "/ops/shipping",
    label: "/ops/shipping",
    description:
      "Live preflight + recent labels. Verify Artifacts column populates after the next auto-ship cron.",
    surface: "operator",
  },
  {
    href: "/ops/finance/review",
    label: "/ops/finance/review",
    description:
      "Read-only Monday finance review. Receipts / approvals / freight-comp / AP packets.",
    surface: "operator",
  },
  {
    href: "/ops/ap-packets",
    label: "/ops/ap-packets",
    description:
      "Roster + JJ detail + Drafts (template-built). Send-on-approve verified by approving an AP packet card in #ops-approvals.",
    surface: "operator",
  },
  {
    href: "/ops/locations",
    label: "/ops/locations",
    description:
      "Internal ingest review queue. Status dropdowns + review notes work; nothing publishes to /where-to-buy.",
    surface: "operator",
  },
  {
    href: "/api/ops/openai-workspace-tools/mcp",
    label: "OpenAI workspace MCP",
    description:
      "Read-only ChatGPT connector endpoint. GET should show search/fetch tools; POST search/fetch stays read-only.",
    surface: "operator",
  },
];

// ----- helpers -------------------------------------------------------

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}
