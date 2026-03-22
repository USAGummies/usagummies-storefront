/**
 * Abra Runtime Config — Loads business values from Supabase config table
 *
 * Replaces hardcoded values with configurable runtime settings.
 * Falls back to defaults if Supabase is unavailable.
 */

type ConfigValue = string | number | boolean | Record<string, unknown>;

const DEFAULTS: Record<string, ConfigValue> = {
  // Unit economics
  "cogs.forward_per_unit": 1.557,
  "cogs.albanese_per_unit": 0.919,
  "cogs.belmark_per_unit": 0.144,
  "cogs.powers_per_unit": 0.385,
  "cogs.freight_per_unit": 0.109,

  // Pricing
  "pricing.amazon_sell_price": 5.99,
  "pricing.dtc_msrp": 4.99,
  "pricing.wholesale_floor_margin": 0.20,
  "pricing.wholesale_target_margin": 0.35,

  // Thresholds
  "threshold.transaction_auto_exec_max": 500,
  "threshold.qbo_transaction_max": 5000,
  "threshold.inventory_adjustment_max": 500,
  "threshold.capex_threshold": 2500,
  "threshold.inventory_reorder_days": 30,
  "threshold.inventory_critical_days": 14,
  "threshold.vendor_followup_stale_days": 5,

  // Budget
  "budget.ai_monthly": 1000,
  "budget.monthly_fixed_costs": 900,

  // Packaging
  "packaging.units_per_case": 6,
  "packaging.cases_per_master_carton": 6,
  "packaging.min_production_order": 25000,
  "packaging.production_lead_time_days": 21,

  // Amazon fees
  "fees.amazon_referral_pct": 0.15,
  "fees.shopify_processing_pct": 0.029,
  "fees.shopify_processing_fixed": 0.30,

  // Product
  "product.asin": "B0G1JK92TJ",
  "product.name": "USA Gummies Dye Free Gummy Bears",
  "product.size": "7.5 oz",
};

let _cache: Record<string, ConfigValue> | null = null;
let _cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function loadFromSupabase(): Promise<Record<string, ConfigValue>> {
  const env = getSupabaseEnv();
  if (!env) return {};

  try {
    const res = await fetch(
      `${env.baseUrl}/rest/v1/abra_config?select=key,value&limit=200`,
      {
        headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return {};

    const rows = (await res.json()) as Array<{ key: string; value: unknown }>;
    if (!Array.isArray(rows)) return {};

    const config: Record<string, ConfigValue> = {};
    for (const row of rows) {
      if (typeof row.key === "string" && row.value != null) {
        config[row.key] = row.value as ConfigValue;
      }
    }
    return config;
  } catch {
    return {};
  }
}

/**
 * Get a config value by key. Checks Supabase first, falls back to defaults.
 */
export async function getConfig<T extends ConfigValue = ConfigValue>(key: string): Promise<T> {
  // Check cache
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) {
    return (_cache[key] ?? DEFAULTS[key] ?? null) as T;
  }

  // Reload
  try {
    const remote = await loadFromSupabase();
    _cache = { ...DEFAULTS, ...remote };
    _cacheTime = Date.now();
  } catch {
    if (!_cache) _cache = { ...DEFAULTS };
  }

  return (_cache[key] ?? DEFAULTS[key] ?? null) as T;
}

/**
 * Get a numeric config value.
 */
export async function getConfigNum(key: string): Promise<number> {
  const val = await getConfig(key);
  return typeof val === "number" ? val : Number(val) || (DEFAULTS[key] as number) || 0;
}

/**
 * Get all config values (for display/export).
 */
export async function getAllConfig(): Promise<Record<string, ConfigValue>> {
  if (!_cache || Date.now() - _cacheTime > CACHE_TTL) {
    const remote = await loadFromSupabase();
    _cache = { ...DEFAULTS, ...remote };
    _cacheTime = Date.now();
  }
  return { ..._cache };
}

/**
 * Invalidate cache (call after updating config).
 */
export function invalidateConfigCache(): void {
  _cache = null;
  _cacheTime = 0;
}
