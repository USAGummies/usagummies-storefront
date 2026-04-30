#!/usr/bin/env node
/**
 * USA Gummies — Creative Drafter
 *
 * Generates ad creative using Google Gemini 2.5 Flash Image (Nano Banana 2)
 * with optional fallback to OpenAI gpt-image-1. Reference images (bag art +
 * logo) are sent inline so output stays brand-consistent.
 *
 * Usage:
 *   node scripts/creative/draft-creative.mjs --prompt "..." [--preset name]
 *     [--ref public/brand/photos/bag-1776.jpg]
 *     [--ref public/brand/logo-horizontal.png]
 *     [--engine gemini|openai] [--n 1] [--size 1080x1080] [--out slug]
 *
 * Examples:
 *   node scripts/creative/draft-creative.mjs --preset kitchen
 *   node scripts/creative/draft-creative.mjs --prompt "veteran on porch holding bag" --ref public/brand/photos/bag-1776.jpg
 *   node scripts/creative/draft-creative.mjs --preset bbq --n 3
 *
 * Output: creative-drafts/<YYYYMMDD-HHMMSS>-<slug>-<n>.png
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Env loader ─────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");
const ENV_FILE = path.join(REPO, ".env.local");
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

// ── Brand reference defaults ───────────────────────────────────────────
// Pulls from creative-drafts/.drive-cache/ first (Drive-sourced, higher
// quality), falling back to repo files. To refresh the cache, ask Claude
// in chat to pull specific Drive file IDs via the Drive MCP tools.
function discoverDefaultRefs(repo) {
  const cacheDir = path.join(repo, "creative-drafts", ".drive-cache");
  const refs = [];
  if (existsSync(cacheDir)) {
    for (const f of readdirSync(cacheDir)) {
      if (/\.(png|jpe?g|webp)$/i.test(f)) refs.push(path.join("creative-drafts", ".drive-cache", f));
    }
  }
  if (refs.length === 0) {
    // Fallback to repo-bundled refs
    refs.push("public/brand/photos/bag-1776.jpg");
    refs.push("public/brand/logo-horizontal.png");
  }
  return refs;
}

// ── Brand grammar shared across all prompts ────────────────────────────
const BRAND_RULES = `
PRODUCT (do not redesign — match the reference exactly):
- Stand-up pouch, deep navy with a horizontal red band across the lower third.
- Front of bag features the white "USA GUMMIES — All American Gummy Bears" lockup with stars.
- Show the bag clearly readable, never warped or distorted.
- Five gummy-bear flavors: classic primaries (red/cherry, yellow/lemon, green/apple, blue/raspberry, orange).

BRAND VOICE & FEEL:
- Premium, patriotic-but-not-tacky. Think craft, small-batch, made-in-America.
- Warm natural light. Real human hands, real homes, real settings — never sterile stock.
- No fake people; if a person appears, they look like a real customer (35-65 yo).
- No cartoon overlays, no AI-shimmer, no neon, no glow effects, no plastic skin.
- No fake product names, no invented certifications, no claim text on-bag we don't have.
- No competing brand logos. No third-party trademarks.

COMPOSITION:
- 1:1 square unless otherwise specified. Hero subject occupies center 60%.
- Leave clean negative space for caption overlay (typically lower third).
- Photographic realism. 50mm prime feel. Subtle film grain ok. No HDR.
`.trim();

// ── Presets — pre-baked Ben-approved creative directions ───────────────
const PRESETS = {
  kitchen: {
    slug: "kitchen-counter",
    prompt: `Photoreal lifestyle ad. A USA Gummies bag (match reference exactly) sits on a sun-lit American kitchen counter — butcher block or stone — next to a small white bowl spilling 5-flavor gummy bears. Soft window light, warm wood and brass accents, a coffee mug just out of focus. Family kitchen feel, not staged. ${BRAND_RULES}`,
  },
  bbq: {
    slug: "family-bbq",
    prompt: `Photoreal lifestyle ad. A USA Gummies bag (match reference exactly) on a wooden picnic table at a backyard summer BBQ. Slight bokeh of a grill, an American flag on a porch, a kid's hand reaching in for a gummy. Golden-hour light. Real family vibe — not stock-photo perfect. ${BRAND_RULES}`,
  },
  veteran: {
    slug: "veteran-porch",
    prompt: `Photoreal lifestyle ad. A weathered American porch with a flag in soft focus. A USA Gummies bag (match reference exactly) rests on a wooden side table next to a coffee mug and a folded newspaper. Warm late-afternoon light. Quiet, dignified, patriotic without being loud. No people in frame. ${BRAND_RULES}`,
  },
  workshop: {
    slug: "workshop-tailgate",
    prompt: `Photoreal lifestyle ad. A USA Gummies bag (match reference exactly) sits on the open tailgate of a clean older pickup truck, parked outside a small American workshop or barn. A few gummies have spilled onto the tailgate. Late-afternoon golden light. Working-man Americana, dust motes, real. ${BRAND_RULES}`,
  },
  antidye: {
    slug: "anti-dye-comparison",
    prompt: `Photoreal split composition ad. Left half: a generic translucent bowl of artificially-bright neon-colored candy on a clinical white surface, lit cold and flat (NO logos, NO brand names, just generic candy). Right half: a small wooden bowl of USA Gummies (match bag reference exactly for the bag in the background) — naturally-tinted bears in 5 fruit colors, on a warm wooden table, sun-lit. Subtle copy-safe negative space across the top. Tells the dye-free story visually without text. ${BRAND_RULES}`,
  },
  hero: {
    slug: "hero-product-shot",
    prompt: `Photoreal hero product shot. A single USA Gummies bag (match reference exactly) stands upright on a clean American walnut wood surface with a soft white seamless paper background. A small handful of 5-flavor gummy bears spilled at the base of the bag. Studio softbox lighting, gentle shadow under the bag, slight catchlight on the gummies. Premium, magazine-grade. ${BRAND_RULES}`,
  },
  buyfourgetone: {
    slug: "buy4get1-stack",
    prompt: `Photoreal product ad. Five USA Gummies bags (match reference exactly) arranged in a neat row on a warm wooden table — one of them tilted slightly forward like it's the "free one." Spilled gummies at the base. Warm window light, clean negative space along the top half for headline copy. The hero of the shot is the *5 bags together*, communicating the Buy 4 Get 1 Free promo without any text. ${BRAND_RULES}`,
  },
  customer: {
    slug: "real-customer-hands",
    prompt: `Photoreal candid lifestyle ad. Real-looking adult hands (35-55 years old, american, working person, not model-perfect) tearing open a USA Gummies bag (match reference exactly), with a few gummies tumbling into the palm. Shot from the customer's POV, slightly above. Natural daylight. Feels like a real customer photo, not an ad. ${BRAND_RULES}`,
  },
};

// ── CLI parser ─────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { refs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--prompt") args.prompt = argv[++i];
    else if (a === "--preset") args.preset = argv[++i];
    else if (a === "--ref") args.refs.push(argv[++i]);
    else if (a === "--engine") args.engine = argv[++i];
    else if (a === "--n") args.n = parseInt(argv[++i], 10);
    else if (a === "--size") args.size = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--list") args.list = true;
    else if (a === "--no-default-refs") args.noDefaults = true;
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

// ── Reference image loader ─────────────────────────────────────────────
function loadRefImage(p) {
  const abs = path.isAbsolute(p) ? p : path.join(REPO, p);
  if (!existsSync(abs)) throw new Error(`Reference not found: ${abs}`);
  const buf = readFileSync(abs);
  const ext = path.extname(abs).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
  return { mime, data: buf.toString("base64"), bytes: buf, name: path.basename(abs) };
}

// ── Gemini 2.5 Flash Image (Nano Banana 2) ─────────────────────────────
async function generateGemini({ prompt, refs, n }) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY not set");
  // "Nano Banana 2" = nano-banana-pro-preview (Google's 2nd-gen image model).
  // Fallbacks: gemini-3-pro-image-preview, gemini-2.5-flash-image (original Nano Banana).
  const model = process.env.GEMINI_IMAGE_MODEL || "nano-banana-pro-preview";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const parts = [];
  for (const r of refs) parts.push({ inline_data: { mime_type: r.mime, data: r.data } });
  parts.push({ text: prompt });

  const outputs = [];
  for (let i = 0; i < n; i++) {
    process.stdout.write(`  [gemini] generating ${i + 1}/${n}... `);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["IMAGE"], temperature: 0.9 },
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      console.log("✗");
      throw new Error(`Gemini ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
    }
    const cand = json.candidates?.[0];
    const imgPart = cand?.content?.parts?.find((p) => p.inline_data || p.inlineData);
    const inline = imgPart?.inline_data || imgPart?.inlineData;
    if (!inline?.data) {
      console.log("✗ (no image)");
      const text = cand?.content?.parts?.find((p) => p.text)?.text || JSON.stringify(json).slice(0, 300);
      throw new Error(`Gemini returned no image data. Response: ${text}`);
    }
    console.log("✓");
    outputs.push({ data: Buffer.from(inline.data, "base64"), mime: inline.mime_type || inline.mimeType || "image/png" });
  }
  return outputs;
}

// ── OpenAI gpt-image-1 ─────────────────────────────────────────────────
// If refs are provided, uses /images/edits (image-conditioning, multi-ref).
// Otherwise uses /images/generations (text-only).
async function generateOpenAI({ prompt, refs, n, size }) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const useEdits = refs && refs.length > 0;
  const endpoint = useEdits ? "edits" : "generations";
  process.stdout.write(`  [openai gpt-image-1 /${endpoint}] generating ${n}... `);

  let res;
  if (useEdits) {
    // multipart: refs as image[], plus prompt + n + size
    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", prompt);
    form.append("n", String(n));
    form.append("size", size || "1024x1024");
    form.append("quality", "high");
    for (const r of refs) {
      const blob = new Blob([r.bytes], { type: r.mime });
      form.append("image[]", blob, r.name);
    }
    res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
  } else {
    res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        n,
        size: size || "1024x1024",
        quality: "high",
      }),
    });
  }

  const json = await res.json();
  if (!res.ok) {
    console.log("✗");
    throw new Error(`OpenAI ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }
  console.log("✓");
  return (json.data || []).map((d) => ({
    data: Buffer.from(d.b64_json, "base64"),
    mime: "image/png",
  }));
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || (!args.prompt && !args.preset && !args.list)) {
    console.log(`USA Gummies — Creative Drafter

Usage:
  --prompt "<text>"          custom prompt
  --preset <name>            use a preset (see --list)
  --ref <path>               additional reference image (repeatable)
  --no-default-refs          skip default bag+logo refs
  --engine gemini|openai     default: gemini (Nano Banana 2)
  --n <int>                  number of variants (default 1)
  --size 1024x1024           OpenAI only
  --out <slug>               output filename slug
  --list                     list available presets

Presets: ${Object.keys(PRESETS).join(", ")}

Examples:
  node scripts/creative/draft-creative.mjs --preset kitchen
  node scripts/creative/draft-creative.mjs --preset hero --n 3
  node scripts/creative/draft-creative.mjs --prompt "..." --ref path/to/extra.png`);
    process.exit(0);
  }

  if (args.list) {
    console.log("Presets:\n");
    for (const [key, val] of Object.entries(PRESETS)) {
      console.log(`  ${key.padEnd(15)}  → ${val.slug}`);
      console.log(`  ${" ".repeat(15)}    ${val.prompt.slice(0, 110).replace(/\n/g, " ")}...`);
      console.log();
    }
    process.exit(0);
  }

  const preset = args.preset ? PRESETS[args.preset] : null;
  if (args.preset && !preset) {
    console.error(`Unknown preset: ${args.preset}. Available: ${Object.keys(PRESETS).join(", ")}`);
    process.exit(1);
  }

  const prompt = args.prompt || preset.prompt;
  const slug = args.out || preset?.slug || "custom";
  const engine = args.engine || "gemini";
  const n = args.n || 1;

  // Build reference list (defaults + any --ref additions)
  const defaults = args.noDefaults ? [] : discoverDefaultRefs(REPO);
  const refPaths = [...defaults];
  for (const r of args.refs) refPaths.push(r);
  const refs = refPaths.map(loadRefImage);

  const ts = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const outDir = path.join(REPO, "creative-drafts");
  mkdirSync(outDir, { recursive: true });

  console.log(`USA Gummies — Creative Drafter`);
  console.log("─".repeat(64));
  console.log(`engine:  ${engine}`);
  console.log(`preset:  ${args.preset || "(custom)"}`);
  console.log(`refs:    ${refs.map((r) => r.name).join(", ") || "(none)"}`);
  console.log(`n:       ${n}`);
  console.log(`prompt:  ${prompt.slice(0, 200)}${prompt.length > 200 ? "..." : ""}`);
  console.log("─".repeat(64));

  const outputs =
    engine === "openai"
      ? await generateOpenAI({ prompt, refs, n, size: args.size })
      : await generateGemini({ prompt, refs, n });

  const written = [];
  for (let i = 0; i < outputs.length; i++) {
    const o = outputs[i];
    const ext = o.mime?.includes("jpeg") ? "jpg" : "png";
    const file = `${ts}-${slug}-${String(i + 1).padStart(2, "0")}.${ext}`;
    const out = path.join(outDir, file);
    writeFileSync(out, o.data);
    written.push(out);
    console.log(`  ✓ ${path.relative(REPO, out)}  (${(o.data.length / 1024).toFixed(0)} KB)`);
  }

  console.log("\nDone.");
  console.log(`Open: open ${written.map((w) => `"${w}"`).join(" ")}`);
}

main().catch((err) => {
  console.error("\n✗ Error:", err.message);
  process.exit(1);
});
