#!/usr/bin/env node
// Sends personalized cart-recovery emails to the 4 abandoned-checkout
// customers from the last 24h. Uses the existing scripts/gmail.mjs sender
// (OAuth via ~/.config/usa-gummies-mcp/gmail-token.json — same wire as
// send-customer-reactivation-batch.mjs).
//
// Each draft was reviewed and approved by Ben in chat 2026-04-30 before
// this script ran. Discount code COMEBACK10 (10% off, 500 uses, once per
// customer, $5.99 minimum) was created via the Shopify GraphQL Admin API
// before this batch went out.
//
// Built-in gmail-send-log dedup will block re-sends if this script is
// accidentally re-run.

import { execSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..", "..");
const GMAIL_SCRIPT = join(REPO, "scripts", "gmail.mjs");

const SHOP_LINK = "https://www.usagummies.com/go/checkout?qty=5&utm_source=email&utm_medium=cart_recovery&utm_campaign=comeback10";
const SINGLE_LINK = "https://www.usagummies.com/go/checkout?qty=1&utm_source=email&utm_medium=cart_recovery&utm_campaign=comeback10";

const customers = [
  {
    to: "remingtonchristy865@gmail.com",
    subject: "Your USA Gummies are still in your cart 🇺🇸",
    body: `Hey,

Saw you reaching for those USA Gummies yesterday — looks like life happened. Wanted to make it easier to come back:

Code COMEBACK10 = 10% off your order at checkout.

Better yet — our 5-Pack now runs Buy 4, Get 1 FREE at $23.96 ($4.79/bag) with free shipping. Stack the COMEBACK10 on top and you're at ~$21.50.

Finish your order: ${SHOP_LINK}

All-American gummy bears, no artificial dyes, made across 5 US states.

— The USA Gummies Team
`,
  },
  {
    to: "afuller013@yahoo.com",
    subject: "🇺🇸 1 bag → upgrade to 5 for $4.79 each (you save $5.99)",
    body: `Hey,

Noticed you were grabbing a single bag yesterday — quick FYI: our 5-Pack is Buy 4, Get 1 FREE at $23.96. That's a free bag, free shipping, and code COMEBACK10 for an extra 10% off.

Or if you just want the one — that's still here for $5.99 + free ship.

5-Pack (Buy 4, Get 1 FREE): ${SHOP_LINK}
Single Bag: ${SINGLE_LINK}

— The USA Gummies Team
`,
  },
  {
    to: "grannytkp@gmail.com",
    subject: "Add 2 more bags → Buy 4, Get 1 FREE",
    body: `Hi,

You were close — add 2 more bags to your cart and you unlock the 5-Pack: Buy 4, Get 1 FREE at $23.96 (vs. $17.97 for 3). That's $1 more for 2 extra bags.

Plus: code COMEBACK10 = another 10% off.

Upgrade to the 5-Pack: ${SHOP_LINK}

— The USA Gummies Team
`,
  },
  {
    to: "SusanVette@yahoo.com",
    subject: "Still curious about USA Gummies?",
    body: `Hey,

Caught your old cart while cleaning up our records. Things have changed since February — new pricing tiers (Buy 4, Get 1 FREE at $23.96), free shipping on every order, and code COMEBACK10 for 10% off if you're still interested.

No pressure. Door's always open.

See what's new: ${SHOP_LINK}

— The USA Gummies Team
`,
  },
];

console.log(`USA Gummies — cart-recovery email batch`);
console.log("─".repeat(64));
console.log(`  Total recipients: ${customers.length}`);
console.log(`  Discount code:    COMEBACK10 (10% off, 500 uses)`);
console.log("");

const sentLog = [];
const failedLog = [];

for (let i = 0; i < customers.length; i++) {
  const c = customers[i];
  console.log(`${i + 1}/${customers.length}  ${c.to}`);
  console.log(`     Subject: ${c.subject}`);

  // Write body to a tempfile so the gmail.mjs send command doesn't have to
  // shell-quote a multi-line body (which breaks on newlines + curly quotes).
  const dir = mkdtempSync(join(tmpdir(), "usag-recovery-"));
  const bodyFile = join(dir, "body.txt");
  writeFileSync(bodyFile, c.body, "utf-8");

  try {
    const result = execSync(
      `node "${GMAIL_SCRIPT}" send --to "${c.to}" --subject "${c.subject.replace(/"/g, '\\"')}" --body-file "${bodyFile}"`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    console.log(`     ✓ sent\n${result.trim().split("\n").map(l => "       " + l).join("\n")}`);
    sentLog.push({ to: c.to, subject: c.subject });
  } catch (err) {
    const stderr = err.stderr?.toString?.() || err.message || String(err);
    console.log(`     ✗ FAILED: ${stderr.trim().slice(0, 200)}`);
    failedLog.push({ to: c.to, error: stderr.trim().slice(0, 500) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("");
console.log("─".repeat(64));
console.log(`✓ sent:    ${sentLog.length}`);
console.log(`✗ failed:  ${failedLog.length}`);
if (failedLog.length) {
  console.log("\nFailures:");
  for (const f of failedLog) console.log(`  ${f.to}: ${f.error.slice(0, 200)}`);
}
