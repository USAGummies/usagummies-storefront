#!/usr/bin/env node
/**
 * inbox-responder.mjs — Autonomous inbox scanner + reply engine
 *
 * Scans marketing@usagummies.com inbox via himalaya CLI.
 * Classifies inbound emails into categories:
 *   - PARTNERSHIP: interested retailers, distributors, gift companies
 *   - INFO_REQUEST: asking for details, pricing, shelf life, MOQ
 *   - GUEST_POST: blog/content collaboration offers
 *   - DIRECTORY: business directory confirmations, listing requests
 *   - BOUNCE: delivery failures (skip)
 *   - SPAM: irrelevant (skip)
 *
 * Sends contextual replies and logs everything for Notion sync.
 *
 * Schedule: runs every 2 hours via launchd
 *
 * Usage:
 *   node scripts/inbox-responder.mjs              # Process inbox
 *   node scripts/inbox-responder.mjs --dry-run     # Preview without sending
 *   node scripts/inbox-responder.mjs --status      # Show reply log
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const HOME = process.env.HOME || "/Users/ben";
const LOG_FILE = path.join(HOME, ".config/usa-gummies-mcp/inbox-responder-log.json");
const PROCESSED_FILE = path.join(HOME, ".config/usa-gummies-mcp/processed-emails.json");
const SEND_SCRIPT = path.join(HOME, ".openclaw/workspace/scripts/send-email.sh");

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ── Processed email tracking ────────────────────────────────────────
function loadProcessed() {
  try {
    if (fs.existsSync(PROCESSED_FILE)) {
      return new Set(JSON.parse(fs.readFileSync(PROCESSED_FILE, "utf8")));
    }
  } catch {}
  return new Set();
}

function saveProcessed(processed) {
  const arr = [...processed].slice(-1000); // Keep last 1000
  const dir = path.dirname(PROCESSED_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PROCESSED_FILE, JSON.stringify(arr, null, 2), "utf8");
}

function appendLog(entry) {
  let logs = [];
  try {
    if (fs.existsSync(LOG_FILE)) {
      logs = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
    }
  } catch {}
  logs.push({ ...entry, timestamp: new Date().toISOString() });
  if (logs.length > 500) logs = logs.slice(-500);
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), "utf8");
}

// ── Himalaya helpers ────────────────────────────────────────────────
function listInbox(page = 1) {
  try {
    const result = execSync(
      `himalaya envelope list -a usagummies -f INBOX -p ${page} 2>/dev/null`,
      { encoding: "utf8", timeout: 30_000 }
    );
    return result;
  } catch (err) {
    log(`⚠️  Failed to list inbox: ${err.message}`);
    return "";
  }
}

function readMessage(id) {
  try {
    const result = execSync(
      `himalaya message read -a usagummies ${id} 2>/dev/null`,
      { encoding: "utf8", timeout: 15_000 }
    );
    return result;
  } catch (err) {
    log(`⚠️  Failed to read message ${id}: ${err.message}`);
    return "";
  }
}

function parseEnvelopeList(raw) {
  const lines = raw.split("\n").filter((l) => l.startsWith("|") && !l.includes("---") && !l.includes("ID"));
  return lines.map((line) => {
    const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cols.length < 5) return null;
    return {
      id: cols[0],
      flags: cols[1],
      subject: cols[2],
      from: cols[3],
      date: cols[4],
    };
  }).filter(Boolean);
}

// ── Email classification ────────────────────────────────────────────
const SKIP_PATTERNS = [
  /mail delivery subsystem/i,
  /postmaster@/i,
  /undeliverable/i,
  /delivery status notification/i,
  /noreply/i,
  /no-reply/i,
  /donotreply/i,
  /security alert/i,
  /^google$/i,
  /medium daily digest/i,
  /linkedin/i,
  /tiktok/i,
  /verification code/i,
  /faire/i,
  /^ben$/i,
  /marketing@usagummies/i,
  /newsletter/i,
  /digest/i,
  /substack/i,
  /mcbride/i,
];

const SKIP_SUBJECTS = [
  /delivery status/i,
  /undeliverable/i,
  /security alert/i,
  /verification code/i,
  /agent script test/i,
  /openclaw.*test/i,
  /smtp test/i,
  /wholesale advertising/i,
  /newsletter/i,
  /weekly digest/i,
];

function shouldSkip(envelope) {
  const from = envelope.from || "";
  const subject = envelope.subject || "";

  for (const p of SKIP_PATTERNS) {
    if (p.test(from)) return true;
  }
  for (const p of SKIP_SUBJECTS) {
    if (p.test(subject)) return true;
  }
  return false;
}

function classify(envelope, body) {
  const subject = (envelope.subject || "").toLowerCase();
  const from = (envelope.from || "").toLowerCase();
  const text = (body || "").toLowerCase();

  // Partnership interest signals
  if (
    text.includes("partnership") ||
    text.includes("wholesale") ||
    text.includes("retail") ||
    text.includes("distribution") ||
    text.includes("carry your product") ||
    text.includes("interested in") ||
    text.includes("new business") ||
    text.includes("proposal") ||
    subject.includes("partnership")
  ) {
    return "PARTNERSHIP";
  }

  // Info requests
  if (
    text.includes("shelf life") ||
    text.includes("shelf-life") ||
    text.includes("expir") ||
    text.includes("moq") ||
    text.includes("minimum order") ||
    text.includes("pricing") ||
    text.includes("price list") ||
    text.includes("how much") ||
    text.includes("what state") ||
    text.includes("where are") ||
    text.includes("more information")
  ) {
    return "INFO_REQUEST";
  }

  // Guest post / content collaboration
  if (
    text.includes("guest post") ||
    text.includes("write for us") ||
    text.includes("content collaboration") ||
    text.includes("article submission") ||
    text.includes("link insertion") ||
    subject.includes("guest post")
  ) {
    return "GUEST_POST";
  }

  // Directory listings
  if (
    text.includes("directory") ||
    text.includes("listing") ||
    text.includes("added you") ||
    text.includes("verify your") ||
    text.includes("claim your") ||
    from.includes("aamfg") ||
    from.includes("americanmanufacturing")
  ) {
    return "DIRECTORY";
  }

  // Currently unavailable / auto-reply
  if (
    text.includes("currently unavailable") ||
    text.includes("out of office") ||
    text.includes("auto-reply") ||
    text.includes("automatic reply")
  ) {
    return "AUTO_REPLY";
  }

  return "UNKNOWN";
}

// ── Reply templates ─────────────────────────────────────────────────
function getReply(category, envelope, body) {
  const fromName = (envelope.from || "").split("<")[0].trim() || "there";

  switch (category) {
    case "PARTNERSHIP":
      return {
        subject: `Re: ${envelope.subject}`,
        body: `Hi ${fromName},

Thanks so much for your interest in USA Gummies! We'd love to explore a partnership.

Quick overview of what we offer:
- All-American Gummy Bears — 7.5 oz bags, dye-free, made in Indiana
- Natural colors from fruit & vegetable extracts (turmeric, spirulina, beet juice)
- FDA-registered facility, full ingredient transparency
- Wholesale pricing available for retail, gift, and food service

Our current wholesale tiers:
- 24+ bags: $3.99/bag
- 48+ bags: $3.49/bag
- 100+ bags: $2.99/bag

I can send a full product sheet with nutrition facts, shelf life info, and high-res photos. Would that be helpful?

Best,
Ben
USA Gummies
https://www.usagummies.com/wholesale`
      };

    case "INFO_REQUEST":
      return {
        subject: `Re: ${envelope.subject}`,
        body: `Hi ${fromName},

Thanks for reaching out! Here are the details:

- Shelf life: 12 months from manufacture date, best enjoyed within 9 months
- Manufacturing: Made in Indiana, packed in Pennsylvania
- Ingredients: All natural — no artificial dyes, colors, or flavors
- Available on: usagummies.com and Amazon (Prime eligible)
- Wholesale: Available for retailers, gift shops, and food service

Our website has full ingredient and nutrition info:
https://www.usagummies.com/ingredients

Is there anything specific I can help with?

Best,
Ben
USA Gummies`
      };

    case "DIRECTORY":
      return {
        subject: `Re: ${envelope.subject}`,
        body: `Hi ${fromName},

Thanks for reaching out! We're happy to provide any additional information needed for our listing.

Company: USA Gummies
Website: https://www.usagummies.com
Product: All-American Gummy Bears (dye-free, natural colors)
Category: Food & Beverage / Candy / Confectionery
Manufacturing State: Indiana
Company State: Wyoming
Founded: 2024
Available: usagummies.com, Amazon

Please let me know if you need anything else!

Best,
Ben
USA Gummies`
      };

    default:
      return null; // Don't auto-reply to unknown categories
  }
}

// ── Send email ──────────────────────────────────────────────────────
function sendReply(to, subject, body, dryRun = false) {
  if (dryRun) {
    log(`  [DRY RUN] Would reply to ${to}: "${subject}"`);
    return true;
  }

  try {
    const args = [SEND_SCRIPT, "--to", to, "--subject", subject, "--body", body];
    execSync(
      `bash ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`,
      { timeout: 30_000, encoding: "utf8" }
    );
    log(`  ✅ Replied to ${to}: "${subject}"`);
    return true;
  } catch (err) {
    log(`  ❌ Failed to reply to ${to}: ${err.message}`);
    return false;
  }
}

// ── Extract email address from "From" field ─────────────────────────
function extractEmail(from) {
  const match = from.match(/<([^>]+)>/);
  if (match) return match[1];
  if (from.includes("@")) return from.trim();
  return null;
}

// ── Main processing ─────────────────────────────────────────────────
async function processInbox(dryRun = false) {
  log("📬 Scanning inbox...");

  const processed = loadProcessed();
  let replied = 0;
  let skipped = 0;
  let newProcessed = 0;

  // Scan first 3 pages (most recent ~30 emails)
  for (let page = 1; page <= 3; page++) {
    const raw = listInbox(page);
    const envelopes = parseEnvelopeList(raw);

    if (envelopes.length === 0) break;

    for (const env of envelopes) {
      const emailKey = `${env.id}-${env.date}`;

      // Already processed?
      if (processed.has(emailKey)) {
        skipped++;
        continue;
      }

      // Skip bounces, auto-replies, notifications
      if (shouldSkip(env)) {
        processed.add(emailKey);
        newProcessed++;
        continue;
      }

      // Read the full message
      const body = readMessage(env.id);
      if (!body) continue;

      // Classify
      const category = classify(env, body);
      log(`  📧 ${env.from} | ${category} | "${(env.subject || "").slice(0, 50)}"`);

      // Get reply template
      const reply = getReply(category, env, body);

      if (reply) {
        const toEmail = extractEmail(env.from);
        if (toEmail) {
          const ok = sendReply(toEmail, reply.subject, reply.body, dryRun);
          if (ok) {
            replied++;
            appendLog({
              action: "auto_reply",
              from: env.from,
              to: toEmail,
              category,
              subject: env.subject,
              replySubject: reply.subject,
              dryRun,
            });
          }
        }
      } else {
        appendLog({
          action: "classified_no_reply",
          from: env.from,
          category,
          subject: env.subject,
        });
      }

      processed.add(emailKey);
      newProcessed++;
    }
  }

  if (!dryRun) saveProcessed(processed);

  log(`\n📊 Results: ${replied} replied, ${skipped} already processed, ${newProcessed} newly scanned`);
}

// ── Status ──────────────────────────────────────────────────────────
function showStatus() {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      log("No reply log yet");
      return;
    }
    const logs = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
    const replies = logs.filter((l) => l.action === "auto_reply");
    const classified = logs.filter((l) => l.action === "classified_no_reply");

    console.log(`\n📊 Inbox Responder Status\n`);
    console.log(`Total auto-replies sent: ${replies.length}`);
    console.log(`Classified but no reply: ${classified.length}\n`);

    if (replies.length) {
      console.log("Recent replies:");
      for (const r of replies.slice(-10)) {
        console.log(`  ${r.timestamp} | ${r.category} | ${r.to} | ${r.replySubject?.slice(0, 50)}`);
      }
    }
    console.log("");
  } catch (e) {
    log(`Error: ${e.message}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes("--status")) {
  showStatus();
} else {
  const dryRun = args.includes("--dry-run");
  await processInbox(dryRun);
}
