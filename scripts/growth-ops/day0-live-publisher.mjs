#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output", "playwright", "day0-live");
const storageFile = path.join(outputDir, "storage-state.json");
const draftsDir = path.join(repoRoot, "growth-ops", "day-0-launch", "syndication-drafts");
const outreachCandidateCsvs = [
  path.join(repoRoot, "growth-ops", "day-0-launch", "outreach", "n50_recipients.csv"),
  path.join(repoRoot, "growth-ops", "day-0-launch", "outreach", "next25_recipients.csv"),
  path.join(repoRoot, "growth-ops", "day-0-launch", "outreach", "batch25_recipients.csv"),
];
const sendLogCsv = path.join(repoRoot, "growth-ops", "day-0-launch", "logs", "day0_send_log.csv");

const args = process.argv.slice(2);
const headful = args.includes("--headful");
const dryRun = args.includes("--dry-run");

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
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? "";
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

async function appendSendLog(entries) {
  if (!entries.length) return;
  let current = "";
  try {
    current = await fs.readFile(sendLogCsv, "utf8");
  } catch {
    current = "timestamp,channel,asset_id,action,status,proof_link,notes\n";
  }

  const lines = entries
    .map((entry) =>
      [
        entry.timestamp,
        entry.channel,
        entry.assetId,
        entry.action,
        entry.status,
        entry.proof,
        entry.notes,
      ]
        .map(csvEscape)
        .join(",")
    )
    .join("\n");

  const suffix = current.endsWith("\n") ? "" : "\n";
  await fs.writeFile(sendLogCsv, `${current}${suffix}${lines}\n`, "utf8");
}

