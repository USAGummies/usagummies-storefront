#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.cwd(), "growth-ops");

const dirs = [
  root,
  path.join(root, "01-authority-profile-takeover"),
  path.join(root, "02-parasite-seo-domination"),
  path.join(root, "03-influencer-affiliate-machine"),
  path.join(root, "04-digital-pr-citation-blast"),
  path.join(root, "05-growth-telemetry-loop"),
];

const siteUrl = "https://www.usagummies.com";
const amazonUrl = "https://www.amazon.com/dp/B0G1JK92TJ";

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 64);
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows) {
  return rows
    .map((row) => row.map((cell) => csvEscape(cell)).join(","))
    .join("\n");
}

function formatDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const profileRows = [
  {
    platform: "Google Business Profile",
    handle: "USA Gummies",
    headline: "Premium gummy bears made in the USA with natural colors",
    bio: "USA Gummies makes premium gummy bears in the USA with natural colors from fruit and vegetable extracts and zero artificial dyes.",
    cta: "Order online or on Amazon",
    link: siteUrl,
  },
  {
    platform: "LinkedIn Company",
    handle: "USA Gummies",
    headline: "American-made candy brand",
    bio: "USA Gummies is a premium candy brand focused on American manufacturing, natural colors, and better-for-you gummy quality.",
    cta: "Follow for wholesale and partnership updates",
    link: `${siteUrl}/contact`,
  },
  {
    platform: "YouTube",
    handle: "@USAGummiesOfficial",
    headline: "Made-in-USA candy stories",
    bio: "Behind the scenes of American gummy manufacturing, ingredient transparency, and snack education.",
    cta: "Watch then shop",
    link: siteUrl,
  },
  {
    platform: "Pinterest",
    handle: "USA Gummies",
    headline: "Patriotic snack ideas",
    bio: "Pin-worthy party boards, gift ideas, and dye-free gummy inspiration from USA Gummies.",
    cta: "Browse gift and party ideas",
    link: siteUrl,
  },
  {
    platform: "Reddit Brand Account",
    handle: "u/USAGummiesOfficial",
    headline: "Transparent brand participation",
    bio: "Official USA Gummies account sharing ingredient transparency, manufacturing insights, and candy tips.",
    cta: "Answering questions openly",
    link: `${siteUrl}/ingredients`,
  },
  {
    platform: "Quora Space",
    handle: "USA Gummies",
    headline: "Natural candy knowledge hub",
    bio: "Answers on natural candy ingredients, dye-free alternatives, and made-in-USA candy buying decisions.",
    cta: "Read and ask questions",
    link: `${siteUrl}/shop`,
  },
  {
    platform: "Medium Publication",
    handle: "USA Gummies Journal",
    headline: "Ingredient and manufacturing deep dives",
    bio: "Educational posts on candy ingredients, label literacy, and American food manufacturing.",
    cta: "Read stories and visit shop",
    link: siteUrl,
  },
  {
    platform: "Substack",
    handle: "USA Gummies Dispatch",
    headline: "Weekly candy and growth notes",
    bio: "Short weekly dispatch with product insights, behind-the-scenes updates, and partnership notes.",
    cta: "Subscribe free",
    link: siteUrl,
  },
  {
    platform: "X",
    handle: "@USAGummies",
    headline: "Fast commentary and launches",
    bio: "Made-in-USA gummy updates, product drops, and ingredient education in short-form.",
    cta: "Follow and share",
    link: siteUrl,
  },
  {
    platform: "Facebook Page",
    handle: "USA Gummies",
    headline: "Community and customer updates",
    bio: "Official USA Gummies page for launch updates, education, and direct community conversations.",
    cta: "Shop now",
    link: siteUrl,
  },
];

