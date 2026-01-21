const BLOCKED_CHECKOUT_PREFIXES = ["/cart/", "/checkout"];

export function getSafeCheckoutUrl(
  checkoutUrl: string | null | undefined,
  context: string
) {
  if (!checkoutUrl) return null;
  if (BLOCKED_CHECKOUT_PREFIXES.some((prefix) => checkoutUrl.startsWith(prefix))) {
    console.error("[checkout] Blocked invalid checkout URL", {
      context,
      checkoutUrl,
    });
    return null;
  }
  return checkoutUrl;
}
