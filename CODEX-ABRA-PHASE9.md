# CODEX-ABRA-PHASE9.md — Intelligence UI (Prompts 49-55)

> **Purpose**: Surface all backend intelligence in the ops dashboard with real-time
> visualizations, unified views, and mobile-responsive layouts.

---

## Global Rules (apply to every prompt)

### Code Style
- TypeScript strict, no `any` except where existing code uses `// eslint-disable`
- Imports: `@/lib/...` alias (not relative `../../`)
- Client components: `"use client"` at top, filename `*.client.tsx`
- Server page wrappers: `page.tsx` that imports client component
- All pages: `export const dynamic = "force-dynamic"`

### UI Patterns (MUST match existing codebase)
- **Charting**: Recharts 3.7.0 (`recharts` package already installed)
  - Import: `ResponsiveContainer, LineChart, Line, BarChart, Bar, ComposedChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend, PieChart, Pie, Cell`
- **Icons**: Lucide React (`lucide-react` already installed)
- **Design tokens** from `@/app/ops/tokens`:
  ```typescript
  NAVY = "#1B2A4A"       // Primary text, headers
  RED = "#c7362c"        // Alerts, negative deltas
  GOLD = "#c7a062"       // Accents, highlights
  CREAM = "#f8f5ef"      // Page background
  SIDEBAR_BG = "#0f1628" // Sidebar
  SURFACE_CARD = "#ffffff"     // Card backgrounds
  SURFACE_BORDER = "rgba(27,42,74,0.08)"  // Card borders
  SURFACE_TEXT_DIM = "rgba(27,42,74,0.56)" // Secondary text
  ```
- **Card pattern** (used everywhere):
  ```tsx
  <div style={{
    background: CARD, border: `1px solid ${BORDER}`,
    borderRadius: 12, padding: "20px 24px",
  }}>
  ```
- **No external UI libraries** — all components are custom inline-styled
- **Data fetching**: `useEffect` + `fetch()` inside client components
- **Loading states**: Use `SkeletonChart`, `SkeletonTable` from `@/app/ops/components/Skeleton`
- **Staleness**: Use `StalenessBadge` from `@/app/ops/components/StalenessBadge`
- **Refresh**: Use `RefreshButton` from `@/app/ops/components/RefreshButton`

### Navigation
- Ops nav defined in `src/app/ops/OpsShell.client.tsx` in `NAV_SECTIONS` array
- Format: `{ href: "/ops/<path>", label: "Label", icon: "emoji", roles: ["admin", ...] }`
- Two sections: "COMMAND" and "OPERATIONS"
- Add new pages to appropriate section

### API Pattern
- Routes at `src/app/api/ops/abra/<name>/route.ts`
- Auth: session check OR `Authorization: Bearer ${CRON_SECRET}`
- Response: JSON with typed payload
- Error: `{ error: string }` with appropriate status code

### Testing
No test suite. Validate with:
1. `npx tsc --noEmit` (type check)
2. `npm run build` (full build — must pass)

### Commits
One commit per prompt. Message format: `Abra v2 Prompt <N>: <short description>`
Do NOT push. Do NOT log to Notion.

---

## Prompt 49 — Unified Command Center

**Goal**: Replace the current ops landing page with a real-time command center showing today's key metrics, active signals, pending approvals, and system health — all on one screen.

### Create `src/app/ops/CommandCenter.client.tsx`

This is the new main landing page component for `/ops`.

**Layout** (single-page dashboard, no tabs):

```
┌─────────────────────────────────────────────────┐
│  TODAY'S PULSE                     March 10, 2026│
├──────────┬──────────┬──────────┬────────────────┤
│ Revenue  │ Orders   │ Sessions │  AOV           │
│ $1,247   │ 18       │ 342      │  $69.28        │
│ ▲ +12%   │ ▲ +5%    │ ▼ -3%    │  ▲ +7%         │
│ (vs 7d)  │ (vs 7d)  │ (vs 7d)  │  (vs 7d)       │
├──────────┴──────────┴──────────┴────────────────┤
│  ACTIVE SIGNALS (3)                              │
│  🔴 Low inventory: Berry Blast (12 units)       │
│  🟡 Amazon revenue spike: +45% vs avg           │
│  🔵 New wholesale inquiry from Faire            │
├─────────────────────────────────────────────────┤
│  PENDING ACTIONS (2)                             │
│  ⏳ Approve reorder for Powers Confections       │
│  ⏳ Review weekly digest before send             │
├──────────────────┬──────────────────────────────┤
│  SYSTEM HEALTH   │  FEED STATUS                 │
│  ✅ Shopify      │  ✅ 6/8 feeds ran today       │
│  ✅ Supabase     │  ⚠️ amazon_inventory stale    │
│  ❌ Amazon       │  Last run: 6:40am PT         │
│  ⚪ Faire        │                              │
└──────────────────┴──────────────────────────────┘
```

