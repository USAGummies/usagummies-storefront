#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const growthRoot = path.join(repoRoot, "growth-ops");
const day0Root = path.join(growthRoot, "day-0-launch");
const draftsDir = path.join(day0Root, "syndication-drafts");
const outreachDir = path.join(day0Root, "outreach");
const logsDir = path.join(day0Root, "logs");

const siteUrl = "https://www.usagummies.com/shop";

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows) {
  return rows.map((row) => row.map((cell) => csvEscape(cell)).join(",")).join("\n");
}

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 72);
}

function readCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    header.forEach((key, idx) => {
      row[key] = values[idx] ?? "";
    });
    return row;
  });
}

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

function trackedUrl(source, medium, campaign, content) {
  return `${siteUrl}?utm_source=${source}&utm_medium=${medium}&utm_campaign=${campaign}&utm_content=${content}`;
}

function platformPrompt(platform) {
  if (platform.includes("LinkedIn")) return "Post as a LinkedIn article or long post";
  if (platform.includes("Medium")) return "Publish as canonical story with source link";
  if (platform.includes("Quora")) return "Answer one high-intent question and link once naturally";
  if (platform.includes("Reddit")) return "Post value-first discussion; avoid sales tone";
  if (platform.includes("Pinterest")) return "Create idea pin + keyworded description";
  if (platform.includes("Substack")) return "Publish note with concise CTA";
  return "Publish with tracked link";
}

function buildPostDraft({ date, platform, topic_title, primary_keyword, utm_url }, index) {
  const title = topic_title;
  const hook = `If you are searching for ${primary_keyword}, this is the shortest practical guide to choose better gummies without hype.`;
  const body = `Most buyers only need three checks: ingredient transparency, manufacturing quality, and consistency over repeat purchases. USA Gummies focuses on made-in-USA production, natural colors from fruit and vegetable extracts, and no artificial dyes. That combination gives buyers clean-label confidence with premium taste and texture.\n\nUse this checklist before any purchase:\n1. Read the ingredient panel first, not the front label.\n2. Validate where the product is manufactured.\n3. Compare total value by quality and repeat satisfaction, not only unit price.\n\nIf this matches what you care about, use the tracked link below so we can keep scaling useful content in this channel.`;

  return `# Day-0 Draft ${String(index + 1).padStart(2, "0")}\n\n- Date: ${date}\n- Platform: ${platform}\n- Primary keyword: ${primary_keyword}\n- Execution note: ${platformPrompt(platform)}\n\n## Title\n${title}\n\n## Hook\n${hook}\n\n## Body\n${body}\n\n## CTA\nShop: ${utm_url}\n\n## Hashtags\n#USAGummies #MadeInUSA #NaturalCandy #DyeFree #GummyBears\n`;
}

function personalizeSubject(segment) {
  if (segment.includes("parents")) return "Quick collab for parent-focused snack content";
  if (segment.includes("Patriotic")) return "Quick collab with an American-made snack brand";
  if (segment.includes("review")) return "Can I send product for an honest snack review?";
  if (segment.includes("Corporate")) return "Commission-only partner invite for your audience";
  return "Quick collab idea for your audience";
}

function personalizeAudienceReason(segment, query) {
  if (segment.includes("parents")) return `your audience already cares about better-for-you choices like ${query}`;
  if (segment.includes("Patriotic")) return `your followers actively engage with made-in-USA product discovery`;
  if (segment.includes("review")) return `your format is ideal for objective snack testing and recommendations`;
  if (segment.includes("Corporate")) return `your audience looks for practical gifting and office snack options`;
  return `your content aligns with our product positioning around quality and ingredient transparency`;
}

function outreachBody(row, idx) {
  const tokenName = `Creator ${idx + 1}`;
  const audienceReason = personalizeAudienceReason(row.segment, row.search_query);
  return `Hi {{first_name}},\n\nI run USA Gummies (premium gummy bears made in the USA with natural colors and no artificial dyes).\n\nFound your work while researching ${row.search_query}. I think there is a strong fit because ${audienceReason}.\n\nIf you are open to it, I can send product for an honest review or set up a no-retainer affiliate link so you only earn on attributed sales.\n\nIf yes, I can send details in one short message.\n\n- Ben\n\nRef: ${tokenName} | Platform: ${row.platform}`;
}

async function ensureDirs() {
  await Promise.all([
    fs.mkdir(day0Root, { recursive: true }),
    fs.mkdir(draftsDir, { recursive: true }),
    fs.mkdir(outreachDir, { recursive: true }),
    fs.mkdir(logsDir, { recursive: true }),
  ]);
}

