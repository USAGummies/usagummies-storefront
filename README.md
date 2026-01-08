# USA Gummies — Headless Shopify Storefront (Launch Build)

This is the **launch-ready** USA Gummies headless storefront built with:

- Next.js (App Router)
- Shopify Storefront API (live product data)
- Tailwind CSS
- Custom cart + drawer (no Shopify apps)

The build is designed to be **stable and regression-resistant**:

- ONE shop page
- ONE product card system
- ONE PDP purchase system (bundle ladder)
- ONE cart system (drawer + cart page)
- ONE reviews system (single source of truth)
- ONE Instagram integration (single route + single UI)

---

## Shopify environment variables (required)

Create `.env.local` in the project root (or set these in your shell/CI):

- `SHOPIFY_STORE_DOMAIN=your-store.myshopify.com`
- `SHOPIFY_STOREFRONT_ACCESS_TOKEN=<your storefront token>`
- `SHOPIFY_STOREFRONT_API_VERSION=2024-07` (optional, defaults to 2024-07 if omitted)
- Optional override: `SHOPIFY_STOREFRONT_API_ENDPOINT=https://your-store.myshopify.com/api/2024-07/graphql.json`

Optional (recommended for canonical URLs in metadata):

- `NEXT_PUBLIC_SITE_URL=https://www.usagummies.com`

### Bundle tier mapping (5/8/12)

Preferred: product metafield `usagummies.bundle_tiers` with JSON:

```json
{
  "5":  { "variantId": "gid://shopify/ProductVariant/...", "qty": 5 },
  "8":  { "variantId": "gid://shopify/ProductVariant/...", "qty": 8 },
  "12": { "variantId": "gid://shopify/ProductVariant/...", "qty": 12 }
}
```

## Canonical UI module: BundleQuickBuy

- `src/components/home/BundleQuickBuy.client.tsx` is the canonical bundle selector UI and must be reused across Homepage/Shop/PDP/Cart surfaces.
- Its design language, copy, pill/tier mapping, savings framing, and CTA behavior are locked; only bug fixes/accessibility fixes/approved strategy changes may alter it.