**Data sources** (fetch in parallel):

1. **Today's Pulse**: `GET /api/ops/abra/finance` — extract today's revenue/orders
   - Also query `kpi_timeseries` for 7-day averages to compute deltas
   - Create new API: `GET /api/ops/abra/pulse` that returns exactly:
     ```typescript
     {
       revenue: { shopify: number; amazon: number; total: number; vs7d: number };
       orders: { shopify: number; amazon: number; total: number; vs7d: number };
       sessions: { value: number; vs7d: number };
       aov: { value: number; vs7d: number };
       date: string;
     }
     ```

2. **Active Signals**: `GET /api/ops/abra/operational-signals` — show top 5 by severity

3. **Pending Actions**: `GET /api/ops/abra/approvals?status=pending` — count + list

4. **System Health**: `GET /api/ops/abra/health` — integration statuses

5. **Feed Status**: `GET /api/ops/abra/feed-health` — active feeds, last run times

### Create `src/app/api/ops/abra/pulse/route.ts`

**Endpoint**: `GET /api/ops/abra/pulse`
**Auth**: session or CRON_SECRET

Aggregates today's KPIs from `kpi_timeseries`:
- Query today and last 7 days for: `daily_revenue_shopify`, `daily_revenue_amazon`, `daily_orders_shopify`, `daily_orders_amazon`, `daily_sessions`, `daily_aov`
- Compute 7-day averages
- Return the pulse object

### Update `src/app/ops/page.tsx`

Replace existing page with:
```typescript
import type { Metadata } from "next";
import { CommandCenter } from "./CommandCenter.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Command Center" };

export default function OpsPage() {
  return <CommandCenter />;
}
```

### Update nav in OpsShell.client.tsx

Change the "Command Center" nav item to use icon "🎯" instead of "🏛️" (optional cosmetic).

**Commit**: `Abra v2 Prompt 49: unified command center with real-time pulse, signals, and health`

---

## Prompt 50 — KPI Charts & Trend Visualization

**Goal**: Upgrade the KPIs page with real Recharts visualizations showing daily revenue, orders, traffic, and AOV with trendlines over 30 days.

### Create `src/app/api/ops/abra/kpi-history/route.ts`

**Endpoint**: `GET /api/ops/abra/kpi-history?days=30&metrics=daily_revenue_shopify,daily_orders_shopify`
**Auth**: session or CRON_SECRET

Queries `kpi_timeseries` for the requested metrics over the requested days:
```sql
SELECT metric_name, value, captured_for_date
FROM kpi_timeseries
WHERE metric_name = ANY($1)
  AND window_type = 'daily'
  AND captured_for_date >= NOW() - INTERVAL '$2 days'
ORDER BY captured_for_date ASC
```

Returns:
```typescript
{
  metrics: Record<string, Array<{ date: string; value: number }>>;
  range: { start: string; end: string; days: number };
}
```

### Update `src/app/ops/kpis/KpisView.client.tsx`

Add a new section at the TOP of the page (before existing pro forma content): **"Live Metrics"**

**Charts to add** (using Recharts):

1. **Revenue Trend** (ComposedChart, 30 days):
   - Line: `daily_revenue_shopify` in NAVY
   - Line: `daily_revenue_amazon` in RED
   - Stacked Area: total revenue in GOLD with 0.1 opacity
   - X-axis: dates (formatted as "Mar 1", "Mar 2", etc.)
   - Y-axis: dollar amounts
   - Tooltip: show both channels + total

2. **Orders Trend** (BarChart, 30 days):
   - Stacked bars: Shopify (NAVY) + Amazon (RED)
   - X-axis: dates
   - Y-axis: order count

3. **Traffic & Engagement** (LineChart, 30 days):
   - Line: `daily_sessions` in NAVY
   - Line: `daily_pageviews` in GOLD
   - X-axis: dates

