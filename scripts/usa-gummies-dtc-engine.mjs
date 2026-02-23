#!/usr/bin/env node
/**
 * USA Gummies — DTC Retention & Lifetime Value Engine (Build 3)
 *
 * 10 autonomous agents that turn one-time DTC buyers into repeat customers.
 * Manages post-purchase email sequences, review solicitation, referral programs,
 * churn prediction, reorder reminders, and loyalty tiers.
 *
 * Agents:
 *   D1  — New Customer Ingestor       Daily 8:00 AM
 *   D2  — Post-Purchase Sequence Mgr  Daily 9:00 AM
 *   D3  — Review Solicitor            (Part of D2 sequence)
 *   D4  — Referral Program Manager    (Part of D2 sequence)
 *   D5  — Reorder Predictor           Daily 10:00 AM
 *   D6  — Churn Risk Scorer           Daily 11:00 AM
 *   D7  — Loyalty Tier Calculator     Weekly Mon 7:00 AM
 *   D8  — Email Deliverability Guard  Daily 6:00 PM
 *   D9  — DTC Daily Report            Daily 7:00 PM
 *   D10 — Self-Heal Monitor           Every 30 min
 *
 * Usage:
 *   node scripts/usa-gummies-dtc-engine.mjs run D1
 *   node scripts/usa-gummies-dtc-engine.mjs run all
 *   node scripts/usa-gummies-dtc-engine.mjs status
 *   node scripts/usa-gummies-dtc-engine.mjs help
 */

import {
  createEngine,
  todayET,
  todayLongET,
  nowETTimestamp,
  addDaysToDate,
  daysSince,
  safeJsonRead,
  safeJsonWrite,
  sendEmail,
  textBen,
  renderTemplate,
  fetchWithTimeout,
  log as sharedLog,
} from "./lib/usa-gummies-shared.mjs";

import fs from "node:fs";
import path from "node:path";

// ── Environment ──────────────────────────────────────────────────────────────

const HOME = process.env.HOME || "/Users/ben";
const ENV_FILE = path.join(HOME, ".config/usa-gummies-mcp/.env-daily-report");

