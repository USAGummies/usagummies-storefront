# AGENTS.md — USA Gummies Storefront

## Scope Rules
- Default to the smallest possible change set; do not touch unrelated sections.
- Do NOT change pricing/discount logic, bundle math, cart behavior, inventory rules, or backend/Shopify logic unless explicitly requested.
- Do NOT add new features or steps; only layout/style/hierarchy changes unless specified.
- Preserve copy meaning; repositioning is allowed only when explicitly requested.
- Before editing, list the exact target files you will touch.
- If a request conflicts with these rules, ask for clarification before changing scope.

## Acceptance Checks
### Homepage purchase rail (product image + bundle selector + CTA)
- Right column is a single full-height purchase rail (no floating card with dead space).
- Bundle selection is a segmented control (5 / 8 / 12); no tiles, pills, or highlighted rows.
- Only one price anchor line ("Total $XX.XX") and one savings line.
- One primary CTA ("Shop & save").
- Trust stack + Amazon helper + rating live inside the rail bottom.
- No extra cards, grids, or repeated CTAs.
- Mobile stacks cleanly with no blank void.

### Cart drawer (express checkout)
- Express pay uses real SVG logos (Shop Pay / Apple Pay / Google Pay).
- Express row is visually secondary to “Secure checkout”.
- No placeholder text or input-like button styling.

## Component Locations (Exact)
- Homepage module (product + bundle UI):
  - `src/app/page.tsx` (homepage section wiring + layout)
  - `src/components/home/BundleQuickBuy.client.tsx` (purchase rail UI/logic)
  - `src/app/globals.css` (atomic-buy / purchase rail styling)
- Cart drawer:
  - `src/components/ui/CartView.tsx`
  - `public/payments/shop-pay.svg`
  - `public/payments/apple-pay.svg`
  - `public/payments/google-pay.svg`

## Test/Deploy Expectations
- Run `npm run lint` when asked for internal tests.
- Run `npm run build` only when explicitly requested.
- Always report what was run and the result.
