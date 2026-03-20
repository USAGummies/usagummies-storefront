/**
 * Abra Markdown Memory Layer
 *
 * Viktor-inspired operational memory stored as plain markdown files in Supabase Storage.
 * These files are always loaded into context — no embedding/similarity matching needed.
 * They sit above the pgvector brain in the system prompt so corrections always win.
 *
 * Bucket: abra-memory
 * Files: corrections.md, teachings.md, team.md, vendors.md, products.md, operations.md
 */

const BUCKET = "abra-memory";

const MEMORY_FILES = [
  "corrections.md",
  "teachings.md",
  "team.md",
  "vendors.md",
  "products.md",
  "operations.md",
] as const;

type MemoryFile = (typeof MEMORY_FILES)[number];

// Map from teach category → which file accumulates it
const CATEGORY_FILE_MAP: Record<string, MemoryFile> = {
  team: "team.md",
  people: "team.md",
  hr: "team.md",
  vendor: "vendors.md",
  vendors: "vendors.md",
  supply_chain: "vendors.md",
  "supply-chain": "vendors.md",
  "supply chain": "vendors.md",
  product: "products.md",
  products: "products.md",
  ecommerce: "products.md",
  amazon: "products.md",
  shopify: "products.md",
  operations: "operations.md",
  ops: "operations.md",
  executive: "operations.md",
};

function resolveTargetFile(category: string): MemoryFile {
  const normalized = category.toLowerCase().trim();
  return CATEGORY_FILE_MAP[normalized] ?? "teachings.md";
}

// ---------------------------------------------------------------------------
// Supabase Storage helpers
// ---------------------------------------------------------------------------

function getEnv(): { url: string; serviceKey: string } | null {
  const url =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return null;
  return { url, serviceKey };
}

function storageHeaders(contentType?: string): Record<string, string> {
  const env = getEnv();
  if (!env) throw new Error("Supabase not configured");
  const headers: Record<string, string> = {
    apikey: env.serviceKey,
    Authorization: `Bearer ${env.serviceKey}`,
  };
  if (contentType) headers["Content-Type"] = contentType;
  return headers;
}