function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  const lines = fs.readFileSync(ENV_FILE, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

// ── Shopify Config ───────────────────────────────────────────────────────────

const SHOPIFY_STORE = "usa-gummies.myshopify.com";
const SHOPIFY_API_VERSION = "2025-01";
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_API_TOKEN || "";

async function shopifyAdmin(endpoint, method = "GET", body = null) {
  const url = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}${endpoint}`;
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetchWithTimeout(url, opts, 20000);
    if (!res.ok) return { ok: false, error: `Shopify ${res.status}: ${res.statusText}` };
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Config & State ───────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(HOME, ".config/usa-gummies-mcp");
const SEQUENCES_FILE = path.join(CONFIG_DIR, "dtc-customer-sequences.json");
const REFERRAL_CODES_FILE = path.join(CONFIG_DIR, "dtc-referral-codes.json");
const DAILY_EMAIL_LOG_FILE = path.join(CONFIG_DIR, "dtc-daily-email-log.json");
const BOUNCE_TRACKER_FILE = path.join(CONFIG_DIR, "dtc-bounce-tracker.json");

// ── Notion DB IDs ────────────────────────────────────────────────────────────
// Set these after creating Notion databases

const IDS = {
  dtcCustomers: process.env.NOTION_DB_DTC_CUSTOMERS || "",
  dtcEmailLog: process.env.NOTION_DB_DTC_EMAIL_LOG || "",
  dtcReviews: process.env.NOTION_DB_DTC_REVIEWS || "",
  dtcReferrals: process.env.NOTION_DB_DTC_REFERRALS || "",
};

// ── Required DB Schemas ──────────────────────────────────────────────────────

const DB_SCHEMAS = {
  dtcCustomers: {
    Name: "title",
    Email: "email",
    "First Order Date": "date",
    "Last Order Date": "date",
    "Total Orders": "number",
    "Total Revenue": "number",
    "Loyalty Tier": { select: { options: [{ name: "Bronze" }, { name: "Silver" }, { name: "Gold" }] } },
    "Referral Code": "rich_text",
    "Referrals Made": "number",
    "Sequence Stage": { select: { options: [{ name: "Day 3" }, { name: "Day 7" }, { name: "Day 14" }, { name: "Day 30" }, { name: "Complete" }] } },
    "Last Email Sent": "date",
    "Churn Risk": { select: { options: [{ name: "Low" }, { name: "Medium" }, { name: "High" }] } },
    "Predicted Reorder Date": "date",
    Source: "rich_text",
  },
  dtcEmailLog: {
    Customer: "title",
    "Email Type": { select: { options: [{ name: "delivery-checkin" }, { name: "review-request" }, { name: "referral" }, { name: "reorder" }, { name: "winback" }, { name: "birthday" }] } },
    "Sent Date": "date",
    Bounced: "checkbox",
    Status: { select: { options: [{ name: "Sent" }, { name: "Bounced" }, { name: "Pending" }] } },
  },
  dtcReviews: {
    Customer: "title",
    Email: "email",
    "Review Date": "date",
    Rating: "number",
    "Review Text": "rich_text",
    Source: { select: { options: [{ name: "Email Solicited" }, { name: "Organic" }] } },
  },
  dtcReferrals: {
    "Referral Code": "title",
    "Referrer Email": "email",
    "Referrer Name": "rich_text",
    "Created Date": "date",
    "Times Redeemed": "number",
    "Revenue Generated": "number",
    "Discount Amount": "number",
    Active: "checkbox",
  },
};

// ── Email Templates ──────────────────────────────────────────────────────────

const EMAIL_TEMPLATES = {
  dtcDeliveryCheckin: {
    subject: "How are your gummies, {{firstName}}? 🐻",
    body: `Hi {{firstName}},

Your USA Gummies order should have arrived by now! We hope you're loving them.

Made with real fruit colors and zero artificial dyes — that's the USA Gummies difference.

If anything isn't perfect, just reply to this email and we'll make it right.

Enjoy!
— The USA Gummies Team

P.S. Fun fact: every bag is made right here in the USA 🇺🇸`,
  },
  dtcReviewRequest: {
    subject: "Love your gummies? We'd love a review! ⭐",
    body: `Hi {{firstName}},

You've had your USA Gummies for about a week now. We hope you're a fan!

If you have a moment, we'd love to hear what you think:
👉 Leave a review: https://www.usagummies.com/shop#reviews

As a thank you, you'll get 10% off your next order automatically.

Thanks for supporting a small, American-made brand!
— The USA Gummies Team`,
  },
  dtcReferralOffer: {
    subject: "Share the love — you both get $5 off 🎉",
    body: `Hi {{firstName}},

Enjoying your USA Gummies? Share them with a friend!

Your personal referral code: {{referralCode}}

Here's how it works:
• Share your code with a friend
• They get $5 off their first order
• You get $5 off your next order when they purchase

Share link: https://www.usagummies.com/shop?ref={{referralCode}}

Thanks for spreading the word!
— The USA Gummies Team`,
  },
  dtcReorderReminder: {
    subject: "Running low on gummies? 🐻",
    body: `Hi {{firstName}},

It's been about {{daysSinceOrder}} days since your last order — you might be running low!

Restock your favorites: https://www.usagummies.com/shop

Still made with real fruit colors. Still zero artificial dyes. Still made in the USA.

— The USA Gummies Team`,
  },
  dtcWinback: {
    subject: "We miss you, {{firstName}}! Here's 15% off 💛",
    body: `Hi {{firstName}},

It's been a while since your last order, and we miss you!

Here's a special welcome-back offer: 15% off with code {{winbackCode}}

Shop now: https://www.usagummies.com/shop?discount={{winbackCode}}

This code expires in 14 days. We hope to see you back!

— The USA Gummies Team`,
  },
  dtcBirthdayGold: {
    subject: "Happy Birthday from USA Gummies! 🎂🐻",
    body: `Hi {{firstName}},

Happy Birthday! As a Gold-tier customer, we wanted to celebrate with you.

Here's a special birthday gift: 20% off your next order with code {{birthdayCode}}

Shop now: https://www.usagummies.com/shop?discount={{birthdayCode}}

Thank you for being one of our most loyal customers!

🎉 — The USA Gummies Team`,
  },
};

// ── Schedule Plan ────────────────────────────────────────────────────────────

const SCHEDULE_PLAN = {
  D1: "Daily 8:00 AM",
  D2: "Daily 9:00 AM",
  D3: "Part of D2 sequence",
  D4: "Part of D2 sequence",
  D5: "Daily 10:00 AM",
  D6: "Daily 11:00 AM",
  D7: "Weekly Mon 7:00 AM",
  D8: "Daily 6:00 PM",
  D9: "Daily 7:00 PM",
  D10: "Every 30 min",
};

// ── Engine Bootstrap ─────────────────────────────────────────────────────────

const engine = createEngine({
  name: "dtc-engine",
  schedulePlan: SCHEDULE_PLAN,
  ids: IDS,
});

const log = (msg) => engine.log(msg);
const DRY_RUN = process.argv.includes("--dry-run");
const MAX_EMAILS_PER_DAY = 20;
const REORDER_WINDOW_DAYS = 30; // avg consumption cycle for a 5-pack
const CHURN_THRESHOLD_DAYS = 45;

// ── Helper: Daily email counter ──────────────────────────────────────────────

function getDailyEmailCount() {
  const data = safeJsonRead(DAILY_EMAIL_LOG_FILE, {});
  const today = todayET();
  return data[today] || 0;
}

function incrementDailyEmailCount() {
  const data = safeJsonRead(DAILY_EMAIL_LOG_FILE, {});
  const today = todayET();
  data[today] = (data[today] || 0) + 1;
  // Prune old entries (keep last 7 days)
  const keys = Object.keys(data).sort();
  while (keys.length > 7) {
    delete data[keys.shift()];
  }
  safeJsonWrite(DAILY_EMAIL_LOG_FILE, data);
}

function canSendEmail() {
  return getDailyEmailCount() < MAX_EMAILS_PER_DAY;
}

// ── Helper: Sequence state ───────────────────────────────────────────────────

function getSequences() {
  return safeJsonRead(SEQUENCES_FILE, {});
}

function saveSequences(data) {
  safeJsonWrite(SEQUENCES_FILE, data);
}

function getReferralCodes() {
  return safeJsonRead(REFERRAL_CODES_FILE, {});
}

function saveReferralCodes(data) {
  safeJsonWrite(REFERRAL_CODES_FILE, data);
}

// ── Helper: Generate referral/discount code ──────────────────────────────────

function generateCode(prefix = "USA") {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = prefix;
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ── Helper: Get first name from full name ────────────────────────────────────

function firstName(fullName) {
  return String(fullName || "").split(/\s+/)[0] || "there";
}

// ══════════════════════════════════════════════════════════════════════════════
//  AGENTS
// ══════════════════════════════════════════════════════════════════════════════

// ── D1: New Customer Ingestor ────────────────────────────────────────────────

async function runD1() {
  log("D1 — New Customer Ingestor starting...");
  if (!SHOPIFY_TOKEN) return engine.fail("D1", "No Shopify Admin token");

  const today = todayET();
  const yesterday = addDaysToDate(today, -1);

  // Fetch orders from last 24h
  const res = await shopifyAdmin(
    `/orders.json?status=any&created_at_min=${yesterday}T00:00:00-05:00&created_at_max=${today}T23:59:59-05:00&limit=250`
  );
  if (!res.ok) return engine.fail("D1", `Shopify error: ${res.error}`);

  const orders = res.data?.orders || [];
  log(`D1 — Found ${orders.length} orders in last 24h`);

  // Filter DTC only (exclude B2B tags)
  const dtcOrders = orders.filter((o) => {
    const tags = String(o.tags || "").toLowerCase();
    return !tags.includes("b2b") && !tags.includes("wholesale") && !tags.includes("bulk");
  });

  const sequences = getSequences();
  let newCustomers = 0;
  let existingCustomers = 0;

  for (const order of dtcOrders) {
    const email = (order.email || "").toLowerCase().trim();
    if (!email) continue;

    const custName = `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim();
    const orderTotal = parseFloat(order.total_price || 0);
    const products = (order.line_items || []).map((li) => li.title).join(", ");
    const source = order.referring_site || order.source_name || "direct";

    if (sequences[email]) {
      // Returning customer — update their record
      existingCustomers++;
      sequences[email].lastOrderDate = today;
      sequences[email].totalOrders = (sequences[email].totalOrders || 1) + 1;
      sequences[email].totalRevenue = (sequences[email].totalRevenue || 0) + orderTotal;
      // Reset sequence for returning customers at reorder stage
      sequences[email].stage = "Complete";
      continue;
    }

    // New customer
    newCustomers++;
    sequences[email] = {
      name: custName,
      email,
      firstOrderDate: today,
      lastOrderDate: today,
      totalOrders: 1,
      totalRevenue: orderTotal,
      products,
      source,
      stage: "new", // Will progress: new → Day 3 → Day 7 → Day 14 → Day 30 → Complete
      lastEmailDate: null,
      referralCode: null,
      churnRisk: "Low",
      loyaltyTier: "Bronze",
    };

    // Write to Notion if DB configured
    if (IDS.dtcCustomers && !DRY_RUN) {
      try {
        await engine.createPage(IDS.dtcCustomers, {
          Name: { title: [{ text: { content: custName || email } }] },
          Email: { email },
          "First Order Date": { date: { start: today } },
          "Last Order Date": { date: { start: today } },
          "Total Orders": { number: 1 },
          "Total Revenue": { number: orderTotal },
          "Loyalty Tier": { select: { name: "Bronze" } },
          "Sequence Stage": { select: { name: "Day 3" } },
          "Churn Risk": { select: { name: "Low" } },
          Source: { rich_text: [{ text: { content: source.slice(0, 100) } }] },
        });
      } catch (err) {
        log(`D1 — Notion write error for ${email}: ${err.message}`);
      }
    }
  }

  saveSequences(sequences);
  log(`D1 — Done: ${newCustomers} new, ${existingCustomers} returning (${dtcOrders.length} DTC orders)`);
  return engine.succeed("D1", { newCustomers, existingCustomers, totalOrders: dtcOrders.length });
}

