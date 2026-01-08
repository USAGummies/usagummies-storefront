"use server";

type ShopifyResponse<T> = { data?: T; errors?: Array<{ message?: string }> };
type ShopifyResult<T> = { ok: boolean; data: T | null; skipped?: boolean; error?: string };

const SHOPIFY_TIMEOUT_MS = 5000;
const SKIP_SHOPIFY_FETCH = process.env.SKIP_SHOPIFY_FETCH === "1";
let warnedSkip = false;

export async function shopifyRequest<T>({
  endpoint,
  token,
  body,
  cache,
  next,
  warnPrefix = "Shopify",
}: {
  endpoint?: string;
  token?: string;
  body: Record<string, unknown>;
  cache?: RequestCache;
  next?: { revalidate?: number; tags?: string[] };
  warnPrefix?: string;
}): Promise<ShopifyResult<T>> {
  if (SKIP_SHOPIFY_FETCH) {
    if (!warnedSkip && process.env.NODE_ENV !== "production") {
      warnedSkip = true;
      // eslint-disable-next-line no-console
      console.warn(`[${warnPrefix}] Shopify fetch skipped (SKIP_SHOPIFY_FETCH=1)`);
    }
    return { ok: false, skipped: true, data: null, error: "skipped" };
  }

  if (!endpoint || !token) {
    return { ok: false, data: null, error: "missing config" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHOPIFY_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": token,
      },
      body: JSON.stringify(body),
      cache,
      next,
      signal: controller.signal,
    });

    const json = (await res.json().catch(() => null)) as ShopifyResponse<T> | null;
    if (!res.ok || !json || json.errors?.length) {
      return { ok: false, data: null, error: "request failed" };
    }

    return { ok: true, data: json.data ?? null };
  } catch (err: any) {
    const isAbort = err?.name === "AbortError";
    return { ok: false, data: null, error: isAbort ? "timeout" : "fetch failed" };
  } finally {
    clearTimeout(timeout);
  }
}
