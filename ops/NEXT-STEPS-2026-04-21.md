# Next Steps — 2026-04-21 (post-overnight session)

**Session ended:** 43 commits on `main` (b0b2392..45a1750). Build clean, 344/346 tests green.
**Companion docs:**
- `/ops/MORNING-2026-04-21.md` — what shipped overnight + priority queue
- `/ops/BEN-PROVISIONING-GUIDES-2026-04-21.md` — exact click-paths for the 10 manual items
- `/ops/blocked-items.md` — full B-16..B-24 queue (renumbered / new)
- `/contracts/build-sequence.md` v1.2 — forward-looking order, canonical
- `/contracts/activation-status.md` — live runtime inventory
- Notion `22.B.Log` — session-by-session build log

---

## Right now (Ben, today)

1. **[10 sec]** Hit `https://www.usagummies.com/api/ops/smoke` to see green/yellow/red across every integration.
2. **[2 min]** Top up Stamps.com wallet — **currently $23.84, floor $100**. Blocks every next USPS label. Guide §1.
3. **[5 min]** Configure Shopify `orders/paid` webhook. Guide §2.
4. **[5 min]** Configure HubSpot `deal.propertyChange` webhook + set `HUBSPOT_APP_SECRET` on Vercel. Guide §3.
5. **[business hours]** Open `/ops/amazon-fbm` at 09:00 PT, dispatch the first real FBM orders through the UI flow.
6. **[when needed]** Follow up on Stamps.com $130.90 refund (Gmail thread). Guide §8.

Everything else in the provisioning guide (Faire, Booke, Notion Compliance Calendar) is lower urgency — none of them are blocking day-to-day shipping.

---

## Code-only build queue (no human blocker)

Ordered by leverage × time-to-ship. Ben can hand these to Claude any time.

### 🟢 Small wins — shipped since last update

- ✅ **S-08 Slack trigger for `#operations`** — `d41ccb0`. Pattern `/sample\s*(request|dispatch)/i` + `/dispatch <channel>` shortcut. Threaded reply with copy-paste template.
- ✅ **Inventory snapshot cron** — `d41ccb0`. Dedicated weekday 13:15 UTC cron with auto-refresh on ≥18h staleness + stale-cache fallback during Shopify outages.
- ✅ **Viktor pipeline composer tests** — `c3d6792`. Extracted to pure function + 11 vitest green.
- ✅ **Webhook signature verification audit** — `7cd7ace`. Shopify webhook recovered from `.gitignore` miss + added X-Shopify-Triggered-At replay protection (5-min tolerance matching HubSpot + Slack).
- ✅ **Wallet top-up deeplink** — `b701263`. One-click button on /ops/shipping when wallet below floor.
- ✅ **/ops/shopify-orders fallback queue** — `8e498bd`. Complements webhook auto-dispatch with a manual catch-up UI. One-click dispatch with full ship-to from Shopify payload (no form needed — unlike FBM). Gated on financial_status:paid fulfillment_status:unfulfilled.
- ✅ **Shopify webhook vitest** — `b8f75ee`. 11/11 green covering HMAC accept/reject/tampered + triggered-at replay (fresh/stale/future/unparseable) + invalid JSON.
- ✅ **Drift-audit weekly summary** — `b8f75ee`. Fulfillment drift audit now renders a weekly summary block (labels active/voided + queue drain rate %) + posts on meaningful activity even when no P1/P2/P3 findings.
- ✅ **FBM bulk ship-to helper** — `b8f75ee`. Collapsible "📋 Bulk ship-to" at the top of /ops/amazon-fbm — paste once, apply to every pending card.
- ✅ **Dispatch retry queue** — `6c81a06`. When Slack post fails from the Shopify/HubSpot webhook, intent gets enqueued to KV; hourly cron at :30 retries up to 5 attempts. Exhausted entries escalate to `#ops-alerts` for manual review. No more silent vanishes.

### 🟢 Small wins — still open (≤ 1 hour each)

1. **Drift-audit enhancement** — fold `/api/ops/fulfillment/summary` weekly totals into the Monday drift-audit scorecard post. Est 30 min.

