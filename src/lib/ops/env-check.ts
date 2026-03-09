import { getNotionApiKey } from "@/lib/notion/credentials";

type EnvShape = Record<string, string | undefined>;

export type IntegrationPriority = "p0" | "p1" | "p2";
export type IntegrationHealthState =
  | "connected"
  | "not_configured"
  | "stale_credentials";

export type IntegrationStatus = {
  key: string;
  name: string;
  configured: boolean;
  status: IntegrationHealthState;
  priority: IntegrationPriority;
  owner: string;
  runbookUrl: string;
  staleReason: string | null;
  envVars: { key: string; set: boolean }[];
};

export type IntegrationSLAReport = {
  weekKey: string;
  generatedAt: string;
  summary: {
    total: number;
    connected: number;
    notConfigured: number;
    staleCredentials: number;
    coveragePct: number;
  };
  topBacklog: Array<{
    key: string;
    name: string;
    priority: IntegrationPriority;
    status: IntegrationHealthState;
    owner: string;
    runbookUrl: string;
    staleReason: string | null;
  }>;
};

type IntegrationDefinition = {
  key: string;
  name: string;
  owner: string;
  runbookUrl: string;
  priority: IntegrationPriority;
  // Any one group can satisfy configuration; all vars in that group must be set.
  groups: string[][];
  rotationEnv?: string;
  staleAfterDays?: number;
  rotationRequired?: boolean;
};