const profilePack = `# Authority Profile Takeover Pack\n\n## Objective\nDeploy one consistent brand identity across the highest-authority free platforms so search results and social surfaces reinforce USA Gummies everywhere.\n\n## Canonical Positioning\n- Core promise: Premium gummy bears made in the USA with natural colors and zero artificial dyes\n- Tone: Warm, confident, ingredient-transparent, non-political patriotic pride\n- Primary CTA: Shop direct at ${siteUrl}\n- Secondary CTA: Amazon listing ${amazonUrl}\n\n## Platform Copy Matrix\n| Platform | Handle | Headline | Bio | CTA | Link |\n| --- | --- | --- | --- | --- | --- |\n${profileRows
  .map(
    (row) =>
      `| ${row.platform} | ${row.handle} | ${row.headline} | ${row.bio} | ${row.cta} | ${row.link} |`
  )
  .join("\n")}\n\n## One-Time Launch Sequence\n1. Claim/update all profiles using the matrix above.\n2. Use one profile image, one cover image set, and one brand description across platforms.\n3. Publish first 3 posts per platform: brand story, ingredient proof, where to buy.\n4. Add tracked link from each platform using the UTM registry in ../05-growth-telemetry-loop/utm_registry.csv.\n5. Add the same contact email and response SLA across all profiles.\n\n## Immediate Post Starters\n- Story: Why USA Gummies was built around American manufacturing and natural colors\n- Proof: Ingredient and manufacturing transparency post with product close-up\n- Action: Direct buyers to ${siteUrl}/shop and Amazon with tracked links\n`;

const articleSeeds = [
  ["What does 'made in USA candy' actually mean in 2026?", "made in usa candy meaning", "educational"],
  ["Natural food dyes vs artificial dyes in gummies: a practical buyer guide", "natural food dyes gummies", "educational"],
  ["How to read a gummy ingredient label in 60 seconds", "how to read gummy ingredient label", "educational"],
  ["Best candy options for parents avoiding artificial dyes", "candy without artificial dyes", "commercial"],
  ["The real difference between premium gummies and commodity gummies", "premium gummies vs regular", "commercial"],
  ["How American candy manufacturing impacts freshness and consistency", "american candy manufacturing", "educational"],
  ["Top patriotic party snack ideas that are actually easy", "patriotic party snack ideas", "informational"],
  ["Teacher appreciation snack gifts that feel premium", "teacher appreciation snack gifts", "commercial"],
  ["Corporate gifting with made-in-USA snacks: what buyers care about", "corporate gifting snacks", "commercial"],
  ["Wedding welcome bag candy ideas with clean labels", "wedding welcome bag candy", "commercial"],
  ["Healthy-ish candy swaps for family movie night", "family movie night candy ideas", "informational"],
  ["A founder playbook: building a premium candy brand as a solo operator", "solo founder candy brand", "thought leadership"],
  ["Why consumers are searching for Red 40 free candy alternatives", "red 40 free candy alternatives", "educational"],
  ["Holiday candy buying calendar: when demand spikes and why", "holiday candy buying calendar", "seasonal"],
  ["How to build a premium candy gift box people remember", "premium candy gift box", "commercial"],
  ["The best candy for event planners: shelf stability, flavor, and presentation", "best candy for events", "commercial"],
  ["Bulk gummy orders without low-quality tradeoffs", "bulk gummy candy orders", "commercial"],
  ["Ingredient transparency in candy: what brands hide and what to ask", "ingredient transparency candy", "educational"],
  ["What retailers want from emerging snack brands", "retail buyer snack brands", "b2b"],
  ["How to pitch wholesale buyers when you are a small food brand", "how to pitch wholesale buyers", "b2b"],
  ["Made-in-USA gift guide: premium picks for office teams", "made in usa office gifts", "commercial"],
  ["Natural color sources in gummies explained", "natural colors in gummies", "educational"],
  ["The complete guide to dye-free gummies for parents", "dye free gummies for parents", "commercial"],
  ["Party favor ideas that avoid synthetic dyes", "party favors without artificial dyes", "informational"],
  ["How to compare gummy brands without getting fooled by labels", "compare gummy brands", "educational"],
  ["Snack table ideas for Fourth of July events", "fourth of july snack table", "seasonal"],
  ["Customer FAQ: allergens, shipping, and what makes USA Gummies different", "usa gummies faq", "brand"],
  ["Amazon vs DTC for gummy buyers: where to buy and why", "buy gummies amazon or website", "commercial"],
  ["Small business spotlight: the economics of premium candy", "premium candy economics", "thought leadership"],
  ["How to plan gummy inventory for school and community events", "event candy planning", "informational"],
  ["What makes a gummy texture feel premium", "premium gummy texture", "educational"],
  ["Gift shop candy merchandising ideas that lift basket size", "gift shop candy merchandising", "b2b"],
  ["Military family event snack ideas with broad appeal", "military event snack ideas", "informational"],
  ["Tourist shop products that sell fast: candy edition", "tourist shop candy products", "b2b"],
  ["How to write product pages for snack brands that convert", "snack product page conversion", "thought leadership"],
  ["Natural candy trends buyers should watch this year", "natural candy trends", "trend"],
  ["How to repurpose one blog post into 10 traffic assets", "repurpose blog content", "thought leadership"],
  ["Do clean-label gummies taste better? blind-test framework", "clean label gummies taste", "educational"],
  ["How to run zero-budget marketing for a food brand", "zero budget food brand marketing", "thought leadership"],
  ["The anti-spam outreach framework for creator partnerships", "creator outreach framework", "thought leadership"],
];

