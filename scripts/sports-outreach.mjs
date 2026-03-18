#!/usr/bin/env node
/**
 * sports-outreach.mjs — Sponsorship outreach to American sports organizations
 *
 * Targets: PRCA (rodeo), B.A.S.S./MLF (bass fishing), ARCA/Truck/DIRTcar (motorsports)
 *
 * Pitch: "Official Gummy of [Sport]" — dye-free, made-in-USA, all-American angle
 *
 * Usage:
 *   node scripts/sports-outreach.mjs              # Send next batch
 *   node scripts/sports-outreach.mjs --dry-run     # Preview without sending
 *   node scripts/sports-outreach.mjs --status       # Show outreach status
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const HOME = process.env.HOME || "/Users/ben";
const STATUS_FILE = path.join(HOME, ".config/usa-gummies-mcp/sports-outreach.json");
const SEND_SCRIPT = path.join(HOME, ".openclaw/workspace/scripts/send-email.sh");

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ── Pitch templates ──────────────────────────────────────────────────

function prcaPitch() {
  return `Hi PRCA team,

I'm the founder of USA Gummies — we make All-American Gummy Bears with natural colors from real fruits and vegetables, no artificial dyes, manufactured right here in the USA (Indiana).

I'm reaching out because I think there's a natural fit between our brand and professional rodeo. Rodeo is the most authentically American sport there is, and we're building the most authentically American candy brand. We'd love to explore becoming the Official Gummy of the PRCA.

Here's what we bring:
- Made in USA (Indiana), FDA-registered facility
- No Red 40, Yellow 5, or artificial dyes — a growing consumer demand
- Already selling on our website (usagummies.com) and Amazon (Prime eligible)
- Strong social media presence with an American-made, family-friendly brand story

We're interested in:
- "Official Gummy" or "Official Candy" category partnership
- Event sampling at PRCA events and the Wrangler NFR
- Co-branded content and promotions
- Concession stand placement at rodeo venues

We're a young brand, so we'd love to hear about partnership tiers that work for emerging companies. Even starting with a single event or regional partnership would be exciting.

Happy to send samples and discuss further.

Best,
Ben
USA Gummies
https://www.usagummies.com
marketing@usagummies.com`;
}

function bassFishingPitch(orgName, specificDetail) {
  return `Hi ${orgName} team,

I'm the founder of USA Gummies — we make All-American Gummy Bears with natural colors from real fruits and vegetables. No artificial dyes. Made in Indiana.

I'd love to explore a sponsorship or partnership with ${orgName}. Bass fishing and our brand share the same DNA — authentically American, outdoors, family-friendly. We think "Official Gummy of ${orgName}" has a ring to it.

What we offer:
- Premium dye-free gummy bears, made in USA
- Sold direct (usagummies.com) and on Amazon Prime
- Family-friendly brand perfect for tournament audiences
- Great activation potential — sampling at weigh-ins, tournament villages, etc.
${specificDetail}
We're an emerging brand, so we're flexible on partnership structure — whether that's event sponsorship, angler partnerships, media integration, or a combination. We'd love to see your 2026 sponsorship deck or media kit.

Happy to send product samples for your team.

Best,
Ben
USA Gummies
https://www.usagummies.com
marketing@usagummies.com`;
}

function motorsportsPitch(orgName, seriesName, specificDetail) {
  return `Hi ${orgName} team,

I'm the founder of USA Gummies — we make All-American Gummy Bears with natural colors from real fruits and vegetables. No artificial dyes. Made in Indiana.

I'm reaching out about sponsorship opportunities in the ${seriesName}. Racing and American-made candy are a natural pairing — high energy, family audiences, and deeply American.

${specificDetail}
About USA Gummies:
- Dye-free gummy bears made in Indiana, FDA-registered facility
- Sold on usagummies.com and Amazon (Prime eligible)
- No Red 40, Yellow 5, or artificial colors — clean label candy
- Growing brand with strong appeal to families and health-conscious consumers

We're interested in:
- "Official Candy" or category partnership
- Car/truck branding (associate or primary)
- Sampling and activation at events
- Co-branded content opportunities

We're a young company, so we'd love to hear about entry-level or emerging brand partnership options. Flexible on structure.

Would love to see your sponsorship deck and discuss further.

Best,
Ben
USA Gummies
https://www.usagummies.com
marketing@usagummies.com`;
}

// ── Outreach targets ─────────────────────────────────────────────────

const TARGETS = [
  // ── RODEO ──
  {
    id: "prca-partnerships",
    name: "PRCA (Professional Rodeo Cowboys Association)",
    email: "sponsorship@prorodeo.com",
    category: "Rodeo",
    subject: "Partnership inquiry: Official Gummy of the PRCA",
    body: prcaPitch(),
  },
  {
    id: "prca-general",
    name: "PRCA General Contact",
    email: "prorodeo@prorodeo.com",
    category: "Rodeo",
    subject: "Sponsorship inquiry — USA Gummies x PRCA partnership",
    body: prcaPitch(),
  },
  {
    id: "pbr",
    name: "PBR (Professional Bull Riders)",
    email: "info@pbr.com",
    category: "Rodeo",
    subject: "Partnership inquiry: USA Gummies x PBR — Official Gummy of Bull Riding",
    body: `Hi PBR team,

I'm the founder of USA Gummies — we make All-American Gummy Bears with natural colors from real fruits and vegetables. No artificial dyes. Made in Indiana.

Bull riding is bold, American, and exciting — just like our brand. We'd love to explore becoming the Official Gummy or Official Candy of the PBR.

We think there's a great activation angle: sampling at PBR events, gummy bear toss promotions, co-branded content with riders, and concessions partnerships. Our product is family-friendly, clean-label, and made right here in America.

About us:
- Premium dye-free gummy bears (no Red 40, Yellow 5)
- Made in Indiana, FDA-registered facility
- Sold on usagummies.com and Amazon Prime
- Strong social presence and growing brand story

We're an emerging brand and flexible on partnership structure — from single event activations to season-long deals. Would love to hear about your sponsorship tiers and see the 2026 deck.

Happy to send samples.

Best,
Ben
USA Gummies
https://www.usagummies.com
marketing@usagummies.com`,
  },

  // ── BASS FISHING ──
  {
    id: "bass-bassmaster",
    name: "B.A.S.S. (Bassmaster)",
    email: "sales@bassmaster.com",
    category: "Bass Fishing",
    subject: "Sponsorship inquiry: Official Gummy of Bassmaster",
    body: bassFishingPitch("Bassmaster", `
We love the Bassmaster Classic and Elite Series — great events for sampling and fan engagement. Picture USA Gummies at every weigh-in stage.
`),
  },
  {
    id: "mlf",
    name: "Major League Fishing",
    email: "michael@majorleaguefishing.com",
    category: "Bass Fishing",
    subject: "Partnership inquiry: USA Gummies x Major League Fishing",
    body: bassFishingPitch("Major League Fishing", `
MLF's innovative format and TV coverage make it a perfect platform. We'd love to discuss the Bass Pro Tour, REDCREST, or Toyota Series opportunities.
`),
  },
  {
    id: "mlf-general",
    name: "Major League Fishing (General)",
    email: "information@majorleaguefishing.com",
    category: "Bass Fishing",
    subject: "Sponsorship inquiry — USA Gummies x MLF",
    body: bassFishingPitch("Major League Fishing", `
We're interested in any tier of partnership — from event sampling to broadcast integration.
`),
  },

  // ── MOTORSPORTS (Entry-Level) ──
  {
    id: "arca-harris",
    name: "ARCA Menards Series (Jesse Harris)",
    email: "jaharris@arcaracing.com",
    category: "Motorsports",
    subject: "Sponsorship inquiry: USA Gummies x ARCA Menards Series",
    body: motorsportsPitch("ARCA", "ARCA Menards Series", `We see ARCA as the perfect entry point for our brand into motorsports. Brands like Reese's and Calypso Lemonade have done great work here, and we'd love to follow suit with a dye-free, American-made candy angle.
`),
  },
  {
    id: "arca-stotz",
    name: "ARCA Menards Series (Jake Stotz)",
    email: "jstotz@arcaracing.com",
    category: "Motorsports",
    subject: "Partnership inquiry — USA Gummies x ARCA",
    body: motorsportsPitch("ARCA", "ARCA Menards Series", `We're interested in race entitlement, team sponsorship, or event activation — whatever makes sense for an emerging food brand. Reese's and Calypso have shown candy can work great in ARCA.
`),
  },
  {
    id: "hardhead-marketing",
    name: "HardHead Marketing (NASCAR Sponsorship Broker)",
    email: "info@hardheadmarketing.com",
    category: "Motorsports",
    subject: "Emerging candy brand seeking NASCAR sponsorship — USA Gummies",
    body: `Hi HardHead Marketing team,

I'm the founder of USA Gummies — we make All-American Gummy Bears with natural colors, no artificial dyes, manufactured in Indiana.

We're an emerging candy brand looking to enter motorsports sponsorship. I understand HardHead specializes in making NASCAR sponsorship accessible for smaller companies, and we'd love your help finding the right opportunity.

We're interested in:
- Craftsman Truck Series shared primary sponsorship
- Xfinity Series associate sponsorship
- Any entry-level NASCAR partnership that gives us car branding and event presence

Our budget is limited as a young brand, but we're flexible and excited to start somewhere. The "All-American candy brand on an All-American race car" story writes itself.

Could you send us information on available sponsorship packages for the 2026 season?

Best,
Ben
USA Gummies
https://www.usagummies.com
marketing@usagummies.com`,
  },
  {
    id: "dirtcar-record",
    name: "World of Outlaws / DIRTcar (Melvyn Record)",
    email: "mrecord@dirtcar.com",
    category: "Motorsports",
    subject: "Partnership inquiry: USA Gummies x World of Outlaws / DIRTcar",
    body: motorsportsPitch("World Racing Group", "World of Outlaws and DIRTcar Racing", `Dirt track racing has the most passionate, loyal fanbase in motorsports — 96% of fans buy from sponsors. That's exactly the kind of engaged audience we want to reach.

We'd love to explore an "Official Candy" partnership, event sampling, or regional activation. Even starting with a single marquee event would be great.
`),
  },
  {
    id: "wrg-partnership",
    name: "World Racing Group (Partnership Form)",
    email: "info@worldracinggroup.com",
    category: "Motorsports",
    subject: "Sponsorship inquiry — USA Gummies x World Racing Group",
    body: motorsportsPitch("World Racing Group", "World of Outlaws and DIRTcar series", `We're a small but growing brand, and we love that your organization works with companies of all sizes. Would love to discuss a partnership that could grow with us.
`),
  },

  // ── BONUS: Other American Sports ──
  {
    id: "nra-shooting",
    name: "National Rifle Association (Events/Sponsorships)",
    email: "membership@nra.org",
    category: "Shooting Sports",
    subject: "Sponsorship inquiry: USA Gummies at NRA events",
    body: `Hi NRA team,

I'm the founder of USA Gummies — we make All-American Gummy Bears with natural colors. No artificial dyes. Made in Indiana.

We'd love to explore having USA Gummies as a vendor or sponsor at NRA events, shows, and competitions. Our product and brand are built on American manufacturing and traditional values — a natural fit for the NRA community.

We're interested in:
- Event vendor/sampling opportunities
- Sponsorship of shooting competitions
- "Official Candy" partnership
- NRA member exclusive promotions

Happy to discuss further and send samples.

Best,
Ben
USA Gummies
https://www.usagummies.com
marketing@usagummies.com`,
  },
  {
    id: "aqha",
    name: "AQHA (American Quarter Horse Association)",
    email: "aqhasponsorship@aqha.org",
    category: "Equestrian",
    subject: "Sponsorship inquiry: USA Gummies x AQHA",
    body: `Hi AQHA team,

I'm the founder of USA Gummies — All-American Gummy Bears made with natural colors, no artificial dyes, manufactured in Indiana.

Quarter horse events draw the same family-friendly, American-values audience that our brand serves. We'd love to explore an "Official Candy" or vendor partnership with AQHA.

Whether it's event sampling, show sponsorship, or member promotions — we're flexible and excited to start a conversation.

Best,
Ben
USA Gummies
https://www.usagummies.com
marketing@usagummies.com`,
  },
];

// ── Submission tracking ──────────────────────────────────────────────
function loadStatus() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
    }
  } catch {}
  return {};
}

function saveStatus(status) {
  const dir = path.dirname(STATUS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), "utf8");
}

// ── Send email ───────────────────────────────────────────────────────
function sendEmail(to, subject, body, dryRun = false) {
  if (dryRun) {
    log(`  [DRY RUN] Would send to ${to}: "${subject}"`);
    return true;
  }

  try {
    const args = [SEND_SCRIPT, "--to", to, "--subject", subject, "--body", body];
    execSync(
      `bash ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`,
      { timeout: 30_000, encoding: "utf8" }
    );
    log(`  ✅ Sent to ${to}: "${subject}"`);
    return true;
  } catch (err) {
    log(`  ❌ Failed to send to ${to}: ${err.message}`);
    return false;
  }
}

// ── Send outreach ────────────────────────────────────────────────────
function sendOutreach(dryRun = false, batchSize = 4) {
  const status = loadStatus();
  let sent = 0;
  let skipped = 0;

  log(`🏟️  Processing ${TARGETS.length} sports outreach targets (batch size: ${batchSize})...`);

  for (const target of TARGETS) {
    if (status[target.id]) {
      skipped++;
      continue;
    }

    if (sent >= batchSize) {
      log(`  ⏸️  Batch limit reached (${batchSize}). Run again for more.`);
      break;
    }

    log(`  📧 [${target.category}] ${target.name} (${target.email})`);
    const ok = sendEmail(target.email, target.subject, target.body, dryRun);

    if (ok) {
      status[target.id] = {
        sentAt: new Date().toISOString(),
        email: target.email,
        name: target.name,
        category: target.category,
        dryRun,
      };
      sent++;
    }
  }

  if (!dryRun) saveStatus(status);

  const remaining = TARGETS.length - skipped - sent;
  log(`\n📊 Sent: ${sent}, Already done: ${skipped}, Remaining: ${remaining}`);
}

// ── Status ───────────────────────────────────────────────────────────
function showStatus() {
  const status = loadStatus();
  const categories = [...new Set(TARGETS.map((t) => t.category))];

  console.log(`\n🏟️  Sports Sponsorship Outreach Status\n`);

  for (const cat of categories) {
    console.log(`\n── ${cat} ──`);
    console.log("Target                                | Status  | Sent At");
    console.log("-".repeat(70));

    for (const t of TARGETS.filter((t) => t.category === cat)) {
      const s = status[t.id];
      const name = t.name.substring(0, 37).padEnd(37);
      if (s) {
        const date = s.sentAt ? new Date(s.sentAt).toLocaleDateString() : "?";
        console.log(`${name} | ✅ Sent | ${date}`);
      } else {
        console.log(`${name} | ⏳ Pending`);
      }
    }
  }

  const done = Object.keys(status).length;
  console.log(`\nTotal: ${done}/${TARGETS.length} sent\n`);
}

// ── Main ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes("--status")) {
  showStatus();
} else {
  const dryRun = args.includes("--dry-run");
  const batchIdx = args.indexOf("--batch");
  const batchSize = batchIdx >= 0 ? parseInt(args[batchIdx + 1]) || 4 : 4;
  sendOutreach(dryRun, batchSize);
}