2. **`/ops/amazon-fbm` bulk-dispatch** — select multiple FBM orders with shared ship-to (e.g. repeat corporate customers) and batch-dispatch. Est 1 hour.

3. **Ship-to autocomplete** — when Ben dispatches Amazon, pull prior ship-to addresses from ShipStation history for the same buyer name; offer autocomplete. Est 1 hour.

4. **`/ops/shipping` + `/ops/ledger` + `/ops/agents/status` mobile polish** — verify the grid layouts work on phone widths; add `viewport` meta. Est 1 hour.

5. **Compliance Specialist live-mode tests** — when Notion DB lands, lock down query/filter/render path with vitest mocks. Est 1 hour.

6. **Amazon dispatch RDT (Restricted Data Token) flow** — eliminate the manual ship-to copy from Seller Central. SP-API `/tokens/2021-03-01` path. Requires PII-approval from Amazon first (separate Ben task). Code scope: ~2 hours once approved.

7. **S-08 Shopify webhook vitest coverage** — unit tests for HMAC verify + triggered-at window + event parsing. Est 45 min.

8. **`/ops/shopify-orders` empty-state polish + count in `/api/ops/smoke`** — when queue is empty, smoke reports green. Est 30 min.

### 🟡 Medium builds (2-4 hours)

11. **Agent Open-Brain write-back** — foundational per-agent observation capture to Supabase. Requires Supabase migrations populated (currently `supabase/` dir has only `functions/`, no `migrations/`). Need to port the pgvector schema from memory before this can land. Est 2 days total.

12. **Unified daily digest** (Phase 2 deferred) — fold Finance Exception + Ops Agent + Exec Brief into a single Slack post once signal overlap becomes noise. Requires signal-usage audit before implementing. Est 2 hours.

13. **Make.com scenario audit + retirement** — 21 scenarios in Make; several overlap with 3.0 runtime (Executive Brief, Finance Exception, etc.). Audit needs Make.com API access. Est 2 hours once creds available.

14. **S-08 Faire adapter** — event-driven dispatch for Faire orders. Blocked on `FAIRE_ACCESS_TOKEN` provisioning. Code scope ~2 hours once token available.

15. **HubSpot deal search UI at `/ops/pipeline`** — dedicated view of B2B pipeline by stage with stage-advance buttons + note-add. Extends Viktor's weekly digest into a real-time dashboard. Est 3 hours.

16. **Freight-comp QBO post validation tests** — integration tests for `/api/ops/fulfillment/freight-comp-queue` POST that mock QBO `createQBOJournalEntry` and assert the paired DEBIT/CREDIT payload. Est 1.5 hours.

17. **`/ops/finance` dashboard** — live P&L snapshot from QBO (already have the API route) + Plaid balance + AR/AP summary. Rene-facing. Est 3 hours.

18. **Inventory reconciliation with Amazon FBA fulfillable** — cross-check Shopify on-hand against FBA-fulfillable + inbound; surface discrepancies in Ops Agent. Est 2 hours.

### 🔴 Big builds (1+ day, needs planning)

19. **R-1..R-7 research specialist runtimes** — 7 LLM-driven research agents per `/contracts/agents/r1-consumer.md` … `r7-press.md`. Blocked on Ben's tool-stack decisions (Feedly Pro vs Muck Rack, SerpAPI vs Reddit API, Finbox vs SEC EDGAR). Scope: 1-2 weeks once decisions made.

20. **Compliance Specialist authoritative mode** — once `/Legal/Compliance Calendar` Notion DB exists, remove the `[FALLBACK]` path and graduate to live-only. Requires Ben + counsel to draft `/Legal/Compliance Calendar` + `/Marketing/Approved Claims` first.

21. **Browser screenshot / OCR bridge for Seller Central** — when PII-approval lands, use Chrome MCP to auto-screenshot the Amazon order page, OCR the ship-to, populate `/ops/amazon-fbm` form. Est 1 day (if Chrome MCP is kept in the stack).