// ── D2: Post-Purchase Sequence Manager ───────────────────────────────────────

async function runD2() {
  log("D2 — Post-Purchase Sequence Manager starting...");

  const sequences = getSequences();
  const today = todayET();
  let emailsSent = 0;
  let queued = 0;

  const sortedCustomers = Object.entries(sequences)
    .filter(([, c]) => c.stage !== "Complete")
    .sort((a, b) => (a[1].firstOrderDate || "").localeCompare(b[1].firstOrderDate || ""));

  for (const [email, customer] of sortedCustomers) {
    if (!canSendEmail()) {
      log(`D2 — Daily email limit reached (${MAX_EMAILS_PER_DAY})`);
      break;
    }

    const daysSinceFirstOrder = daysSince(customer.firstOrderDate);
    const fn = firstName(customer.name);

    // Determine next action based on stage and timing
    let action = null;

    if (customer.stage === "new" && daysSinceFirstOrder >= 3) {
      action = { stage: "Day 3", template: "dtcDeliveryCheckin", type: "delivery-checkin" };
    } else if (customer.stage === "Day 3" && daysSinceFirstOrder >= 7) {
      action = { stage: "Day 7", template: "dtcReviewRequest", type: "review-request" };
    } else if (customer.stage === "Day 7" && daysSinceFirstOrder >= 14) {
      action = { stage: "Day 14", template: "dtcReferralOffer", type: "referral" };
    } else if (customer.stage === "Day 14" && daysSinceFirstOrder >= 30) {
      action = { stage: "Day 30", template: "dtcReorderReminder", type: "reorder" };
    } else if (customer.stage === "Day 30" && daysSinceFirstOrder >= 35) {
      // Sequence complete
      customer.stage = "Complete";
      continue;
    }

    if (!action) continue;

    // Generate referral code if needed for Day 14
    if (action.type === "referral" && !customer.referralCode) {
      customer.referralCode = generateCode("USAG");
      const codes = getReferralCodes();
      codes[customer.referralCode] = { email, name: customer.name, created: today, redeemed: 0, revenue: 0 };
      saveReferralCodes(codes);
    }

    const vars = {
      firstName: fn,
      referralCode: customer.referralCode || "",
      daysSinceOrder: String(daysSinceFirstOrder),
    };

    const tpl = EMAIL_TEMPLATES[action.template];
    if (!tpl) continue;

    const subject = renderTemplate(tpl.subject, vars);
    const body = renderTemplate(tpl.body, vars);

    if (DRY_RUN) {
      log(`D2 [DRY] Would send ${action.type} to ${email} (${fn})`);
      queued++;
    } else {
      const result = sendEmail({ to: email, subject, body });
      if (result.ok) {
        emailsSent++;
        incrementDailyEmailCount();
        customer.stage = action.stage;
        customer.lastEmailDate = today;
        log(`D2 — Sent ${action.type} to ${email}`);

        // Log to Notion
        if (IDS.dtcEmailLog) {
          try {
            await engine.createPage(IDS.dtcEmailLog, {
              Customer: { title: [{ text: { content: customer.name || email } }] },
              "Email Type": { select: { name: action.type } },
              "Sent Date": { date: { start: today } },
              Bounced: { checkbox: false },
              Status: { select: { name: "Sent" } },
            });
          } catch (err) {
            log(`D2 — Notion log error: ${err.message}`);
          }
        }
      } else {
        log(`D2 — Email failed to ${email}: ${result.error}`);
      }
    }
  }

  saveSequences(sequences);
  log(`D2 — Done: ${emailsSent} sent, ${queued} queued (dry-run)`);
  return engine.succeed("D2", { emailsSent, queued });
}

