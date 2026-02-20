#!/usr/bin/env node
/**
 * email-drip.mjs — Automated welcome email drip sequence
 *
 * Reads leads from ~/.config/usa-gummies-mcp/leads.json
 * Sends a 3-email welcome sequence via himalaya:
 *   Email 1: Welcome (immediate on first run after capture)
 *   Email 2: "Why Dye-Free Matters" (24h after capture)
 *   Email 3: 10% off first order (72h after capture)
 *
 * Schedule: runs every 2 hours via launchd
 * Leads file: JSON array of { email, source, capturedAt, drip1?, drip2?, drip3? }
 *
 * Adding leads:
 *   node scripts/email-drip.mjs --add "someone@example.com" "exit-intent"
 *   or manually edit ~/.config/usa-gummies-mcp/leads.json
 *
 * Usage:
 *   node scripts/email-drip.mjs              # Process drip queue
 *   node scripts/email-drip.mjs --add EMAIL SOURCE  # Add a lead
 *   node scripts/email-drip.mjs --dry-run     # Preview without sending
 *   node scripts/email-drip.mjs --status      # Show drip status
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const LEADS_FILE = path.join(
  process.env.HOME || "/Users/ben",
  ".config/usa-gummies-mcp/leads.json"
);
const LOG_FILE = path.join(
  process.env.HOME || "/Users/ben",
  ".config/usa-gummies-mcp/drip-log.json"
);
const SEND_SCRIPT = path.join(
  process.env.HOME || "/Users/ben",
  ".openclaw/workspace/scripts/send-email.sh"
);

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ── Lead storage ────────────────────────────────────────────────────
function loadLeads() {
  try {
    if (fs.existsSync(LEADS_FILE)) {
      return JSON.parse(fs.readFileSync(LEADS_FILE, "utf8"));
    }
  } catch (e) {
    log(`⚠️  Error reading leads file: ${e.message}`);
  }
  return [];
}

function saveLeads(leads) {
  const dir = path.dirname(LEADS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2), "utf8");
}

function appendLog(entry) {
  let logs = [];
  try {
    if (fs.existsSync(LOG_FILE)) {
      logs = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
    }
  } catch {}
  logs.push({ ...entry, timestamp: new Date().toISOString() });
  // Keep last 500 entries
  if (logs.length > 500) logs = logs.slice(-500);
  fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), "utf8");
}

// ── Email templates ─────────────────────────────────────────────────
const DRIP_EMAILS = {
  drip1: {
    delayHours: 0,
    subject: "Welcome to USA Gummies — here's what we're about",
    body: `Hi there,

Thanks for joining the USA Gummies community! We're a small American brand making gummy bears the way they should be made — with real ingredients and zero artificial dyes.

While big candy companies like Mars are scrambling to remove artificial dyes by 2028, we started dye-free from day one. Our colors come from turmeric, spirulina, beet juice, and other fruits and vegetables.

Here's what makes us different:
- No Red 40, Yellow 5, Blue 1, or any artificial dyes
- Made in Indiana, packed in Pennsylvania
- FDA-registered facility
- Bold, juicy flavors (not the bland "healthy" taste you might expect)

Check out our shop: https://www.usagummies.com/shop?utm_source=email&utm_medium=drip&utm_campaign=welcome&utm_content=drip1

Talk soon,
Ben
USA Gummies
https://www.usagummies.com

P.S. We're also on Amazon if that's easier: https://www.amazon.com/dp/B0G1JK92TJ`
  },

  drip2: {
    delayHours: 24,
    subject: "Why we stopped eating gummy bears (then started making them)",
    body: `Hi again,

Quick question — have you ever flipped over a bag of gummy bears and read the ingredients?

Most popular brands use 5-7 artificial dyes per bag. Red 40, Yellow 5, Blue 1 — these are petroleum-derived chemicals that the EU requires warning labels on. The same Haribo you buy in America has different ingredients than the one sold in Germany.

We thought that was wrong. So we made our own.

Here's a quick read if you're curious about what's actually in most candy:
https://www.usagummies.com/blog/is-red-40-bad-for-you?utm_source=email&utm_medium=drip&utm_campaign=welcome&utm_content=drip2

And if you have kids, this one is worth 2 minutes:
https://www.usagummies.com/blog/food-dyes-adhd-children?utm_source=email&utm_medium=drip&utm_campaign=welcome&utm_content=drip2

We're not trying to scare anyone — just sharing what we learned when we started digging into this stuff.

Ben
USA Gummies`
  },

  drip3: {
    delayHours: 72,
    subject: "A small thank you (10% off your first order)",
    body: `Hey,

You've been on our list for a few days now, and I wanted to say thanks for sticking around.

Here's 10% off your first order — no minimum, no strings:

Use code WELCOME10 at checkout
https://www.usagummies.com/shop?utm_source=email&utm_medium=drip&utm_campaign=welcome&utm_content=drip3

Our best seller is the 5-bag bundle ($25 shipped free). That's basically $4.50/bag for premium dye-free gummy bears made in the USA.

If you have any questions about ingredients, shipping, or anything else, just reply to this email. I read every one.

Ben
USA Gummies
https://www.usagummies.com

P.S. If you know someone who cares about what's in their food, feel free to forward this. We're a small brand and every share helps.`
  }
};

// ── Send email via himalaya ─────────────────────────────────────────
function sendEmail(to, subject, body, dryRun = false) {
  if (dryRun) {
    log(`  [DRY RUN] Would send to ${to}: "${subject}"`);
    return true;
  }

  try {
    const args = [
      SEND_SCRIPT,
      "--to", to,
      "--subject", subject,
      "--body", body
    ];
    execSync(`bash ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`, {
      timeout: 30_000,
      encoding: "utf8",
    });
    log(`  ✅ Sent to ${to}: "${subject}"`);
    return true;
  } catch (err) {
    log(`  ❌ Failed to send to ${to}: ${err.message}`);
    return false;
  }
}

// ── Process drip queue ──────────────────────────────────────────────
function processDrips(dryRun = false) {
  const leads = loadLeads();
  if (leads.length === 0) {
    log("📭 No leads in queue");
    return;
  }

  const now = Date.now();
  let sent = 0;
  let skipped = 0;

  log(`📬 Processing ${leads.length} leads...`);

  for (const lead of leads) {
    const capturedAt = new Date(lead.capturedAt).getTime();
    if (isNaN(capturedAt)) {
      log(`  ⚠️  Invalid capturedAt for ${lead.email}, skipping`);
      continue;
    }

    const hoursSinceCapture = (now - capturedAt) / (1000 * 60 * 60);

    for (const [key, template] of Object.entries(DRIP_EMAILS)) {
      // Already sent this drip?
      if (lead[key]) continue;

      // Not time yet?
      if (hoursSinceCapture < template.delayHours) continue;

      // Send it
      const ok = sendEmail(lead.email, template.subject, template.body, dryRun);
      if (ok) {
        lead[key] = new Date().toISOString();
        sent++;
        appendLog({
          action: "drip_sent",
          email: lead.email,
          drip: key,
          subject: template.subject,
          dryRun,
        });
      }

      // Only send one drip per lead per run (don't blast all 3 at once)
      break;
    }

    // Check if fully dripped
    if (lead.drip1 && lead.drip2 && lead.drip3 && !lead.completed) {
      lead.completed = true;
      log(`  🎉 ${lead.email} — drip sequence complete`);
    }
  }

  if (!dryRun) saveLeads(leads);
  log(`📊 Sent ${sent}, skipped ${skipped}, total leads: ${leads.length}`);
}

// ── Add a lead ──────────────────────────────────────────────────────
function addLead(email, source = "manual") {
  const leads = loadLeads();

  // Dedupe
  if (leads.some((l) => l.email.toLowerCase() === email.toLowerCase())) {
    log(`⚠️  ${email} already in leads list`);
    return;
  }

  leads.push({
    email: email.toLowerCase().trim(),
    source,
    capturedAt: new Date().toISOString(),
  });

  saveLeads(leads);
  appendLog({ action: "lead_added", email, source });
  log(`✅ Added ${email} (source: ${source})`);
}

// ── Status ──────────────────────────────────────────────────────────
function showStatus() {
  const leads = loadLeads();
  if (leads.length === 0) {
    log("📭 No leads");
    return;
  }

  console.log(`\n📊 Drip Status — ${leads.length} leads\n`);
  console.log("Email                          | Source       | Drip1 | Drip2 | Drip3 | Done");
  console.log("-".repeat(90));

  for (const l of leads) {
    const email = l.email.padEnd(30);
    const source = (l.source || "?").padEnd(12);
    const d1 = l.drip1 ? "✅" : "⏳";
    const d2 = l.drip2 ? "✅" : "⏳";
    const d3 = l.drip3 ? "✅" : "⏳";
    const done = l.completed ? "✅" : "";
    console.log(`${email} | ${source} | ${d1}    | ${d2}    | ${d3}    | ${done}`);
  }
  console.log("");
}

// ── Main ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes("--add")) {
  const addIdx = args.indexOf("--add");
  const email = args[addIdx + 1];
  const source = args[addIdx + 2] || "manual";
  if (!email || !email.includes("@")) {
    console.error("Usage: --add EMAIL [SOURCE]");
    process.exit(1);
  }
  addLead(email, source);
} else if (args.includes("--status")) {
  showStatus();
} else {
  const dryRun = args.includes("--dry-run");
  processDrips(dryRun);
}
