#!/usr/bin/env node
/**
 * build-notion-workspace.mjs
 *
 * One-time script that creates an organized Notion workspace hierarchy for
 * USA Gummies. Creates a top-level "USA Gummies HQ" page, then department
 * pages underneath, each linking to the relevant existing databases.
 *
 * Idempotent: checks for existing HQ page before creating.
 *
 * Usage:
 *   node scripts/build-notion-workspace.mjs
 *
 * Requires: NOTION_API_KEY in .env.local (or environment)
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_VERSION = "2022-06-28";

if (!NOTION_API_KEY) {
  console.error("❌ NOTION_API_KEY not found in .env.local");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Notion API helpers
// ---------------------------------------------------------------------------

async function notionFetch(path, init = {}) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(
      `Notion ${init.method || "GET"} ${path} → ${res.status}: ${typeof json === "string" ? json : JSON.stringify(json).slice(0, 300)}`
    );
  }
  return json;
}

function toNotionId(raw) {
  const clean = raw.replace(/-/g, "").trim();
  if (clean.length !== 32) return raw.trim();
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
}

function notionUrl(id) {
  return `https://www.notion.so/${id.replace(/-/g, "")}`;
}

// ---------------------------------------------------------------------------
// Markdown → Notion blocks
// ---------------------------------------------------------------------------

function markdownToBlocks(content) {
  const lines = content.split("\n");
  const blocks = [];

  for (const rawLine of lines.slice(0, 100)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      // Empty lines become paragraph spacers
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [] },
      });
      continue;
    }
    if (line.startsWith("### ")) {
      blocks.push({
        object: "block",
        type: "heading_3",
        heading_3: {
          rich_text: [{ type: "text", text: { content: line.slice(4) } }],
        },
      });
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push({
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [{ type: "text", text: { content: line.slice(3) } }],
        },
      });
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push({
        object: "block",
        type: "heading_1",
        heading_1: {
          rich_text: [{ type: "text", text: { content: line.slice(2) } }],
        },
      });
      continue;
    }
    if (line.startsWith("- ")) {
      // Check for linked database references
      const linkMatch = line.match(/\[(.+?)\]\((.+?)\)/);
      if (linkMatch) {
        blocks.push({
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: [
              {
                type: "text",
                text: { content: linkMatch[1], link: { url: linkMatch[2] } },
              },
            ],
          },
        });
      } else {
        blocks.push({
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: [{ type: "text", text: { content: line.slice(2) } }],
          },
        });
      }
      continue;
    }
    // Paragraph with possible link
    const linkMatch = line.match(/\[(.+?)\]\((.+?)\)/);
    if (linkMatch) {
      const before = line.slice(0, linkMatch.index);
      const after = line.slice(linkMatch.index + linkMatch[0].length);
      const richText = [];
      if (before) richText.push({ type: "text", text: { content: before } });
      richText.push({
        type: "text",
        text: { content: linkMatch[1], link: { url: linkMatch[2] } },
      });
      if (after) richText.push({ type: "text", text: { content: after } });
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: richText },
      });
    } else {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: line } }],
        },
      });
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Create a Notion page under a parent page
// ---------------------------------------------------------------------------

async function createPage(parentPageId, title, emoji, content) {
  const blocks = markdownToBlocks(content);
  const payload = {
    parent: { page_id: toNotionId(parentPageId) },
    icon: emoji ? { type: "emoji", emoji } : undefined,
    properties: {
      title: { title: [{ text: { content: title } }] },
    },
    children: blocks.slice(0, 100), // Notion max 100 blocks per request
  };

  const result = await notionFetch("/pages", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return result.id;
}

// ---------------------------------------------------------------------------
// Search for existing HQ page to avoid duplicates
// ---------------------------------------------------------------------------

async function findExistingHQPage() {
  try {
    const result = await notionFetch("/search", {
      method: "POST",
      body: JSON.stringify({
        query: "USA Gummies HQ",
        filter: { value: "page", property: "object" },
        page_size: 5,
      }),
    });
    const pages = result.results || [];
    for (const page of pages) {
      const titleProp = page.properties?.title;
      if (!titleProp?.title) continue;
      const titleText = titleProp.title
        .map((t) => t.plain_text || "")
        .join("");
      if (titleText === "USA Gummies HQ") {
        return page.id;
      }
    }
    return null;
  } catch (err) {
    console.warn("⚠️  Search failed, will create fresh:", err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Database definitions — all known Notion databases
// ---------------------------------------------------------------------------

function dbLink(envKey, fallbackId) {
  const id = process.env[envKey] || fallbackId || "";
  if (!id || id === "00000000000000000000000000000000") return null;
  return { id: toNotionId(id), url: notionUrl(id) };
}

const DATABASES = {
  // Finance
  cash_transactions: dbLink("NOTION_CASH_TX_DB_ID", "6325d16870024b83876b9e591b3d2d9c"),

  // Operations
  fleet_ops: dbLink("NOTION_FLEET_OPS_DB_ID", "30d4c0c42c2e81b0914ee534e56e2351"),
  inventory: dbLink("NOTION_INVENTORY_DB_ID", "d598e72e09974194bfe3624ee6e0117e"),
  sku_registry: dbLink("NOTION_SKU_DB_ID", "8173583d402145fb8d87ad74c0241f00"),
  repacker_list: dbLink("NOTION_DB_REPACKER_LIST", "cfdc95e9eab44f5480f578a1349eadd9"),

  // Sales & Growth
  b2b_prospects: dbLink("NOTION_B2B_PROSPECTS_DB", "6007a5df7b49468b9bbf1f1341885aea"),
  distributor_prospects: dbLink("NOTION_DISTRIBUTOR_PROSPECTS_DB", "804b3270eb17483caac0441369c21f3a"),

  // Marketing
  content_drafts: dbLink("NOTION_DB_CONTENT_DRAFTS"),
  image_library: dbLink("NOTION_DB_IMAGE_LIBRARY"),

  // System
  daily_performance: dbLink("NOTION_DAILY_PERF_DB_ID", "2f31cfad04b744e3b16da4edc9675502"),
  agent_run_log: dbLink("NOTION_DB_AGENT_RUN_LOG", "30d4c0c42c2e81b0914ee534e56e2351"),
  platform_users: dbLink("NOTION_PLATFORM_USERS_DB_ID", "f1f7500b35d34908addeba4b94b21c6e"),
  build_tracker: dbLink("NOTION_BUILD_TRACKER_DB", "31e4c0c42c2e81df8b93fd16b4fd2e5b"),

  // Meeting Notes (general log)
  meeting_notes: dbLink("NOTION_MEETING_NOTES_DB_ID") || dbLink("NOTION_MEETING_DB_ID"),
};

// ---------------------------------------------------------------------------
// Department pages
// ---------------------------------------------------------------------------

function dbBullet(label, db) {
  if (!db) return `- ${label}: _not configured_`;
  return `- [${label}](${db.url})`;
}

function buildDepartmentPages() {
  return [
    {
      title: "Company Dashboard",
      emoji: "📊",
      content: [
        "## Overview",
        "Central dashboard for USA Gummies operations.",
        "",
        "### Key Links",
        dbBullet("Daily Performance", DATABASES.daily_performance),
        dbBullet("Build Tracker", DATABASES.build_tracker),
        "",
        "### Quick Stats",
        "Abra generates a morning brief every day at 5am PT via Slack.",
        "End-of-day summary posts at ~8pm PT with full Notion log.",
        "Weekly digest on Mondays, monthly report on the 1st.",
      ].join("\n"),
    },
    {
      title: "Finance",
      emoji: "💰",
      content: [
        "## Financial Data",
        dbBullet("Cash Transactions", DATABASES.cash_transactions),
        "",
        "### How to Load Data",
        "- Upload BofA CSV: usagummies.com/ops/finance",
        "- Upload bank PDFs/statements: usagummies.com/ops/documents",
        "- Abra auto-categorizes transactions and updates cash position",
        "",
        "### Reports",
        "- Cash position appears in morning brief when data is loaded",
        "- Monthly report on the 1st includes financial summary",
      ].join("\n"),
    },
    {
      title: "Operations",
      emoji: "📦",
      content: [
        "## Operations & Supply Chain",
        dbBullet("Fleet Ops Log", DATABASES.fleet_ops),
        dbBullet("Inventory", DATABASES.inventory),
        dbBullet("SKU Registry", DATABASES.sku_registry),
        dbBullet("Repacker List", DATABASES.repacker_list),
        "",
        "### Processes",
        "- Inventory levels tracked per SKU",
        "- Fleet ops logs shipments and logistics events",
        "- Repacker list tracks co-packing partners",
      ].join("\n"),
    },
    {
      title: "Sales & Growth",
      emoji: "🛒",
      content: [
        "## Sales Pipeline",
        dbBullet("B2B Prospects", DATABASES.b2b_prospects),
        dbBullet("Distributor Prospects", DATABASES.distributor_prospects),
        "",
        "### Channels",
        "- DTC: Shopify storefront (usagummies.com)",
        "- Marketplace: Amazon (Seller ID A16G27VYDSSEGO)",
        "- Wholesale: B2B outreach via ops pipeline",
        "",
        "### Pipeline Intelligence",
        "- Abra auto-enriches new prospects from email and feeds",
        "- Weekly pipeline digest on Mondays",
      ].join("\n"),
    },
    {
      title: "Marketing",
      emoji: "📣",
      content: [
        "## Marketing & Content",
        dbBullet("Content Drafts", DATABASES.content_drafts),
        dbBullet("Image Library", DATABASES.image_library),
        "",
        "### Content Pipeline",
        "- Blog: 29 MDX posts in content/blog/",
        "- SEO agent monitors rankings and suggests posts",
        "- Social content ideas generated by DTC engine",
      ].join("\n"),
    },
    {
      title: "Meeting Notes & Daily Logs",
      emoji: "📋",
      content: [
        "## Session Logs",
        dbBullet("Meeting Notes / Daily Logs", DATABASES.meeting_notes),
        "",
        "### How This Works",
        "- Abra creates a daily log page every evening (~8pm PT)",
        "- Chat sessions that produce decisions/action items are logged here",
        "- Morning briefs and end-of-day summaries link back to this DB",
      ].join("\n"),
    },
    {
      title: "System & Integrations",
      emoji: "⚙️",
      content: [
        "## Abra System Status",
        dbBullet("Agent Run Log", DATABASES.agent_run_log),
        dbBullet("Platform Users", DATABASES.platform_users),
        dbBullet("Daily Performance", DATABASES.daily_performance),
        "",
        "### Integrations",
        "- Shopify Storefront + Admin API",
        "- Amazon SP-API",
        "- GA4 Analytics",
        "- Gmail SMTP (transactional email)",
        "- Slack (notifications)",
        "- Supabase (vector memory, KPIs, initiatives)",
        "- Upstash (QStash scheduling, KV state)",
        "",
        "### Feeds (11 active)",
        "- email_inbox, shopify_orders, amazon_orders",
        "- ga4_traffic, inventory_check, market_trends",
        "- customer_feedback, competitor_watch",
        "- social_mentions, supplier_updates, regulatory_updates",
      ].join("\n"),
    },
  ];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("🏗️  Building USA Gummies Notion workspace...\n");

  // Check for existing HQ page
  let hqPageId = await findExistingHQPage();
  if (hqPageId) {
    console.log(`✅ Found existing HQ page: ${notionUrl(hqPageId)}`);
    console.log("   Skipping creation to avoid duplicates.\n");
    console.log("   To rebuild, archive the existing page first.\n");
  } else {
    // Create top-level HQ page (workspace-level, no parent)
    const hqPayload = {
      parent: { type: "workspace", workspace: true },
      icon: { type: "emoji", emoji: "🏢" },
      properties: {
        title: { title: [{ text: { content: "USA Gummies HQ" } }] },
      },
      children: markdownToBlocks(
        [
          "## Welcome to USA Gummies HQ",
          "",
          "This is the central Notion workspace for USA Gummies.",
          "Departments are organized as sub-pages below.",
          "",
          "### Quick Access",
          "- Morning Brief: delivered to Slack daily at 5am PT",
          "- End-of-Day Summary: Slack + Notion page at 8pm PT",
          "- Chat with Abra: usagummies.com/ops/ → Abra chat",
        ].join("\n")
      ),
    };

    const hqResult = await notionFetch("/pages", {
      method: "POST",
      body: JSON.stringify(hqPayload),
    });
    hqPageId = hqResult.id;
    console.log(`✅ Created HQ page: ${notionUrl(hqPageId)}\n`);
  }

  // Create department pages
  const departments = buildDepartmentPages();
  const created = [];

  for (const dept of departments) {
    try {
      const pageId = await createPage(hqPageId, dept.title, dept.emoji, dept.content);
      console.log(`  ✅ ${dept.emoji} ${dept.title} → ${notionUrl(pageId)}`);
      created.push({ title: dept.title, id: pageId });
    } catch (err) {
      console.error(`  ❌ ${dept.emoji} ${dept.title}: ${err.message}`);
    }
  }

  console.log(`\n🎉 Done! Created ${created.length}/${departments.length} department pages.`);
  console.log(`\n📌 HQ Page: ${notionUrl(hqPageId)}`);

  // Output the HQ page ID for saving to env
  console.log(`\n💡 Add to .env.local:`);
  console.log(`   NOTION_WORKSPACE_HQ_PAGE_ID="${hqPageId}"`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
