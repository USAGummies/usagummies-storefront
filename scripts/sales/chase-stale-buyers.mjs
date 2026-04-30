#!/usr/bin/env node
/**
 * chase-stale-buyers.mjs — Operator-facing chase-prep CLI.
 *
 * The morning daily-brief surfaces ~162 stale B2B deals on a typical
 * weekday (per `/contracts/agents/...stale-buyer.md` thresholds). This
 * script turns that surface into actionable per-deal chase plans the
 * operator can review and fire through `scripts/sales/send-and-log.py`
 * (the canonical single-entry-point for cold B2B outreach per
 * `/CLAUDE.md` "Cold B2B Outreach").
 *
 * What it does:
 *   1. Calls `GET /api/ops/sales/stale-buyers` (bearer CRON_SECRET) to
 *      get the structured `StaleBuyerSummary` slice.
 *   2. For each stale deal, derives the stage-appropriate chase tactic
 *      from `STAGE_NEXT_ACTIONS` (locked in `src/lib/sales/stale-buyer.ts`).
 *   3. Default mode: prints a per-deal chase plan to stdout (top N by
 *      days-stale).
 *   4. `--prep` mode: writes draft body files to `drafts/chase/<dealId>.txt`
 *      with stage-templated copy ready for operator edit + send-and-log.py.
 *
 * What it does NOT do:
 *   - Send any email. Per CLAUDE.md doctrine, every cold B2B outbound
 *     MUST go through `scripts/sales/send-and-log.py`. This script
 *     stages drafts; the operator runs the send.
 *   - Mutate HubSpot, QBO, Slack, or any other system. Pure read +
 *     local-disk-write.
 *   - Look up contact emails. The brief slice doesn't carry them; the
 *     operator pulls the email from `/ops/sales` UI or HubSpot when
 *     crafting each send. (Future enhancement: enrich via a HubSpot
 *     deal→primary-contact lookup.)
 *
 * Usage:
 *   node scripts/sales/chase-stale-buyers.mjs                 # print top 25
 *   node scripts/sales/chase-stale-buyers.mjs --limit 50      # print top 50
 *   node scripts/sales/chase-stale-buyers.mjs --detail 12345  # one deal full
 *   node scripts/sales/chase-stale-buyers.mjs --prep --limit 5
 *      # write drafts/chase/<dealId>.txt for top 5
 *
 * Env: CRON_SECRET (from .env.local), and optional CHASE_API_BASE_URL
 *      (default https://www.usagummies.com).
 *
 * Exit codes: 0 ok / 2 usage / 3 API error.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const ENV_FILE = path.join(REPO, ".env.local");
const DRAFTS_DIR = path.join(REPO, "drafts", "chase");

// Light .env.local reader — same pattern as other scripts in this dir.
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (process.env[k]) continue;
    let v = vRaw.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}

const API_BASE = process.env.CHASE_API_BASE_URL || "https://www.usagummies.com";
const CRON_SECRET = process.env.CRON_SECRET;

// ── Args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name, dflt = false) {
  return args.includes(`--${name}`) ? true : dflt;
}
function opt(name, dflt = null) {
  const i = args.findIndex((a) => a === `--${name}`);
  if (i < 0 || i + 1 >= args.length) return dflt;
  return args[i + 1];
}
const LIMIT = Number(opt("limit", "25"));
const DETAIL_DEAL_ID = opt("detail", null);
const PREP = flag("prep");
const HELP = flag("help") || flag("h");

if (HELP) {
  console.log(
    "Usage:\n" +
    "  node scripts/sales/chase-stale-buyers.mjs              # print top 25\n" +
    "  node scripts/sales/chase-stale-buyers.mjs --limit 50\n" +
    "  node scripts/sales/chase-stale-buyers.mjs --detail <dealId>\n" +
    "  node scripts/sales/chase-stale-buyers.mjs --prep --limit 5",
  );
  process.exit(0);
}

if (!CRON_SECRET) {
  console.error("✗ CRON_SECRET missing from env. Aborting.");
  process.exit(2);
}

// ── Stage-appropriate chase tactics + draft templates ─────────────────────
// Mirrors `STAGE_NEXT_ACTIONS` in `src/lib/sales/stale-buyer.ts` but adds a
// per-stage `subjectLine` + `bodyTemplate` so operators can copy/paste a
// starting point. Templates use `{{company}}` + `{{daysStale}}` placeholders.
const STAGE_PLAYBOOK = {
  Lead: {
    tactic: "First-touch outreach — they're cold. Lead with the made-in-USA + dye-free angle and a clear sample offer.",
    subjectLine: "All American Gummy Bears for {{company}} — quick intro",
    bodyTemplate:
      "Hi there,\n\n" +
      "Reaching out from USA Gummies — we make the only fully Made-in-USA, dye-free gummy bear at retail (everything down to the film). Already on shelves at multiple national-park gift shops, museum stores, and small chains.\n\n" +
      "Wanted to see if {{company}} would be open to a quick taste test — happy to ship a sample bag to whatever address works.\n\n" +
      "If candy isn't your category, no worries — just point me to whoever owns it on your team and I'll loop them in directly.\n\n" +
      "Thanks,\nBen Stutman\nUSA Gummies",
  },
  Contacted: {
    tactic: "Re-pitch with a different angle — sample offer, sell sheet, or brand story they haven't seen yet. {{daysStale}} days cold.",
    subjectLine: "Re: USA Gummies — {{company}}",
    bodyTemplate:
      "Hi there,\n\n" +
      "Circling back on USA Gummies — last I reached out we hadn't connected. Wanted to try a different angle:\n\n" +
      "We're the only fully Made-in-USA dye-free gummy bear at retail (every component, including the film, is American-made). State dye-ban legislation is moving fast (Texas SB 25 effective Jan 2027 requires warning labels on Red 40 / Yellow 5 / etc. — every conventional candy on shelf gets a state-mandated warning sticker), so a 100% natural-color gummy is one of the few candy SKUs that doesn't reformulate or relabel.\n\n" +
      "Would a 7.5oz sample be useful? Happy to send one to whoever owns candy buying at {{company}}.\n\n" +
      "Thanks,\nBen Stutman\nUSA Gummies",
  },
  Responded: {
    tactic: "They engaged once. Move them forward with a sample offer or pricing tiers. {{daysStale}} days idle.",
    subjectLine: "Re: USA Gummies — sample drop for {{company}}?",
    bodyTemplate:
      "Hey — wanted to follow up on our last note. Two paths from here:\n\n" +
      "1. Send a 7.5oz sample bag — fastest way to taste-test before any commitment.\n" +
      "2. Share our wholesale pricing tiers + sell sheet so your team can compare against current SKUs.\n\n" +
      "Which works better for {{company}}? Happy to do both.\n\n" +
      "Thanks,\nBen",
  },
  "Sample Requested": {
    tactic: "Sample was requested but not shipped yet — coordinate ship-out with Ben (Ashford) and update the deal stage.",
    subjectLine: "(internal — not for outbound)",
    bodyTemplate:
      "INTERNAL ACTION: ship a sample bag from Ashford. Use the sample-dispatch flow at /ops/sample-dispatch (creates draft order + ShipStation label + posts to #shipping). Move deal to Sample Shipped after.",
  },
  "Sample Shipped": {
    tactic: "{{daysStale}} days since shipment. Ask for taste reaction + introduce wholesale pricing.",
    subjectLine: "Sample landed at {{company}}? — quick check-in",
    bodyTemplate:
      "Hey,\n\n" +
      "Wanted to check in — sample bag should have arrived a couple weeks back. Curious what your team thought. Happy to share next-step pricing whenever you're ready:\n\n" +
      "  • Master carton (36 bags): $3.25/bag\n" +
      "  • Pallet (900 bags, 3+ pallets): $3.00/bag landed\n" +
      "  • Volume tiers + custom freight on bigger commits\n\n" +
      "Suggested retail is $4.99–$5.99 — that's a 42–50% retail margin, which beats most impulse-candy targets.\n\n" +
      "Worth a 15-min call?\n\n" +
      "Thanks,\nBen",
  },
  "Quote/PO Sent": {
    tactic: "Quote out, no movement for {{daysStale}} days. Pick up the phone — email-only chase rarely closes here.",
    subjectLine: "Quick call on the {{company}} quote?",
    bodyTemplate:
      "Hey,\n\n" +
      "Sent over the wholesale quote a couple weeks back — wanted to ping in case it got buried. Happy to walk through the pricing tiers, talk freight, or answer anything blocking the PO.\n\n" +
      "Got 10–15 min today or tomorrow?\n\n" +
      "Ben\n(307) 209-4928",
  },
  "Vendor Setup": {
    tactic: "{{daysStale}} days stalled in vendor setup — usually missing AP info or NCS-001 paperwork. Resend the link with a personal nudge.",
    subjectLine: "Re: USA Gummies vendor setup — {{company}}",
    bodyTemplate:
      "Hey,\n\n" +
      "Following up on the vendor setup for {{company}}. The NCS-001 form lives at usagummies.com/upload/ncs — should take ~5 minutes to fill out (legal name, ship-to, AP contact, bank ACH).\n\n" +
      "If anything in there is unclear or you need help on a field, just hit reply and I'll walk you through it.\n\n" +
      "Thanks,\nBen",
  },
  "PO Received": {
    tactic: "PO landed but no shipment movement for {{daysStale}} days. Confirm shipment status + tracking with the buyer.",
    subjectLine: "Shipment update on your {{company}} PO",
    bodyTemplate:
      "Quick update on the {{company}} PO — wanted to confirm shipment status:\n\n" +
      "  • Status: [fill in: packing / shipped / scheduled]\n" +
      "  • Tracking: [paste tracking #]\n" +
      "  • ETA: [fill in delivery window]\n\n" +
      "Let me know if anything's blocking on your end.\n\n" +
      "Thanks,\nBen",
  },
  Shipped: {
    tactic: "Order landed {{daysStale}} days ago — reorder window is open. Lead with sell-through curiosity, then pricing.",
    subjectLine: "How are USA Gummies moving at {{company}}?",
    bodyTemplate:
      "Hey,\n\n" +
      "It's been about a month since the first order landed at {{company}} — curious how the bags are moving on shelf. Anything we should adjust on the next round (case mix, shelf placement, signage)?\n\n" +
      "Same wholesale pricing on the reorder. Lead time ~2 weeks Ashford → your DC.\n\n" +
      "Thanks,\nBen",
  },
};

function playbookFor(stageName) {
  return (
    STAGE_PLAYBOOK[stageName] ?? {
      tactic: `(no playbook for stage "${stageName}" — review manually in /ops/sales)`,
      subjectLine: "",
      bodyTemplate: "",
    }
  );
}

function fillTemplate(template, vars) {
  return template
    .replace(/\{\{company\}\}/g, vars.company || "your team")
    .replace(/\{\{daysStale\}\}/g, String(vars.daysStale ?? ""));
}

// ── API ───────────────────────────────────────────────────────────────────
async function fetchStaleBuyers() {
  const url = `${API_BASE}/api/ops/sales/stale-buyers?limit=200`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status} — ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── Render ────────────────────────────────────────────────────────────────
function renderSummaryTable(stalest, limit) {
  const top = stalest.slice(0, limit);
  const lines = [];
  const HEADER = `${"DAYS".padEnd(5)}${"STAGE".padEnd(20)}${"COMPANY".padEnd(40)}DEAL ID`;
  lines.push(HEADER);
  lines.push("─".repeat(HEADER.length + 12));
  for (const d of top) {
    const days = `${d.daysSinceActivity}d`.padEnd(5);
    const stage = (d.stageName || "?").slice(0, 18).padEnd(20);
    const company = (d.primaryCompanyName || d.dealName || "(unknown)")
      .slice(0, 38)
      .padEnd(40);
    lines.push(`${days}${stage}${company}${d.dealId}`);
  }
  return lines.join("\n");
}

function renderDetail(deal) {
  const playbook = playbookFor(deal.stageName);
  const company = deal.primaryCompanyName || deal.dealName || "(unknown company)";
  const vars = { company, daysStale: deal.daysSinceActivity };
  const subject = fillTemplate(playbook.subjectLine, vars);
  const body = fillTemplate(playbook.bodyTemplate, vars);
  return [
    `━━━ ${company} (${deal.daysSinceActivity}d stale, stage: ${deal.stageName}) ━━━`,
    `Deal ID:   ${deal.dealId}`,
    `Tactic:    ${fillTemplate(playbook.tactic, vars)}`,
    ``,
    `Subject:   ${subject}`,
    ``,
    `--- Draft body ---`,
    body,
    `--- end draft ---`,
    ``,
    `Send-and-log invocation (after editing the draft + filling --email):`,
    `  python3 scripts/sales/send-and-log.py \\`,
    `    --company "${company}" \\`,
    `    --email   <BUYER_EMAIL_HERE> \\`,
    `    --first   <FIRST> \\`,
    `    --last    <LAST> \\`,
    `    --subject "${subject}" \\`,
    `    --body    drafts/chase/${deal.dealId}.txt`,
    ``,
  ].join("\n");
}

function writeDraftFile(deal) {
  if (!existsSync(DRAFTS_DIR)) mkdirSync(DRAFTS_DIR, { recursive: true });
  const playbook = playbookFor(deal.stageName);
  const company = deal.primaryCompanyName || deal.dealName || "(unknown company)";
  const vars = { company, daysStale: deal.daysSinceActivity };
  const body = fillTemplate(playbook.bodyTemplate, vars);
  const out = path.join(DRAFTS_DIR, `${deal.dealId}.txt`);
  writeFileSync(out, body, "utf8");
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  let payload;
  try {
    payload = await fetchStaleBuyers();
  } catch (err) {
    console.error(`✗ Could not fetch stale-buyer summary: ${err.message}`);
    process.exit(3);
  }

  if (payload.degraded) {
    console.error(`⚠ Degraded source: ${payload.degradedReasons?.join("; ")}`);
  }
  const summary = payload.summary;
  if (!summary || summary.stalest.length === 0) {
    console.log("✅ No stale buyers — all deals fresh.");
    return;
  }

  // ─ --detail mode ─
  if (DETAIL_DEAL_ID) {
    const deal = summary.stalest.find((d) => d.dealId === DETAIL_DEAL_ID);
    if (!deal) {
      console.error(`✗ Deal ${DETAIL_DEAL_ID} not found in current stale-buyer set.`);
      process.exit(3);
    }
    console.log(renderDetail(deal));
    return;
  }

  // ─ --prep mode ─
  if (PREP) {
    const top = summary.stalest.slice(0, LIMIT);
    console.log(`Writing ${top.length} draft files to ${path.relative(REPO, DRAFTS_DIR)}/...`);
    for (const deal of top) {
      const out = writeDraftFile(deal);
      const company =
        deal.primaryCompanyName || deal.dealName || "(unknown)";
      console.log(`  ✓ ${path.relative(REPO, out)}  (${deal.daysSinceActivity}d · ${deal.stageName} · ${company})`);
    }
    console.log(
      `\nNext step: edit each draft, then per CLAUDE.md doctrine fire each via:\n` +
      `  python3 scripts/sales/send-and-log.py --company "..." --email "..." \\\n` +
      `    --subject "..." --body drafts/chase/<dealId>.txt`,
    );
    return;
  }

  // ─ Default: summary table ─
  const totalStale = summary.staleByStage.reduce((s, x) => s + x.count, 0);
  console.log(`STALE BUYERS — ${totalStale} deal(s) need follow-up · scanned ${summary.activeDealsScanned} active`);
  console.log(`Showing top ${Math.min(LIMIT, summary.stalest.length)} by days stale.\n`);
  console.log(renderSummaryTable(summary.stalest, LIMIT));
  console.log(
    `\n  • Per-stage: ${summary.staleByStage
      .map((s) => `${s.stageName} ${s.count}`)
      .join(", ")}`,
  );
  console.log(`\nNext steps:`);
  console.log(
    `  • Inspect a deal:  node scripts/sales/chase-stale-buyers.mjs --detail <dealId>`,
  );
  console.log(
    `  • Stage drafts:    node scripts/sales/chase-stale-buyers.mjs --prep --limit ${LIMIT}`,
  );
  console.log(
    `  • Send (per deal): python3 scripts/sales/send-and-log.py ... (single-entry-point per /CLAUDE.md)`,
  );
}

main().catch((err) => {
  console.error(`✗ Unexpected error: ${err.message}`);
  process.exit(1);
});