4. **AOV Trend** (LineChart, 30 days):
   - Line: `daily_aov` in GOLD
   - Reference line: 30-day average (dashed, TEXT_DIM color)

**Layout**: 2x2 grid on desktop, 1-column stack on mobile.

Each chart wrapped in a card with:
- Title (e.g., "Revenue — Last 30 Days")
- Subtitle with current value and delta vs 7-day average
- StalenessBadge if latest data is >24h old

**Responsive**: Use `@media (max-width: 768px)` via inline style or CSS class to stack charts vertically.

**Commit**: `Abra v2 Prompt 50: KPI charts with 30-day revenue, orders, traffic, and AOV trends`

---

## Prompt 51 — Anomaly Visualization

**Goal**: Highlight detected anomalies on KPI charts with red zones, and add a dedicated anomaly timeline.

### Create `src/app/api/ops/abra/anomaly-history/route.ts`

**Endpoint**: `GET /api/ops/abra/anomaly-history?days=30`
**Auth**: session or CRON_SECRET

Queries Supabase for recent anomalies (either from an `abra_anomalies` table or run `detectAnomalies()` live for the current snapshot, and also query historical anomalies if stored).

If no `abra_anomalies` table exists for historical storage, create a way to detect anomalies for the last 30 days by running `checkMetricAnomaly()` for each day's data point against its preceding 7 days.

Returns:
```typescript
{
  anomalies: Array<{
    date: string;
    metric: string;
    direction: "spike" | "drop";
    severity: "info" | "warning" | "critical";
    z_score: number;
    deviation_pct: number;
    current_value: number;
    expected_value: number;
  }>;
}
```

### Update KPI charts (from Prompt 50)

On each revenue/orders chart, overlay anomaly markers:
- Use Recharts `ReferenceDot` component at the anomaly data point
- Critical: red circle with white "!" icon
- Warning: orange circle
- Info: blue circle
- On hover/click, show tooltip with: metric, deviation %, z-score, direction

### Add Anomaly Timeline section to KPIs page

Below the charts, add a timeline view:
```
ANOMALY LOG — Last 30 Days
┌──────────┬────────────────────┬──────┬──────────────┐
│ Date     │ Metric             │ Type │ Deviation    │
├──────────┼────────────────────┼──────┼──────────────┤
│ Mar 9    │ daily_revenue_amz  │ 🔴▲  │ +145% (z=3.2)│
│ Mar 7    │ daily_sessions     │ 🟡▼  │ -38% (z=2.1) │
│ Mar 3    │ daily_aov          │ 🔵▲  │ +22% (z=1.8) │
└──────────┴────────────────────┴──────┴──────────────┘
```

Sort by date descending. Show severity icon + direction arrow. Click to expand details.

**Commit**: `Abra v2 Prompt 51: anomaly visualization with chart overlays and timeline`

---

## Prompt 52 — Financial Dashboard Upgrade

**Goal**: Upgrade `/ops/finance` with channel-level revenue breakdown, margin analysis, and revenue timeline charts.

### Create `src/app/api/ops/abra/revenue-by-channel/route.ts`

**Endpoint**: `GET /api/ops/abra/revenue-by-channel?days=30`
**Auth**: session or CRON_SECRET

Aggregates KPI data by channel:
```typescript
{
  channels: {
    shopify: { revenue: number; orders: number; aov: number; trend: Array<{date: string; value: number}> };
    amazon: { revenue: number; orders: number; aov: number; trend: Array<{date: string; value: number}> };
    faire: { revenue: number; orders: number; aov: number; trend: Array<{date: string; value: number}> };
  };
  total: { revenue: number; orders: number; aov: number };
  period: { start: string; end: string; days: number };
}
```

### Update `src/app/ops/finance/FinanceView.client.tsx`

Add new sections above the existing P&L content:

1. **Revenue by Channel** (PieChart + legend):
   - Shopify: NAVY
   - Amazon: RED
   - Faire/Wholesale: GOLD
   - Show dollar amounts and percentages

2. **Channel Revenue Trend** (ComposedChart, 30 days):
   - Stacked area chart showing all channels
   - Same color scheme as pie chart

3. **Margin Snapshot** card:
   - Fetch from `/api/ops/abra/finance`
   - Show: gross margin %, COGS breakdown, estimated net margin
   - Format as a simple table or card grid

4. **Cash Position** card:
   - Pull from existing `useBalancesData()` hook (already exists)
   - Show: current cash, burn rate, runway estimate

