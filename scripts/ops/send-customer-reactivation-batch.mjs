#!/usr/bin/env node
// Sends the 9 customer-reactivation emails in one shot via gmail.mjs send
// helper. Uses OAuth token at ~/.config/usa-gummies-mcp/gmail-token.json.
//
// One-shot batch — DO NOT re-run without --resend flag (built-in dedup will
// likely block dupes via gmail-send-log anyway, but be explicit).
//
// Created 2026-04-29 for warm-network reactivation push.

import { execSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..", "..");
const GMAIL_SCRIPT = join(REPO, "scripts", "gmail.mjs");

const CTA_LINK =
  "https://www.usagummies.com/go?utm_source=email&utm_medium=customer&utm_campaign=spring_batch";

const customers = [
  {
    to: "eric@reddogsaloon.com",
    subject: "Quick check-in from USA Gummies",
    body: `Hi Eric,

Thank you for the master-carton order back in April — that was a meaningful first run for us.

We're shipping fresh inventory now. If Red Dog Saloon is interested in a wholesale pricing structure (case prices below the master-carton rate, Net 30 terms), I'd love to put it in front of you. Reply with a good time to chat for 5 minutes.

If you're just looking to reorder for the bar, code FRIENDS10 takes 10% off through Sunday: ${CTA_LINK}

Thanks again — your order means a lot to a small American brand still finding its footing.

— Benjamin
USA Gummies
`,
  },
  {
    to: "ohiojud@hotmail.com",
    subject: "Spring batch is in",
    body: `Hi,

Saw both your orders back in March and wanted to say thank you. You're one of our first repeat buyers — for a small brand still finding its footing, that means a lot.

Spring batch is fresh and shipping. If you're due for a restock, code FRIENDS10 takes 10% off through Sunday: ${CTA_LINK}

Honest question — what brought you back the second time? A one-line reply would help us understand what to keep doing. No public review needed, just your real take.

Thanks again,
— Benjamin
USA Gummies
`,
  },
  {
    to: "shotone@sbcglobal.net",
    subject: "Hope the gummies held up",
    body: `Hi,

Hope your 12-bag order from February is treating you well. Wanted to say thank you for taking the chance on a small American brand.

If you're due for a restock, code FRIENDS10 takes 10% off through Sunday: ${CTA_LINK}

Honest question — if you had any feedback from that first batch (good or bad), I'd love to hear it. Reply directly. We're still small and your real take shapes the next run.

Thanks,
— Benjamin
USA Gummies
`,
  },
  {
    to: "dvmaba22@hotmail.com",
    subject: "A note from the brand whose packaging comes from your state",
    body: `Hi,

Saw your 12-bag order from February — thank you. Quick note that might amuse you: our bag packaging is printed in Wisconsin, at a place called Belmark in De Pere. So your gummies traveled through your state on the way to you.

Spring batch is fresh and shipping. If you're due for a restock, code FRIENDS10 takes 10% off through Sunday: ${CTA_LINK}

Any feedback from the first round, good or bad? Reply directly. We're a small team and your honest take shapes the next run.

Thanks,
— Benjamin
USA Gummies
`,
  },
  {
    to: "vicki.l.williams59@gmail.com",
    subject: "A note from a fellow Washingtonian",
    body: `Hi Vicki,

Saw your 12-bag order from January — thank you. You may not have known: our final repack happens at a veteran-owned facility in Spokane, so we're both Washington-based on this side of the transaction.

Spring batch is fresh and shipping. If you're due for a restock, code FRIENDS10 takes 10% off through Sunday: ${CTA_LINK}

Any feedback from the first batch, good or bad? Reply directly. We're a small team and your honest take shapes what we do next.

Thanks,
— Benjamin
USA Gummies
`,
  },
  {
    to: "beaumason@utah.gov",
    subject: "Spring batch from USA Gummies",
    body: `Hi Beau,

Thank you for the 5-bag order back in March — that was an early one for us and it mattered.

Spring batch is fresh and shipping. If you're due for a restock, code FRIENDS10 takes 10% off through Sunday: ${CTA_LINK}

Any feedback from the first batch — good or bad? Reply directly. Honest input shapes the next run.

Thanks,
— Benjamin
USA Gummies
`,
  },
  {
    to: "pjw72961@yahoo.com",
    subject: "Spring batch from USA Gummies",
    body: `Hi,

Thank you for the 5-bag order back in February — that was an early one for us and it mattered.

Spring batch is fresh and shipping. If you're due for a restock, code FRIENDS10 takes 10% off through Sunday: ${CTA_LINK}

Any feedback from the first batch — good or bad? Reply directly. Honest input shapes the next run.

Thanks,
— Benjamin
USA Gummies
`,
  },
  {
    to: "kkboney01@gmail.com",
    subject: "Spring batch from USA Gummies",
    body: `Hi,

Thank you for the 4-bag order back in February — that was an early one for us and it mattered.

Spring batch is fresh and shipping. If you're due for a restock, code FRIENDS10 takes 10% off through Sunday: ${CTA_LINK}

Any feedback from the first batch — good or bad? Reply directly. Honest input shapes the next run.

Thanks,
— Benjamin
USA Gummies
`,
  },
  {
    to: "gary@globalelectric.biz",
    subject: "Spring batch — and a quick wholesale question",
    body: `Hi Gary,

Thank you for the order back in January — that was one of our first.

Spring batch is fresh and shipping. If you're due for a personal restock, code FRIENDS10 takes 10% off through Sunday: ${CTA_LINK}

A separate question: I noticed your email is from Global Electric. If your team breakroom or a customer-thank-you program could use dye-free American gummy bears in cases, we have a wholesale program with case pricing and Net 30 terms. Reply if it's worth a 5-minute conversation.

Thanks,
— Benjamin
USA Gummies
`,
  },
];

const tmp = mkdtempSync(join(tmpdir(), "send-batch-"));
const results = [];

for (const c of customers) {
  const bodyFile = join(tmp, `${c.to.replace(/[^a-z0-9]/gi, "_")}.txt`);
  writeFileSync(bodyFile, c.body, "utf8");
  try {
    const out = execSync(
      `node ${JSON.stringify(GMAIL_SCRIPT)} send --to ${JSON.stringify(c.to)} --subject ${JSON.stringify(c.subject)} --body-file ${JSON.stringify(bodyFile)}`,
      { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }
    );
    results.push({ to: c.to, ok: true, output: out.trim().split("\n").slice(-3).join(" | ") });
    console.log(`✓ ${c.to}`);
  } catch (err) {
    const msg = err.stderr?.toString() || err.message || String(err);
    results.push({ to: c.to, ok: false, error: msg.trim().split("\n").slice(-3).join(" | ") });
    console.error(`✗ ${c.to} — ${msg.split("\n")[0]}`);
  }
}

rmSync(tmp, { recursive: true, force: true });

console.log(`\n=== SUMMARY ===`);
const ok = results.filter((r) => r.ok).length;
const fail = results.length - ok;
console.log(`Sent: ${ok}/${results.length}`);
if (fail) {
  console.log(`\nFailures:`);
  for (const r of results.filter((r) => !r.ok)) {
    console.log(`  ${r.to}: ${r.error}`);
  }
}