22. **Supabase migrations bootstrap** — port the `20260307000000_abra_core.sql` schema from project memory into `supabase/migrations/`, run it, wire the Open Brain write-back. Est 1 day.

23. **Sample Order Dispatch Slack slash command** — `/dispatch-sample <order-id>` in #operations. Requires Slack app config + app-level token. Est 3 hours.

24. **WA workers-comp quarterly reminder cron** — per compliance-doctrine, WA L&I quarterly filing (Apr 30 / Jul 31 / Oct 31 / Jan 31) needs a Rene-facing 14-day reminder. Est 2 hours.

25. **Cover-day forecast with real burn rate calibration** — compute burn-per-day from rolling-30d Shopify + Amazon order line items instead of env placeholder. Est 4 hours.

---

## What's fully done (don't touch unless something breaks)

**9 BUILDs from 2026-04-20 shipping rush:** carrier code `ups_walleted`, preflight wallet check, 504 idempotency recovery, thermal/laser printer router, Chrome-headless packing-slip PDF, CF-09 freight-comp JE builder, delivered-pricing doctrine guard, wallet auto-reload doc + env, voided-label refund watcher.

**Wiring:** ATP gate in buy-label, inventory auto-decrement, HubSpot deal-stage auto-advance on label buy, Finance Exception drains freight-comp + stale-void queues, Ops Agent pre-flight, morning Exec Brief pre-flight, EOD today-in-review, 9 PM iMessage ShipStation extension, reorder trigger, Amazon FBM threaded through preflight + brief + Ops Agent + `/ops/shipping`.

**Browser surfaces (4):** `/ops/shipping`, `/ops/ledger`, `/ops/agents/status`, `/ops/amazon-fbm`.

**Adapters (3 of 4 S-08 channels):** Shopify webhook, HubSpot webhook, Amazon FBM polling + dispatch. Faire still blocked on token.

**Drift prevention:** Weekly `/api/ops/control-plane/fulfillment-drift-audit` (Mon 20:30 PT → `#ops-audit`) + weekly `/api/ops/fulfillment/summary` rollup + Viktor weekly pipeline digest (Mon 07:00 PT → `#sales`).

**Runtime cron count:** 15 in `vercel.json`. Watch Hobby-plan ceiling (provisioning guide §9).

**Tests:** 109 new this session, 344/346 overall green.

---

## Parked / blocked / watch

| Item | Status | Unblocks on |
|---|---|---|
| $130.90 Stamps.com refund | Email sent 2026-04-20, no reply | Stamps.com or ShipStation support response |
| Shopify webhook auto-dispatch | Code ready, webhook URL not configured in Shopify | Ben does guide §2 (5 min) |
| HubSpot webhook auto-dispatch | Code ready, needs `HUBSPOT_APP_SECRET` + URL config | Ben does guide §3 (10 min) |
| Compliance Specialist live-mode | `[FALLBACK]` doctrine active | Ben + counsel create Notion `/Legal/Compliance Calendar` |
| Faire Specialist live-mode | Degraded | `FAIRE_ACCESS_TOKEN` provisioning |
| Booke "Uncategorized" feed | Degraded (unavailable in Finance Exception digest) | `BOOKE_API_TOKEN` or Zapier bridge |
| Amazon RDT for buyer PII | Manual ship-to copy is MVP | PII-approval from Amazon Seller Central |
| R-1..R-7 research agents | Contracts exist, runtimes pending | Ben's tool-stack decisions |
| Agent Open-Brain write-back | Schema defined in memory, not migrated | Port Supabase migrations |
| Make.com scenario retirement | Overlaps identified in memory | Make.com API access |

---

## Graduation gauges (from governance §4)

A specialist graduates from "in-the-loop" → "autonomous" after:
- 30 days green health (0 wrong-origin, 0 AR-hold bypasses, 0 fabrication incidents)
- 100+ successful invocations under the contract's Class A/B ratio
- Rene + Ben + Drew sign off in `#ops-approvals`

None of the new agents tonight graduate yet — S-08 is 0 days old, Viktor pipeline digest fires first Monday, fulfillment-drift audit fires first Monday. **Track in `22.B.Log` future sessions.**
