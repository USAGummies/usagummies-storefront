# ShipStation — Integration Contract

**Status:** CANONICAL — 2026-04-20
**Source:** [22.B §D Operations substrate](https://www.notion.so/3484c0c42c2e81048158f9007dddc093) (D.1–D.4) + [`CLAUDE.md` fulfillment rules](../../CLAUDE.md)
**Purpose:** One source of truth for how USA Gummies ships via ShipStation. Every agent that touches a ShipStation surface (shipping hub, Ops Agent, Faire Specialist, future Freight Specialist) references this page. No separate "my rules" anywhere in code.

---

## 1. Ship-from locations (the two-origin rule)

Per CLAUDE.md + blueprint §14.4:

| Origin | Address | Used for |
|---|---|---|
| **Ashford** | 30027 SR 706 E, Ashford WA 98304 — Ben personally packs | **All paid orders** (DTC, wholesale, B2B, Amazon FBM). One hard rule: orders ship from Ashford. |
| **East Coast** | Drew's warehouse address (TBD — canonical value enters here once Drew confirms in writing) | **Samples only** + anything that specifically needs East Coast transit (faster to northeast / mid-Atlantic prospects). |

**Hard rule (blueprint + Viktor contract §6.7):** Viktor and every specialist agent refuses to instruct Drew to ship a customer order. If an agent is asked to ship something marked `tag:sample=false` from East Coast, that's a contract violation → pause + review per governance §6.

## 2. Package presets (22.B D.1)

SKU dimensions + weight profiles — these drive `createLabel` calls in [`src/lib/ops/shipstation-client.ts`](../../src/lib/ops/shipstation-client.ts):

| Packaging type | Dimensions (in) | Weight (lb) | Used for |
|---|---|---|---|
| `case` (6-count inner) | 14 × 10 × 8 | 6 | Smaller wholesale / sample bundles |
| `master_carton` (36-count) | 21 × 14 × 8 | **21.125** (= 21 lb 2 oz, measured packed by Ben 2026-04-20) | Wholesale cases; default for invoice line qty ÷ 36 cartons |
| `pallet` | — (LTL) | — | Pallet orders skip parcel rate-quoting; LTL freight priced separately |

**Canonical weight rule:** 21 lb 2 oz per master carton from 2026-04-20 forward. Any SKU or case-pack change revises this table + the `PACKAGE_PROFILES` const in lockstep, with the measurement date. Agents refuse to buy a label with a weight override that drifts more than ±2 lb from this without explicit per-instance Ben approval.

Source: [`PACKAGE_PROFILES` in shipstation-client.ts](../../src/lib/ops/shipstation-client.ts). The fulfillment hub's "Buy UPS Ground label" modal exposes the same two options.

## 3. Automation rule: origin routing (22.B D.3)

The ShipStation automation rule **must mirror** our code-side origin decision. Precedence:

1. If order tags contain `sample` OR `tag:sample` OR `purpose:sample` → East Coast origin.
2. Else if order tags contain `origin:east-coast` → East Coast origin (explicit override).
3. Else → Ashford origin (default).

This rule is set **inside ShipStation's UI** (Automation → Rules) by Ben; it is mirrored here so every agent proposing a shipment knows which origin to label it with when drafting for Ben's approval. The two must match; the weekly drift audit samples ShipStation shipments against this rule and flags a violation if they diverge.

## 4. Shipping presets (22.B D.2)

ShipStation stores four carrier presets; code relies on the service codes:

| Origin | Preferred carrier | Service code | When |
|---|---|---|---|
| Ashford | UPS | `ups_ground` | Wholesale + B2B (default) |
| Ashford | USPS | `usps_ground_advantage` | Small DTC orders (< 3 lb) |
| East Coast | UPS | `ups_ground` | Samples to northeast / mid-Atlantic business customers |
| East Coast | USPS | `usps_ground_advantage` | Retail sample packets (light + cheap) |

Rate-quote flow: `/api/booth-order/freight-quote` + `getUpsGroundRate()` in [`shipstation-client.ts`](../../src/lib/ops/shipstation-client.ts).
Label-buy flow: `createUpsGroundLabel()` → Shipping Hub "Buy UPS Ground label" modal (Phase 2 live).

## 5. Packaging spec (the 6 × 6 × 1 rule)

Per Ben 2026-04-20 Uline order:

- **Inner case** = 6 bags per case
- **Master carton** = 6 cases per carton = **36 bags / carton**
- **Strip clip** = 1 per case (holds the 6-bag strip on a peg hook)
- **Metal hook** = 1 per strip clip (= 1 per case)

So: N master cartons needed = N × (6 cases × 6 bags) = 36 × N bags. Every invoice line qty is in **bags** (QBO line.Qty) — dividing by 36 gives cartons; by 6 gives cases.

The shipping hub computes this automatically; this is documented here so the Pending Commitments section (e.g. "Inderbitzin +5 cartons = 180 bags") is reproducible.

## 6. Webhook (Phase 3 of the shipping hub)

**URL:** `https://www.usagummies.com/api/ops/fulfillment/tracking-webhook?token=$FULFILLMENT_WEBHOOK_SECRET`
**Events:** `SHIP_NOTIFY`, `ITEM_SHIP_NOTIFY`
**Effect:** when UPS scans a tracking number associated with a `fulfillment:stages` KV entry, the entry promotes from `ready` → `shipped` automatically. Ben stops having to click "Mark shipped" after the scan.

**Registration:** via `POST /api/ops/fulfillment/webhook-register` (bearer `CRON_SECRET`) once Ben provisions `SHIPSTATION_API_KEY` + `SHIPSTATION_API_SECRET` on Vercel. Currently parked on MFA (see [`ops/blocked-items.md`](../../ops/blocked-items.md) B-13).

## 7. Shipment-history cross-ref (wire when credentials land)

Once the ShipStation v1 API key + secret land on Vercel, the fulfillment hub adds a second auto-clear path:

1. GET `https://ssapi.shipstation.com/shipments?orderNumber=<our-key>` — match by the `orderNumber` we pass during label buy (`<keys>+<carton>/<total>`).
2. If a shipment exists with a tracking number, write back to the stage entry's `tracking` field and promote to `shipped`.

This runs on each fulfillment hub GET so the queue self-heals even for orders Ben shipped directly in ShipStation without going through the hub's "Buy label" flow. Implementation blocked on credentials.

## 8. Env vars

| Key | Where | Purpose |
|---|---|---|
| `SHIPSTATION_API_KEY` | Vercel + local `.env.local` (set 2026-04-20 evening) | v1 API auth (Basic) |
| `SHIPSTATION_API_SECRET` | Vercel + local | v1 API auth (Basic) |
| `FULFILLMENT_WEBHOOK_SECRET` | Vercel (set 2026-04-20) | Tracking webhook query-param token |
| `SHIPSTATION_FROM_NAME` | Vercel | Defaults to `Benjamin Stutman` |
| `SHIPSTATION_FROM_COMPANY` | Vercel | Defaults to `USA Gummies` |
| `SHIPSTATION_FROM_STREET1` | Vercel (set 2026-04-20 → `30027 SR 706 E`) | Ashford street |
| `SHIPSTATION_FROM_CITY` | Vercel | Defaults to `Ashford` |
| `SHIPSTATION_FROM_STATE` | Vercel | Defaults to `WA` |
| `SHIPSTATION_FROM_POSTALCODE` | Vercel | Defaults to `98304` |
| `SHIPSTATION_FROM_PHONE` | Vercel | Defaults to `3072094928` |
| `SHIPSTATION_WALLET_MIN_STAMPS_COM` | Vercel | Minimum USD floor for Stamps.com wallet — Finance Exception Agent alerts if balance < this. BUILD #8. Default `100`. |
| `SHIPSTATION_WALLET_MIN_UPS_WALLETED` | Vercel | Same for UPS by ShipStation. Default `150`. |
| `SHIPSTATION_WALLET_MIN_FEDEX_WALLETED` | Vercel | Same for FedEx by ShipStation. Default `100`. |
| `THERMAL_PRINTER_NAME` | Local (Ben's laptop) | Override name for 4×6 label printer. Default `_PL70e_BT`. BUILD #4. |
| `LASER_PRINTER_NAME` | Local | Override name for letter packing-slip printer. Default `Brother_HL_L6200DW_series`. BUILD #4. |
| `CHROME_BINARY` | Local | Override path for Chrome headless used by the packing-slip PDF generator. BUILD #5. Auto-discovered on macOS + Linux. |

## 9. Class-class-D (prohibited autonomous actions)

Per approval-taxonomy Class D:

- **Never create a label autonomously.** Label purchases are Class B — they require Ben's explicit per-instance approval via the Buy-label modal.
- **Never override the origin rule.** If code detects a sample that somehow got tagged for Ashford or an order for East Coast, it surfaces a `warning` and refuses to buy a label; Ben re-tags in ShipStation and retries.
- **Never modify the origin address autonomously.** Ship-from env changes are a Ben-only action via Vercel admin.
- **Never ship a paid order from East Coast (hard rule).**

## 10. Drift audit hooks

The weekly drift audit (Sunday 20:00 PT) samples 10 random ShipStation shipments from the past week and verifies:
- Every shipment with `tag:sample` shipped from East Coast
- Every other shipment shipped from Ashford
- Tracking number is present on every non-voided shipment
- Label cost matches the invoice's expected freight line (within ± $2)

Violations → auto-pause the shipping hub's Class B `shipment.create` action pending Ben review (governance §5 + §6).

## 11. Wallet auto-reload (BUILD #8)

ShipStation's connected carriers (`stamps_com`, `ups_walleted`, `fedex_walleted`) are **funded wallets** — every label buy debits the wallet. Running out in the middle of a buy-loop is a hard stop, and re-loading requires Ben to log into ShipStation's web UI. On 2026-04-20 this happened twice mid-rush; we lost time that Ben explicitly called out ("this is a real barrier... we need these to auto top off").

**Doctrine (Ben's one-time setup, not an API action):**
1. ShipStation UI → Settings → **Your Account / Billing** → **Stamps.com Balance** → **Auto-refill**.
   - Trigger: balance < `$100`
   - Refill amount: `$200`
   - Funding source: BofA checking ending 7020 (the business account — **never** the emergency debit card).
2. Repeat for UPS by ShipStation (trigger `$100`, refill `$200`) and FedEx by ShipStation (trigger `$100`, refill `$200`) once those carriers are used often enough to justify. **2026-04-30 PM:** Ben dropped UPS trigger from $150 → $100 to keep cash in the bank rather than sitting in the wallet queue. Mirrored in code at `src/app/api/ops/shipstation/wallet-check/route.ts` `DEFAULT_FLOORS`.

**Code-side enforcement (BUILD #2 preflight):** every label buy calls `preflightWalletCheck()` which refuses the purchase if balance < cost × 1.2. This prevents the exact 2026-04-20 failure even if auto-reload hasn't fired yet (Stamps.com reload can take ~15 min).

**Finance Exception Agent (BUILD #9):** the Thursday digest includes a wallet-floor line. If any walleted carrier reports a balance below its `SHIPSTATION_WALLET_MIN_*` env, the digest surfaces it as an exception so Ben can top up manually or raise the auto-refill trigger.

## 12. Voided-label refund watcher (BUILD #9)

Stamps.com issues void refunds in batches — typically 24-48h, occasionally up to 14 days. On 2026-04-20 we voided 3 Red Dog labels ($81.81) + discovered 17 orphaned Viktor triple-buy voids ($130.90). Neither batch had visible refund traces on the Stamps.com Activity view immediately.

**Watcher (daily at 09:15 PT):** the Finance Exception Agent scans `/shipments?voided=true&voidDateStart=-14d` and produces a table of every void with: void date, days since void, label cost, refund status. Rule:

- Void > 72h old AND no matching refund credit in the wallet ledger → **flag as exception**
- Exception fires a Slack ping to `#financials` with the 17 specific tracking numbers so Rene can open a Stamps.com support ticket.

The detection heuristic for "matching refund credit" = a positive wallet ledger entry within 14 days of the void date, within ± $0.50 of the voided label's cost. Stamps.com refunds are line-item'd in the wallet Activity view — if we ever get API access to it, the watcher can be 100% deterministic. Until then it's best-effort and human-verified.

## 13. Amazon FBM auto-ship pipeline (2026-04-23)

The first live Amazon FBM day forced a full end-to-end build in one night. Doctrine distilled from the run:

**Owner:** Ben (Ashford WA) until Drew has East Coast inventory. All MFN orders route through Ashford. No split by destination yet.

**Trigger:** Vercel cron at `*/30 * * * *` hits `GET /api/ops/amazon/auto-ship`. Every 30 min, weekday and weekend — Amazon orders land 24/7 and the handling-promise clock starts on purchase time, not business hours.

**Pipeline steps (per order):**
1. Poll SP-API unshipped FBM orders (`fetchUnshippedFbmOrders`, 7-day window).
2. Dedup against `amazon:fbm:dispatched` KV so a retry never double-buys.
3. Count bags via SP-API `/orders/{id}/orderItems` → sum of `QuantityOrdered`.
4. Resolve packaging via `pickPackagingForBags(bags)` — §13.1 below.
5. Lookup the order in ShipStation by `orderNumber` (for the shipTo PII the SP-API RDT gate hides).
6. Pick service for weight — §13.2 below.
7. `POST /shipments/createlabel` with the packaging dims + selected service + shipTo pulled from the SS order.
8. `POST /orders/markasshipped` with `notifySalesChannel=true` → pushes the new tracking to Amazon Seller Central within ~5 min.
9. Upload the label PDF (page 1 only — page 2 is ShipStation's packing slip which we skip, see §13.3) to `#operations` with a one-line summary.
10. Write `amazon:fbm:dispatched` KV entry for dedup + audit-mirror to `#ops-audit`.

**Kill switch:** `AUTO_SHIP_ENABLED=false` env var pauses the pipeline without a redeploy. Primary use: Amazon account issues, carrier outages, inventory stockouts.

### 13.1 Packaging rules (HARD)

| Bags | Package | ShipStation Custom Package | Auto-buy |
|---|---|---|---|
| 1–4 | 6×9 padded mailer (11×9×1 effective) | `Sample Mailer (Branded)` | ✅ |
| 5–12 | 7×7×7 inner case box | `Inner Case Box (6-ct)` | ✅ |
| 36 | 21×14×8 master carton | `Master Carton (36-ct)` | ✅ |
| 0, 13–35, 37+ | (undefined) | — | ❌ surface to `#ops-approvals` |

Biggest Amazon bundle currently listed is a 10-pack, so > 99% of FBM orders land in the mailer bucket. The 5–12 range covers 5-pack + 10-pack variants; 36 is a full-case shipment.

Weight model (measured 2026-04-21):
- mailer: `0.05 + 0.5 × bags` lb
- 7×7×7 box: `0.50 + 0.5 × bags` lb
- master carton: `21.125` lb (fixed)

Any bag count outside the three ranges (0, 13–35, 37+) is **not** auto-buyable. The pipeline posts a review request to `#ops-approvals` with the Seller Central deeplink + reason, and does not charge the wallet.

### 13.2 Service selection

Live-rate observation on 2026-04-22 / 23 (first FBM day):

| Weight | Cheapest carrier (observed) | Service code |
|---|---|---|
| ≤13 oz | Stamps.com (USPS) | `usps_first_class_mail` |
| 14 oz – 3 lb | UPS by ShipStation (SurePost) | `ups_ground_saver` |
| > 3 lb | Stamps.com (USPS) | `usps_ground_advantage` |

UPS Ground Saver beat USPS Ground Advantage on 2 of 3 labels in the 1–2 lb range despite USPS often being the mental default. The selector in `auto-ship/route.ts#pickServiceForWeight` encodes this heuristic; if we see consistent misses swap to calling `getCheapestShipStationRate()` live per-label (adds ~500ms per label).

### 13.3 Label PDF quirks (hard-learned 2026-04-22)

ShipStation's label download is **always 2 pages**: page 1 = the shipping label, page 2 = a packing slip. When printing to a thermal printer via CUPS, the default behavior prints both, burning a label on page 2 (wasted media + confusion about which page is which). The auto-ship pipeline extracts page 1 only before upload.

The Polono PL70e-BT's physical media calibration drifts. When it drifts, CUPS reports the job as "completed" but the printer outputs blank labels. Recovery: power off → hold feed button while powering on until it feeds 2-3 blank labels + beeps. This is a hardware reality, not a software bug — documented here so future-us doesn't chase a phantom CUPS issue.

### 13.4 Void + re-buy

When a label needs to be re-bought (wrong ship-from, service correction, address fix):

1. ShipStation UI → **Shipments** tab → filter to ship date → select the shipment(s) → **Void Label**.
2. Refunds are issued to the carrier wallet over ~30 days (Stamps.com) or instantly (UPS wallet — typically).
3. The order record stays in `Shipped` status in ShipStation. To buy a new label, use **Shipment Actions → Reship** on the order detail — this clones the shipment into `Awaiting Shipment` without disturbing the original record.
4. Configure the clone + buy. `markasshipped` with `notifySalesChannel=true` overwrites the old tracking in Amazon.

The `/api/ops/amazon/reship` route automates steps 1–4 for API callers. (Known bug as of 2026-04-23: the `/shipments?orderId=X` lookup returns 0 despite live shipments — workaround is to use the UI flow above. Pending fix.)

### 13.5 Doctrine: "questions about the shipping → don't auto-buy"

Auto-buy is fast, Slack-delivered, and self-accountable — but it is NOT a replacement for human judgment on edge cases. The pipeline hard-refuses (and surfaces to `#ops-approvals`) when:

- Bag count is outside the three canonical ranges.
- ShipStation lookup fails (order not synced yet, or Amazon integration hiccup).
- SP-API item fetch fails (no way to compute packaging deterministically).
- `AUTO_SHIP_ENABLED=false` is set.
- A previous dispatch KV entry exists for the same order (idempotency).

Every refusal path carries the reason + a Seller Central deeplink so Ben (or whoever's on call) can resolve in one click.

## Version history

- **1.2 — 2026-04-23** — Added §13 Amazon FBM auto-ship pipeline, §13.1 packaging rules, §13.2 service-selection heuristic from first live FBM day, §13.3 label PDF quirks (2-page gotcha + Polono calibration drift), §13.4 void + re-buy doctrine, §13.5 auto-buy refusal criteria. Reverted ship-from default back to `USA Gummies / 30025 SR 706 E / Ashford WA 98304` to mirror the ShipStation "USA Gummies HQ" warehouse exactly — no personal name on the label. A brief detour to the WY corporate address was rolled back after confirming the WA warehouse config already omits Ben's name.
- **1.1 — 2026-04-20** — Added §11 wallet auto-reload doctrine, §12 voided-label refund watcher, BUILD #1-#9 env vars. Carrier codes confirmed as `stamps_com` / `ups_walleted` / `fedex_walleted` (NOT `ups`) via `/carriers` endpoint on 2026-04-20.
- **1.0 — 2026-04-20** — First canonical publication. Derived from 22.B §D + CLAUDE.md fulfillment rules.