const DEFINITIONS: IntegrationDefinition[] = [
  {
    key: "shopify_admin",
    name: "Shopify Admin",
    owner: "Revenue Ops",
    runbookUrl: "/docs/investor-readiness/operational-readiness-brief.md",
    priority: "p0",
    groups: [["SHOPIFY_ADMIN_TOKEN"]],
    rotationEnv: "SHOPIFY_ADMIN_TOKEN_ROTATED_AT",
    staleAfterDays: 90,
    rotationRequired: true,
  },
  {
    key: "shopify_storefront",
    name: "Shopify Storefront",
    owner: "Web Platform",
    runbookUrl: "/docs/investor-readiness/command-center-walkthrough.md",
    priority: "p1",
    groups: [["NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN"]],
  },
  {
    key: "notion",
    name: "Notion",
    owner: "Ops Systems",
    runbookUrl: "/docs/investor-readiness/notion-governance-slide.md",
    priority: "p0",
    groups: [["NOTION_API_KEY"]],
    rotationEnv: "NOTION_API_KEY_ROTATED_AT",
    staleAfterDays: 90,
  },
  {
    key: "gmail",
    name: "Gmail",
    owner: "Ops Systems",
    runbookUrl: "/docs/investor-readiness/operational-readiness-brief.md",
    priority: "p0",
    groups: [
      ["GMAIL_SERVICE_ACCOUNT_JSON"],
      [
        "GMAIL_OAUTH_CLIENT_ID",
        "GMAIL_OAUTH_CLIENT_SECRET",
        "GMAIL_OAUTH_REFRESH_TOKEN",
      ],
    ],
    rotationEnv: "GMAIL_OAUTH_REFRESH_TOKEN_ROTATED_AT",
    staleAfterDays: 90,
    rotationRequired: true,
  },
  {
    key: "ga4",
    name: "GA4",
    owner: "Growth Ops",
    runbookUrl: "/docs/investor-readiness/operational-readiness-brief.md",
    priority: "p1",
    groups: [["GA4_SERVICE_ACCOUNT_JSON"], ["GOOGLE_APPLICATION_CREDENTIALS"]],
    rotationEnv: "GA4_SERVICE_ACCOUNT_ROTATED_AT",
    staleAfterDays: 180,
  },
  {
    key: "plaid",
    name: "Plaid",
    owner: "Finance Ops",
    runbookUrl: "/docs/investor-readiness/supabase-rto-rpo-runbook.md",
    priority: "p0",
    groups: [["PLAID_CLIENT_ID", "PLAID_SECRET"]],
    rotationEnv: "PLAID_SECRET_ROTATED_AT",
    staleAfterDays: 90,
    rotationRequired: true,
  },
  {
    key: "amazon_sp_api",
    name: "Amazon SP-API",
    owner: "Marketplace Ops",
    runbookUrl: "/docs/investor-readiness/operational-readiness-brief.md",
    priority: "p0",
    groups: [["AMAZON_SP_REFRESH_TOKEN"]],
    rotationEnv: "AMAZON_SP_REFRESH_TOKEN_ROTATED_AT",
    staleAfterDays: 90,
    rotationRequired: true,
  },
  {
    key: "slack",
    name: "Slack",
    owner: "Ops Systems",
    runbookUrl: "/docs/investor-readiness/deployment-control-log.md",
    priority: "p1",
    groups: [["SLACK_WEBHOOK_ALERTS"]],
    rotationEnv: "SLACK_WEBHOOK_ROTATED_AT",
    staleAfterDays: 180,
  },
  {
    key: "nextauth",
    name: "NextAuth",
    owner: "Web Platform",
    runbookUrl: "/docs/investor-readiness/command-center-walkthrough.md",
    priority: "p0",
    groups: [["NEXTAUTH_SECRET", "NEXTAUTH_URL"]],
  },
  {
    key: "qstash",
    name: "QStash",
    owner: "Ops Systems",
    runbookUrl: "/docs/investor-readiness/deployment-control-log.md",
    priority: "p0",
    groups: [["QSTASH_TOKEN"]],
    rotationEnv: "QSTASH_TOKEN_ROTATED_AT",
    staleAfterDays: 90,
  },
  {
    key: "vercel_kv",
    name: "Vercel KV",
    owner: "Platform",
    runbookUrl: "/docs/investor-readiness/deployment-control-log.md",
    priority: "p1",
    groups: [["KV_REST_API_URL", "KV_REST_API_TOKEN"]],
  },
  {
    key: "supabase",
    name: "Supabase",
    owner: "Platform",
    runbookUrl: "/docs/investor-readiness/supabase-rto-rpo-runbook.md",
    priority: "p0",
    groups: [["SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL"]],
    rotationEnv: "SUPABASE_SERVICE_ROLE_ROTATED_AT",
    staleAfterDays: 90,
    rotationRequired: true,
  },
  {
    key: "openai",
    name: "OpenAI",
    owner: "AI Systems",
    runbookUrl: "/docs/investor-readiness/operational-readiness-brief.md",
    priority: "p1",
    groups: [["OPENAI_API_KEY"]],
    rotationEnv: "OPENAI_API_KEY_ROTATED_AT",
    staleAfterDays: 120,
  },
  {
    key: "gemini",
    name: "Gemini",
    owner: "AI Systems",
    runbookUrl: "/docs/investor-readiness/operational-readiness-brief.md",
    priority: "p2",
    groups: [["GEMINI_API_KEY"]],
    rotationEnv: "GEMINI_API_KEY_ROTATED_AT",
    staleAfterDays: 120,
  },
  {
    key: "meta_ads",
    name: "Meta Ads",
    owner: "Growth Ops",
    runbookUrl: "/docs/investor-readiness/operational-readiness-brief.md",
    priority: "p1",
    groups: [["META_ACCESS_TOKEN"]],
    rotationEnv: "META_ACCESS_TOKEN_ROTATED_AT",
    staleAfterDays: 90,
  },
  {
    key: "tiktok_ads",
    name: "TikTok Ads",
    owner: "Growth Ops",
    runbookUrl: "/docs/investor-readiness/operational-readiness-brief.md",
    priority: "p2",
    groups: [["TIKTOK_ACCESS_TOKEN"]],
    rotationEnv: "TIKTOK_ACCESS_TOKEN_ROTATED_AT",
    staleAfterDays: 90,
  },
  {
    key: "google_ads",
    name: "Google Ads",
    owner: "Growth Ops",
    runbookUrl: "/docs/investor-readiness/operational-readiness-brief.md",
    priority: "p1",
    groups: [["GOOGLE_ADS_DEVELOPER_TOKEN"]],
    rotationEnv: "GOOGLE_ADS_DEVELOPER_TOKEN_ROTATED_AT",
    staleAfterDays: 120,
  },
  {
    key: "klaviyo",
    name: "Klaviyo",
    owner: "Lifecycle Marketing",
    runbookUrl: "/docs/investor-readiness/operational-readiness-brief.md",
    priority: "p1",
    groups: [["KLAVIYO_API_KEY"]],
    rotationEnv: "KLAVIYO_API_KEY_ROTATED_AT",
    staleAfterDays: 120,
  },
  {
    key: "resend",
    name: "Resend",
    owner: "Lifecycle Marketing",
    runbookUrl: "/docs/investor-readiness/operational-readiness-brief.md",
    priority: "p2",
    groups: [["RESEND_API_KEY"]],
    rotationEnv: "RESEND_API_KEY_ROTATED_AT",
    staleAfterDays: 120,
  },
  {
    key: "twilio",
    name: "Twilio",
    owner: "Ops Systems",
    runbookUrl: "/docs/investor-readiness/operational-readiness-brief.md",
    priority: "p2",
    groups: [["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]],
    rotationEnv: "TWILIO_AUTH_TOKEN_ROTATED_AT",
    staleAfterDays: 120,
  },
  {
    key: "sentry",
    name: "Sentry",
    owner: "Platform",
    runbookUrl: "/docs/investor-readiness/deployment-control-log.md",
    priority: "p2",
    groups: [["SENTRY_AUTH_TOKEN"]],
    rotationEnv: "SENTRY_AUTH_TOKEN_ROTATED_AT",
    staleAfterDays: 180,
  },
  {
    key: "firebase",
    name: "Firebase",
    owner: "Platform",
    runbookUrl: "/docs/investor-readiness/deployment-control-log.md",
    priority: "p2",
    groups: [["FIREBASE_SERVICE_ACCOUNT_JSON"]],
    rotationEnv: "FIREBASE_SERVICE_ACCOUNT_ROTATED_AT",
    staleAfterDays: 180,
  },
  {
    key: "shipstation",
    name: "ShipStation",
    owner: "Fulfillment Ops",
    runbookUrl: "/docs/investor-readiness/operational-readiness-brief.md",
    priority: "p2",
    groups: [["SHIPSTATION_API_KEY", "SHIPSTATION_API_SECRET"]],
    rotationEnv: "SHIPSTATION_API_SECRET_ROTATED_AT",
    staleAfterDays: 120,
  },
  {
    key: "airtable",
    name: "Airtable",
    owner: "Ops Systems",
    runbookUrl: "/docs/investor-readiness/operational-readiness-brief.md",
    priority: "p2",
    groups: [["AIRTABLE_API_KEY"]],
    rotationEnv: "AIRTABLE_API_KEY_ROTATED_AT",
    staleAfterDays: 180,
  },
];

function priorityWeight(priority: IntegrationPriority): number {
  if (priority === "p0") return 0;
  if (priority === "p1") return 1;
  return 2;
}

function isoWeekKey(now: Date): string {
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function getRaw(env: EnvShape, key: string): string {
  return String(env[key] || "").trim();
}

function isSet(
  env: EnvShape,
  key: string,
  options?: { useNotionCredentialLookup?: boolean },
): boolean {
  if (key === "NOTION_API_KEY" && options?.useNotionCredentialLookup) {
    return Boolean(getNotionApiKey());
  }
  return Boolean(getRaw(env, key));
}

function staleReasonFor(
  def: IntegrationDefinition,
  env: EnvShape,
): string | null {
  if (!def.rotationEnv) return null;

  const raw = getRaw(env, def.rotationEnv);
  if (!raw) {
    return def.rotationRequired
      ? `Missing ${def.rotationEnv}; cannot verify credential freshness.`
      : null;
  }

  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) {
    return `Invalid ${def.rotationEnv} timestamp.`;
  }

  const staleAfterDays = def.staleAfterDays ?? 90;
  const ageDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  if (ageDays > staleAfterDays) {
    return `Credential age ${Math.floor(ageDays)}d exceeds ${staleAfterDays}d.`;
  }
  return null;
}

export function checkIntegrations(opts?: {
  env?: EnvShape;
  now?: Date;
}): IntegrationStatus[] {
  const env = opts?.env ?? (process.env as EnvShape);
  const useNotionCredentialLookup = !opts?.env;

  return DEFINITIONS.map((def) => {
    const keySet = new Set<string>();
    for (const group of def.groups) {
      for (const key of group) keySet.add(key);
    }
    if (def.rotationEnv) keySet.add(def.rotationEnv);

    const envVars = [...keySet].map((key) => ({
      key,
      set: isSet(env, key, { useNotionCredentialLookup }),
    }));
    const configured = def.groups.some((group) =>
      group.every((key) => isSet(env, key, { useNotionCredentialLookup })),
    );

    const staleReason = configured ? staleReasonFor(def, env) : null;
    const status: IntegrationHealthState = !configured
      ? "not_configured"
      : staleReason
        ? "stale_credentials"
        : "connected";

    return {
      key: def.key,
      name: def.name,
      configured,
      status,
      priority: def.priority,
      owner: def.owner,
      runbookUrl: def.runbookUrl,
      staleReason,
      envVars,
    };
  });
}

export function buildIntegrationSLAReport(opts?: {
  now?: Date;
  env?: EnvShape;
}): IntegrationSLAReport {
  const now = opts?.now ?? new Date();
  const details = checkIntegrations({ env: opts?.env, now });
  const connected = details.filter((d) => d.status === "connected").length;
  const notConfigured = details.filter((d) => d.status === "not_configured").length;
  const staleCredentials = details.filter((d) => d.status === "stale_credentials").length;
  const total = details.length;
  const coveragePct = total > 0 ? Math.round((connected / total) * 1000) / 10 : 0;

  const topBacklog = details
    .filter((d) => d.status !== "connected")
    .sort((a, b) => {
      const pr = priorityWeight(a.priority) - priorityWeight(b.priority);
      if (pr !== 0) return pr;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 5)
    .map((item) => ({
      key: item.key,
      name: item.name,
      priority: item.priority,
      status: item.status,
      owner: item.owner,
      runbookUrl: item.runbookUrl,
      staleReason: item.staleReason,
    }));

  return {
    weekKey: isoWeekKey(now),
    generatedAt: now.toISOString(),
    summary: {
      total,
      connected,
      notConfigured,
      staleCredentials,
      coveragePct,
    },
    topBacklog,
  };
}
