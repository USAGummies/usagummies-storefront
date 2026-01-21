const BLOCKED_CHECKOUT_PREFIXES = ["/cart/", "/checkout"];

function sanitizeHost(value?: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    return url.host;
  } catch {
    return null;
  }
}

function getCheckoutDomainOverride() {
  const isServer = typeof window === "undefined";

  if (isServer) {
    const explicit =
      sanitizeHost(process.env.SHOPIFY_CHECKOUT_DOMAIN) ||
      sanitizeHost(process.env.NEXT_PUBLIC_SHOPIFY_CHECKOUT_DOMAIN);
    if (explicit) return explicit;

    const endpoint =
      sanitizeHost(process.env.SHOPIFY_STOREFRONT_API_ENDPOINT) ||
      sanitizeHost(process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_ENDPOINT);
    if (endpoint) return endpoint;

    const storeDomain =
      sanitizeHost(process.env.SHOPIFY_STORE_DOMAIN) ||
      sanitizeHost(process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN) ||
      sanitizeHost(process.env.SHOPIFY_DOMAIN) ||
      sanitizeHost(process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN);
    if (storeDomain && storeDomain.endsWith(".myshopify.com")) return storeDomain;
  } else {
    const explicit = sanitizeHost(process.env.NEXT_PUBLIC_SHOPIFY_CHECKOUT_DOMAIN);
    if (explicit) return explicit;

    const endpoint = sanitizeHost(process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_ENDPOINT);
    if (endpoint) return endpoint;

    const storeDomain =
      sanitizeHost(process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN) ||
      sanitizeHost(process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN);
    if (storeDomain && storeDomain.endsWith(".myshopify.com")) return storeDomain;
  }

  return null;
}

export function normalizeCheckoutUrl(checkoutUrl: string | null | undefined) {
  if (!checkoutUrl) return null;
  const trimmed = checkoutUrl.trim();
  if (!trimmed) return null;

  const overrideHost = getCheckoutDomainOverride();
  if (trimmed.startsWith("/")) {
    return overrideHost ? `https://${overrideHost}${trimmed}` : trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (overrideHost) parsed.host = overrideHost;
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

export function getSafeCheckoutUrl(
  checkoutUrl: string | null | undefined,
  context: string,
  currentHost?: string | null
) {
  const normalized = normalizeCheckoutUrl(checkoutUrl);
  if (!normalized) return null;

  if (normalized.startsWith("/")) {
    console.error("[checkout] Blocked invalid checkout URL", {
      context,
      checkoutUrl: normalized,
    });
    return null;
  }

  try {
    const parsed = new URL(normalized);
    const isSameHost =
      currentHost && parsed.host.toLowerCase() === currentHost.toLowerCase();
    if (
      isSameHost &&
      BLOCKED_CHECKOUT_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix))
    ) {
      console.error("[checkout] Blocked same-origin checkout URL", {
        context,
        checkoutUrl: normalized,
      });
      return null;
    }
    if (isSameHost) {
      console.error("[checkout] Blocked same-origin checkout URL", {
        context,
        checkoutUrl: normalized,
      });
      return null;
    }
  } catch {
    console.error("[checkout] Blocked invalid checkout URL", {
      context,
      checkoutUrl: normalized,
    });
    return null;
  }

  return normalized;
}
