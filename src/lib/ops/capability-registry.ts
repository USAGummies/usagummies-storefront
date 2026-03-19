/**
 * Capability / Freshness Registry for Abra
 *
 * Tracks the health of every external integration so Abra can answer:
 * "What can I access right now, what is stale, what is blocked?"
 *
 * Storage: Vercel KV with keys `abra:cap:{name}` (1-hour TTL).
 * On KV failure everything returns "unknown" — never throws.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CapabilityStatus = "healthy" | "degraded" | "down" | "unknown";

export type CapabilityEntry = {
  name: string;
  displayName: string;
  status: CapabilityStatus;
  lastSuccessAt: string | null;  // ISO timestamp
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  consecutiveErrors: number;
  ttlMinutes: number;  // healthy → unknown after this many minutes without a success
};

export type CapabilitySummary = {
  healthy: string[];
  degraded: string[];
  down: string[];
  unknown: string[];
  checkedAt: string;
};

// ---------------------------------------------------------------------------
// Capability definitions
// ---------------------------------------------------------------------------

type CapabilityDefinition = {
  displayName: string;
  ttlMinutes: number;
};

const CAPABILITY_DEFS: Record<string, CapabilityDefinition> = {
  shopify_storefront: { displayName: "Shopify Storefront API", ttlMinutes: 30 },
  shopify_admin:     { displayName: "Shopify Admin API",       ttlMinutes: 30 },
  supabase:          { displayName: "Supabase (Brain/Memory)",  ttlMinutes: 60 },
  gmail:             { displayName: "Gmail (Email)",            ttlMinutes: 60 },
  qbo:               { displayName: "QuickBooks Online",        ttlMinutes: 120 },
  notion:            { displayName: "Notion (CRM/Docs)",        ttlMinutes: 60 },
  anthropic:         { displayName: "Anthropic (Claude LLM)",   ttlMinutes: 30 },
  openai:            { displayName: "OpenAI (Embeddings)",      ttlMinutes: 60 },
  slack:             { displayName: "Slack (Notifications)",    ttlMinutes: 60 },
  amazon:            { displayName: "Amazon SP-API",            ttlMinutes: 120 },
  vercel_kv:         { displayName: "Vercel KV (State)",        ttlMinutes: 30 },
  qstash:            { displayName: "QStash (Scheduling)",      ttlMinutes: 60 },
};

export const CAPABILITY_NAMES = Object.keys(CAPABILITY_DEFS) as (keyof typeof CAPABILITY_DEFS)[];

// ---------------------------------------------------------------------------
// KV helpers — lazy-load, never throw
// ---------------------------------------------------------------------------

type KVClient = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<string | null>;
};

let _kv: KVClient | null = null;

async function getKV(): Promise<KVClient | null> {
  try {
    if (!_kv) {
      const mod = await import("@vercel/kv");
      _kv = mod.kv as KVClient;
    }
    return _kv;
  } catch {
    return null;
  }
}

function capKey(name: string): string {
  return `abra:cap:${name}`;
}

const KV_TTL_SECONDS = 60 * 60; // 1 hour

type StoredEntry = {
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  consecutiveErrors: number;
};

const EMPTY_STORED: StoredEntry = {
  lastSuccessAt: null,
  lastErrorAt: null,
  lastErrorMessage: null,
  consecutiveErrors: 0,
};

async function readStored(name: string): Promise<StoredEntry | null> {
  const kv = await getKV();
  if (!kv) return null;
  try {
    const val = await kv.get<StoredEntry>(capKey(name));
    return val ?? null;
  } catch {
    return null;
  }
}

async function writeStored(name: string, entry: StoredEntry): Promise<void> {
  const kv = await getKV();
  if (!kv) return;
  try {
    await kv.set(capKey(name), entry, { ex: KV_TTL_SECONDS });
  } catch {
    // KV down — silently ignore
  }
}

// ---------------------------------------------------------------------------
// Status computation
// ---------------------------------------------------------------------------

function computeStatus(stored: StoredEntry | null, ttlMinutes: number): CapabilityStatus {
  if (!stored || stored.lastSuccessAt === null) {
    // No data at all — if we've never had a success but have errors, that's down
    if (stored && stored.consecutiveErrors >= 3) return "down";
    if (stored && stored.consecutiveErrors >= 1) return "degraded";
    return "unknown";
  }

  const lastSuccessMs = Date.parse(stored.lastSuccessAt);
  if (Number.isNaN(lastSuccessMs)) return "unknown";

  const ageMinutes = (Date.now() - lastSuccessMs) / 60_000;
  const withinTTL = ageMinutes <= ttlMinutes;

  if (stored.consecutiveErrors >= 3) return "down";
  if (stored.consecutiveErrors >= 1) return withinTTL ? "degraded" : "down";
  if (!withinTTL) return "down";
  return "healthy";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a successful call to a capability.
 * Resets consecutive error count and stores current timestamp.
 */
