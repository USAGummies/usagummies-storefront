# CLAUDE.md — USA Gummies Storefront

## Project Overview
E-commerce storefront + ops platform for USA Gummies. Next.js 15 App Router deployed on Vercel (Hobby plan). Sells via Shopify (DTC) and Amazon (marketplace).

## Commands
- `npm run dev` — local dev server
- `npm run build` — production build (runs `verify:env` first)
- `npm run lint` — ESLint
- `npm run agentic:run-daily` — run all daily ops agents

## Architecture
- `src/app/` — Next.js App Router pages and API routes
- `src/app/ops/` — 15-page ops dashboard (auth-gated via NextAuth)
- `src/lib/` — shared libs (cart, Shopify client, ops utilities)
- `src/lib/ops/` — ops platform core (notify, email, state, engine runner)
- `scripts/` — standalone .mjs agent scripts (B2B outreach, SEO, supply chain, etc.)
- `content/blog/` — MDX blog posts (29 posts)

## Critical Rules
- **Git**: Only `main` branch. Never create feature branches. Vercel deploys every pushed branch.
- **Blog**: Commit MDX posts directly to main. Use `./scripts/add-blog-post.sh <slug>`.
- **Env vars**: Never add values with trailing `\n`. Use `printf '%s'` when piping to `vercel env add`.
- **Env var naming**: `src/` uses `NOTION_*_DB` convention, `scripts/` uses `NOTION_DB_*`. Both aliases must exist.
- **Deploys**: Vercel auto-deploys on push to main. No GitHub Actions.
- **Dependencies**: `.npmrc` has `legacy-peer-deps=true` — required for Vercel builds.

## Key Integrations
- **Shopify Storefront API** — product catalog, cart, checkout
- **Shopify Admin API** — order management, inventory
- **Amazon SP-API** — marketplace orders (requires LWA OAuth token exchange)
- **Notion API** — CRM (B2B prospects, distributors), agent run logs, daily reports, platform users
- **GA4** — analytics via service account
- **Upstash** — QStash (agent scheduling), Redis/KV (state persistence)
- **Slack** — notifications via webhook (single webhook with channel prefixes)
- **Gmail SMTP** — transactional email via `smtp.gmail.com:465`

## Thermal Label Printing (Polono PL70e-BT)
- **Printer**: Polono PL70e-BT via USB (`_PL70e_BT` in CUPS)
- **Label size**: 4×6 (100mm×150mm) die-cut shipping labels
- **Critical**: Must use `zeMediaTracking=Continuous` mode — Gap mode causes blank labels between prints
- **Print command** (no blanks):
  ```
  lp -d _PL70e_BT -o PageSize=w288h432 -o zeMediaTracking=Continuous -o page-top=0 -o page-bottom=0 -o page-left=0 -o page-right=0 -o fit-to-page -n <QTY> '<file>.pdf'
  ```
- **Label files**: `labels/` directory — case label, master carton label, interactive generator (`index.html`)
- **PDF generation**: Use Puppeteer (`/tmp/make-labels.mjs`) with `width: '100mm', height: '150mm'`, logo embedded as base64, barcodes via JsBarcode CDN
- **Logo for thermal**: CSS `filter: grayscale(1) contrast(10) brightness(0.75)` converts color logo to clean B&W

## Testing
No test suite configured. Verify changes via `npm run build` (catches TypeScript and build errors).