// ── D3: Review Solicitor (triggered as part of D2 Day 7 stage) ───────────────

async function runD3() {
  log("D3 — Review Solicitor (runs as part of D2 Day 7 stage)");
  // D3 logic is embedded in D2's Day 7 action using dtcReviewRequest template
  // Standalone run reviews current solicitation stats
  const sequences = getSequences();
  const reviewRequested = Object.values(sequences).filter((c) => {
    const stage = c.stage || "";
    return stage === "Day 7" || stage === "Day 14" || stage === "Day 30" || stage === "Complete";
  }).length;
  const totalCustomers = Object.keys(sequences).length;

  log(`D3 — ${reviewRequested}/${totalCustomers} customers have received review requests`);
  return engine.succeed("D3", { reviewRequested, totalCustomers });
}

// ── D4: Referral Program Manager (triggered as part of D2 Day 14 stage) ──────

async function runD4() {
  log("D4 — Referral Program Manager");
  // D4 logic is embedded in D2's Day 14 action using dtcReferralOffer template
  // Standalone run shows referral code stats
  const codes = getReferralCodes();
  const totalCodes = Object.keys(codes).length;
  const totalRedeemed = Object.values(codes).reduce((sum, c) => sum + (c.redeemed || 0), 0);
  const totalRevenue = Object.values(codes).reduce((sum, c) => sum + (c.revenue || 0), 0);

  log(`D4 — ${totalCodes} referral codes created, ${totalRedeemed} redeemed, $${totalRevenue.toFixed(2)} revenue`);
  return engine.succeed("D4", { totalCodes, totalRedeemed, totalRevenue });
}