export async function markSuccess(capability: string): Promise<void> {
  const stored = (await readStored(capability)) ?? { ...EMPTY_STORED };
  await writeStored(capability, {
    ...stored,
    lastSuccessAt: new Date().toISOString(),
    consecutiveErrors: 0,
  });
}

/**
 * Record a failed call to a capability.
 * Increments consecutive error count and sets error metadata.
 */
export async function markFailure(capability: string, error?: string): Promise<void> {
  const stored = (await readStored(capability)) ?? { ...EMPTY_STORED };
  await writeStored(capability, {
    ...stored,
    lastErrorAt: new Date().toISOString(),
    lastErrorMessage: error ?? null,
    consecutiveErrors: stored.consecutiveErrors + 1,
  });
}

/**
 * Get the full status entry for a single capability.
 * Returns "unknown" if KV is unavailable or no data exists.
 */
export async function getStatus(capability: string): Promise<CapabilityEntry> {
  const def = CAPABILITY_DEFS[capability];
  const displayName = def?.displayName ?? capability;
  const ttlMinutes = def?.ttlMinutes ?? 60;

  const stored = await readStored(capability);
  const status = computeStatus(stored, ttlMinutes);

  return {
    name: capability,
    displayName,
    status,
    lastSuccessAt: stored?.lastSuccessAt ?? null,
    lastErrorAt: stored?.lastErrorAt ?? null,
    lastErrorMessage: stored?.lastErrorMessage ?? null,
    consecutiveErrors: stored?.consecutiveErrors ?? 0,
    ttlMinutes,
  };
}

/**
 * Get a summary of all registered capabilities grouped by status.
 */
export async function getAllCapabilities(): Promise<CapabilitySummary> {
  const entries = await Promise.all(CAPABILITY_NAMES.map((name) => getStatus(name)));

  const summary: CapabilitySummary = {
    healthy: [],
    degraded: [],
    down: [],
    unknown: [],
    checkedAt: new Date().toISOString(),
  };

  for (const entry of entries) {
    summary[entry.status].push(entry.name);
  }

  return summary;
}

/**
 * Quick boolean check — returns false if status is anything other than "healthy".
 */
export async function isHealthy(capability: string): Promise<boolean> {
  const entry = await getStatus(capability);
  return entry.status === "healthy";
}

/**
 * Returns a human-readable, prompt-friendly string describing the current
 * status of all capabilities. Suitable for inclusion in LLM system prompts.
 *
 * Example output:
 *   ✅ Shopify Storefront API: healthy (12m ago) | ⚠️ QuickBooks Online: degraded | ❌ Gmail: down (3 errors)
 */
export async function getCapabilityContext(): Promise<string> {
  const entries = await Promise.all(CAPABILITY_NAMES.map((name) => getStatus(name)));
  const nowMs = Date.now();

  const parts = entries.map((entry) => {
    const icon =
      entry.status === "healthy"  ? "✅" :
      entry.status === "degraded" ? "⚠️" :
      entry.status === "down"     ? "❌" :
                                    "❓";

    const details: string[] = [];

    if (entry.lastSuccessAt) {
      const ageMinutes = Math.round((nowMs - Date.parse(entry.lastSuccessAt)) / 60_000);
      if (ageMinutes < 60) {
        details.push(`last ok ${ageMinutes}m ago`);
      } else {
        const ageHours = Math.round(ageMinutes / 60);
        details.push(`last ok ${ageHours}h ago`);
      }
    }

    if (entry.consecutiveErrors > 0) {
      details.push(`${entry.consecutiveErrors} consecutive error${entry.consecutiveErrors !== 1 ? "s" : ""}`);
    }

    if (entry.lastErrorMessage && entry.status !== "healthy") {
      const truncated = entry.lastErrorMessage.slice(0, 60);
      details.push(`"${truncated}${entry.lastErrorMessage.length > 60 ? "…" : ""}"`);
    }

    const detailStr = details.length > 0 ? ` (${details.join(", ")})` : "";
    return `${icon} ${entry.displayName}: ${entry.status}${detailStr}`;
  });

  return parts.join(" | ");
}
