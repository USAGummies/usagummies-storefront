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

## 1) Required environment variables (Shopify)

Create `.env.local` in the project root:

```bash
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_STOREFRONT_ACCESS_TOKEN=your_storefront_token
```

Optional (recommended for canonical URLs in metadata):

```bash
NEXT_PUBLIC_SITE_URL=https://www.usagummies.com
```

---

## 2) Optional integrations (plug-and-play)

These are **safe** when unset. The site remains fast and functional without them.

### Google Analytics 4

```bash
NEXT_PUBLIC_GA4_ID=G-XXXXXXXXXX
```

### Meta Pixel

```bash
NEXT_PUBLIC_META_PIXEL_ID=1234567890
```

### Instagram feed (@usagummies)

The site uses a **server-side** fetch via `/api/instagram` so tokens are never exposed to the browser.

```bash
INSTAGRAM_USER_ID=your_instagram_user_id
INSTAGRAM_ACCESS_TOKEN=your_long_lived_token
```

If unset, the Instagram section renders a clean fallback CTA instead of breaking the page.

---

## 3) Amazon reviews (single source of truth)

Reviews are intentionally implemented as a **stable trust system** (not scraping).

Paste real review data into:

`src/data/amazonReviews.ts`

Once filled, reviews automatically render:

- Home hero trust line
- PDP purchase area (near bundles/pricing)
- Cart confidence area

---

## 4) Local development

```bash
npm install
npm run dev
```

Open: http://localhost:3000

---

## 5) Deploy

Deploy to Vercel (recommended) or any Node host.

Ensure your environment variables are set in the host dashboard.
