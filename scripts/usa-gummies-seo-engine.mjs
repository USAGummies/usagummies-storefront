#!/usr/bin/env node
/**
 * USA Gummies — SEO Content Domination System (Build 4)
 *
 * 9 autonomous agents that automate the entire content pipeline:
 * keyword research, content gap analysis, blog post drafting,
 * internal link optimization, and performance tracking.
 *
 * Agents:
 *   S1  — Keyword Opportunity Scanner    Weekly Mon 7:00 AM
 *   S2  — Content Gap Analyzer           Weekly Tue 7:00 AM
 *   S3  — Blog Post Drafter              Weekly Wed 7:00 AM
 *   S4  — Internal Link Optimizer        Weekly Thu 7:00 AM
 *   S5  — Blog Performance Tracker       Daily 8:00 PM
 *   S6  — Featured Snippet Optimizer     Weekly Fri 7:00 AM
 *   S7  — Sitemap & Schema Validator     Weekly Sat 7:00 AM
 *   S8  — Content Calendar Manager       Weekly Sun 7:00 AM
 *   S9  — Self-Heal Monitor              Every 30 min
 *
 * Usage:
 *   node scripts/usa-gummies-seo-engine.mjs run S1
 *   node scripts/usa-gummies-seo-engine.mjs run all
 *   node scripts/usa-gummies-seo-engine.mjs status
 *   node scripts/usa-gummies-seo-engine.mjs help
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
  fetchWithTimeout,
  textBen,
  loadGA4ServiceAccount,
  log as sharedLog,
} from "./lib/usa-gummies-shared.mjs";

import { callLLM, parseLLMJson, loadVersionedPrompt } from "./lib/llm.mjs";
import fs from "node:fs";
import path from "node:path";

// ── Environment ──────────────────────────────────────────────────────────────

const HOME = process.env.HOME || "/Users/ben";
const ENV_FILE = path.join(HOME, ".config/usa-gummies-mcp/.env-daily-report");
const CONFIG_DIR = path.join(HOME, ".config/usa-gummies-mcp");
const PROJECT_ROOT = (() => {
  try { return path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."); }
  catch { return process.cwd(); }
})();

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

// ── GA4 Config ───────────────────────────────────────────────────────────────

const GA4_PROPERTY_ID = "509104328";

async function getGA4AccessToken() {
  try {
    const sa = loadGA4ServiceAccount();
    if (!sa?.client_email || !sa?.private_key) return null;

    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })).toString("base64url");

    const crypto = await import("node:crypto");
    const sign = crypto.createSign("RSA-SHA256");
    sign.update(`${header}.${payload}`);
    const signature = sign.sign(sa.private_key, "base64url");

    const jwt = `${header}.${payload}.${signature}`;
    const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token || null;
  } catch { return null; }
}

async function ga4Report(dimensions, metrics, dateRanges, dimensionFilter = null) {
  const token = await getGA4AccessToken();
  if (!token) return { ok: false, error: "No GA4 access token" };

  const body = {
    dateRanges,
    dimensions: dimensions.map((d) => ({ name: d })),
    metrics: metrics.map((m) => ({ name: m })),
  };
  if (dimensionFilter) body.dimensionFilter = dimensionFilter;

  try {
    const res = await fetchWithTimeout(
      `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`,
      { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
    if (!res.ok) return { ok: false, error: `GA4 ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (err) { return { ok: false, error: err.message }; }
}

// ── State Files ──────────────────────────────────────────────────────────────

const KEYWORD_CACHE_FILE = path.join(CONFIG_DIR, "seo-keyword-cache.json");
const SERP_CACHE_FILE = path.join(CONFIG_DIR, "seo-serp-cache.json");
const BLOG_DIR = path.join(PROJECT_ROOT, "content/blog");

// ── Notion DB IDs ────────────────────────────────────────────────────────────

const IDS = {
  seoKeywords: process.env.NOTION_DB_SEO_KEYWORDS || "",
  seoCalendar: process.env.NOTION_DB_SEO_CALENDAR || "",
  seoBlogPerf: process.env.NOTION_DB_SEO_BLOG_PERF || "",
  seoLinks: process.env.NOTION_DB_SEO_LINKS || "",
  contentDrafts: process.env.NOTION_DB_CONTENT_DRAFTS || "",
};

// ── Required DB Schemas ──────────────────────────────────────────────────────

const DB_SCHEMAS = {
  seoKeywords: {
    Keyword: "title",
    "Search Volume": "number",
    "Current Rank": "number",
    "Has Blog Post": "checkbox",
    "Blog Post URL": "url",
    "Content Gap Score": "number",
    Priority: { select: { options: [{ name: "High" }, { name: "Medium" }, { name: "Low" }] } },
    "Last Checked": "date",
  },
  seoCalendar: {
    Title: "title",
    "Target Keyword": "rich_text",
    "Publish Date": "date",
    Status: { select: { options: [{ name: "Idea" }, { name: "Drafted" }, { name: "Reviewed" }, { name: "Published" }] } },
    "MDX Slug": "rich_text",
    Author: "rich_text",
    "Word Count": "number",
  },
  seoBlogPerf: {
    "Blog Post": "title",
    Date: "date",
    Sessions: "number",
    "Bounce Rate": "number",
    "Avg Time": "number",
    "Shop Conversions": "number",
    "Organic Sessions": "number",
  },
  seoLinks: {
    "Source Post": "title",
    "Target Post": "rich_text",
    "Anchor Text": "rich_text",
    Applied: "checkbox",
    "Approved By": "rich_text",
  },
};

// ── Schedule Plan ────────────────────────────────────────────────────────────

const SCHEDULE_PLAN = {
  S1: "Weekly Mon 7:00 AM",
  S2: "Weekly Tue 7:00 AM",
  S3: "Weekly Wed 7:00 AM",
  S4: "Weekly Thu 7:00 AM",
  S5: "Daily 8:00 PM",
  S6: "Weekly Fri 7:00 AM",
  S7: "Weekly Sat 7:00 AM",
  S8: "Weekly Sun 7:00 AM",
  S9: "Every 30 min",
};

// ── Engine Bootstrap ─────────────────────────────────────────────────────────

const engine = createEngine({
  name: "seo-engine",
  schedulePlan: SCHEDULE_PLAN,
  ids: IDS,
});

const log = (msg) => engine.log(msg);
const DRY_RUN = process.argv.includes("--dry-run");

// ── Helper: Read existing blog posts ─────────────────────────────────────────

function getExistingBlogPosts() {
  try {
    const files = fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith(".mdx"));
    return files.map((f) => {
      const content = fs.readFileSync(path.join(BLOG_DIR, f), "utf8");
      const slug = f.replace(".mdx", "");

      // Parse frontmatter
      const fm = {};
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        for (const line of fmMatch[1].split("\n")) {
          const m = line.match(/^(\w+):\s*(.+)/);
          if (m) fm[m[1]] = m[2].replace(/^["']|["']$/g, "");
        }
      }

      // Count internal links
      const internalLinks = (content.match(/\]\(\/(blog|shop)/g) || []).length;
      // Count words (rough)
      const wordCount = content.replace(/---[\s\S]*?---/, "").split(/\s+/).filter(Boolean).length;

      return { slug, file: f, title: fm.title || slug, tags: fm.tags || "", category: fm.category || "", wordCount, internalLinks };
    });
  } catch { return []; }
}

// ── Helper: Target keyword clusters ──────────────────────────────────────────

const DYE_KEYWORDS = [
  "red 40 dye", "blue 1 dye", "yellow 5 dye", "yellow 6 dye",
  "titanium dioxide candy", "artificial dyes in candy", "dye free candy",
  "dye free gummy bears", "natural color candy", "food dye ban",
  "california food dye ban", "fda dye ban", "red 3 ban",
  "best dye free candy", "candy without artificial colors",
];

const SEASONAL_KEYWORDS = [
  "dye free easter candy", "dye free halloween candy",
  "dye free valentines candy", "dye free christmas candy",
  "natural color easter eggs candy", "healthy trick or treat candy",
];

const BRAND_KEYWORDS = [
  "usa made gummy bears", "american made candy",
  "gummy bears made in usa", "small batch gummy bears",
  "artisan gummy candy", "real fruit gummy bears",
];

// ══════════════════════════════════════════════════════════════════════════════
//  AGENTS
// ══════════════════════════════════════════════════════════════════════════════

// ── S1: Keyword Opportunity Scanner ──────────────────────────────────────────

async function runS1() {
  log("S1 — Keyword Opportunity Scanner starting...");

  // Pull GA4 search console data (organic landing pages)
  const dateRange = [{ startDate: "30daysAgo", endDate: "yesterday" }];
  const res = await ga4Report(
    ["pagePath", "sessionSource"],
    ["sessions", "bounceRate", "averageSessionDuration"],
    dateRange,
    { filter: { fieldName: "sessionSource", stringFilter: { matchType: "CONTAINS", value: "google" } } }
  );

  const blogPosts = getExistingBlogPosts();
  const blogSlugs = new Set(blogPosts.map((p) => p.slug));
  const keywordCache = safeJsonRead(KEYWORD_CACHE_FILE, { keywords: {}, lastScan: null });

  // Map GA4 organic pages to discover which content drives traffic
  const organicPages = [];
  if (res.ok && res.data?.rows) {
    for (const row of res.data.rows) {
      const pagePath = row.dimensionValues?.[0]?.value || "";
      const sessions = parseInt(row.metricValues?.[0]?.value || "0");
      if (pagePath.startsWith("/blog/") && sessions > 0) {
        organicPages.push({ path: pagePath, sessions });
      }
    }
  }
  organicPages.sort((a, b) => b.sessions - a.sessions);

  // Cross-reference target keywords with existing blog posts
  const allKeywords = [...DYE_KEYWORDS, ...SEASONAL_KEYWORDS, ...BRAND_KEYWORDS];
  const opportunities = [];

  for (const kw of allKeywords) {
    const slug = kw.replace(/\s+/g, "-").toLowerCase();
    const hasPost = blogSlugs.has(slug) || blogPosts.some((p) =>
      p.title.toLowerCase().includes(kw) || (p.tags || "").toLowerCase().includes(kw.split(" ")[0])
    );

    // Score: higher if no post exists, higher for dye keywords (proven traffic drivers)
    let gapScore = hasPost ? 20 : 80;
    if (DYE_KEYWORDS.includes(kw)) gapScore += 15;
    if (SEASONAL_KEYWORDS.includes(kw)) gapScore += 10;

    keywordCache.keywords[kw] = {
      keyword: kw,
      hasBlogPost: hasPost,
      gapScore,
      lastChecked: todayET(),
    };

    if (!hasPost) {
      opportunities.push({ keyword: kw, gapScore, category: DYE_KEYWORDS.includes(kw) ? "Dye" : SEASONAL_KEYWORDS.includes(kw) ? "Seasonal" : "Brand" });
    }
  }

  opportunities.sort((a, b) => b.gapScore - a.gapScore);
  keywordCache.lastScan = todayET();
  keywordCache.topOpportunities = opportunities.slice(0, 10);

  // LLM-powered analysis for deeper keyword insights
  const llmAnalysis = await analyzeSEOKeywordsWithLLM({
    organicPages: organicPages.slice(0, 20),
    opportunities: opportunities.slice(0, 15),
    existingPosts: blogPosts.slice(0, 30).map((p) => ({ slug: p.slug, title: p.title })),
  });
  if (llmAnalysis) {
    keywordCache.llmAnalysis = llmAnalysis;
    keywordCache.llmAnalysisDate = todayET();
  }

  safeJsonWrite(KEYWORD_CACHE_FILE, keywordCache);

  // Write top opportunities to Notion
  if (IDS.seoKeywords && !DRY_RUN) {
    for (const opp of opportunities.slice(0, 5)) {
      try {
        await engine.createPage(IDS.seoKeywords, {
          Keyword: { title: [{ text: { content: opp.keyword } }] },
          "Has Blog Post": { checkbox: false },
          "Content Gap Score": { number: opp.gapScore },
          Priority: { select: { name: opp.gapScore > 80 ? "High" : opp.gapScore > 50 ? "Medium" : "Low" } },
          "Last Checked": { date: { start: todayET() } },
        });
      } catch (err) { log(`S1 — Notion error: ${err.message}`); }
    }
  }

  log(`S1 — Done: ${opportunities.length} keyword gaps found, ${organicPages.length} organic pages tracked`);
  return engine.succeed("S1", { gaps: opportunities.length, organicPages: organicPages.length, topGap: opportunities[0]?.keyword || "none" });
}

// ── LLM: SEO Keyword Analyzer ────────────────────────────────────────────────

const SEO_KEYWORD_ANALYZER_FALLBACK = `You are an SEO strategist for USA Gummies, a dye-free American-made gummy bear brand. Given organic traffic data and keyword gaps, produce: (1) top 5 keyword opportunities ranked by search potential and brand fit, (2) content angle recommendation for each, (3) estimated difficulty level (Easy/Medium/Hard), (4) internal linking suggestions. Output JSON: {keyword_analysis: [{keyword, angle, difficulty, linking_suggestions, priority_score}], overall_strategy: string}`;

async function analyzeSEOKeywordsWithLLM(data) {
  const { organicPages, opportunities, existingPosts } = data || {};
  try {
    const versionedPrompt = await loadVersionedPrompt("seo_keyword_analyzer");
    const systemPrompt = versionedPrompt || SEO_KEYWORD_ANALYZER_FALLBACK;

    const userMessage = JSON.stringify({
      organic_pages: (organicPages || []).slice(0, 50),
      keyword_gaps: (opportunities || []).slice(0, 30),
      existing_blog_posts: (existingPosts || []).slice(0, 40),
    });

    const raw = await callLLM({
      system: systemPrompt,
      user: userMessage,
      temperature: 0.3,
      maxTokens: 1024,
    });

    return parseLLMJson(raw);
  } catch (err) {
    log(`analyzeSEOKeywordsWithLLM failed: ${err.message}`);
    return null;
  }
}

// ── S2: Content Gap Analyzer ─────────────────────────────────────────────────

async function runS2() {
  log("S2 — Content Gap Analyzer starting...");

  const keywordCache = safeJsonRead(KEYWORD_CACHE_FILE, { keywords: {}, topOpportunities: [] });
  const topOpps = keywordCache.topOpportunities || [];
  const serpCache = safeJsonRead(SERP_CACHE_FILE, {});

  if (topOpps.length === 0) {
    log("S2 — No keyword opportunities found. Run S1 first.");
    return engine.succeed("S2", { analyzed: 0 });
  }

  // Analyze top 3 keyword opportunities
  let analyzed = 0;
  for (const opp of topOpps.slice(0, 3)) {
    const kw = opp.keyword;

    // Cache check — don't re-analyze within 7 days
    if (serpCache[kw] && daysSince(serpCache[kw].lastChecked) < 7) continue;

    // Generate LLM-powered content brief for this keyword gap
    const llmBrief = await generateSEOContentBrief(kw, serpCache[kw] || {});

    serpCache[kw] = {
      keyword: kw,
      lastChecked: todayET(),
      recommendation: llmBrief?.cta_strategy || `Write a comprehensive post targeting "${kw}". Include: definition, health implications, alternatives, USA Gummies positioning.`,
      suggestedTitle: llmBrief?.titles?.[0] || `${kw.split(" ").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")}: What You Need to Know`,
      suggestedSlug: kw.replace(/\s+/g, "-").toLowerCase(),
      priority: opp.gapScore > 80 ? "High" : "Medium",
      llmBrief: llmBrief || null,
    };
    analyzed++;
    log(`S2 — Analyzed gap: "${kw}" (score: ${opp.gapScore})`);
  }

  safeJsonWrite(SERP_CACHE_FILE, serpCache);
  log(`S2 — Done: ${analyzed} keywords analyzed`);
  return engine.succeed("S2", { analyzed });
}

// ── LLM: SEO Content Brief Generator ─────────────────────────────────────────

const SEO_CONTENT_GAP_FALLBACK = `You are a content strategist for USA Gummies. Create a detailed blog post brief for the given keyword. Include: title options (3), meta description, H2 outline (5-8 sections), key points per section, CTA placement, internal link targets. Focus on the brand's strengths: dye-free, Made-in-USA, America 250. Output JSON: {titles: string[], meta_description: string, outline: [{heading, key_points: string[], word_count_target: number}], cta_strategy: string}`;

async function generateSEOContentBrief(keyword, serpData) {
  try {
    const versionedPrompt = await loadVersionedPrompt("seo_content_gap");
    const systemPrompt = versionedPrompt || SEO_CONTENT_GAP_FALLBACK;

    const userMessage = JSON.stringify({
      target_keyword: keyword,
      serp_analysis: serpData || {},
    });

    const raw = await callLLM({
      system: systemPrompt,
      user: userMessage,
      temperature: 0.4,
      maxTokens: 1500,
    });

    return parseLLMJson(raw);
  } catch (err) {
    log(`generateSEOContentBrief failed: ${err.message}`);
    return null;
  }
}

// ── S3: Blog Post Drafter ────────────────────────────────────────────────────

async function runS3() {
  log("S3 — Blog Post Drafter starting...");

  const serpCache = safeJsonRead(SERP_CACHE_FILE, {});
  const keywordCache = safeJsonRead(KEYWORD_CACHE_FILE, { keywords: {} });

  // Find highest priority unwritten keyword
  const candidates = Object.values(serpCache)
    .filter((s) => s.priority === "High" && !keywordCache.keywords[s.keyword]?.hasBlogPost)
    .sort((a, b) => (b.priority === "High" ? 1 : 0) - (a.priority === "High" ? 1 : 0));

  if (candidates.length === 0) {
    log("S3 — No high-priority drafts needed this week.");
    return engine.succeed("S3", { drafted: 0 });
  }

  const target = candidates[0];
  const openAiKey = process.env.OPENAI_API_KEY || "";
  if (!openAiKey) {
    const reason = "OPENAI_API_KEY missing — cannot generate draft";
    log(`S3 — ${reason}`);
    return engine.fail("S3", reason);
  }

  function chunks(text, max = 1800) {
    const out = [];
    for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
    return out.length ? out : [""];
  }

  const systemPrompt = [
    "You are writing for USA Gummies.",
    "Tone: patriotic, health-conscious, informative, evidence-aware, no hype.",
    "Output valid MDX only with YAML frontmatter.",
    "Target 800-1200 words.",
    "Include a CTA to /shop and at least 2 internal links to /blog/*.",
    "Do not include fabricated claims or unverifiable statistics.",
  ].join(" ");

  const userPrompt = [
    `Target keyword: ${target.keyword}`,
    `Title direction: ${target.suggestedTitle}`,
    `Slug direction: ${target.suggestedSlug}`,
    "Sections to include: definition, health implications, regulatory context, how to avoid dyes, alternatives, USA Gummies position, CTA.",
    "Return only MDX content.",
  ].join("\n");

  let mdx = "";
  try {
    const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    }, 60000);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${text.slice(0, 220)}`);
    }

    const json = await res.json();
    mdx = json?.choices?.[0]?.message?.content?.trim() || "";
    if (!mdx) throw new Error("OpenAI returned empty draft");
  } catch (err) {
    const reason = `Draft generation failed: ${err.message || err}`;
    log(`S3 — ${reason}`);
    return engine.fail("S3", reason);
  }

  const wordCount = mdx.split(/\s+/).filter(Boolean).length;
  const titleMatch = mdx.match(/title:\s*"?([^\n"]+)"?/i);
  const slugMatch = mdx.match(/slug:\s*"?([^\n"]+)"?/i);
  const finalTitle = (titleMatch?.[1] || target.suggestedTitle || `USA Gummies — ${target.keyword}`).trim();
  const finalSlug = ((slugMatch?.[1] || target.suggestedSlug || target.keyword).trim().toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-"));

  if (IDS.contentDrafts && !DRY_RUN) {
    try {
      await engine.createPage(IDS.contentDrafts, {
        Title: { title: [{ text: { content: finalTitle } }] },
        "Target Keyword": { rich_text: [{ text: { content: target.keyword } }] },
        Slug: { rich_text: [{ text: { content: finalSlug } }] },
        Status: { select: { name: "Draft" } },
        "SEO Score": { number: Math.min(100, Math.max(55, Math.round(target.gapScore || 70))) },
        "Word Count": { number: wordCount },
        Author: { rich_text: [{ text: { content: "SEO Engine (GPT-4o-mini)" } }] },
        "Generated At": { date: { start: todayET() } },
        Body: { rich_text: chunks(mdx).map((chunk) => ({ text: { content: chunk } })) },
      });
    } catch (err) {
      log(`S3 — Notion content drafts write failed: ${err.message}`);
    }
  } else if (IDS.seoCalendar && !DRY_RUN) {
    // Fallback to existing calendar DB when content drafts DB is not yet configured.
    try {
      await engine.createPage(IDS.seoCalendar, {
        Title: { title: [{ text: { content: finalTitle } }] },
        "Target Keyword": { rich_text: [{ text: { content: target.keyword } }] },
        Status: { select: { name: "Drafted" } },
        "MDX Slug": { rich_text: [{ text: { content: finalSlug } }] },
        Author: { rich_text: [{ text: { content: "SEO Engine (GPT-4o-mini)" } }] },
        "Word Count": { number: wordCount },
      });
    } catch (err) {
      log(`S3 — Notion fallback write failed: ${err.message}`);
    }
  }

  if (!DRY_RUN) {
    textBen(`📝 SEO Engine: New GPT draft ready for review\n"${finalTitle}"\nKeyword: ${target.keyword}\nWord count: ${wordCount}\nCheck Notion Content Drafts.`).catch(() => {});
  }

  log(`S3 — Done: Generated full draft for "${finalTitle}"`);
  return engine.succeed("S3", { drafted: 1, keyword: target.keyword, title: finalTitle, wordCount });
}

// ── S4: Internal Link Optimizer ──────────────────────────────────────────────

async function runS4() {
  log("S4 — Internal Link Optimizer starting...");

  const posts = getExistingBlogPosts();
  const suggestions = [];

  // Build keyword → post mapping
  const postsByTopic = {};
  for (const post of posts) {
    const keywords = [
      ...(post.tags || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
      ...post.title.toLowerCase().split(/\s+/).filter((w) => w.length > 4),
    ];
    for (const kw of keywords) {
      if (!postsByTopic[kw]) postsByTopic[kw] = [];
      postsByTopic[kw].push(post);
    }
  }

  // Find cross-linking opportunities
  for (const post of posts) {
    if (post.internalLinks >= 3) continue; // Already well-linked

    const postContent = (() => {
      try { return fs.readFileSync(path.join(BLOG_DIR, post.file), "utf8").toLowerCase(); }
      catch { return ""; }
    })();

    for (const other of posts) {
      if (other.slug === post.slug) continue;

      // Check if the other post's title keywords appear in this post's content
      const otherWords = other.title.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
      const matchCount = otherWords.filter((w) => postContent.includes(w)).length;

      if (matchCount >= 2) {
        // Check if link already exists
        if (postContent.includes(`/blog/${other.slug}`)) continue;

        suggestions.push({
          source: post.slug,
          target: other.slug,
          targetTitle: other.title,
          matchStrength: matchCount,
          anchorText: other.title,
        });
      }
    }
  }

  suggestions.sort((a, b) => b.matchStrength - a.matchStrength);
  const topSuggestions = suggestions.slice(0, 15);

  // Write suggestions to Notion
  if (IDS.seoLinks && !DRY_RUN) {
    for (const sug of topSuggestions.slice(0, 5)) {
      try {
        await engine.createPage(IDS.seoLinks, {
          "Source Post": { title: [{ text: { content: sug.source } }] },
          "Target Post": { rich_text: [{ text: { content: sug.target } }] },
          "Anchor Text": { rich_text: [{ text: { content: sug.anchorText } }] },
          Applied: { checkbox: false },
        });
      } catch (err) { log(`S4 — Notion error: ${err.message}`); }
    }
  }

  log(`S4 — Done: ${topSuggestions.length} link opportunities found`);
  return engine.succeed("S4", { suggestions: topSuggestions.length, totalPosts: posts.length });
}

// ── S5: Blog Performance Tracker ─────────────────────────────────────────────

async function runS5() {
  log("S5 — Blog Performance Tracker starting...");

  const dateRange = [{ startDate: "7daysAgo", endDate: "yesterday" }];
  const res = await ga4Report(
    ["pagePath"],
    ["sessions", "bounceRate", "averageSessionDuration", "conversions"],
    dateRange,
    { filter: { fieldName: "pagePath", stringFilter: { matchType: "BEGINS_WITH", value: "/blog/" } } }
  );

  if (!res.ok) {
    log(`S5 — GA4 error: ${res.error}`);
    return engine.fail("S5", res.error);
  }

  const rows = res.data?.rows || [];
  const blogPerf = [];

  for (const row of rows) {
    const pagePath = row.dimensionValues?.[0]?.value || "";
    const sessions = parseInt(row.metricValues?.[0]?.value || "0");
    const bounceRate = parseFloat(row.metricValues?.[1]?.value || "0");
    const avgTime = parseFloat(row.metricValues?.[2]?.value || "0");
    const conversions = parseInt(row.metricValues?.[3]?.value || "0");

    if (sessions < 1) continue;

    blogPerf.push({ path: pagePath, sessions, bounceRate: Math.round(bounceRate * 100) / 100, avgTime: Math.round(avgTime), conversions });
  }

  blogPerf.sort((a, b) => b.sessions - a.sessions);

  // Write to Notion
  if (IDS.seoBlogPerf && !DRY_RUN) {
    for (const perf of blogPerf.slice(0, 20)) {
      try {
        await engine.createPage(IDS.seoBlogPerf, {
          "Blog Post": { title: [{ text: { content: perf.path } }] },
          Date: { date: { start: todayET() } },
          Sessions: { number: perf.sessions },
          "Bounce Rate": { number: perf.bounceRate },
          "Avg Time": { number: perf.avgTime },
          "Shop Conversions": { number: perf.conversions },
        });
      } catch (err) { log(`S5 — Notion error: ${err.message}`); }
    }
  }

  // Flag underperformers (high bounce, low time)
  const underperformers = blogPerf.filter((p) => p.bounceRate > 0.75 && p.sessions > 5);
  if (underperformers.length > 0) {
    log(`S5 — ${underperformers.length} underperforming posts (>75% bounce): ${underperformers.map((p) => p.path).join(", ")}`);
  }

  log(`S5 — Done: ${blogPerf.length} blog posts tracked`);
  return engine.succeed("S5", { tracked: blogPerf.length, topPost: blogPerf[0]?.path || "none", underperformers: underperformers.length });
}

// ── S6: Featured Snippet Optimizer ───────────────────────────────────────────

async function runS6() {
  log("S6 — Featured Snippet Optimizer starting...");

  const posts = getExistingBlogPosts();
  const suggestions = [];

  for (const post of posts) {
    const content = (() => {
      try { return fs.readFileSync(path.join(BLOG_DIR, post.file), "utf8"); }
      catch { return ""; }
    })();

    // Check for FAQ-style content (questions in headings)
    const hasQuestions = (content.match(/^##\s+.+\?/gm) || []).length;
    // Check for list content (good for featured snippets)
    const hasLists = (content.match(/^[-*]\s+/gm) || []).length;
    // Check for definition patterns
    const hasDefinitions = (content.match(/\*\*[A-Z].+\*\*\s*[—–:]/g) || []).length;

    let snippetScore = 0;
    const recommendations = [];

    if (hasQuestions < 2) {
      recommendations.push("Add FAQ-style headings (## What is...? ## How does...?)");
      snippetScore += 20;
    }
    if (hasLists < 3 && post.wordCount > 500) {
      recommendations.push("Add bulleted/numbered lists for key points");
      snippetScore += 15;
    }
    if (hasDefinitions < 1) {
      recommendations.push("Add a clear definition paragraph at the top (direct answer format)");
      snippetScore += 25;
    }

    // Check for JSON-LD FAQ schema
    const hasFAQSchema = content.includes("FAQPage") || content.includes("faqSchema");
    if (!hasFAQSchema && hasQuestions >= 2) {
      recommendations.push("Add FAQPage JSON-LD schema (has question headings but no schema)");
      snippetScore += 30;
    }

    if (recommendations.length > 0) {
      suggestions.push({
        post: post.slug,
        title: post.title,
        snippetScore,
        recommendations,
      });
    }
  }

  suggestions.sort((a, b) => b.snippetScore - a.snippetScore);

  log(`S6 — Done: ${suggestions.length} posts need snippet optimization`);
  if (suggestions.length > 0) {
    log(`S6 — Top priority: "${suggestions[0].title}" — ${suggestions[0].recommendations.join("; ")}`);
  }

  return engine.succeed("S6", { postsAnalyzed: posts.length, needsWork: suggestions.length });
}

// ── S7: Sitemap & Schema Validator ───────────────────────────────────────────

async function runS7() {
  log("S7 — Sitemap & Schema Validator starting...");

  const posts = getExistingBlogPosts();
  const issues = [];

  // Check sitemap exists
  try {
    const sitemapRes = await fetchWithTimeout("https://www.usagummies.com/sitemap.xml", {}, 10000);
    if (sitemapRes.ok) {
      const sitemapText = await sitemapRes.text();
      // Check each blog post is in sitemap
      for (const post of posts) {
        if (!sitemapText.includes(`/blog/${post.slug}`)) {
          issues.push({ type: "missing_from_sitemap", post: post.slug });
        }
      }
      log(`S7 — Sitemap check: ${posts.length - issues.filter((i) => i.type === "missing_from_sitemap").length}/${posts.length} posts found`);
    } else {
      issues.push({ type: "sitemap_error", detail: `HTTP ${sitemapRes.status}` });
    }
  } catch (err) {
    issues.push({ type: "sitemap_error", detail: err.message });
    log(`S7 — Sitemap fetch error: ${err.message}`);
  }

  // Check key pages for JSON-LD schema
  const pagesToCheck = [
    { url: "https://www.usagummies.com/", expected: ["Organization", "WebSite"] },
    { url: "https://www.usagummies.com/shop", expected: ["Product"] },
  ];

  for (const page of pagesToCheck) {
    try {
      const res = await fetchWithTimeout(page.url, {}, 10000);
      if (res.ok) {
        const html = await res.text();
        for (const schema of page.expected) {
          if (!html.includes(`"@type":"${schema}"`) && !html.includes(`"@type": "${schema}"`)) {
            issues.push({ type: "missing_schema", url: page.url, schema });
          }
        }
      }
    } catch (err) {
      log(`S7 — Schema check error for ${page.url}: ${err.message}`);
    }
  }

  if (issues.length > 0 && !DRY_RUN) {
    textBen(`🔍 SEO Validator: ${issues.length} issues found\n${issues.slice(0, 5).map((i) => `• ${i.type}: ${i.post || i.url || i.detail || ""}`).join("\n")}`);
  }

  log(`S7 — Done: ${issues.length} issues found`);
  return engine.succeed("S7", { issues: issues.length, postsChecked: posts.length });
}

// ── S8: Content Calendar Manager ─────────────────────────────────────────────

async function runS8() {
  log("S8 — Content Calendar Manager starting...");

  const keywordCache = safeJsonRead(KEYWORD_CACHE_FILE, { topOpportunities: [] });
  const serpCache = safeJsonRead(SERP_CACHE_FILE, {});
  const posts = getExistingBlogPosts();

  // Build 30-day content plan
  const today = new Date(todayET() + "T12:00:00Z");
  const plan = [];

  // Priority 1: Top keyword gaps
  const gaps = (keywordCache.topOpportunities || []).slice(0, 4);
  for (let i = 0; i < gaps.length; i++) {
    const publishDate = new Date(today);
    publishDate.setUTCDate(publishDate.getUTCDate() + (i + 1) * 7); // Weekly cadence
    const dateStr = publishDate.toISOString().slice(0, 10);

    const serpData = serpCache[gaps[i].keyword] || {};
    plan.push({
      title: serpData.suggestedTitle || `Post about: ${gaps[i].keyword}`,
      keyword: gaps[i].keyword,
      publishDate: dateStr,
      status: "Idea",
      priority: gaps[i].gapScore > 80 ? "High" : "Medium",
    });
  }

  // Write calendar to Notion
  if (IDS.seoCalendar && !DRY_RUN) {
    for (const entry of plan) {
      try {
        await engine.createPage(IDS.seoCalendar, {
          Title: { title: [{ text: { content: entry.title } }] },
          "Target Keyword": { rich_text: [{ text: { content: entry.keyword } }] },
          "Publish Date": { date: { start: entry.publishDate } },
          Status: { select: { name: entry.status } },
        });
      } catch (err) { log(`S8 — Notion error: ${err.message}`); }
    }
  }

  log(`S8 — Done: ${plan.length} entries in 30-day content plan`);
  return engine.succeed("S8", { planned: plan.length, existingPosts: posts.length });
}

// ── S9: Self-Heal Monitor ────────────────────────────────────────────────────

async function runS9() {
  return engine.runSelfHeal("S9", AGENT_REGISTRY);
}

// ══════════════════════════════════════════════════════════════════════════════
//  REGISTRY & CLI
// ══════════════════════════════════════════════════════════════════════════════

const AGENT_REGISTRY = {
  S1: { name: "Keyword Opportunity Scanner", fn: runS1, schedule: SCHEDULE_PLAN.S1 },
  S2: { name: "Content Gap Analyzer", fn: runS2, schedule: SCHEDULE_PLAN.S2 },
  S3: { name: "Blog Post Drafter", fn: runS3, schedule: SCHEDULE_PLAN.S3 },
  S4: { name: "Internal Link Optimizer", fn: runS4, schedule: SCHEDULE_PLAN.S4 },
  S5: { name: "Blog Performance Tracker", fn: runS5, schedule: SCHEDULE_PLAN.S5 },
  S6: { name: "Featured Snippet Optimizer", fn: runS6, schedule: SCHEDULE_PLAN.S6 },
  S7: { name: "Sitemap & Schema Validator", fn: runS7, schedule: SCHEDULE_PLAN.S7 },
  S8: { name: "Content Calendar Manager", fn: runS8, schedule: SCHEDULE_PLAN.S8 },
  S9: { name: "Self-Heal Monitor", fn: runS9, schedule: SCHEDULE_PLAN.S9 },
};

async function runAgentByName(name) {
  const key = name.toUpperCase();
  if (key === "SELF-HEAL") return runS9();
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
    if (s === "Every 30 min") { toRun.push(key); continue; }
    const dm = s.match(/Daily (\d+):(\d+)\s*(AM|PM)/);
    if (dm) {
      let h = parseInt(dm[1]);
      if (dm[3] === "PM" && h !== 12) h += 12;
      if (dm[3] === "AM" && h === 12) h = 0;
      if (h === hour && Math.abs(minute - parseInt(dm[2])) < 5) toRun.push(key);
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
  console.log(`USA Gummies SEO Content Domination System (Build 4)
${"═".repeat(52)}

Commands:
  run <agent>      Run a specific agent (S1-S9)
  run all          Run all scheduled agents for current time
  run self-heal    Run the self-heal monitor
  status           Show system status JSON
  help             Show this help

Options:
  --dry-run        Preview actions without making changes
  --source <src>   Override run source label

Agents:
  S1   Keyword Opportunity Scanner     ${SCHEDULE_PLAN.S1}
  S2   Content Gap Analyzer            ${SCHEDULE_PLAN.S2}
  S3   Blog Post Drafter               ${SCHEDULE_PLAN.S3}
  S4   Internal Link Optimizer         ${SCHEDULE_PLAN.S4}
  S5   Blog Performance Tracker        ${SCHEDULE_PLAN.S5}
  S6   Featured Snippet Optimizer      ${SCHEDULE_PLAN.S6}
  S7   Sitemap & Schema Validator      ${SCHEDULE_PLAN.S7}
  S8   Content Calendar Manager        ${SCHEDULE_PLAN.S8}
  S9   Self-Heal Monitor               ${SCHEDULE_PLAN.S9}

Blog Posts Dir: ${BLOG_DIR}
Target Keyword Clusters: Dye (${DYE_KEYWORDS.length}), Seasonal (${SEASONAL_KEYWORDS.length}), Brand (${BRAND_KEYWORDS.length})

Examples:
  node scripts/usa-gummies-seo-engine.mjs run S1     # scan keywords
  node scripts/usa-gummies-seo-engine.mjs --dry-run run S5
  node scripts/usa-gummies-seo-engine.mjs run all
  node scripts/usa-gummies-seo-engine.mjs status`);
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
  const status = engine.loadSystemStatus();
  console.log(JSON.stringify(status, null, 2));
} else {
  console.error(`Unknown command: ${cmd}. Try 'help'.`);
  process.exit(1);
}
