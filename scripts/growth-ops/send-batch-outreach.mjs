#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output", "playwright", "day0-live");
const storageFile = path.join(outputDir, "storage-state.json");
const sendLogCsv = path.join(repoRoot, "growth-ops", "day-0-launch", "logs", "day0_send_log.csv");
const args = process.argv.slice(2);
const leadsArgIndex = args.findIndex((arg) => arg === "--leads");
const leadsCsv =
  leadsArgIndex >= 0 && args[leadsArgIndex + 1]
    ? path.resolve(args[leadsArgIndex + 1])
    : path.join(repoRoot, "growth-ops", "day-0-launch", "outreach", "batch25_recipients.csv");

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }

  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    header.forEach((h, idx) => {
      row[h] = cols[idx] ?? "";
    });
    return row;
  });
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

async function appendLog(entry) {
  const line = [
    entry.timestamp,
    entry.channel,
    entry.asset_id,
    entry.action,
    entry.status,
    entry.proof_link,
    entry.notes,
  ]
    .map(csvEscape)
    .join(",");
  await fs.appendFile(sendLogCsv, `${line}\n`, "utf8");
}

function buildSubject(lead) {
  if (lead.type === "media") {
    return `Editorial angle for ${lead.org}: made-in-USA gummies with natural colors`;
  }
  if (lead.type === "listing") {
    return `USA Gummies listing request for ${lead.org}`;
  }
  return `USA Gummies x ${lead.org} partnership fit`;
}

function buildBody(lead) {
  const link = `https://www.usagummies.com/shop?utm_source=gmail&utm_medium=outreach&utm_campaign=day0_batch25&utm_content=${lead.utm_content}`;

  if (lead.type === "media") {
    return [
      `Hi ${lead.org} team,`,
      "",
      "I run USA Gummies, a premium gummy brand made in the USA with natural colors and no artificial dyes.",
      "",
      "If you are covering American-made products or ingredient transparency, I can provide a concise source brief and quotable commentary.",
      "",
      "Happy to send details on short notice.",
      "",
      "Best,",
      "Ben",
      "USA Gummies",
      link,
    ].join("\n");
  }

  if (lead.type === "listing") {
    return [
      `Hi ${lead.org} team,`,
      "",
      "Requesting a USA Gummies profile/listing review for your directory or platform.",
      "",
      "Brand summary: premium gummy bears made in the USA, natural colors from fruit and vegetable extracts, zero artificial dyes.",
      "",
      "If there is a preferred submission format, I can send it immediately.",
      "",
      "Best,",
      "Ben",
      "USA Gummies",
      link,
    ].join("\n");
  }

  return [
    `Hi ${lead.org} team,`,
    "",
    "I run USA Gummies, a premium gummy brand made in the USA with natural colors and no artificial dyes.",
    "",
    "I think there is a strong partnership fit for gifting/snack programs where ingredient transparency and premium quality matter.",
    "",
    "If useful, I can send a one-page fit summary with fulfillment details.",
    "",
    "Best,",
    "Ben",
    "USA Gummies",
    link,
  ].join("\n");
}

async function fillRecipient(page, to) {
  const toInput = page.locator('input[aria-label^="To"], textarea[name="to"]').first();
  const toVisible = await toInput.isVisible().catch(() => false);
  if (!toVisible) return false;

  await toInput.click();
  await page.keyboard.type(to);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);

  const chipCount = await page
    .locator(`span[email="${to}"], div[email="${to}"], [data-hovercard-id="${to}"]`)
    .count()
    .catch(() => 0);
  const bodyText = ((await page.locator("body").innerText().catch(() => "")) || "").toLowerCase();
  return chipCount > 0 || bodyText.includes(to.toLowerCase());
}

async function sendOne(page, lead) {
  const subject = buildSubject(lead);
  const body = buildBody(lead);
  const to = lead.email.trim();

  const composeUrl =
    "https://mail.google.com/mail/?view=cm&fs=1&su=" +
    encodeURIComponent(subject) +
    "&body=" +
    encodeURIComponent(body);

  await page.goto(composeUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(6000);

  const recipientReady = await fillRecipient(page, to);
  if (!recipientReady) {
    return {
      status: "blocked",
      notes: "Recipient not detected after manual fill",
      subject,
    };
  }

  const sendBtn = page.locator('div[role="button"][data-tooltip*="Send"], div[role="button"][aria-label^="Send"]');
  const canSend = await sendBtn.first().isVisible().catch(() => false);
  if (!canSend) {
    return {
      status: "blocked",
      notes: "Send button missing",
      subject,
    };
  }

  await sendBtn.first().click();
  await page.waitForTimeout(3500);
  const composeBody = (await page.locator("body").innerText().catch(() => "")) || "";
  const messageSent = /Message sent/i.test(composeBody);

  const query = `subject:("${subject}") to:(${to}) in:sent`;
  const searchUrl = "https://mail.google.com/mail/u/0/#search/" + encodeURIComponent(query);
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(12000);

  const sentBody = (await page.locator("body").innerText().catch(() => "")) || "";
  const sentFound =
    sentBody.toLowerCase().includes(subject.toLowerCase()) || /1-1 of 1|1 result|of about 1/i.test(sentBody);

  const proof = path.join(outputDir, `gmail-search-${lead.id}.png`);
  await page.screenshot({ path: proof, fullPage: false, timeout: 10000 }).catch(() => {});

  return {
    status: messageSent && sentFound ? "sent_confirmed" : messageSent ? "send_clicked_unconfirmed" : "send_not_confirmed",
    notes: `msgSent=${messageSent};sentFound=${sentFound};subject=${subject}`,
    subject,
    proof,
  };
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const hasState = await fs
    .access(storageFile)
    .then(() => true)
    .catch(() => false);

  if (!hasState) {
    throw new Error(`Missing storage state: ${storageFile}`);
  }

  const leadsText = await fs.readFile(leadsCsv, "utf8");
  const leads = parseCsv(leadsText).filter((row) => row.email && row.id);

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({
    storageState: storageFile,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const results = [];

  for (const lead of leads) {
    let status = "error";
    let notes = "";
    let proof = path.join(outputDir, `gmail-search-${lead.id}.png`);
    let subject = "";

    try {
      const res = await sendOne(page, lead);
      status = res.status;
      notes = res.notes;
      proof = res.proof || proof;
      subject = res.subject;
    } catch (error) {
      notes = error instanceof Error ? error.message : String(error);
      await page.screenshot({ path: proof, fullPage: false, timeout: 10000 }).catch(() => {});
    }

    const ts = new Date().toISOString();
    const logEntry = {
      timestamp: ts,
      channel: "gmail_outreach",
      asset_id: lead.id,
      action: "outreach",
      status,
      proof_link: proof,
      notes,
    };

    await appendLog(logEntry);
    results.push({ id: lead.id, email: lead.email, status, subject });
    await page.waitForTimeout(1500);
  }

  await context.close();
  await browser.close();

  const byStatus = results.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  console.log(`Batch processed: ${results.length}`);
  console.log(`Status summary: ${JSON.stringify(byStatus)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