async function buildProfileQueue() {
  const rows = [
    [
      "platform",
      "profile_url",
      "priority",
      "owner",
      "status",
      "launch_task",
      "tracked_link",
      "notes",
    ],
    ["Google Business Profile", "https://www.google.com/business/", "P0", "Ben", "ready", "Update profile copy + publish first post", trackedUrl("google_business_profile", "organic_local", "authority_takeover", "gbp_day0"), "Use profile-pack canonical text"],
    ["LinkedIn Company", "https://www.linkedin.com/company/setup/new/", "P0", "Ben", "ready", "Update About + publish day-0 post", trackedUrl("linkedin", "organic_social", "authority_takeover", "linkedin_day0"), "Pin intro post"],
    ["YouTube", "https://www.youtube.com/account", "P1", "Ben", "ready", "Channel bio update + Shorts draft", trackedUrl("youtube", "organic_video", "authority_takeover", "youtube_day0"), "Add shop link in channel links"],
    ["Pinterest", "https://www.pinterest.com/business/create/", "P1", "Ben", "ready", "Business profile + 1 idea pin", trackedUrl("pinterest", "organic_social", "authority_takeover", "pinterest_day0"), "Use product + party visual"],
    ["Reddit", "https://www.reddit.com/register/", "P1", "Ben", "ready", "Profile + 1 value-first post", trackedUrl("reddit", "organic_referral", "authority_takeover", "reddit_day0"), "No promotional spam"],
    ["Quora", "https://www.quora.com/", "P1", "Ben", "ready", "Space setup + first answer", trackedUrl("quora", "organic_referral", "authority_takeover", "quora_day0"), "Answer high-intent question"],
    ["Medium", "https://medium.com/new-story", "P0", "Ben", "ready", "Publication profile + first story", trackedUrl("medium", "organic_referral", "authority_takeover", "medium_day0"), "Use canonical URL"],
    ["Substack", "https://substack.com/", "P1", "Ben", "ready", "Newsletter setup + first note", trackedUrl("substack", "email", "authority_takeover", "substack_day0"), "Short founder note"],
    ["X", "https://x.com/i/flow/signup", "P1", "Ben", "ready", "Bio + pinned intro thread", trackedUrl("x", "organic_social", "authority_takeover", "x_day0"), "3-post sequence"],
    ["Facebook Page", "https://www.facebook.com/pages/create/", "P1", "Ben", "ready", "Page optimization + first post", trackedUrl("facebook", "organic_social", "authority_takeover", "facebook_day0"), "Enable CTA button"],
  ];

  await fs.writeFile(path.join(day0Root, "profile-update-queue.csv"), `${toCsv(rows)}\n`, "utf8");
}

async function buildSyndicationDrafts() {
  const sourceCsv = await fs.readFile(path.join(growthRoot, "02-parasite-seo-domination", "syndication-calendar.csv"), "utf8");
  const rows = readCsv(sourceCsv).slice(0, 20);

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const fileName = `${String(i + 1).padStart(2, "0")}-${slugify(row.topic_title)}.md`;
    const content = buildPostDraft(row, i);
    await fs.writeFile(path.join(draftsDir, fileName), content, "utf8");
  }

  return rows.length;
}

async function buildOutreachBatch() {
  const sourceCsv = await fs.readFile(path.join(growthRoot, "03-influencer-affiliate-machine", "creator_pipeline.csv"), "utf8");
  const leads = readCsv(sourceCsv).slice(0, 25);

  const csvRows = [[
    "lead_id",
    "segment",
    "platform",
    "search_query",
    "discovery_url",
    "message_subject",
    "message_body",
    "status",
    "followup_due_days",
  ]];

  const mdBlocks = ["# Day-0 Creator Outreach Batch (25)\n"];

  leads.forEach((lead, idx) => {
    const subject = personalizeSubject(lead.segment);
    const body = outreachBody(lead, idx);

    csvRows.push([
      lead.lead_id,
      lead.segment,
      lead.platform,
      lead.search_query,
      lead.discovery_url,
      subject,
      body,
      "ready-to-send",
      "4",
    ]);

    mdBlocks.push(`## ${lead.lead_id} | ${lead.platform} | ${lead.segment}\n`);
    mdBlocks.push(`- Query: ${lead.search_query}`);
    mdBlocks.push(`- Discovery URL: ${lead.discovery_url}`);
    mdBlocks.push(`- Subject: ${subject}`);
    mdBlocks.push("- Message:");
    mdBlocks.push("");
    mdBlocks.push(body);
    mdBlocks.push("");
  });

  await fs.writeFile(path.join(outreachDir, "day0_creator_outreach_batch.csv"), `${toCsv(csvRows)}\n`, "utf8");
  await fs.writeFile(path.join(outreachDir, "day0_creator_outreach_batch.md"), `${mdBlocks.join("\n")}\n`, "utf8");

  return leads.length;
}

async function buildLogs() {
  const rows = [[
    "timestamp",
    "channel",
    "asset_id",
    "action",
    "status",
    "proof_link",
    "notes",
  ]];
  await fs.writeFile(path.join(logsDir, "day0_send_log.csv"), `${toCsv(rows)}\n`, "utf8");
}

async function writeReadme(postCount, outreachCount) {
  const content = `# Day-0 Launch Bundle\n\nThis package is ready for immediate execution outside OpenClaw.\n\n## Completed in this run\n- 10 platform profile update queue generated\n- ${postCount} syndication drafts generated\n- ${outreachCount} creator outreach messages prepared\n- send log template initialized\n\n## Files\n- profile-update-queue.csv\n- syndication-drafts/ (20 markdown drafts)\n- outreach/day0_creator_outreach_batch.csv\n- outreach/day0_creator_outreach_batch.md\n- logs/day0_send_log.csv\n\n## Immediate sequence\n1. Complete all rows in profile-update-queue.csv (status -> done).\n2. Publish first 10 syndication drafts today and mark proof links in logs/day0_send_log.csv.\n3. Send first 25 outreach messages and track replies + follow-up dates.\n`; 

  await fs.writeFile(path.join(day0Root, "README.md"), content, "utf8");
}

async function main() {
  await ensureDirs();
  await buildProfileQueue();
  const postCount = await buildSyndicationDrafts();
  const outreachCount = await buildOutreachBatch();
  await buildLogs();
  await writeReadme(postCount, outreachCount);

  console.log("Day-0 launch bundle created.");
  console.log(`Path: ${day0Root}`);
  console.log("Profiles queued: 10");
  console.log(`Syndication drafts: ${postCount}`);
  console.log(`Outreach messages: ${outreachCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