// ── D5: Reorder Predictor ────────────────────────────────────────────────────

async function runD5() {
  log("D5 — Reorder Predictor starting...");

  const sequences = getSequences();
  const today = todayET();
  let predictions = 0;
  let reminders = 0;

  for (const [email, customer] of Object.entries(sequences)) {
    if (customer.stage !== "Complete") continue; // Only completed-sequence customers
    if (customer.totalOrders < 1) continue;

    const daysSinceLastOrder = daysSince(customer.lastOrderDate);
    const predictedReorderDay = REORDER_WINDOW_DAYS; // ~30 days for gummy consumption

    // Calculate predicted reorder date
    const predictedDate = addDaysToDate(customer.lastOrderDate, predictedReorderDay);
    customer.predictedReorderDate = predictedDate;
    predictions++;

    // Send reminder 3 days before predicted reorder
    const daysUntilReorder = predictedReorderDay - daysSinceLastOrder;

    if (daysUntilReorder <= 3 && daysUntilReorder >= 0 && canSendEmail()) {
      // Check if we already sent a reorder reminder recently
      if (customer.lastReorderReminder && daysSince(customer.lastReorderReminder) < 25) continue;

      const vars = {
        firstName: firstName(customer.name),
        daysSinceOrder: String(daysSinceLastOrder),
      };
      const tpl = EMAIL_TEMPLATES.dtcReorderReminder;
      const subject = renderTemplate(tpl.subject, vars);
      const body = renderTemplate(tpl.body, vars);

      if (DRY_RUN) {
        log(`D5 [DRY] Would send reorder reminder to ${email}`);
      } else {
        const result = sendEmail({ to: email, subject, body });
        if (result.ok) {
          reminders++;
          incrementDailyEmailCount();
          customer.lastReorderReminder = today;
          log(`D5 — Sent reorder reminder to ${email} (${daysSinceLastOrder} days since last order)`);
        }
      }
    }
  }

  saveSequences(sequences);
  log(`D5 — Done: ${predictions} predictions updated, ${reminders} reminders sent`);
  return engine.succeed("D5", { predictions, reminders });
}

// ── D6: Churn Risk Scorer ────────────────────────────────────────────────────