Keep ALL existing content below these new sections. Do not remove the P&L, Amazon profitability, or forecast sections.

**Commit**: `Abra v2 Prompt 52: financial dashboard with channel breakdown and margin analysis`

---

## Prompt 53 — Competitive Intelligence UI

**Goal**: Add a competitive intel page where Ben can manually track competitors, view comparisons, and get Abra's analysis.

### Create `src/app/ops/competitors/page.tsx`

Server wrapper:
```typescript
import type { Metadata } from "next";
import { CompetitorsView } from "./CompetitorsView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Competitive Intel" };

export default function CompetitorsPage() {
  return <CompetitorsView />;
}
```

### Create `src/app/ops/competitors/CompetitorsView.client.tsx`

**Layout**:

1. **Header**: "Competitive Intelligence" with "Add Competitor" button

2. **Competitor Grid** (card layout):
   Each competitor card shows:
   - Name, website
   - Category (e.g., "Direct competitor", "Adjacent", "Aspirational")
   - Key products / price range
   - Last updated date
   - Edit / Delete buttons

3. **Add/Edit Modal**:
   Form fields:
   - `name` (text, required)
   - `website` (URL)
   - `category` (select: Direct Competitor, Adjacent Brand, Aspirational, Private Label)
   - `products` (textarea — key products and prices)
   - `strengths` (textarea)
   - `weaknesses` (textarea)
   - `notes` (textarea — general intel)

4. **Ask Abra** button per competitor:
   - Opens a pre-filled chat prompt: "Analyze our competitive position vs {competitor name}. Consider: pricing, product range, distribution channels, brand positioning."
   - Routes to `/ops/abra?q=<encoded question>`

**API**: Uses existing `GET/POST/PATCH/DELETE /api/ops/abra/competitors` route (created in Prompt 41).

### Add to navigation

In `OpsShell.client.tsx`, add to the COMMAND section:
```typescript
{ href: "/ops/competitors", label: "Competitive Intel", icon: "🎯", roles: ["admin", "employee"] },
```

**Commit**: `Abra v2 Prompt 53: competitive intelligence UI with competitor tracking and analysis`

---

## Prompt 54 — Playbook Integration in Chat

**Goal**: Wire department playbooks into the Abra chat flow so it follows decision trees when answering domain-specific questions.

### Context
- `src/lib/ops/department-playbooks.ts` EXISTS with playbook definitions
- Playbooks have question detection patterns and decision trees
- The chat system prompt is built in `src/lib/ops/abra-system-prompt.ts`

### Update `src/lib/ops/abra-system-prompt.ts`

In the `buildSystemPrompt()` function, add a section that injects active playbooks as structured guidance:

```typescript
// After existing sections (corrections, departments, signals), add:
const playbooks = await getActivePlaybooks(); // from department-playbooks.ts

if (playbooks.length > 0) {
  sections.push(`

## Decision Playbooks
When a question falls into one of these domains, follow the structured approach:

${playbooks.map(p => `### ${p.department} — ${p.name}
Triggers: ${p.triggers.join(", ")}
Steps:
${p.steps.map((s, i) => `${i+1}. ${s}`).join("\n")}
`).join("\n")}

Use these playbooks as a framework — gather the information specified before giving a recommendation.
If the user's question matches a playbook trigger, mention which playbook you're following.
`);
}
```

### Update `src/lib/ops/department-playbooks.ts`

Add a `getActivePlaybooks()` export that returns simplified playbook summaries suitable for injection into the system prompt. Each playbook should have:
- `department`: string
- `name`: string
- `triggers`: string[] — keywords/patterns that activate this playbook
- `steps`: string[] — the decision tree steps in plain English

If playbooks are stored in Supabase (`abra_playbooks` table), fetch from there. If they're hardcoded, wrap the existing data structure.

### Update chat route

In `src/app/api/ops/abra/chat/route.ts`, ensure `buildSystemPrompt()` is called fresh for each request (not cached) so playbook data stays current.

### Add playbook indicator to chat UI

In `src/app/ops/abra/AbraChat.client.tsx` (or equivalent), when Abra's response mentions "Following the X playbook" or similar, highlight that line with a 📋 icon and the GOLD accent color.

This is a lightweight CSS/rendering change — detect the pattern in the response text and wrap it in a styled span.

