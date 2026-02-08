import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const BASE_URL = "https://www.usagummies.com";
const JSON_PATH = path.join(ROOT, "docs/seo/seo-meta.json");
const CSV_PATH = path.join(ROOT, "docs/seo/seo-meta.csv");
const SITEMAP_PATH = path.join(ROOT, "src/app/sitemap.ts");
const TITLE_MAX = 60;
const DESCRIPTION_MAX = 155;
const BLOG_DESCRIPTION_KEYWORDS = [
  "dye-free",
  "no artificial dyes",
  "made in usa",
  "patriotic",
];

function fail(message) {
  console.error(`[seo-meta] ${message}`);
  process.exit(1);
}

function normalizeUrl(value) {
  const url = (value || "").trim();
  if (!url) return url;
  if (url.endsWith("/") && url !== `${BASE_URL}/`) return url.slice(0, -1);
  return url;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        i += 1;
        continue;
      }
      if (char === "\"") {
        inQuotes = false;
        continue;
      }
      field += char;
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field);
      if (row.some((cell) => cell.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim().length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function readJsonMeta() {
  if (!fs.existsSync(JSON_PATH)) {
    fail(`Missing JSON meta file: ${JSON_PATH}`);
  }
  const raw = fs.readFileSync(JSON_PATH, "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    fail(`Invalid JSON in ${JSON_PATH}: ${error.message}`);
  }
  if (!Array.isArray(data)) {
    fail(`Expected JSON array in ${JSON_PATH}`);
  }
  return data;
}

function readCsvMeta() {
  if (!fs.existsSync(CSV_PATH)) {
    fail(`Missing CSV meta file: ${CSV_PATH}`);
  }
  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(raw);
  if (!rows.length) {
    fail(`Empty CSV file: ${CSV_PATH}`);
  }
  const header = rows[0].map((cell) => cell.trim());
  if (header.join(",") !== "url,title,description") {
    fail(`CSV header must be "url,title,description" in ${CSV_PATH}`);
  }
  return rows.slice(1).map((row) => ({
    url: normalizeUrl(row[0] || ""),
    title: (row[1] || "").trim(),
    description: (row[2] || "").trim(),
  }));
}

function extractIndexableUrls() {
  if (!fs.existsSync(SITEMAP_PATH)) {
    fail(`Missing sitemap: ${SITEMAP_PATH}`);
  }
  const raw = fs.readFileSync(SITEMAP_PATH, "utf8");
  const matches = [...raw.matchAll(/url:\s*`\$\{base\}([^`]+)`/g)];
  const paths = new Set();

  for (const match of matches) {
    const pathPart = match[1];
    if (!pathPart) continue;
    const mapped = mapDynamicPath(pathPart);
    if (!mapped) continue;
    paths.add(mapped);
  }

  return [...paths].map((pathPart) => normalizeUrl(`${BASE_URL}${pathPart}`));
}

function mapDynamicPath(pathPart) {
  if (!pathPart.includes("${")) return pathPart;
  if (pathPart.startsWith("/products/")) return "/products/[handle]";
  if (pathPart.startsWith("/collections/")) return "/collections/[handle]";
  if (pathPart.startsWith("/pages/")) return "/pages/[handle]";
  if (pathPart.startsWith("/blog/page/")) return "/blog/page/[page]";
  if (pathPart.startsWith("/blog/category/")) {
    if (pathPart.includes("/page/")) return "/blog/category/[slug]/page/[page]";
    return "/blog/category/[slug]";
  }
  if (pathPart.startsWith("/blog/tag/")) {
    if (pathPart.includes("/page/")) return "/blog/tag/[slug]/page/[page]";
    return "/blog/tag/[slug]";
  }
  if (pathPart.startsWith("/blog/author/")) {
    if (pathPart.includes("/page/")) return "/blog/author/[slug]/page/[page]";
    return "/blog/author/[slug]";
  }
  if (pathPart.startsWith("/blog/")) return "/blog/[slug]";
  return null;
}

const jsonMeta = readJsonMeta().map((entry) => ({
  url: normalizeUrl(entry.url || ""),
  title: (entry.title || "").trim(),
  description: (entry.description || "").trim(),
}));
const csvMeta = readCsvMeta();

const jsonByUrl = new Map();
for (const entry of jsonMeta) {
  if (!entry.url) {
    fail("JSON meta entry missing url.");
  }
  if (!entry.title) {
    fail(`JSON meta entry missing title for ${entry.url}`);
  }
  if (!entry.description) {
    fail(`JSON meta entry missing description for ${entry.url}`);
  }
  if (entry.title.length > TITLE_MAX) {
    fail(`Title exceeds ${TITLE_MAX} chars for ${entry.url}`);
  }
  if (entry.description.length > DESCRIPTION_MAX) {
    fail(`Description exceeds ${DESCRIPTION_MAX} chars for ${entry.url}`);
  }
  if (jsonByUrl.has(entry.url)) {
    fail(`Duplicate JSON meta entry for ${entry.url}`);
  }
  jsonByUrl.set(entry.url, entry);
}

const requiredBlogTemplates = [
  `${BASE_URL}/blog`,
  `${BASE_URL}/blog/[slug]`,
  `${BASE_URL}/blog/page/[page]`,
  `${BASE_URL}/blog/category/[slug]`,
  `${BASE_URL}/blog/category/[slug]/page/[page]`,
  `${BASE_URL}/blog/tag/[slug]`,
  `${BASE_URL}/blog/tag/[slug]/page/[page]`,
  `${BASE_URL}/blog/author/[slug]`,
  `${BASE_URL}/blog/author/[slug]/page/[page]`,
];

const missingBlogTemplates = requiredBlogTemplates.filter((url) => !jsonByUrl.has(url));
if (missingBlogTemplates.length) {
  fail(`Missing blog meta entries:\n${missingBlogTemplates.join("\n")}`);
}

const blogPatternIssues = [];
const blogIndex = jsonByUrl.get(`${BASE_URL}/blog`);
const blogPostTemplate = jsonByUrl.get(`${BASE_URL}/blog/[slug]`);
const blogCategoryTemplate = jsonByUrl.get(`${BASE_URL}/blog/category/[slug]`);
const blogTagTemplate = jsonByUrl.get(`${BASE_URL}/blog/tag/[slug]`);
const blogAuthorTemplate = jsonByUrl.get(`${BASE_URL}/blog/author/[slug]`);

if (blogIndex) {
  if (blogIndex.title !== "Blog | USA Gummies") {
    blogPatternIssues.push(`Blog index title must equal "Blog | USA Gummies" for ${blogIndex.url}`);
  }
  const blogDescLower = blogIndex.description.toLowerCase();
  if (!blogDescLower.includes("dye-free") || !blogDescLower.includes("made in usa")) {
    blogPatternIssues.push(
      `Blog index description must include "dye-free" and "made in USA" for ${blogIndex.url}`
    );
  }
}

if (blogPostTemplate) {
  if (!blogPostTemplate.title.startsWith("[Post Title] |")) {
    blogPatternIssues.push(`Blog post title must start with "[Post Title] |" for ${blogPostTemplate.url}`);
  }
  if (!blogPostTemplate.title.endsWith("| USA Gummies")) {
    blogPatternIssues.push(`Blog post title must end with "| USA Gummies" for ${blogPostTemplate.url}`);
  }
  const postDescLower = blogPostTemplate.description.toLowerCase();
  const hasKeyword = BLOG_DESCRIPTION_KEYWORDS.some((keyword) => postDescLower.includes(keyword));
  if (!hasKeyword) {
    blogPatternIssues.push(
      `Blog post description must include one of: ${BLOG_DESCRIPTION_KEYWORDS.join(", ")} for ${blogPostTemplate.url}`
    );
  }
}

if (blogCategoryTemplate) {
  if (!blogCategoryTemplate.title.includes("Category")) {
    blogPatternIssues.push(`Blog category title must include "Category" for ${blogCategoryTemplate.url}`);
  }
  if (!blogCategoryTemplate.title.includes("| USA Gummies")) {
    blogPatternIssues.push(`Blog category title must include "| USA Gummies" for ${blogCategoryTemplate.url}`);
  }
}

if (blogTagTemplate) {
  if (!blogTagTemplate.title.includes("Tag")) {
    blogPatternIssues.push(`Blog tag title must include "Tag" for ${blogTagTemplate.url}`);
  }
  if (!blogTagTemplate.title.includes("| USA Gummies")) {
    blogPatternIssues.push(`Blog tag title must include "| USA Gummies" for ${blogTagTemplate.url}`);
  }
}

if (blogAuthorTemplate) {
  if (!blogAuthorTemplate.title.includes("Author")) {
    blogPatternIssues.push(`Blog author title must include "Author" for ${blogAuthorTemplate.url}`);
  }
  if (!blogAuthorTemplate.title.includes("| USA Gummies")) {
    blogPatternIssues.push(`Blog author title must include "| USA Gummies" for ${blogAuthorTemplate.url}`);
  }
}

if (blogPatternIssues.length) {
  fail(`Blog metadata pattern errors:\n${blogPatternIssues.join("\n")}`);
}

const csvByUrl = new Map();
for (const entry of csvMeta) {
  if (!entry.url) {
    fail("CSV meta entry missing url.");
  }
  if (csvByUrl.has(entry.url)) {
    fail(`Duplicate CSV meta entry for ${entry.url}`);
  }
  csvByUrl.set(entry.url, entry);
}

const csvMismatches = [];
for (const [url, entry] of jsonByUrl.entries()) {
  const csvEntry = csvByUrl.get(url);
  if (!csvEntry) {
    csvMismatches.push(`Missing CSV row for ${url}`);
    continue;
  }
  if (csvEntry.title !== entry.title || csvEntry.description !== entry.description) {
    csvMismatches.push(`CSV mismatch for ${url}`);
  }
}
for (const url of csvByUrl.keys()) {
  if (!jsonByUrl.has(url)) {
    csvMismatches.push(`CSV has extra row not in JSON: ${url}`);
  }
}
if (csvMismatches.length) {
  fail(`CSV must match JSON source-of-truth.\\n${csvMismatches.join("\\n")}`);
}

const indexableUrls = extractIndexableUrls();
const missingMeta = [];

for (const url of indexableUrls) {
  const entry = jsonByUrl.get(url);
  if (!entry) {
    missingMeta.push(`Missing meta for ${url}`);
    continue;
  }
  if (!entry.title) {
    missingMeta.push(`Missing title for ${url}`);
  }
  if (!entry.description) {
    missingMeta.push(`Missing description for ${url}`);
  }
}

if (missingMeta.length) {
  fail(`Indexable pages missing metadata:\\n${missingMeta.join("\\n")}`);
}

console.log(`[seo-meta] OK (${indexableUrls.length} indexable URLs validated).`);