async function runD6() {
  log("D6 — Churn Risk Scorer starting...");

  const sequences = getSequences();
  const today = todayET();
  let atRisk = 0;
  let winbacks = 0;

  for (const [email, customer] of Object.entries(sequences)) {
    const daysSinceLastOrder = daysSince(customer.lastOrderDate);

    // Score churn risk
    if (daysSinceLastOrder > CHURN_THRESHOLD_DAYS * 2) {
      customer.churnRisk = "High";
    } else if (daysSinceLastOrder > CHURN_THRESHOLD_DAYS) {
      customer.churnRisk = "Medium";
    } else {
      customer.churnRisk = "Low";
      continue;
    }

    atRisk++;

    // Send winback for Medium risk (first time only)
    if (customer.churnRisk === "Medium" && !customer.winbackSent && canSendEmail()) {
      const winbackCode = generateCode("BACK");
      const vars = {
        firstName: firstName(customer.name),
        winbackCode,
      };
      const tpl = EMAIL_TEMPLATES.dtcWinback;
      const subject = renderTemplate(tpl.subject, vars);
      const body = renderTemplate(tpl.body, vars);

      if (DRY_RUN) {
        log(`D6 [DRY] Would send winback to ${email} (${daysSinceLastOrder} days)`);
      } else {
        const result = sendEmail({ to: email, subject, body });
        if (result.ok) {
          winbacks++;
          incrementDailyEmailCount();
          customer.winbackSent = today;
          customer.winbackCode = winbackCode;
          log(`D6 — Sent winback to ${email} (${daysSinceLastOrder} days inactive)`);
        }
      }
    }
  }

  saveSequences(sequences);
  log(`D6 — Done: ${atRisk} at-risk customers, ${winbacks} winback emails sent`);
  return engine.succeed("D6", { atRisk, winbacks });
}

// ── D7: Loyalty Tier Calculator ──────────────────────────────────────────────

async function runD7() {
  log("D7 — Loyalty Tier Calculator starting...");

  const sequences = getSequences();
  const tiers = { Bronze: 0, Silver: 0, Gold: 0 };

  for (const [email, customer] of Object.entries(sequences)) {
    const orders = customer.totalOrders || 0;
    const revenue = customer.totalRevenue || 0;
    const oldTier = customer.loyaltyTier;

    // Tier calculation
    if (orders >= 4 && revenue >= 150) {
      customer.loyaltyTier = "Gold";
    } else if (orders >= 2 && revenue >= 50) {
      customer.loyaltyTier = "Silver";
    } else {
      customer.loyaltyTier = "Bronze";
    }

    tiers[customer.loyaltyTier]++;

    // Notify on tier upgrade
    if (oldTier && customer.loyaltyTier !== oldTier) {
      const tierOrder = ["Bronze", "Silver", "Gold"];
      if (tierOrder.indexOf(customer.loyaltyTier) > tierOrder.indexOf(oldTier)) {
        log(`D7 — ${customer.name || email} upgraded: ${oldTier} → ${customer.loyaltyTier}`);
      }
    }
  }

  saveSequences(sequences);
  log(`D7 — Done: Bronze=${tiers.Bronze}, Silver=${tiers.Silver}, Gold=${tiers.Gold}`);
  return engine.succeed("D7", { tiers, totalCustomers: Object.keys(sequences).length });
}

// ── D8: Email Deliverability Guard ───────────────────────────────────────────

async function runD8() {
  log("D8 — Email Deliverability Guard starting...");

  const bounceData = safeJsonRead(BOUNCE_TRACKER_FILE, { domains: {}, blocked: [] });
  const sequences = getSequences();

  // Scan for bounced emails (check sent folder for bounce-backs)
  // In practice, we'd parse himalaya's sent folder for MAILER-DAEMON responses
  // For now, track domains that have had multiple failures

  const domainStats = {};
  for (const [email, customer] of Object.entries(sequences)) {
    const domain = email.split("@")[1];
    if (!domain) continue;
    if (!domainStats[domain]) domainStats[domain] = { total: 0, bounced: 0 };
    domainStats[domain].total++;
  }

  // Check existing bounce data
  const newBlocked = [];
  for (const [domain, stats] of Object.entries(bounceData.domains)) {
    const bounceRate = stats.bounced / Math.max(stats.total, 1);
    if (bounceRate > 0.5 && stats.total >= 3 && !bounceData.blocked.includes(domain)) {
      newBlocked.push(domain);
      bounceData.blocked.push(domain);
      log(`D8 — Blocked domain ${domain}: ${(bounceRate * 100).toFixed(0)}% bounce rate`);
    }
  }

  safeJsonWrite(BOUNCE_TRACKER_FILE, bounceData);

  if (newBlocked.length > 0) {
    textBen(`⚠️ DTC Email Guard: Blocked ${newBlocked.length} domains: ${newBlocked.join(", ")}`);
  }

  log(`D8 — Done: ${bounceData.blocked.length} domains blocked, ${newBlocked.length} newly blocked`);
  return engine.succeed("D8", { blockedDomains: bounceData.blocked.length, newBlocked: newBlocked.length });
}