const longformSeedsMd = `# Longform Article Seeds (Parasite SEO + Syndication)\n\nUse these as canonical source pieces, then syndicate derivative versions to Medium, LinkedIn, Quora, Reddit, Pinterest, and Substack with tracked links.\n\n${articleSeeds
  .map(
    ([title, keyword, intent], idx) =>
      `${idx + 1}. **${title}**  \n   - Primary keyword: \`${keyword}\`  \n   - Intent: ${intent}  \n   - CTA: Shop ${siteUrl}/shop and Amazon ${amazonUrl}`
  )
  .join("\n\n")}\n`;

const platforms = ["Medium", "LinkedIn Article", "Quora Answer", "Reddit Value Post", "Pinterest Idea Pin", "Substack Note"];
const calendarRows = [[
  "date",
  "platform",
  "asset_type",
  "topic_title",
  "primary_keyword",
  "source_asset",
  "cta_url",
  "utm_url",
  "status",
]];

const startDate = new Date();
for (let day = 0; day < 30; day += 1) {
  const date = new Date(startDate);
  date.setDate(startDate.getDate() + day);

  for (let slot = 0; slot < 2; slot += 1) {
    const topic = articleSeeds[(day * 2 + slot) % articleSeeds.length];
    const platform = platforms[(day + slot) % platforms.length];
    const medium = platform.toLowerCase().replace(/\s+/g, "_");
    const contentSlug = slugify(topic[0]);
    const utmUrl = `${siteUrl}/shop?utm_source=${medium}&utm_medium=organic&utm_campaign=parasite_seo_blitz&utm_content=${contentSlug}`;

    calendarRows.push([
      formatDate(date),
      platform,
      platform.includes("Answer") || platform.includes("Post") ? "short-form" : "long-form",
      topic[0],
      topic[1],
      `Source seed #${(day * 2 + slot) % articleSeeds.length + 1}`,
      `${siteUrl}/shop`,
      utmUrl,
      "queued",
    ]);
  }
}

const segments = [
  { name: "Health-conscious parents", score: 10, queries: ["dye free snacks for kids", "lunchbox snack swaps", "mom snack reviews"] },
  { name: "Patriotic lifestyle creators", score: 9, queries: ["made in usa products", "american small business finds", "patriotic party ideas"] },
  { name: "Food and snack reviewers", score: 10, queries: ["snack review", "candy review", "amazon snack finds"] },
  { name: "Party planners", score: 8, queries: ["party favor ideas", "event snack table", "birthday candy bar"] },
  { name: "Teacher classroom creators", score: 7, queries: ["teacher treat ideas", "classroom rewards", "school event snacks"] },
  { name: "Corporate gifting creators", score: 9, queries: ["employee gift box", "corporate event snacks", "office snack program"] },
  { name: "Wedding creators", score: 8, queries: ["wedding welcome bags", "wedding favor ideas", "bridal event snacks"] },
  { name: "Military family creators", score: 7, queries: ["military family events", "patriotic family content", "support small usa brands"] },
  { name: "Gift guide publishers", score: 9, queries: ["gift guide food", "american made gifts", "holiday gift guide snacks"] },
  { name: "Wellness and clean-label", score: 8, queries: ["clean label snacks", "ingredient transparency", "natural candy alternatives"] },
];

