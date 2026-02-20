#!/usr/bin/env node
/**
 * directory-submit.mjs — Submit USA Gummies to free business directories
 *
 * Sends email submissions to free directories that accept email-based listings.
 * Tracks which directories have been submitted to avoid duplicates.
 *
 * Already submitted (via day-0 batch): AAM, All American, Made in USA Product,
 * b4USA, Crunchbase, F6S, Bing Places, RangeMe, MapQuest
 *
 * Usage:
 *   node scripts/directory-submit.mjs              # Submit to next batch
 *   node scripts/directory-submit.mjs --dry-run     # Preview without sending
 *   node scripts/directory-submit.mjs --status      # Show submission status
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const HOME = process.env.HOME || "/Users/ben";
const STATUS_FILE = path.join(HOME, ".config/usa-gummies-mcp/directory-submissions.json");
const SEND_SCRIPT = path.join(HOME, ".openclaw/workspace/scripts/send-email.sh");

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ── Company info ─────────────────────────────────────────────────────
const COMPANY_INFO = {
  name: "USA Gummies",
  website: "https://www.usagummies.com",
  amazon: "https://www.amazon.com/dp/B0G1JK92TJ",
  description:
    "USA Gummies makes premium All-American Gummy Bears with natural colors from fruit and vegetable extracts — no artificial dyes, no Red 40, no Yellow 5. Made in Indiana, packed in Pennsylvania. FDA-registered facility.",
  shortDescription:
    "Premium dye-free gummy bears made in the USA with natural colors from real fruits and vegetables.",
  category: "Food & Beverage / Candy / Confectionery",
  naics: "311340",
  sic: "2064",
  products: "All-American Gummy Bears (7.5 oz bags, dye-free, natural colors)",
  founded: "2024",
  companyState: "Wyoming",
  manufacturingState: "Indiana",
  packingState: "Pennsylvania",
  email: "marketing@usagummies.com",
  contactName: "Ben",
  phone: "",
  social: {
    instagram: "https://www.instagram.com/usagummies",
    tiktok: "https://www.tiktok.com/@usagummies",
    pinterest: "https://www.pinterest.com/usagummies",
  },
};

// ── Directory targets ────────────────────────────────────────────────
// Each target has an email and a custom body template
const DIRECTORIES = [
  {
    id: "thomasnet",
    name: "ThomasNet",
    email: "info@thomasnet.com",
    subject: "New manufacturer listing request — USA Gummies (food/confectionery)",
    body: `Hi ThomasNet team,

I'd like to register USA Gummies on your platform as a US-based food manufacturer.

Company: ${COMPANY_INFO.name}
Website: ${COMPANY_INFO.website}
Category: ${COMPANY_INFO.category}
NAICS: ${COMPANY_INFO.naics}
Product: ${COMPANY_INFO.products}
Manufacturing Location: ${COMPANY_INFO.manufacturingState}
Description: ${COMPANY_INFO.shortDescription}

Please let me know what information you need to complete our listing.

Best,
${COMPANY_INFO.contactName}
${COMPANY_INFO.email}`,
  },
  {
    id: "manta",
    name: "Manta",
    email: "support@manta.com",
    subject: "Business listing request — USA Gummies",
    body: `Hi Manta team,

I'd like to add our small business to your directory.

Company: ${COMPANY_INFO.name}
Website: ${COMPANY_INFO.website}
Category: ${COMPANY_INFO.category}
Location: ${COMPANY_INFO.companyState}
Founded: ${COMPANY_INFO.founded}
Description: ${COMPANY_INFO.shortDescription}

Happy to provide any additional details needed.

Best,
${COMPANY_INFO.contactName}
${COMPANY_INFO.email}`,
  },
  {
    id: "chamber-commerce",
    name: "US Chamber of Commerce",
    email: "membership@uschamber.com",
    subject: "Small business listing inquiry — USA Gummies (food manufacturer)",
    body: `Hi US Chamber team,

I'm the founder of USA Gummies, a small American food manufacturer producing dye-free gummy bears. We make everything in Indiana with natural colors from fruit and vegetable extracts.

I'd love to explore listing our company in the Chamber's business directory.

Website: ${COMPANY_INFO.website}
Product: ${COMPANY_INFO.products}
Manufacturing: ${COMPANY_INFO.manufacturingState}
Category: ${COMPANY_INFO.category}

Please let me know the process for small business membership or listings.

Best,
${COMPANY_INFO.contactName}
${COMPANY_INFO.name}
${COMPANY_INFO.email}`,
  },
  {
    id: "score-mentor",
    name: "SCORE",
    email: "help@score.org",
    subject: "Small business resource listing — USA Gummies",
    body: `Hi SCORE team,

I'm the founder of USA Gummies, a small American candy company making dye-free gummy bears in Indiana. We'd love to be listed in your small business resources and connect with SCORE mentors if applicable.

Company: ${COMPANY_INFO.name}
Website: ${COMPANY_INFO.website}
Founded: ${COMPANY_INFO.founded}
Category: ${COMPANY_INFO.category}
Description: ${COMPANY_INFO.shortDescription}

Thank you for supporting small businesses!

Best,
${COMPANY_INFO.contactName}
${COMPANY_INFO.email}`,
  },
  {
    id: "hotfrog",
    name: "Hotfrog",
    email: "support@hotfrog.com",
    subject: "New business listing — USA Gummies (food & beverage)",
    body: `Hi Hotfrog team,

I'd like to create a free listing for our food company.

Company: ${COMPANY_INFO.name}
Website: ${COMPANY_INFO.website}
Category: ${COMPANY_INFO.category}
Location: ${COMPANY_INFO.companyState}
Description: ${COMPANY_INFO.shortDescription}

Please let me know the next steps for creating our listing.

Best,
${COMPANY_INFO.contactName}
${COMPANY_INFO.email}`,
  },
  {
    id: "yellowpages",
    name: "YellowPages / YP.com",
    email: "customercare@yp.com",
    subject: "Free business listing request — USA Gummies",
    body: `Hi YellowPages team,

I'd like to add our business to your directory.

Business Name: ${COMPANY_INFO.name}
Website: ${COMPANY_INFO.website}
Category: ${COMPANY_INFO.category}
SIC Code: ${COMPANY_INFO.sic}
Email: ${COMPANY_INFO.email}
Description: ${COMPANY_INFO.shortDescription}

Please let me know how to complete our free listing.

Best,
${COMPANY_INFO.contactName}
${COMPANY_INFO.email}`,
  },
  {
    id: "bbb",
    name: "Better Business Bureau",
    email: "info@council.bbb.org",
    subject: "Business listing inquiry — USA Gummies (food manufacturer)",
    body: `Hi BBB team,

I'm the founder of USA Gummies, a food manufacturer producing dye-free gummy bears in Indiana. I'd like to inquire about listing our company with the BBB.

Company: ${COMPANY_INFO.name}
Website: ${COMPANY_INFO.website}
Category: ${COMPANY_INFO.category}
Manufacturing: ${COMPANY_INFO.manufacturingState}
Founded: ${COMPANY_INFO.founded}
Description: ${COMPANY_INFO.shortDescription}

Please let me know the process and any requirements.

Best,
${COMPANY_INFO.contactName}
${COMPANY_INFO.email}`,
  },
  {
    id: "spoke",
    name: "Spoke.com",
    email: "support@spoke.com",
    subject: "Company listing request — USA Gummies",
    body: `Hi Spoke team,

I'd like to add our company to your business directory.

Company: ${COMPANY_INFO.name}
Website: ${COMPANY_INFO.website}
Category: ${COMPANY_INFO.category}
Founded: ${COMPANY_INFO.founded}
Description: ${COMPANY_INFO.shortDescription}

Best,
${COMPANY_INFO.contactName}
${COMPANY_INFO.email}`,
  },
  {
    id: "sba-resource",
    name: "SBA Resource Partners",
    email: "answerdesk@sba.gov",
    subject: "Small business resource inquiry — USA Gummies (food manufacturer)",
    body: `Hi SBA team,

I'm the founder of USA Gummies, a small food manufacturing company producing dye-free gummy bears in Indiana using natural colors. We'd love to be connected with SBA resource partners and any applicable directory listings for small manufacturers.

Company: ${COMPANY_INFO.name}
Website: ${COMPANY_INFO.website}
Founded: ${COMPANY_INFO.founded}
Category: ${COMPANY_INFO.category}
Manufacturing Location: ${COMPANY_INFO.manufacturingState}
Description: ${COMPANY_INFO.shortDescription}

Thank you for supporting small businesses.

Best,
${COMPANY_INFO.contactName}
${COMPANY_INFO.email}`,
  },
  {
    id: "superpages",
    name: "Superpages",
    email: "customerservice@superpages.com",
    subject: "Free listing request — USA Gummies",
    body: `Hi Superpages team,

I'd like to create a free listing for our business.

Company: ${COMPANY_INFO.name}
Website: ${COMPANY_INFO.website}
Category: ${COMPANY_INFO.category}
Email: ${COMPANY_INFO.email}
Description: ${COMPANY_INFO.shortDescription}

Best,
${COMPANY_INFO.contactName}
${COMPANY_INFO.email}`,
  },
  {
    id: "brownbook",
    name: "Brownbook.net",
    email: "info@brownbook.net",
    subject: "Business listing request — USA Gummies (USA food company)",
    body: `Hi Brownbook team,

I'd like to add our food company to your global business directory.

Company: ${COMPANY_INFO.name}
Website: ${COMPANY_INFO.website}
Country: United States
Category: ${COMPANY_INFO.category}
Description: ${COMPANY_INFO.shortDescription}

Best,
${COMPANY_INFO.contactName}
${COMPANY_INFO.email}`,
  },
  {
    id: "cylex",
    name: "Cylex",
    email: "office@cylex.us",
    subject: "Free business listing — USA Gummies",
    body: `Hi Cylex team,

I'd like to register our food company in your directory.

Company: ${COMPANY_INFO.name}
Website: ${COMPANY_INFO.website}
Category: ${COMPANY_INFO.category}
Location: ${COMPANY_INFO.companyState}
Description: ${COMPANY_INFO.shortDescription}

Best,
${COMPANY_INFO.contactName}
${COMPANY_INFO.email}`,
  },
  {
    id: "foursquare",
    name: "Foursquare / Swarm",
    email: "support@foursquare.com",
    subject: "Business listing — USA Gummies (online food brand)",
    body: `Hi Foursquare team,

I'd like to add our food brand to your business listings.

Company: ${COMPANY_INFO.name}
Website: ${COMPANY_INFO.website}
Category: ${COMPANY_INFO.category}
Available: Online (usagummies.com) and Amazon
Description: ${COMPANY_INFO.shortDescription}

Best,
${COMPANY_INFO.contactName}
${COMPANY_INFO.email}`,
  },
  {
    id: "indiana-mfg",
    name: "Indiana Manufacturers Association",
    email: "info@imaweb.com",
    subject: "New member / listing inquiry — USA Gummies (confectionery manufacturer in Indiana)",
    body: `Hi Indiana Manufacturers Association team,

I'm the founder of USA Gummies. We manufacture premium dye-free gummy bears right here in Indiana, using natural colors from fruit and vegetable extracts.

I'd love to explore membership or a listing with the IMA. Our products are made in an FDA-registered facility in Indiana and sold direct-to-consumer and on Amazon.

Company: ${COMPANY_INFO.name}
Website: ${COMPANY_INFO.website}
Product: ${COMPANY_INFO.products}
Manufacturing: Indiana (FDA-registered facility)
Category: ${COMPANY_INFO.category}

Please let me know the process for listing or membership.

Best,
${COMPANY_INFO.contactName}
${COMPANY_INFO.name}
${COMPANY_INFO.email}`,
  },
  {
    id: "specialty-food",
    name: "Specialty Food Association",
    email: "memberservices@specialtyfood.com",
    subject: "Membership inquiry — USA Gummies (dye-free confectionery brand)",
    body: `Hi Specialty Food Association team,

I'm the founder of USA Gummies, a specialty confectionery brand making dye-free gummy bears with natural colors from real fruits and vegetables. We're exploring SFA membership and the Fancy Food Show as we grow our wholesale channel.

Company: ${COMPANY_INFO.name}
Website: ${COMPANY_INFO.website}
Product: ${COMPANY_INFO.products}
Made in: Indiana
Available: Direct (usagummies.com), Amazon (Prime eligible), wholesale
Description: ${COMPANY_INFO.description}

Could you share information about membership tiers and benefits for a small food brand?

Best,
${COMPANY_INFO.contactName}
${COMPANY_INFO.name}
${COMPANY_INFO.email}`,
  },
];

// ── Submission tracking ──────────────────────────────────────────────
function loadStatus() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
    }
  } catch {}
  return {};
}

function saveStatus(status) {
  const dir = path.dirname(STATUS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), "utf8");
}

// ── Send email ───────────────────────────────────────────────────────
function sendEmail(to, subject, body, dryRun = false) {
  if (dryRun) {
    log(`  [DRY RUN] Would send to ${to}: "${subject}"`);
    return true;
  }

  try {
    const args = [SEND_SCRIPT, "--to", to, "--subject", subject, "--body", body];
    execSync(
      `bash ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`,
      { timeout: 30_000, encoding: "utf8" }
    );
    log(`  ✅ Sent to ${to}: "${subject}"`);
    return true;
  } catch (err) {
    log(`  ❌ Failed to send to ${to}: ${err.message}`);
    return false;
  }
}

// ── Submit to directories ────────────────────────────────────────────
function submitDirectories(dryRun = false, batchSize = 5) {
  const status = loadStatus();
  let sent = 0;
  let skipped = 0;

  log(`📂 Processing ${DIRECTORIES.length} directories (batch size: ${batchSize})...`);

  for (const dir of DIRECTORIES) {
    if (status[dir.id]) {
      skipped++;
      continue;
    }

    if (sent >= batchSize) {
      log(`  ⏸️  Batch limit reached (${batchSize}). Run again for more.`);
      break;
    }

    log(`  📧 ${dir.name} (${dir.email})`);
    const ok = sendEmail(dir.email, dir.subject, dir.body, dryRun);

    if (ok) {
      status[dir.id] = {
        sentAt: new Date().toISOString(),
        email: dir.email,
        name: dir.name,
        dryRun,
      };
      sent++;
    }
  }

  if (!dryRun) saveStatus(status);

  const remaining = DIRECTORIES.length - skipped - sent;
  log(`\n📊 Sent: ${sent}, Already done: ${skipped}, Remaining: ${remaining}`);
}

// ── Status ───────────────────────────────────────────────────────────
function showStatus() {
  const status = loadStatus();

  console.log(`\n📂 Directory Submission Status\n`);
  console.log("Directory                      | Status  | Sent At");
  console.log("-".repeat(75));

  for (const dir of DIRECTORIES) {
    const s = status[dir.id];
    const name = dir.name.padEnd(30);
    if (s) {
      const date = s.sentAt ? new Date(s.sentAt).toLocaleDateString() : "?";
      console.log(`${name} | ✅ Sent | ${date}`);
    } else {
      console.log(`${name} | ⏳ Pending`);
    }
  }

  const done = Object.keys(status).length;
  console.log(`\nTotal: ${done}/${DIRECTORIES.length} submitted\n`);
}

// ── Main ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes("--status")) {
  showStatus();
} else {
  const dryRun = args.includes("--dry-run");
  const batchIdx = args.indexOf("--batch");
  const batchSize = batchIdx >= 0 ? parseInt(args[batchIdx + 1]) || 5 : 5;
  submitDirectories(dryRun, batchSize);
}