async function readDrafts(limit = 5) {
  const files = (await fs.readdir(draftsDir)).filter((f) => f.endsWith(".md")).sort();
  const picked = files.slice(0, limit);
  const drafts = [];
  for (const file of picked) {
    const text = await fs.readFile(path.join(draftsDir, file), "utf8");
    const titleMatch = text.match(/## Title\n([\s\S]*?)\n\n## Hook/);
    const hookMatch = text.match(/## Hook\n([\s\S]*?)\n\n## Body/);
    const bodyMatch = text.match(/## Body\n([\s\S]*?)\n\n## CTA/);
    const ctaMatch = text.match(/## CTA\n([\s\S]*?)\n\n## Hashtags/);
    drafts.push({
      file,
      title: titleMatch?.[1]?.trim() || "USA Gummies update",
      hook: hookMatch?.[1]?.trim() || "",
      body: bodyMatch?.[1]?.trim() || "",
      cta: ctaMatch?.[1]?.trim() || "",
      full: `${titleMatch?.[1]?.trim() || "USA Gummies update"}\n\n${hookMatch?.[1]?.trim() || ""}\n\n${bodyMatch?.[1]?.trim() || ""}\n\n${ctaMatch?.[1]?.trim() || ""}`,
    });
  }
  return drafts;
}

async function readOutreachLead() {
  let logText = "";
  try {
    logText = await fs.readFile(sendLogCsv, "utf8");
  } catch {
    logText = "";
  }

  const usedIds = new Set();
  for (const line of logText.split(/\r?\n/)) {
    if (!line || line.startsWith("timestamp,")) continue;
    if (!line.includes(",gmail_outreach,")) continue;
    const cols = parseCsvLine(line);
    const assetId = cols[2];
    if (assetId) usedIds.add(assetId);
  }

  for (const csvPath of outreachCandidateCsvs) {
    let text = "";
    try {
      text = await fs.readFile(csvPath, "utf8");
    } catch {
      continue;
    }

    const rows = parseCsv(text);
    const next = rows.find((row) => row.id && row.email && !usedIds.has(row.id));
    if (next) return next;
  }

  return null;
}

function isLoginUrl(url) {
  const lower = url.toLowerCase();
  return (
    lower.includes("login") ||
    lower.includes("signin") ||
    lower.includes("auth") ||
    lower.includes("challenge") ||
    lower.includes("checkpoint") ||
    lower.includes("accounts.google.com")
  );
}

function buildOutreachSubject(lead) {
  if (lead.type === "media") {
    return `Editorial angle for ${lead.org}: made-in-USA gummies with natural colors`;
  }
  if (lead.type === "listing") {
    return `USA Gummies listing request for ${lead.org}`;
  }
  return `USA Gummies x ${lead.org} partnership fit`;
}

function buildOutreachBody(lead) {
  const link = `https://www.usagummies.com/shop?utm_source=gmail&utm_medium=outreach&utm_campaign=day0_live_publisher&utm_content=${lead.utm_content || lead.id || "general"}`;

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

async function screenshot(page, name) {
  const file = path.join(outputDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false, timeout: 10000 });
  return file;
}

async function tryXPost(page, draft) {
  await page.goto("https://x.com/compose/post", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(3000);
  const currentUrl = page.url();

  if (isLoginUrl(currentUrl) || currentUrl.includes("x.com/i/flow/login")) {
    return { status: "login_required", details: `URL: ${currentUrl}` };
  }

  const composer = page.locator('[data-testid="tweetTextarea_0"], div[role="textbox"][aria-label="Post text"]');
  const hasComposer = await composer.first().isVisible().catch(() => false);
  if (!hasComposer) {
    return { status: "blocked", details: "Composer not found" };
  }

  const urlOnly = (draft.cta || "").replace(/^Shop:\s*/i, "").trim();
  const xText = `Made-in-USA gummies with natural colors and no artificial dyes.\n${urlOnly}`.slice(0, 275);

  await composer.first().evaluate((el) => {
    el.focus();
  });
  await page.keyboard.press("Meta+A").catch(() => {});
  await page.keyboard.press("Control+A").catch(() => {});
  await page.keyboard.type(xText);
  await page.waitForTimeout(500);
  const typedText = (await composer.first().innerText().catch(() => "")).trim();
  if (!typedText) {
    return { status: "blocked", details: "Composer did not accept text input" };
  }

  if (dryRun) {
    return { status: "draft_ready", details: "Dry run; not posted" };
  }

  const postBtn = page.locator('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');
  const hasPostBtn = await postBtn.first().isVisible().catch(() => false);
  if (!hasPostBtn) {
    return { status: "blocked", details: "Post button not found" };
  }

  const disabled = await postBtn.first().isDisabled();
  if (disabled) {
    return { status: "blocked", details: "Post button disabled" };
  }

  await postBtn.first().click();
  await page.waitForTimeout(3000);
  const xBody = (await page.locator("body").innerText().catch(() => "")) || "";
  if (/Your post was sent|post sent|posted/i.test(xBody)) {
    return { status: "posted", details: "Post confirmation detected" };
  }
  return { status: "post_clicked_unconfirmed", details: "Post click completed; no confirmation text detected" };
}

async function tryLinkedInPost(page, draft) {
  await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(3500);
  const currentUrl = page.url();

  if (isLoginUrl(currentUrl)) {
    return { status: "login_required", details: `URL: ${currentUrl}` };
  }

  const startPost = page.locator(
    '[aria-label="Start a post"], button[aria-label="Start a post"], button:has-text("Start a post"), button:has-text("Create a post")'
  );
  const hasStartPost = await startPost.first().isVisible().catch(() => false);
  if (!hasStartPost) {
    return { status: "blocked", details: "Start post button not found" };
  }

  await startPost.first().click();
  await page.waitForTimeout(1200);

  const editor = page.locator('[role="textbox"][contenteditable="true"], [role="textbox"]');
  const hasEditor = await editor.first().isVisible().catch(() => false);
  if (!hasEditor) {
    return { status: "blocked", details: "Post editor not found" };
  }

  await editor.first().click();
  await page.keyboard.type(`${draft.title}\n\n${draft.hook}\n\n${draft.cta}`);

  if (dryRun) {
    return { status: "draft_ready", details: "Dry run; not posted" };
  }

  const postBtn = page.locator(
    '[role="dialog"] button:has-text("Post"), [role="dialog"] button[aria-label="Post"], button.share-actions__primary-action'
  );
  const count = await postBtn.count().catch(() => 0);
  let postIndex = -1;
  for (let i = 0; i < count; i += 1) {
    // Prefer the first visible modal button.
    if (await postBtn.nth(i).isVisible().catch(() => false)) {
      postIndex = i;
      break;
    }
  }
  if (postIndex < 0) {
    return { status: "blocked", details: "Post button not found" };
  }

  const selectedPostBtn = postBtn.nth(postIndex);
  const disabled = await selectedPostBtn.isDisabled();
  if (disabled) {
    return { status: "blocked", details: "Post button disabled" };
  }

  await selectedPostBtn.click();
  await page.waitForTimeout(3000);
  const liBody = (await page.locator("body").innerText().catch(() => "")) || "";
  if (/Post successful|Your post is now live|posted/i.test(liBody)) {
    return { status: "posted", details: "Post confirmation detected" };
  }
  return { status: "post_clicked_unconfirmed", details: "Post click completed; no confirmation text detected" };
}

async function tryMediumDraft(page, draft) {
  await page.goto("https://medium.com/new-story", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2500);
  const currentUrl = page.url();
  if (isLoginUrl(currentUrl) || currentUrl.includes("/m/signin")) {
    return { status: "login_required", details: `URL: ${currentUrl}` };
  }

  const signInPrompt = page.locator('a[href*="/m/signin"], a:has-text("Sign in"), button:has-text("Sign in")');
  if (await signInPrompt.first().isVisible().catch(() => false)) {
    return { status: "login_required", details: "Medium sign-in prompt detected" };
  }

  const titleEl = page.locator('textarea[placeholder*="Title"], h1[contenteditable="true"]');
  if (!(await titleEl.count())) {
    return { status: "blocked", details: "Editor not found" };
  }

  await titleEl.first().click();
  await page.keyboard.type(draft.title);
  await page.keyboard.press("Enter");
  await page.keyboard.type(`${draft.hook}\n\n${draft.body}\n\n${draft.cta}`);

  return { status: dryRun ? "draft_ready" : "draft_saved_or_ready", details: "Content inserted" };
}

async function tryRedditPost(page, draft) {
  await page.goto("https://www.reddit.com/submit", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2000);
  const currentUrl = page.url();
  if (isLoginUrl(currentUrl) || currentUrl.includes("/login")) {
    return { status: "login_required", details: `URL: ${currentUrl}` };
  }

  const loginPrompt = page.locator('a[href*="/login"], button:has-text("Log In"), button:has-text("Continue with Google")');
  if (await loginPrompt.first().isVisible().catch(() => false)) {
    return { status: "login_required", details: "Reddit login prompt detected" };
  }

  const titleInput = page.locator(
    'textarea[name="title"], input[name="title"], [data-test-id="post-title-input"], [data-testid="post-title-input"]'
  );
  if (!(await titleInput.count())) {
    return { status: "blocked", details: "Reddit post title input not found" };
  }

  await titleInput.first().fill(draft.title);
  return { status: "draft_ready", details: "Title filled; subreddit/body require manual selection" };
}

async function tryGmailOutreach(page, lead) {
  if (!lead) return { status: "skipped", details: "No outreach lead found" };
  if (!lead.email || !String(lead.email).trim()) {
    return { status: "skipped", details: "Lead missing recipient email" };
  }
  const subjectText = lead.message_subject || buildOutreachSubject(lead);
  const messageBody = lead.message_body || buildOutreachBody(lead);
  const subject = encodeURIComponent(subjectText);
  const body = encodeURIComponent(messageBody);
  const to = encodeURIComponent(lead.email || "");
  const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${subject}&body=${body}`;

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(4500);

  const currentUrl = page.url();
  if (isLoginUrl(currentUrl) || currentUrl.includes("accounts.google.com")) {
    return { status: "login_required", details: `URL: ${currentUrl}` };
  }

  const sendBtn = page.locator('div[role="button"][data-tooltip*="Send"], div[role="button"][aria-label^="Send"]');
  const hasSendBtn = await sendBtn.first().isVisible().catch(() => false);
  if (!hasSendBtn) {
    return { status: "draft_ready", details: "Compose opened but Send button not found" };
  }

  if (dryRun) {
    return { status: "draft_ready", details: "Dry run; not sending" };
  }

  const toField = page.locator('input[aria-label^="To"], textarea[name="to"]');
  const toValue = (await toField.first().inputValue().catch(() => "")).trim();
  if (!toValue) {
    return { status: "blocked", details: "Recipient missing in compose window" };
  }

  await sendBtn.first().click();
  await page.waitForTimeout(3000);
  const pageBody = (await page.locator("body").innerText().catch(() => "")) || "";
  if (/Message sent/i.test(pageBody)) {
    return { status: "sent", details: "Message sent confirmed" };
  }
  return { status: "send_clicked_unconfirmed", details: "Send clicked but confirmation not detected" };
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const drafts = await readDrafts(5);
  const outreachLead = await readOutreachLead();
  const now = new Date().toISOString();
  const hasStorageState = await fs
    .access(storageFile)
    .then(() => true)
    .catch(() => false);

  const browser = await chromium.launch({
    headless: !headful,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(hasStorageState ? { storageState: storageFile } : {}),
  });
  const page = await context.newPage();

  const checks = [
    { channel: "x", assetId: drafts[0]?.file || "draft-1", action: "post", fn: () => tryXPost(page, drafts[0]) },
    {
      channel: "linkedin",
      assetId: drafts[1]?.file || "draft-2",
      action: "post",
      fn: () => tryLinkedInPost(page, drafts[1] || drafts[0]),
    },
    {
      channel: "medium",
      assetId: drafts[2]?.file || "draft-3",
      action: "draft",
      fn: () => tryMediumDraft(page, drafts[2] || drafts[0]),
    },
    {
      channel: "reddit",
      assetId: drafts[3]?.file || "draft-4",
      action: "draft",
      fn: () => tryRedditPost(page, drafts[3] || drafts[0]),
    },
    {
      channel: "gmail_outreach",
      assetId: outreachLead?.id || outreachLead?.lead_id || "lead-1",
      action: "outreach",
      fn: () => tryGmailOutreach(page, outreachLead),
    },
  ];

  const report = [];
  const logEntries = [];

  for (const check of checks) {
    let status = "error";
    let details = "";
    let proof = "";

    try {
      const result = await check.fn();
      status = result.status;
      details = result.details;
    } catch (error) {
      status = "error";
      details = error instanceof Error ? error.message : String(error);
    }

    try {
      proof = await screenshot(page, `${check.channel}-${check.assetId.replace(/[^a-z0-9.-]/gi, "_")}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      details = details ? `${details}; screenshot_error=${msg}` : `screenshot_error=${msg}`;
    }

    report.push({
      timestamp: new Date().toISOString(),
      channel: check.channel,
      asset_id: check.assetId,
      action: check.action,
      status,
      details,
      proof,
    });

    logEntries.push({
      timestamp: new Date().toISOString(),
      channel: check.channel,
      assetId: check.assetId,
      action: check.action,
      status,
      proof,
      notes: details,
    });
  }

  await fs.writeFile(path.join(outputDir, `run-${Date.now()}.json`), JSON.stringify(report, null, 2), "utf8");
  await appendSendLog(logEntries);

  await context.close();
  await browser.close();

  const summary = report.map((r) => `${r.channel}: ${r.status}`).join(" | ");
  console.log(`Day-0 live publisher completed at ${now}`);
  console.log(summary);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
