const BLOCKED_CHECKOUT_PREFIXES = ["/cart/", "/checkout"];
const BLOCKED_HOSTS = new Set(["www.usagummies.com"]);

export function getSafeCheckoutUrl(
  checkoutUrl: string | null | undefined,
  context: string,
  currentHost?: string | null
) {
  if (!checkoutUrl) return null;

  if (BLOCKED_CHECKOUT_PREFIXES.some((prefix) => checkoutUrl.startsWith(prefix))) {
    console.error("[checkout] Blocked invalid checkout URL", {
      context,
      checkoutUrl,
    });
    return null;
  }

  try {
    const parsed = new URL(checkoutUrl);
    if (BLOCKED_CHECKOUT_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix))) {
      console.error("[checkout] Blocked invalid checkout URL", {
        context,
        checkoutUrl,
      });
      return null;
    }
    const host = parsed.host.toLowerCase();
    if (BLOCKED_HOSTS.has(host) || (currentHost && host === currentHost.toLowerCase())) {
      console.error("[checkout] Blocked same-origin checkout URL", {
        context,
        checkoutUrl,
      });
      return null;
    }
  } catch {
    console.error("[checkout] Blocked invalid checkout URL", {
      context,
      checkoutUrl,
    });
    return null;
  }

  return checkoutUrl;
}
