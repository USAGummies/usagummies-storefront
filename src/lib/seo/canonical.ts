export type CanonicalSearchParams =
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | null
  | undefined;

type CanonicalInput = {
  pathname: string;
  searchParams?: CanonicalSearchParams;
  siteUrl?: string;
};

const STRIP_PARAM_KEYS = new Set([
  // Shopify/product params
  "variant",
  "quantity",
  "selling_plan",
  "preview_theme_id",
  "preview_script_id",
  "preview",
  "view",
  "section_id",
  // Shopify storefront/search
  "_pos",
  "_psq",
  "_ss",
  "_sid",
  "_s",
  "_url",
  "_fid",
  "_ref",
  "_branch_match_id",
  "_branch_referrer",
  // Marketing/tracking
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "gclid",
  "gclsrc",
  "gad_source",
  "wbraid",
  "gbraid",
  "fbclid",
  "msclkid",
  "ttclid",
  "twclid",
  "igshid",
  "srsltid",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "irclickid",
  "irgwc",
  "cmpid",
  "ref",
  "source",
  "aff",
  "aff_id",
  // Collection sorting
  "sort_by",
]);

const STRIP_PARAM_PREFIXES = ["utm_", "filter."] as const;

function shouldStripParam(key: string) {
  const normalized = key.toLowerCase();
  if (STRIP_PARAM_KEYS.has(normalized)) return true;
  return STRIP_PARAM_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function normalizeSearchParams(input?: CanonicalSearchParams) {
  if (!input) return new URLSearchParams();
  if (input instanceof URLSearchParams) {
    return new URLSearchParams(input.toString());
  }
  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
      return;
    }
    params.set(key, value);
  });
  return params;
}

function cleanSearchParams(input?: CanonicalSearchParams) {
  const params = normalizeSearchParams(input);
  for (const key of Array.from(params.keys())) {
    if (shouldStripParam(key)) params.delete(key);
  }
  return params;
}

function normalizePathname(pathname: string) {
  if (!pathname) return "/";
  const withSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (withSlash.length === 1) return withSlash;
  return withSlash.replace(/\/+$/, "");
}

function mapDuplicateRoutes(pathname: string) {
  if (pathname === "/collections") return "/shop";
  return pathname;
}

function isPaginatedListing(pathname: string) {
  if (pathname === "/shop") return true;
  if (pathname.startsWith("/collections/")) return true;
  if (pathname.startsWith("/blogs/")) {
    const segments = pathname.split("/").filter(Boolean);
    return segments.length === 2;
  }
  return false;
}

function parsePageParam(params: URLSearchParams) {
  const raw = params.get("page");
  if (!raw) return null;
  const page = Number.parseInt(raw, 10);
  if (!Number.isFinite(page) || page < 2) return null;
  return page;
}

export function resolveSiteUrl() {
  const preferred = "https://www.usagummies.com";
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || null;
  const nodeEnv = (process.env.NODE_ENV as string | undefined) || "";
  if (fromEnv && fromEnv.includes("usagummies.com")) return fromEnv.replace(/\/$/, "");
  if (nodeEnv === "production") return preferred;
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : null;
  if (vercel) return vercel;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (nodeEnv !== "production") return "http://localhost:3000";
  return preferred;
}

export function buildCanonicalUrl({ pathname, searchParams, siteUrl }: CanonicalInput) {
  const base = (siteUrl || resolveSiteUrl()).replace(/\/$/, "");
  const normalizedPath = normalizePathname(pathname);
  const canonicalPath = mapDuplicateRoutes(normalizedPath);
  const cleaned = cleanSearchParams(searchParams);
  const output = new URLSearchParams();

  if (isPaginatedListing(canonicalPath)) {
    const page = parsePageParam(cleaned);
    if (page) output.set("page", String(page));
  }

  const query = output.toString();
  return `${base}${canonicalPath}${query ? `?${query}` : ""}`;
}
