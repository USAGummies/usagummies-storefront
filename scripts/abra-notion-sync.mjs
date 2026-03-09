#!/usr/bin/env node
/**
 * Abra Notion Sync — Notion databases → Supabase open_brain_entries pipeline.
 *
 * Reads key Notion databases, transforms each record into an open_brain_entry,
 * generates embeddings via embed-and-store, and persists to Supabase.
 *
 * Usage:
 *   node scripts/abra-notion-sync.mjs --db b2b              # sync one database
 *   node scripts/abra-notion-sync.mjs --db all               # sync all databases
 *   node scripts/abra-notion-sync.mjs --db b2b --max 10      # limit records
 *   node scripts/abra-notion-sync.mjs --db all --dry-run     # preview only
 *
 * Requires:
 *   - NOTION_API_KEY env var (or ~/.config/usa-gummies-mcp/.notion-credentials)
 *   - SUPABASE_URL + SERVICE_ROLE_JWT env vars
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HOME = os.homedir();
const CONFIG_DIR = path.join(HOME, ".config/usa-gummies-mcp");
const CURSOR_PATH = path.join(CONFIG_DIR, "abra-notion-sync-cursor.json");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zdvfllvopocptwgummzb.supabase.co";
const SERVICE_ROLE_JWT = process.env.SERVICE_ROLE_JWT || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const EMBED_URL = `${SUPABASE_URL}/functions/v1/embed-and-store`;
const REST_URL = `${SUPABASE_URL}/rest/v1`;

const NOTION_API_VERSION = "2022-06-28";
const NOTION_RATE_DELAY_MS = 350; // ~3 req/s
const EMBED_DELAY_MS = 200;

// ---------------------------------------------------------------------------
// Database registry
// ---------------------------------------------------------------------------

const DATABASES = {
  b2b: {
    id: "6007a5df7b49468b9bbf1f1341885aea",
    name: "B2B Prospects",
    category: "deal_data",
    department: "revenue",
    entryType: "finding",
  },
  distributors: {
    id: "804b3270eb17483caac0441369c21f3a",
    name: "Distributor Prospects",
    category: "deal_data",
    department: "revenue",
    entryType: "finding",
  },
  skus: {
    id: "8173583d402145fb8d87ad74c0241f00",
    name: "SKU Registry",
    category: "operational",
    department: "operations",
    entryType: "research",
  },
  performance: {
    id: "2f31cfad04b744e3b16da4edc9675502",
    name: "Daily Performance",
    category: "financial",
    department: "finance",
    entryType: "summary",
  },
  repackers: {
    id: "cfdc95e9eab44f5480f578a1349eadd9",
    name: "Repacker List",
    category: "operational",
    department: "operations",
    entryType: "finding",
  },
  cash: {
    id: "6325d16870024b83876b9e591b3d2d9c",
    name: "Cash Transactions",
    category: "financial",
    department: "finance",
    entryType: "finding",
  },
};

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { db: "all", max: Infinity, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--db" && argv[i + 1]) args.db = argv[++i];
    if (argv[i] === "--max" && argv[i + 1]) args.max = parseInt(argv[++i], 10);
    if (argv[i] === "--dry-run") args.dryRun = true;
  }
  return args;
}

// ---------------------------------------------------------------------------
// Notion API (raw fetch — same pattern as usa-gummies-agentic.mjs)
// ---------------------------------------------------------------------------

function getNotionKey() {
  // Try env vars first (dual naming convention)
  const key = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
  if (key) return key;

  // Fallback to credentials file
  const credPath = path.join(CONFIG_DIR, ".notion-credentials");
  if (fs.existsSync(credPath)) {
    const content = fs.readFileSync(credPath, "utf8").trim();
    const match = content.match(/NOTION_API_KEY=(.+)/);
    if (match) return match[1].trim();
    return content; // raw token
  }

  throw new Error("No Notion API key found. Set NOTION_API_KEY or create ~/.config/usa-gummies-mcp/.notion-credentials");
}

const notionKey = getNotionKey();

async function notion(pathname, method = "GET", body = null) {
  const res = await fetch(`https://api.notion.com/v1${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${notionKey}`,
      "Notion-Version": NOTION_API_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Notion ${method} ${pathname} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

function toNotionId(id) {
  if (id.includes("-")) return id;
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

async function queryDatabaseAll(dbId, filter = null, sorts = null, maxRecords = Infinity) {
  const out = [];
  let startCursor = null;
  do {
    const body = { page_size: 100 };
    if (startCursor) body.start_cursor = startCursor;
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;
    const res = await notion(`/databases/${toNotionId(dbId)}/query`, "POST", body);
    out.push(...(res.results || []));
    startCursor = res.has_more ? res.next_cursor : null;
    await new Promise((r) => setTimeout(r, NOTION_RATE_DELAY_MS));
    if (out.length >= maxRecords) break;
  } while (startCursor);
  return out.slice(0, maxRecords);
}

// ---------------------------------------------------------------------------
// Notion property extraction (mirrors usa-gummies-agentic.mjs)
// ---------------------------------------------------------------------------

function getPlainText(prop) {
  if (!prop) return "";
  if (prop.type === "title") return (prop.title || []).map((x) => x.plain_text || "").join("");
  if (prop.type === "rich_text") return (prop.rich_text || []).map((x) => x.plain_text || "").join("");
  if (prop.type === "email") return prop.email || "";
  if (prop.type === "phone_number") return prop.phone_number || "";
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "multi_select") return (prop.multi_select || []).map((x) => x.name).join(", ");
  if (prop.type === "url") return prop.url || "";
  if (prop.type === "date") return prop.date?.start || "";
  if (prop.type === "checkbox") return prop.checkbox ? "Yes" : "No";
  if (prop.type === "number") return prop.number != null ? String(prop.number) : "";
  if (prop.type === "formula") {
    if (prop.formula?.type === "string") return prop.formula.string || "";
    if (prop.formula?.type === "number") return prop.formula.number != null ? String(prop.formula.number) : "";
    if (prop.formula?.type === "boolean") return prop.formula.boolean ? "Yes" : "No";
    if (prop.formula?.type === "date") return prop.formula.date?.start || "";
  }
  if (prop.type === "rollup") {
    if (prop.rollup?.type === "number") return prop.rollup.number != null ? String(prop.rollup.number) : "";
    if (prop.rollup?.type === "array") return prop.rollup.array?.map((x) => getPlainText(x)).filter(Boolean).join(", ") || "";
  }
  if (prop.type === "status") return prop.status?.name || "";
  if (prop.type === "people") return (prop.people || []).map((p) => p.name || p.id).join(", ");
  if (prop.type === "created_time") return prop.created_time || "";
  if (prop.type === "last_edited_time") return prop.last_edited_time || "";
  return "";
}

function getTitle(page) {
  for (const [, prop] of Object.entries(page.properties || {})) {
    if (prop.type === "title") return getPlainText(prop);
  }
  return "(untitled)";
}

// ---------------------------------------------------------------------------
// Transform Notion page → open_brain_entries record
// ---------------------------------------------------------------------------

function notionPageToRecord(page, dbConfig) {
  const title = getTitle(page);
  const pageId = page.id.replace(/-/g, "");
  const sourceRef = `notion:${dbConfig.id}:${pageId}`;

  // Build raw_text from all properties
  const lines = [`${dbConfig.name}: ${title}`];
  const propEntries = Object.entries(page.properties || {}).sort(([a], [b]) => a.localeCompare(b));

  for (const [name, prop] of propEntries) {
    if (prop.type === "title") continue; // already in title
    const value = getPlainText(prop);
    if (value) {
      lines.push(`${name}: ${value}`);
    }
  }

  const rawText = lines.join("\n");
  const summaryText = rawText.slice(0, 500);

  // Extract tags from the record
  const tags = [dbConfig.name.toLowerCase().replace(/\s+/g, "-")];
  const status = getPlainText(page.properties?.Status || page.properties?.status);
  if (status) tags.push(status.toLowerCase().replace(/\s+/g, "-"));

  return {
    source_type: "api",
    source_ref: sourceRef,
    entry_type: dbConfig.entryType,
    title: `${dbConfig.name}: ${title}`.slice(0, 200),
    raw_text: rawText.slice(0, 45000), // stay under 50KB limit
    summary_text: summaryText,
    category: dbConfig.category,
    department: dbConfig.department,
    confidence: "high",
    priority: "normal",
    tags,
  };
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

async function supabaseGet(pathname, params = "") {
  const url = `${REST_URL}${pathname}${params ? "?" + params : ""}`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE_JWT,
      Authorization: `Bearer ${SERVICE_ROLE_JWT}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Supabase GET ${pathname} failed: ${res.status}`);
  return res.json();
}

async function supabaseDelete(pathname, params = "") {
  const url = `${REST_URL}${pathname}${params ? "?" + params : ""}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      apikey: SERVICE_ROLE_JWT,
      Authorization: `Bearer ${SERVICE_ROLE_JWT}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase DELETE ${pathname} failed: ${res.status}`);
}

async function embedAndStore(record) {
  const res = await fetch(EMBED_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_JWT}`,
    },
    body: JSON.stringify({ table: "open_brain_entries", record }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`embed-and-store failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Cursor state
// ---------------------------------------------------------------------------

function loadCursor() {
  try {
    return JSON.parse(fs.readFileSync(CURSOR_PATH, "utf8"));
  } catch {
    return { dbCursors: {}, totalSynced: 0 };
  }
}

function saveCursor(cursor) {
  fs.mkdirSync(path.dirname(CURSOR_PATH), { recursive: true });
  fs.writeFileSync(CURSOR_PATH, JSON.stringify(cursor, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Sync one database
// ---------------------------------------------------------------------------

async function syncDatabase(dbKey, dbConfig, args) {
  const cursor = loadCursor();
  const dryRun = args.dryRun;
  const maxRecords = args.max;

  console.log(`\nSyncing: ${dbConfig.name} (${dbKey})`);
  console.log(`  Notion DB: ${dbConfig.id}`);
  console.log(`  Category: ${dbConfig.category} | Department: ${dbConfig.department}`);

  // Build filter for incremental sync
  const lastSync = cursor.dbCursors?.[dbKey];
  let filter = null;
  if (lastSync) {
    filter = {
      timestamp: "last_edited_time",
      last_edited_time: { after: lastSync },
    };
    console.log(`  Incremental: records edited after ${lastSync}`);
  } else {
    console.log(`  Full sync (first run for this database)`);
  }

  // Fetch from Notion
  const pages = await queryDatabaseAll(dbConfig.id, filter, null, maxRecords);
  console.log(`  Fetched ${pages.length} records from Notion`);

  if (!pages.length) {
    console.log("  Nothing to sync.");
    return { synced: 0, updated: 0, skipped: 0 };
  }

  let synced = 0;
  let updated = 0;
  let skipped = 0;
  let latestEditTime = lastSync || null;

  for (const page of pages) {
    try {
      const record = notionPageToRecord(page, dbConfig);
      const editTime = page.last_edited_time;

      // Track latest edit time for cursor
      if (!latestEditTime || editTime > latestEditTime) {
        latestEditTime = editTime;
      }

      // Check if this source_ref already exists
      const existing = await supabaseGet(
        "/open_brain_entries",
        `select=id,updated_at&source_ref=eq.${encodeURIComponent(record.source_ref)}&limit=1`
      );

      if (existing.length > 0) {
        // Record exists — check if Notion version is newer
        const existingUpdatedAt = existing[0].updated_at;
        if (editTime && existingUpdatedAt && editTime <= existingUpdatedAt) {
          skipped++;
          continue; // Not changed
        }
        // Delete old record, re-insert with new embedding
        if (!dryRun) {
          await supabaseDelete("/open_brain_entries", `id=eq.${existing[0].id}`);
        }
        updated++;
      }

      if (dryRun) {
        console.log(`  [DRY] ${record.title?.slice(0, 60)} | ${existing.length > 0 ? "UPDATE" : "NEW"}`);
      } else {
        await embedAndStore(record);
        console.log(`  ✓ ${record.title?.slice(0, 60)} | ${existing.length > 0 ? "UPDATED" : "NEW"}`);
      }

      synced++;
      await new Promise((r) => setTimeout(r, EMBED_DELAY_MS));
    } catch (err) {
      console.error(`  ✗ ${page.id}: ${err.message}`);
    }
  }

  // Save cursor
  if (!dryRun && latestEditTime) {
    cursor.dbCursors = cursor.dbCursors || {};
    cursor.dbCursors[dbKey] = latestEditTime;
    cursor.totalSynced = (cursor.totalSynced || 0) + synced;
    saveCursor(cursor);
  }

  console.log(`  Done: ${synced} synced, ${updated} updated, ${skipped} unchanged`);
  return { synced, updated, skipped };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!SERVICE_ROLE_JWT) {
    console.error("Missing SERVICE_ROLE_JWT or SUPABASE_SERVICE_ROLE_KEY env var.");
    process.exit(1);
  }

  console.log("Abra Notion Sync");
  console.log(`  Supabase: ${SUPABASE_URL}`);
  console.log(`  Target: ${args.db}`);
  console.log(`  Max per DB: ${args.max === Infinity ? "all" : args.max}`);
  console.log(`  Dry run: ${args.dryRun}`);

  const dbKeys = args.db === "all" ? Object.keys(DATABASES) : [args.db];

  for (const key of dbKeys) {
    const dbConfig = DATABASES[key];
    if (!dbConfig) {
      console.error(`Unknown database key: "${key}". Valid: ${Object.keys(DATABASES).join(", ")}`);
      continue;
    }
    await syncDatabase(key, dbConfig, args);
  }

  console.log("\nAll done.");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