// ── D9: DTC Daily Report ─────────────────────────────────────────────────────

async function runD9() {
  log("D9 — DTC Daily Report starting...");

  const sequences = getSequences();
  const codes = getReferralCodes();
  const today = todayET();

  // Compute stats
  const totalCustomers = Object.keys(sequences).length;
  const activeSequences = Object.values(sequences).filter((c) => c.stage !== "Complete" && c.stage !== "new").length;
  const completedSequences = Object.values(sequences).filter((c) => c.stage === "Complete").length;
  const emailsSentToday = getDailyEmailCount();

  const tiers = { Bronze: 0, Silver: 0, Gold: 0 };
  const churnRisk = { Low: 0, Medium: 0, High: 0 };
  let totalRevenue = 0;

  for (const customer of Object.values(sequences)) {
    tiers[customer.loyaltyTier || "Bronze"]++;
    churnRisk[customer.churnRisk || "Low"]++;
    totalRevenue += customer.totalRevenue || 0;
  }

  const totalReferralCodes = Object.keys(codes).length;
  const totalRedemptions = Object.values(codes).reduce((s, c) => s + (c.redeemed || 0), 0);
  const referralRevenue = Object.values(codes).reduce((s, c) => s + (c.revenue || 0), 0);

  const report = {
    date: today,
    totalCustomers,
    activeSequences,
    completedSequences,
    emailsSentToday,
    tiers,
    churnRisk,
    totalRevenue,
    avgLTV: totalCustomers > 0 ? totalRevenue / totalCustomers : 0,
    referrals: { codes: totalReferralCodes, redemptions: totalRedemptions, revenue: referralRevenue },
  };

  // Text summary
  const summary = [
    `📊 DTC Engine Daily Report — ${todayLongET()}`,
    ``,
    `👥 Customers: ${totalCustomers} (${activeSequences} in sequence)`,
    `📧 Emails sent today: ${emailsSentToday}/${MAX_EMAILS_PER_DAY}`,
    `💰 Total LTV: $${totalRevenue.toFixed(0)} (avg $${report.avgLTV.toFixed(0)}/customer)`,
    `🏅 Tiers: ${tiers.Gold}G / ${tiers.Silver}S / ${tiers.Bronze}B`,
    `⚠️ Churn: ${churnRisk.High} high, ${churnRisk.Medium} medium`,
    `🔗 Referrals: ${totalReferralCodes} codes, ${totalRedemptions} redeemed`,
  ].join("\n");

  if (!DRY_RUN) {
    textBen(summary);
  } else {
    log(`D9 [DRY] Would text:\n${summary}`);
  }

  log("D9 — Done");
  return engine.succeed("D9", report);
}

// ── D10: Self-Heal Monitor ───────────────────────────────────────────────────

async function runD10() {
  return engine.runSelfHeal("D10", AGENT_REGISTRY);
}

// ══════════════════════════════════════════════════════════════════════════════
//  REGISTRY & CLI
// ══════════════════════════════════════════════════════════════════════════════

const AGENT_REGISTRY = {
  D1: { name: "New Customer Ingestor", fn: runD1, schedule: SCHEDULE_PLAN.D1 },
  D2: { name: "Post-Purchase Sequence Mgr", fn: runD2, schedule: SCHEDULE_PLAN.D2 },
  D3: { name: "Review Solicitor", fn: runD3, schedule: SCHEDULE_PLAN.D3 },
  D4: { name: "Referral Program Manager", fn: runD4, schedule: SCHEDULE_PLAN.D4 },
  D5: { name: "Reorder Predictor", fn: runD5, schedule: SCHEDULE_PLAN.D5 },
  D6: { name: "Churn Risk Scorer", fn: runD6, schedule: SCHEDULE_PLAN.D6 },
  D7: { name: "Loyalty Tier Calculator", fn: runD7, schedule: SCHEDULE_PLAN.D7 },
  D8: { name: "Email Deliverability Guard", fn: runD8, schedule: SCHEDULE_PLAN.D8 },
  D9: { name: "DTC Daily Report", fn: runD9, schedule: SCHEDULE_PLAN.D9 },
  D10: { name: "Self-Heal Monitor", fn: runD10, schedule: SCHEDULE_PLAN.D10 },
};