**Commit**: `Abra v2 Prompt 54: playbook integration in chat with decision tree guidance`

---

## Prompt 55 — Mobile-Responsive Ops Dashboard

**Goal**: Make the entire `/ops/` dashboard usable on mobile (iPhone-sized screens). Ben checks this from his phone constantly.

### Key Changes

1. **OpsShell.client.tsx** — Mobile sidebar:
   - On screens < 768px, collapse sidebar into a hamburger menu
   - Add a hamburger icon (☰) button in the top-left
   - Sidebar slides in as an overlay (position: fixed, z-index: 1000)
   - Tap outside or tap ☰ again to close
   - Show current page title in the top bar when sidebar is collapsed

2. **CommandCenter.client.tsx** (Prompt 49):
   - Metric cards: 2x2 grid → 2-column on mobile (they're already small enough)
   - Signals/Actions/Health: stack vertically
   - Full-width cards on mobile

3. **KpisView.client.tsx** (Prompt 50):
   - Charts: 2x2 grid → single column stack on mobile
   - Chart height: 250px on mobile (vs 300px desktop)
   - Ensure `ResponsiveContainer` width="100%" is used (Recharts handles this)

4. **FinanceView.client.tsx** (Prompt 52):
   - Channel breakdown: horizontal layout → vertical stack
   - PieChart: reduce size to fit 320px width
   - Tables: add `overflow-x: auto` wrapper for horizontal scroll

5. **AbraChat** (`src/app/ops/abra/AbraChat.client.tsx`):
   - Chat input: full width, larger touch target (min-height: 48px)
   - Message bubbles: max-width: 100% on mobile (vs 80% desktop)
   - Quick action buttons: wrap to 2-column grid on mobile

6. **CompetitorsView.client.tsx** (Prompt 53):
   - Competitor cards: single column on mobile
   - Modal: full-screen on mobile (position: fixed, inset: 0)

### Implementation approach

Use CSS media queries via inline styles or a shared utility:

```typescript
// Add to src/app/ops/tokens.ts:
export const MOBILE_BREAKPOINT = 768; // px

// In components, use a hook:
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}
```

Export this hook from a shared location (e.g., `src/app/ops/hooks.ts`) so all components can use it.

### Mobile sidebar implementation

In `OpsShell.client.tsx`:

```typescript
const [mobileNavOpen, setMobileNavOpen] = useState(false);
const isMobile = useIsMobile();

// Render:
{isMobile && (
  <div style={{
    position: "fixed", top: 0, left: 0, right: 0,
    height: 48, background: SIDEBAR_BG, zIndex: 999,
    display: "flex", alignItems: "center", padding: "0 16px",
    borderBottom: `1px solid ${SIDEBAR_BORDER}`,
  }}>
    <button onClick={() => setMobileNavOpen(!mobileNavOpen)} style={{ color: "#fff", fontSize: 24 }}>
      ☰
    </button>
    <span style={{ color: GOLD, marginLeft: 12, fontSize: 14, fontWeight: 600 }}>
      {/* current page label */}
    </span>
  </div>
)}

{/* Sidebar: on mobile, render as overlay */}
<aside style={{
  ...(isMobile ? {
    position: "fixed", top: 0, left: 0, bottom: 0, width: 260,
    zIndex: 1000, transform: mobileNavOpen ? "translateX(0)" : "translateX(-100%)",
    transition: "transform 0.2s ease",
  } : {
    /* existing desktop sidebar styles */
  }),
}}>
```

Add a backdrop overlay when mobile nav is open:
```typescript
{isMobile && mobileNavOpen && (
  <div
    onClick={() => setMobileNavOpen(false)}
    style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 999 }}
  />
)}
```

### Content area adjustment

When on mobile, add `padding-top: 56px` to the main content area to account for the fixed top bar.

### Test
- Verify `npm run build` passes
- All pages should render without horizontal overflow on 375px wide viewport

**Commit**: `Abra v2 Prompt 55: mobile-responsive ops dashboard with hamburger nav and adaptive layouts`

---

## Execution Order

Run prompts in order: **49 → 50 → 51 → 52 → 53 → 54 → 55**

After each prompt:
1. Run `npx tsc --noEmit` — fix any type errors
2. Run `npm run build` — must pass
3. Commit with message format: `Abra v2 Prompt <N>: <description>`

After ALL prompts complete:
1. Final `npm run build` — must pass
2. Do NOT push. Do NOT create branches.
