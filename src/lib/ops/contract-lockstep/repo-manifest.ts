/**
 * Repo-manifest reader — parses `/contracts/agents/*.md` (and listed
 * top-level contracts) into the `RepoContract` shape the auditor
 * consumes.
 *
 * Read-only. The reader uses `fs.readFile` only — no writes.
 *
 * The auditor is pure / DI-driven, so this reader is OPTIONAL: tests
 * pass synthetic manifests directly. Production code (the dashboard
 * page) calls `readRepoManifest()` once per request.
 */

import path from "node:path";
import { promises as fs } from "node:fs";

import { DOCTRINE_LOCKS } from "@/lib/ops/operating-memory/drift-doctrine";

import type { RepoContract } from "./types";

/**
 * Default contract paths the lockstep auditor cross-walks. Hand-
 * maintained — the weekly drift audit catches drift between this
 * list and the actual `/contracts/agents/` directory contents.
 */
export const DEFAULT_REPO_CONTRACT_PATHS: readonly string[] = Object.freeze([
  "contracts/viktor.md",
  "contracts/agents/booke.md",
  "contracts/agents/compliance-specialist.md",
  "contracts/agents/drift-audit-runner.md",
  "contracts/agents/executive-brief.md",
  "contracts/agents/faire-specialist.md",
  "contracts/agents/finance-exception.md",
  "contracts/agents/interviewer.md",
  "contracts/agents/inventory-specialist.md",
  "contracts/agents/ops.md",
  "contracts/agents/platform-specialist.md",
  "contracts/agents/r1-consumer.md",
  "contracts/agents/r2-market.md",
  "contracts/agents/r3-competitive.md",
  "contracts/agents/r4-channel.md",
  "contracts/agents/r5-regulatory.md",
  "contracts/agents/r6-supply.md",
  "contracts/agents/r7-press.md",
  "contracts/agents/reconciliation-specialist.md",
  "contracts/agents/research-librarian.md",
  "contracts/agents/sample-order-dispatch.md",
  "contracts/agents/viktor-rene-capture.md",
]);

/** Slug-shape regex for body scraping. */
const SLUG_RE =
  /\b(?:[a-z][a-z0-9-]+)(?:\.[a-z][a-z0-9-]+){1,3}\b/g;

const SLUG_FALSE_POSITIVE_PREFIXES = new Set<string>([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "google.com",
  "shopify.com",
  "amazon.com",
  "usagummies.com",
  "anthropic.com",
  "vercel.app",
  "vercel.com",
  "slack.com",
  "supabase.co",
  "notion.so",
  "github.com",
  "stripe.com",
  "qbo.intuit.com",
  "intuit.com",
  "openai.com",
  "make.com",
  "next.config",
  "tsconfig.json",
  "package.json",
  "node.js",
  "react.js",
  "next.js",
  "tailwind.css",
]);

/** Max body length retained per contract. */
const MAX_BODY_LEN = 50_000;

interface ParsedFrontMatter {
  title?: string;
  status?: string;
  version?: string;
  humanOwner?: string;
}

/**
 * Parse the bold-prefixed front-matter pattern used in our markdown:
 *   # Title
 *   **Status:** ...
 *   **Version:** 1.4 — 2026-04-27
 *   **Human owner:** Rene
 */
function parseFrontMatter(text: string): ParsedFrontMatter {
  const out: ParsedFrontMatter = {};

  const titleMatch = text.match(/^#\s+(.+)$/m);
  if (titleMatch) out.title = titleMatch[1].trim();

  const lines = text.split(/\r?\n/).slice(0, 30); // front-matter is in the first ~30 lines
  for (const line of lines) {
    let m = line.match(/^\*\*Status:\*\*\s*(.+)$/);
    if (m && !out.status) out.status = m[1].trim();
    m = line.match(/^\*\*Version:\*\*\s*(.+)$/);
    if (m && !out.version) out.version = m[1].trim();
    m = line.match(/^\*\*Human owner:\*\*\s*(.+)$/);
    if (m && !out.humanOwner) out.humanOwner = m[1].trim();
  }
  return out;
}

/** Scrape slug-shaped tokens from the body. */
function scrapeReferencedSlugs(body: string): string[] {
  const found = new Set<string>();
  for (const raw of body.match(SLUG_RE) ?? []) {
    const token = raw.toLowerCase();
    if (SLUG_FALSE_POSITIVE_PREFIXES.has(token)) continue;
    found.add(token);
  }
  return [...found];
}

/** Scan body for doctrine-contradiction markers using the shared doctrine table. */
function scanDoctrineMarkers(body: string): string[] {
  const matched: string[] = [];
  for (const lock of DOCTRINE_LOCKS) {
    if (lock.contradictionPattern.test(body)) {
      matched.push(lock.id);
    }
  }
  return matched;
}

/** Extract the ISO date portion from a version string. */
function extractVersionDate(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const m = v.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : undefined;
}

/**
 * Parse a single contract file's text into a `RepoContract`. Pure —
 * tests pass synthetic strings directly.
 */
export function parseRepoContract(
  pathRelToRoot: string,
  text: string,
): RepoContract {
  const fm = parseFrontMatter(text);
  const body = text.length > MAX_BODY_LEN ? text.slice(0, MAX_BODY_LEN) : text;
  return {
    path: pathRelToRoot,
    title: fm.title ?? path.basename(pathRelToRoot, ".md"),
    status: fm.status,
    version: fm.version,
    versionDate: extractVersionDate(fm.version),
    humanOwner: fm.humanOwner,
    referencedSlugs: scrapeReferencedSlugs(body),
    doctrineMarkers: scanDoctrineMarkers(body),
    body,
  };
}

/**
 * Load the default repo manifest from disk. Server-side only.
 * Failures are swallowed per file (missing files just don't appear in
 * the manifest); the caller decides how to handle empty results.
 */
export async function readRepoManifest(
  paths: readonly string[] = DEFAULT_REPO_CONTRACT_PATHS,
  rootOverride?: string,
): Promise<RepoContract[]> {
  const root = rootOverride ?? process.cwd();
  const out: RepoContract[] = [];
  await Promise.all(
    paths.map(async (rel) => {
      try {
        const text = await fs.readFile(path.resolve(root, rel), "utf8");
        out.push(parseRepoContract(rel, text));
      } catch {
        // missing file / unreadable — silently skip; the auditor's
        // missing-in-notion + missing-in-repo cross-walk handles
        // discoverability via path comparisons.
      }
    }),
  );
  return out;
}

/** Exposed for tests. */
export const __INTERNAL = {
  parseFrontMatter,
  scrapeReferencedSlugs,
  scanDoctrineMarkers,
  extractVersionDate,
  MAX_BODY_LEN,
};