async function runAgentByName(name) {
  const key = name.toUpperCase();
  if (key === "SELF-HEAL") return runD10();
  if (AGENT_REGISTRY[key]) return AGENT_REGISTRY[key].fn();
  log(`Unknown agent: ${name}`);
  process.exit(1);
}

async function runScheduledAgents() {
  const now = new Date();
  const etOpts = { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" };
  const parts = new Intl.DateTimeFormat("en-US", etOpts).formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0");
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0");
  const weekday = parts.find((p) => p.type === "weekday")?.value || "";

  const toRun = [];
  for (const [key, entry] of Object.entries(AGENT_REGISTRY)) {
    const s = entry.schedule;
    if (s.startsWith("Part of")) continue; // D3, D4 run inside D2
    if (s === "Every 30 min") { toRun.push(key); continue; }
    const m = s.match(/Daily (\d+):(\d+)\s*(AM|PM)/);
    if (m) {
      let h = parseInt(m[1]);
      if (m[3] === "PM" && h !== 12) h += 12;
      if (m[3] === "AM" && h === 12) h = 0;
      if (h === hour && Math.abs(minute - parseInt(m[2])) < 5) toRun.push(key);
      continue;
    }
    const wm = s.match(/Weekly (\w+) (\d+):(\d+)\s*(AM|PM)/);
    if (wm) {
      if (!weekday.startsWith(wm[1].slice(0, 3))) continue;
      let h = parseInt(wm[2]);
      if (wm[4] === "PM" && h !== 12) h += 12;
      if (wm[4] === "AM" && h === 12) h = 0;
      if (h === hour && Math.abs(minute - parseInt(wm[3])) < 5) toRun.push(key);
    }
  }

  if (toRun.length === 0) { log("No agents scheduled for current time"); return; }
  log(`Running scheduled agents: ${toRun.join(", ")}`);
  for (const key of toRun) {
    try { await AGENT_REGISTRY[key].fn(); } catch (err) { log(`${key} error: ${err.message}`); }
  }
}

function showHelp() {
  console.log(`USA Gummies DTC Retention & Lifetime Value Engine (Build 3)
${"═".repeat(55)}

Commands:
  run <agent>      Run a specific agent (D1-D10)
  run all          Run all scheduled agents for current time
  run self-heal    Run the self-heal monitor
  status           Show system status JSON
  help             Show this help

Options:
  --dry-run        Preview actions without sending emails
  --source <src>   Override run source label

Agents:
  D1   New Customer Ingestor           ${SCHEDULE_PLAN.D1}
  D2   Post-Purchase Sequence Mgr      ${SCHEDULE_PLAN.D2}
  D3   Review Solicitor                ${SCHEDULE_PLAN.D3}
  D4   Referral Program Manager        ${SCHEDULE_PLAN.D4}
  D5   Reorder Predictor               ${SCHEDULE_PLAN.D5}
  D6   Churn Risk Scorer               ${SCHEDULE_PLAN.D6}
  D7   Loyalty Tier Calculator         ${SCHEDULE_PLAN.D7}
  D8   Email Deliverability Guard      ${SCHEDULE_PLAN.D8}
  D9   DTC Daily Report                ${SCHEDULE_PLAN.D9}
  D10  Self-Heal Monitor               ${SCHEDULE_PLAN.D10}

Email Templates: ${Object.keys(EMAIL_TEMPLATES).join(", ")}
Max Emails/Day: ${MAX_EMAILS_PER_DAY}

Examples:
  node scripts/usa-gummies-dtc-engine.mjs run D1     # ingest new customers
  node scripts/usa-gummies-dtc-engine.mjs --dry-run run D2
  node scripts/usa-gummies-dtc-engine.mjs run all
  node scripts/usa-gummies-dtc-engine.mjs status`);
}

// ── Main CLI ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const cmd = args[0];

if (cmd === "help" || !cmd) {
  showHelp();
} else if (cmd === "run") {
  const target = args[1];
  if (!target) { console.error("Usage: run <agent|all|self-heal>"); process.exit(1); }
  if (target === "all") {
    await runScheduledAgents();
  } else {
    await runAgentByName(target);
  }
} else if (cmd === "status") {
  const status = engine.getStatus();
  console.log(JSON.stringify(status, null, 2));
} else {
  console.error(`Unknown command: ${cmd}. Try 'help'.`);
  process.exit(1);
}
