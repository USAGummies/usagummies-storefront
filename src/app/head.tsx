export default function Head() {
  const domains = new Set<string>();
  domains.add("https://cdn.shopify.com");

  const storeDomain =
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
    process.env.SHOPIFY_STORE_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN ||
    process.env.SHOPIFY_DOMAIN;
  if (storeDomain) {
    const clean = storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    domains.add(`https://${clean}`);
  }

  const hrefs = Array.from(domains);

  return (
    <>
      {hrefs.map((href) => (
        <link key={`preconnect-${href}`} rel="preconnect" href={href} crossOrigin="anonymous" />
      ))}
      {hrefs.map((href) => (
        <link key={`dns-${href}`} rel="dns-prefetch" href={href} />
      ))}
    </>
  );
}