const discoveryPlatforms = [
  { name: "YouTube", url: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` },
  { name: "TikTok", url: (q) => `https://www.tiktok.com/search?q=${encodeURIComponent(q)}` },
  { name: "Instagram", url: (q) => `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(q)}` },
  { name: "LinkedIn", url: (q) => `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(q)}` },
  { name: "X", url: (q) => `https://x.com/search?q=${encodeURIComponent(q)}&f=live` },
];

const creatorRows = [[
  "lead_id",
  "segment",
  "platform",
  "search_query",
  "discovery_url",
  "alignment_score",
  "contact_status",
  "next_action",
  "owner",
]];

let leadCounter = 1;
for (const segment of segments) {
  for (const query of segment.queries) {
    for (const platform of discoveryPlatforms) {
      creatorRows.push([
        `CR-${String(leadCounter).padStart(4, "0")}`,
        segment.name,
        platform.name,
        query,
        platform.url(`usa gummies ${query}`),
        segment.score,
        "not-contacted",
        "Review top 10 results, pick 2 high-fit creators, draft personalized DM/email",
        "Ben",
      ]);
      leadCounter += 1;
    }
  }
}

const outreachTemplates = `# Influencer + Affiliate Outreach Templates\n\n## Personalization Tokens\n- {{first_name}}\n- {{handle_or_channel}}\n- {{specific_post_reference}}\n- {{audience_fit_reason}}\n- {{your_name}}\n\n## Template 1: Creator Product Seeding\nSubject: Quick collab idea for {{handle_or_channel}}\n\nHi {{first_name}},\n\nI run USA Gummies. I liked your post on {{specific_post_reference}} and your audience overlap with us is strong because {{audience_fit_reason}}.\n\nIf you are open to it, I can send product for an honest review. No script and no forced claims.\n\nIf yes, I will send details and keep it simple.\n\n- {{your_name}}\n\n## Template 2: Affiliate Offer (Commission-Only)\nSubject: Zero-risk affiliate invite\n\nHi {{first_name}},\n\nI run USA Gummies (premium gummies made in the USA, natural colors, no artificial dyes).\n\nI want to offer you a no-retainer affiliate partnership: unique tracked link + commission on attributed sales.\n\nIf this fits your audience, I can send one-page terms and a custom landing link today.\n\n- {{your_name}}\n\n## Template 3: Follow-up (Day 4)\nSubject: Re: quick collab idea\n\nHi {{first_name}},\n\nBumping this once in case it got buried. If helpful, I can send a short sample pack and you can decide from there.\n\nEither way, appreciate your work on {{handle_or_channel}}.\n\n- {{your_name}}\n\n## Template 4: Follow-up (Day 9, close loop)\nSubject: Close loop?\n\nHi {{first_name}},\n\nI will close the loop after this message. If a future campaign is better timing, I can check back later in the season.\n\nThanks again.\n\n- {{your_name}}\n\n## Sequence Rules\n1. Day 0: personalized initial outreach\n2. Day 4: short follow-up\n3. Day 9: close-loop follow-up\n4. Move non-responders to 30-day nurture list\n`;

const distributionTargets = [
  ["PR Distribution", "PRLog", "https://www.prlog.org/", "Free press release distribution", "low", "high"],
  ["PR Distribution", "OpenPR", "https://www.openpr.com/", "Free/low-cost PR posting", "low", "high"],
  ["PR Distribution", "PR.com", "https://www.pr.com/press-release-service", "Press release submission options", "medium", "medium"],
  ["PR Distribution", "1888PressRelease", "https://www.1888pressrelease.com/", "Submission with editorial review", "medium", "medium"],
  ["Journalist Source", "Qwoted", "https://www.qwoted.com/", "Founder/source pitches to journalists", "medium", "high"],
  ["Journalist Source", "SourceBottle", "https://www.sourcebottle.com/", "Free expert source queries", "low", "high"],
  ["Journalist Source", "Featured", "https://featured.com/", "Contribute expert quotes", "low", "high"],
  ["Local Citation", "Google Business Profile", "https://www.google.com/business/", "Primary local visibility surface", "low", "high"],
  ["Local Citation", "Bing Places", "https://www.bingplaces.com/", "Microsoft local listing", "low", "high"],
  ["Local Citation", "Apple Business Connect", "https://businessconnect.apple.com/", "Apple Maps listing and updates", "medium", "high"],
  ["Local Citation", "Yelp for Business", "https://biz.yelp.com/", "Claim and optimize listing", "low", "high"],
  ["Local Citation", "Yellow Pages", "https://www.yellowpages.com/", "Business listing discovery", "low", "medium"],
  ["Local Citation", "Manta", "https://www.manta.com/", "Business directory profile", "low", "medium"],
  ["Local Citation", "Hotfrog", "https://www.hotfrog.com/add-your-business", "Free business listing", "low", "medium"],
  ["Local Citation", "MapQuest Local", "https://listings.mapquest.com/", "Local business listing", "low", "medium"],
  ["Local Citation", "Chamber of Commerce", "https://www.chamberofcommerce.com/", "Business directory listing", "low", "medium"],
  ["Business Profile", "LinkedIn Company", "https://www.linkedin.com/company/setup/new/", "Authority profile and content distribution", "low", "high"],
  ["Business Profile", "YouTube Channel", "https://www.youtube.com/account", "Video search footprint", "medium", "high"],
  ["Business Profile", "Pinterest Business", "https://www.pinterest.com/business/create/", "Image search and evergreen referral", "low", "high"],
  ["Business Profile", "Substack", "https://substack.com/", "Newsletter and web archive pages", "low", "high"],
  ["Business Profile", "Medium Publication", "https://medium.com/new-story", "High-authority canonical syndication", "low", "high"],
  ["Business Profile", "Quora Space", "https://www.quora.com/", "Question-intent capture", "low", "high"],
  ["Business Profile", "Reddit Brand Profile", "https://www.reddit.com/register/", "Community-driven discovery", "low", "medium"],
  ["Business Profile", "Facebook Page", "https://www.facebook.com/pages/create/", "Social proof and reviews", "low", "high"],
  ["Business Profile", "X Profile", "https://x.com/i/flow/signup", "Real-time conversations", "low", "medium"],
  ["Marketplace", "Amazon Brand Store", "https://sellercentral.amazon.com/", "Authority and conversion for marketplace buyers", "medium", "high"],
  ["Marketplace", "Faire", "https://www.faire.com/", "Wholesale discovery channel", "medium", "high"],
  ["Marketplace", "Abound", "https://www.abound.co/", "Wholesale marketplace", "medium", "high"],
  ["Marketplace", "Tundra", "https://www.tundra.com/", "Wholesale marketplace", "medium", "medium"],
  ["Marketplace", "RangeMe", "https://rangeme.com/", "Retail buyer submissions", "medium", "high"],
  ["Discovery", "Product Hunt", "https://www.producthunt.com/posts/new", "Launch visibility and backlinks", "low", "medium"],
  ["Discovery", "Crunchbase", "https://www.crunchbase.com/", "Company profile authority", "low", "medium"],
  ["Discovery", "AboutUs", "https://aboutus.com/", "Brand profile citation", "low", "low"],
  ["Discovery", "F6S", "https://www.f6s.com/", "Founder/company visibility", "low", "low"],
  ["Community", "Indie Hackers", "https://www.indiehackers.com/", "Founder story + product updates", "low", "medium"],
  ["Community", "Hacker News Show HN", "https://news.ycombinator.com/submit", "Occasional launch visibility", "low", "low"],
  ["Community", "r/snackexchange", "https://www.reddit.com/r/snackexchange/", "Community participation (non-spam)", "medium", "low"],
  ["Community", "r/Food", "https://www.reddit.com/r/food/", "Value posts only", "medium", "medium"],
  ["Community", "r/Entrepreneur", "https://www.reddit.com/r/Entrepreneur/", "Founder learnings and traffic", "medium", "medium"],
  ["Community", "Quora Topics", "https://www.quora.com/topic/Candy", "Answer high-intent questions", "low", "high"],
];

const distRows = [["category", "platform", "submission_url", "notes", "effort", "priority", "status"]];
for (const target of distributionTargets) {
  distRows.push([...target, "queued"]);
}

const pressAngles = `# Press + Media Angles\n\n## Angle 1: Product Story\nHeadline: American Gummy Brand Scales Premium Candy Without Artificial Dyes\n\n- Hook: Premium taste + natural colors + domestic manufacturing\n- Why now: Rising buyer scrutiny on ingredient labels\n- Proof points: Made in USA, natural color extracts, direct and Amazon availability\n- CTA: Interviews and product samples available\n\n## Angle 2: Founder Story\nHeadline: Solo Founder Builds a 24/7 Distribution Engine for an American Candy Brand\n\n- Hook: One-operator model competing through execution speed\n- Why now: Interest in lean founder-led CPG growth\n- Proof points: Multi-channel distribution, outbound partnerships, content engine\n- CTA: Founder interview slots available\n\n## Angle 3: Industry Trend\nHeadline: Ingredient Transparency Is Reshaping Candy Buying Behavior\n\n- Hook: Consumers are increasingly ingredient-first in snack decisions\n- Why now: Search and social behavior around dye-free alternatives\n- Proof points: Educational content performance and buyer FAQs\n- CTA: Data-backed commentary available for reporters\n\n## Pitch Email Skeleton\nSubject: Source for your [food/consumer trend] story\n\nHi {{journalist_name}},\n\nYou cover {{beat}} and I thought this might be useful for an upcoming piece.\n\nI run USA Gummies, a made-in-USA gummy brand focused on natural colors and transparent ingredient communication. I can share:\n- concise founder perspective\n- category observations from direct customer conversations\n- quotable comments within your deadline\n\nIf useful, I can send a short quote set today.\n\n- {{your_name}}\n`;

const utmChannels = [
  ["google_business_profile", "organic_local", "authority_takeover", "gbp_profile"],
  ["linkedin", "organic_social", "parasite_seo_blitz", "article_post"],
  ["medium", "organic_referral", "parasite_seo_blitz", "story"],
  ["quora", "organic_referral", "parasite_seo_blitz", "answer"],
  ["reddit", "organic_referral", "parasite_seo_blitz", "value_post"],
  ["pinterest", "organic_social", "parasite_seo_blitz", "idea_pin"],
  ["substack", "email", "authority_takeover", "dispatch"],
  ["youtube", "organic_video", "authority_takeover", "short"],
  ["influencer", "affiliate", "creator_seed", "partner"],
  ["press", "earned_media", "digital_pr_blast", "release"],
  ["directory", "organic_referral", "citation_blast", "listing"],
  ["x", "organic_social", "authority_takeover", "thread"],
  ["facebook", "organic_social", "authority_takeover", "post"],
];

const utmRows = [["channel", "destination", "utm_source", "utm_medium", "utm_campaign", "utm_content", "tracked_url"]];
for (const [source, medium, campaign, content] of utmChannels) {
  const tracked = `${siteUrl}/shop?utm_source=${source}&utm_medium=${medium}&utm_campaign=${campaign}&utm_content=${content}`;
  utmRows.push([source, `${siteUrl}/shop`, source, medium, campaign, content, tracked]);
}

const scoreRows = [[
  "date",
  "channel",
  "sessions",
  "engaged_sessions",
  "engagement_rate",
  "orders",
  "revenue",
  "assisted_orders",
  "outbound_actions",
  "notes",
  "next_day_action",
]];

const scoreboardChannels = [
  "google_business_profile",
  "linkedin",
  "medium",
  "quora",
  "reddit",
  "pinterest",
  "substack",
  "youtube",
  "influencer",
  "press",
  "directory",
  "amazon",
];

for (let i = 0; i < 14; i += 1) {
  const day = new Date(startDate);
  day.setDate(startDate.getDate() + i);
  for (const channel of scoreboardChannels) {
    scoreRows.push([
      formatDate(day),
      channel,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
  }
}

const readme = `# Growth Ops: Outside OpenClaw Nuclear Stack\n\nThis folder is a standalone execution stack to drive organic reach and traffic without touching website code.\n\n## What this build generated\n1. Authority profile takeover copy pack\n2. 30-day parasite SEO syndication calendar (2 posts/day)\n3. Influencer + affiliate discovery pipeline (search-ready lead rows)\n4. PR + citation distribution queue with direct submission links\n5. UTM registry and daily scoreboarding template for kill/scale decisions\n\n## Generated assets\n- 01-authority-profile-takeover/profile-pack.md\n- 02-parasite-seo-domination/longform-article-seeds.md\n- 02-parasite-seo-domination/syndication-calendar.csv\n- 03-influencer-affiliate-machine/creator_pipeline.csv\n- 03-influencer-affiliate-machine/outreach_templates.md\n- 04-digital-pr-citation-blast/distribution_targets.csv\n- 04-digital-pr-citation-blast/press-release-angles.md\n- 05-growth-telemetry-loop/utm_registry.csv\n- 05-growth-telemetry-loop/daily_scoreboard_template.csv\n\n## Regenerate\n\`node scripts/growth-ops/build-growth-ops-assets.mjs\`\n\n## Operating rule\nOnly double down on channels that produce sessions + orders in the scoreboard. De-prioritize channels with high effort and no conversion within 7 days.\n`;

async function main() {
  await Promise.all(dirs.map((dir) => fs.mkdir(dir, { recursive: true })));

  await fs.writeFile(path.join(root, "01-authority-profile-takeover", "profile-pack.md"), profilePack, "utf8");
  await fs.writeFile(
    path.join(root, "02-parasite-seo-domination", "longform-article-seeds.md"),
    longformSeedsMd,
    "utf8"
  );
  await fs.writeFile(
    path.join(root, "02-parasite-seo-domination", "syndication-calendar.csv"),
    `${toCsv(calendarRows)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(root, "03-influencer-affiliate-machine", "creator_pipeline.csv"),
    `${toCsv(creatorRows)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(root, "03-influencer-affiliate-machine", "outreach_templates.md"),
    outreachTemplates,
    "utf8"
  );
  await fs.writeFile(
    path.join(root, "04-digital-pr-citation-blast", "distribution_targets.csv"),
    `${toCsv(distRows)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(root, "04-digital-pr-citation-blast", "press-release-angles.md"),
    pressAngles,
    "utf8"
  );
  await fs.writeFile(
    path.join(root, "05-growth-telemetry-loop", "utm_registry.csv"),
    `${toCsv(utmRows)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(root, "05-growth-telemetry-loop", "daily_scoreboard_template.csv"),
    `${toCsv(scoreRows)}\n`,
    "utf8"
  );
  await fs.writeFile(path.join(root, "README.md"), readme, "utf8");

  console.log("Growth ops assets generated successfully.");
  console.log(`Root: ${root}`);
  console.log(`Syndication rows: ${calendarRows.length - 1}`);
  console.log(`Creator pipeline rows: ${creatorRows.length - 1}`);
  console.log(`Distribution targets: ${distRows.length - 1}`);
  console.log(`UTM links: ${utmRows.length - 1}`);
  console.log(`Scoreboard rows: ${scoreRows.length - 1}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