async function storageGet(filename: MemoryFile): Promise<string | null> {
  const env = getEnv();
  if (!env) return null;
  try {
    const res = await fetch(
      `${env.url}/storage/v1/object/${BUCKET}/${filename}`,
      {
        headers: storageHeaders(),
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      },
    );
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function storagePut(filename: MemoryFile, content: string): Promise<boolean> {
  const env = getEnv();
  if (!env) return false;
  try {
    const res = await fetch(
      `${env.url}/storage/v1/object/${BUCKET}/${filename}`,
      {
        method: "POST",
        headers: {
          ...storageHeaders("text/markdown; charset=utf-8"),
          "x-upsert": "true",
        },
        body: content,
        signal: AbortSignal.timeout(10000),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Seed content for initial file creation
// ---------------------------------------------------------------------------

const SEED_CONTENT: Record<MemoryFile, string> = {
  "corrections.md": `# Corrections

_All corrections to Abra's claims. These always override brain entries._

### 2026-03-01 CORRECTION
**WRONG:** COGS is $3.11 per unit
**CORRECT:** $3.11 was historical COGS before the 2026 repacker switch. Forward COGS is $1.522/unit with Powers Confections ($0.385/lb) and Belmark labels.
---

### 2026-03-01 CORRECTION
**WRONG:** USA Gummies sells supplements
**CORRECT:** USA Gummies sells confectionery (dye-free gummy candy), NOT supplements. This affects regulatory, labeling, and channel strategy.
---

### 2026-03-01 CORRECTION
**WRONG:** PirateShip invoice is a single flat shipping fee
**CORRECT:** PirateShip invoices include postage costs (shipping expense / COGS) AND service fees (SG&A). Always split into two line items when recording.
---

### 2026-03-01 CORRECTION
**WRONG:** Powers Confections rate is unknown
**CORRECT:** Powers Confections repacking rate is $0.385/lb (current as of 2026).
---
`,

  "teachings.md": `# Teachings

_Accumulated knowledge taught by the team via \`/abra teach:\`_

`,

  "team.md": `# Team Directory

## Ben Stutman — CEO / Founder
- Email: Ben@usagummies.com | benjamin.stutman@gmail.com
- Role: Decision-maker for all strategic, financial, and operational matters
- Slack: Primary user of Abra — address him directly in responses

## Andrew — Operations
- Role: Supply chain, fulfillment, and day-to-day ops execution

## Rene G. Gonzalez — Finance / Investor
- Role: Finance oversight and investor
- CRITICAL: ANY bank transfer from "Rene G. Gonzalez", "Gonzalez, Rene", or "The Rene G. Gonzalez Trust" is an INVESTOR LOAN (QBO account ID 167 — "Investor Loan - Rene"). This is a LIABILITY, never income or revenue. Always alert Ben via Slack when detecting investor transfers.
`,

  "vendors.md": `# Vendors & Supply Chain

## Powers Confections — Co-Packer / Repacker
- Location: Spokane, WA
- Rate: $0.385/lb (current as of early 2026)
- Status: Active primary repacker (replaced prior arrangement in 2026)
- Notes: Invoice is per-pound; weight is finished product weight

## Albanese — Bulk Gummy Supplier
- Product: Bulk dye-free gummy bears (All American variety)
- Status: Active primary ingredient supplier

## Belmark — Labels / Packaging
- Product: Printed labels for All American Gummy Bears and other SKUs
- Status: Active

## PirateShip — Shipping Platform
- Purpose: Discounted USPS/UPS postage for DTC orders
- Billing split: postage costs → Shipping expense (COGS); service/platform fees → SG&A
- Always split PirateShip invoices into two categories when recording transactions
`,

  "products.md": `# Products & SKUs

## All American Gummy Bears — 7.5oz
- Primary DTC and Amazon SKU
- Contains: Dye-free bulk gummies (Albanese), Belmark label, packaged by Powers Confections
- COGS (forward, 2026+): ~$1.522/unit
  - Repacking (Powers): $0.385/lb
  - Labels (Belmark): included in COGS estimate
- Channels: Shopify DTC, Amazon US (Seller ID: A16G27VYDSSEGO)

## VARIETY-10PK Bundle
- Price: $39.99
- Contents: 10-pack variety assortment
- Channel: Shopify DTC

## COGS Note
- Historical COGS (pre-2026): ~$3.11/unit (old repacker)
- Forward COGS (2026+): ~$1.522/unit (Powers Confections)
- Never mix these — always use forward COGS for projections
`,

  "operations.md": `# Operations — Current State

## Repacker
- Active: Powers Confections, Spokane WA, $0.385/lb
- Switched from prior arrangement in early 2026

## Accounting
- System of record: QuickBooks Online (QBO)
- Connected bank accounts: BofA checking (...7020), Capital One Platinum (...8133), Capital One QuicksilverOne (...6682)
- Finance lead: Rene G. Gonzalez
- Notion ledger: https://www.notion.so/6325d16870024b83876b9e591b3d2d9c (secondary/legacy)

## Sales Channels
- DTC: Shopify (usagummies.com)
- Marketplace: Amazon US (Seller ID: A16G27VYDSSEGO)
- B2B: Faire, direct wholesale

## Product Category
- Confectionery (candy), NOT supplements
- Dye-free positioning is the core differentiation
`,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read all memory files and return a single concatenated string.
 * Files that don't exist in storage are seeded on first access.
 * Total output is capped at ~6000 chars to stay under ~1500 tokens.
 */
export async function readAllMemory(): Promise<string> {
  const parts: string[] = [];

  await Promise.all(
    MEMORY_FILES.map(async (filename) => {
      let content = await storageGet(filename);

      // Seed on first access
      if (content === null) {
        const seed = SEED_CONTENT[filename];
        await storagePut(filename, seed);
        content = seed;
      }

      if (content && content.trim()) {
        parts.push(`## ${filename.replace(".md", "")}\n\n${content.trim()}`);
      }
    }),
  );

  // Sort to ensure consistent ordering (corrections first)
  const ordered = MEMORY_FILES.map((f) =>
    parts.find((p) => p.startsWith(`## ${f.replace(".md", "")}`)),
  ).filter((p): p is string => !!p);

  const full = ordered.join("\n\n---\n\n");

  // Hard cap at ~6000 chars to leave room for rest of prompt
  if (full.length > 6000) {
    return full.slice(0, 6000) + "\n\n_[memory truncated for context length]_";
  }
  return full;
}

/**
 * Append a correction entry to corrections.md.
 */
export async function appendCorrection(
  original: string,
  correction: string,
  date?: string,
): Promise<boolean> {
  const d = date || new Date().toISOString().split("T")[0];
  const entry = `\n### ${d} CORRECTION\n**WRONG:** ${original}\n**CORRECT:** ${correction}\n---\n`;
  return appendToFile("corrections.md", entry);
}

/**
 * Append a teaching entry to the appropriate file based on category.
 */
export async function appendTeaching(
  category: string,
  content: string,
  taughtBy: string,
  date?: string,
): Promise<boolean> {
  const d = date || new Date().toISOString().split("T")[0];
  const targetFile = resolveTargetFile(category);
  const entry = `\n### ${d} [${category || "general"}]\n_Taught by ${taughtBy}_\n\n${content}\n---\n`;
  return appendToFile(targetFile, entry);
}

/**
 * Read a single memory file.
 */
export async function readMemoryFile(filename: MemoryFile): Promise<string> {
  const content = await storageGet(filename);
  if (content === null) {
    // Seed and return
    const seed = SEED_CONTENT[filename];
    await storagePut(filename, seed);
    return seed;
  }
  return content;
}

/**
 * Overwrite a memory file entirely.
 */
export async function writeMemoryFile(
  filename: MemoryFile,
  content: string,
): Promise<boolean> {
  return storagePut(filename, content);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function appendToFile(filename: MemoryFile, entry: string): Promise<boolean> {
  try {
    let existing = await storageGet(filename);
    if (existing === null) {
      existing = SEED_CONTENT[filename];
    }
    const updated = existing.trimEnd() + "\n" + entry;
    return storagePut(filename, updated);
  } catch (err) {
    console.error(`[abra-markdown-memory] appendToFile ${filename} failed:`, err);
    return false;
  }
}
