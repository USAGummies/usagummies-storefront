#!/usr/bin/env node
/**
 * abra-patch-teachings.mjs — Fix remaining teachings that reference vitamins/supplements
 *
 * Instead of superseding, this patches the entries in-place:
 * 1. Fetches full text of each teaching
 * 2. Replaces vitamin/supplement references with confectionery/candy
 * 3. Updates embedding for corrected text
 * 4. PATCHes the entry in Supabase
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

async function getEmbedding(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000), dimensions: 1536 }),
  });
  if (!res.ok) throw new Error(`Embedding failed: ${res.status}`);
  const data = await res.json();
  return data.data[0].embedding;
}

async function patchEntry(id, updates) {
  const embText = `${updates.title || ''}. ${updates.raw_text || ''}`;
  const embedding = await getEmbedding(embText);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/open_brain_entries?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      ...updates,
      embedding,
      updated_at: new Date().toISOString(),
    }),
  });

  const body = await res.text();
  if (!res.ok) throw new Error(`Patch failed (${res.status}): ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

// Per-entry correction definitions
// Each entry has specific text replacements and/or full text overrides
const CORRECTIONS = {
  // 1. Company Overview — fundamentally wrong description
  '1f8bf2fd-1e93-436b-88d5-a2853e36dad4': {
    title: 'USA Gummies — Company Overview',
    raw_text: `Taught by founder (Ben Stutman):

USA Gummies is a consumer packaged goods (CPG) company specializing in confectionery gummy candy. The company sells American-made gummy bears and other gummy candy products. All products are manufactured domestically in the USA.

Key facts:
- Founded by Ben Stutman
- Headquartered in the United States
- Product category: CONFECTIONERY / CANDY (gummy bears, gummy candy)
- NOT a vitamin, supplement, or health product company
- Sales channels: DTC (Shopify website), Amazon (Grocery & Gourmet Food category), and wholesale/retail (grocery stores, candy shops, specialty retailers)
- Manufacturing: Contract manufacturer (co-packer) in the USA
- Brand identity: Patriotic, American-made, quality confectionery
- Target market: Candy consumers, gift buyers, patriotic Americans
- Competitors: Haribo, Black Forest, Albanese, Trolli, Smart Sweets (candy brands, NOT supplement brands)
- Regulatory: Standard food safety (FDA food regulations, cGMP for food, FSMA), NOT supplement regulations (NOT DSHEA)
- Amazon category: Grocery & Gourmet Food > Candy & Chocolate > Gummy Candy

The company is pre-revenue/early-revenue stage, expecting $100K in funding. The founder manages all operations with AI assistance (Abra) and a small team.`,
    summary_text: 'USA Gummies is a CPG confectionery company selling American-made gummy candy (not vitamins/supplements). DTC, Amazon, and wholesale channels.',
  },

  // 2. Brand Values — minor reference
  'b099e015-0c28-47d9-b1cf-fcce3f9f73d7': {
    replaceInText: [
      ['gummy vitamins', 'gummy candy'],
      ['gummy vitamin', 'gummy candy'],
      ['vitamins and supplements', 'gummy bears and candy'],
      ['vitamin brand', 'candy brand'],
    ],
  },

  // 3. CPG Finance Fundamentals — minor reference
  '32108225-cc60-41c8-a4b6-158f5e914fa4': {
    replaceInText: [
      ['gummy vitamin', 'gummy candy'],
      ['vitamin company', 'candy company'],
      ['supplement company', 'candy company'],
    ],
  },

  // 4. Supply Chain Structure — supplement references
  '646ed122-6b2e-45cc-8215-e735cd010d3e': {
    replaceInText: [
      ['gummy vitamin', 'gummy candy'],
      ['supplement fact', 'nutrition fact'],
      ['supplement facts', 'nutrition facts'],
      ['Supplement Facts panel', 'Nutrition Facts panel'],
      ['supplements', 'confectionery products'],
      ['supplement', 'confectionery'],
      ['dietary supplement', 'confectionery'],
      ['21 CFR Part 111', '21 CFR Part 117'],
      ['DSHEA', 'FDA food safety regulations'],
    ],
  },

  // 5. Retail Buyer Push — Memorial Day strategy
  '30690f0a-1194-4065-99bc-a3fdc4f6af00': {
    replaceInText: [
      ['gummy vitamins', 'gummy candy'],
      ['gummy vitamin', 'gummy candy'],
      ['vitamin/supplement', 'candy/confectionery'],
      ['vitamin aisle', 'candy aisle'],
      ['supplement aisle', 'candy aisle'],
      ['vitamins', 'gummy bears'],
      ['supplements', 'candy'],
      ['health food', 'candy and snack'],
      ['supplement category', 'candy category'],
    ],
  },

  // 6. B2B Sales Process — vitamin/supplement references
  '0af2fa47-9651-4383-aec5-5bd9251ce6b6': {
    replaceInText: [
      ['gummy vitamins', 'gummy candy'],
      ['gummy vitamin', 'gummy candy'],
      ['vitamin and supplement', 'candy and confectionery'],
      ['vitamins and supplements', 'candy and confectionery'],
      ['vitamin/supplement', 'candy/confectionery'],
      ['supplement buyers', 'candy buyers'],
      ['health and wellness', 'candy and snacks'],
      ['supplement', 'candy'],
    ],
  },

  // 7. Product Line — the most wrong one, needs full rewrite
  '28d83347-1ef2-4dd9-a544-9c132a02a1a1': {
    title: 'USA Gummies Product Line',
    raw_text: `Taught by founder (Ben Stutman):

USA Gummies product line consists of confectionery gummy candy products. All products are manufactured in the USA by a contract manufacturer (co-packer). This is a CANDY company, not a supplement company.

Current product line:
- Gummy bears (classic flavors: strawberry, raspberry, lemon, orange, cherry, grape)
- Patriotic-themed gummy bears (red, white, blue)
- Potential future SKUs: sour gummy bears, sugar-free gummies, seasonal/holiday editions

Product attributes:
- Category: CONFECTIONERY / CANDY
- All-natural colors and flavors where possible
- Made in USA (core brand differentiator)
- Standard candy packaging (resealable pouches, bags)
- Labeled with Nutrition Facts panel (NOT Supplement Facts — we're candy, not supplements)
- Standard food allergen labeling (FALCPA compliant)

Pricing:
- DTC (website): Premium pricing, $8-15 per bag depending on size
- Amazon: Competitive with premium candy brands, ~$10-14
- Wholesale: ~50% of retail, ~$4-7 per unit depending on volume

Product development:
- Focus on TASTE and TEXTURE (not health benefits or bioavailability)
- No active ingredients, vitamins, minerals, or dietary supplement ingredients
- Standard confectionery ingredients: gelatin, sugar, corn syrup, natural flavors, natural colors
- Product testing focused on taste testing, texture analysis, shelf life (not potency or ingredient uniformity)`,
    summary_text: 'USA Gummies sells confectionery gummy bears (candy), not vitamins. Classic, patriotic, and seasonal varieties. Nutrition Facts labeling, standard food allergen compliance.',
  },

  // 8. Cash Flow Management — seasonal reference
  '69a099d4-1294-40e0-a009-2f13581ca182': {
    replaceInText: [
      ['Supplement sales have seasonal patterns. Q1 (New Year\'s resolutions) and Q4 (holiday gifting) are typically strongest.',
       'Candy sales have seasonal patterns. Summer, Halloween, and Q4 (holiday gifting) are typically strongest. Patriotic themes peak around Memorial Day and July 4th.'],
      ['supplement sales', 'candy sales'],
      ['supplement industry', 'candy industry'],
    ],
  },

  // 9. How to Get Into Retail — vitamin email pitch + trade shows
  '50e18c49-a8cc-4ae8-a664-4350c016b3a4': {
    replaceInText: [
      ['New American-Made Gummy Vitamins for', 'New American-Made Gummy Candy for'],
      ['Gummy Vitamins', 'Gummy Candy'],
      ['gummy vitamins', 'gummy candy'],
      ['biggest supplement trade shows', 'biggest food and candy trade shows'],
      ['Natural Products Expo West/East are the biggest supplement trade shows. Expensive but high-value buyer meetings.',
       'Sweets & Snacks Expo, Natural Products Expo West, and Fancy Food Show are key trade shows for candy/confectionery. Expensive but high-value buyer meetings.'],
      ['vitamin aisle', 'candy aisle'],
      ['supplement aisle', 'candy aisle'],
      ['vitamins', 'gummy candy'],
      ['supplement', 'candy'],
    ],
  },

  // 10. Faire Strategy — health food store reference
  '88c30b74-6ec9-4f40-9447-0189f23a1096': {
    replaceInText: [
      ['health food stores, specialty retailers, and boutiques', 'candy shops, specialty retailers, gift shops, and boutiques'],
      ['health food store', 'candy shop'],
      ['vitamin shop', 'candy shop'],
      ['supplement shop', 'candy shop'],
      ['health-conscious consumers', 'candy-loving consumers and gift buyers'],
      ['gummy vitamins', 'gummy candy'],
      ['gummy vitamin', 'gummy candy'],
      ['vitamins', 'gummy bears'],
      ['supplements', 'candy'],
    ],
  },
};

async function main() {
  console.log('\n🔧 PATCHING TEACHINGS: Remove vitamin/supplement references\n');
  console.log('═'.repeat(60));

  let patched = 0;
  let failed = 0;

  for (const [id, correction] of Object.entries(CORRECTIONS)) {
    console.log(`\n📝 Patching: ${correction.title || id.slice(0, 12)}...`);

    try {
      // If replaceInText mode, fetch current text and apply replacements
      if (correction.replaceInText) {
        // Fetch current entry
        const fetchRes = await fetch(
          `${SUPABASE_URL}/rest/v1/open_brain_entries?id=eq.${id}&select=title,raw_text,summary_text`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        );
        const entries = await fetchRes.json();
        if (!entries || entries.length === 0) {
          console.log(`   ⚠️ Entry not found: ${id}`);
          failed++;
          continue;
        }

        let { title, raw_text, summary_text } = entries[0];
        const originalText = raw_text;

        // Apply text replacements (case-insensitive for each pair)
        for (const [oldStr, newStr] of correction.replaceInText) {
          const regex = new RegExp(escapeRegex(oldStr), 'gi');
          raw_text = raw_text.replace(regex, newStr);
          if (summary_text) {
            summary_text = summary_text.replace(regex, newStr);
          }
          if (title) {
            title = title.replace(regex, newStr);
          }
        }

        if (raw_text === originalText) {
          console.log(`   ⏭️ No changes needed (text didn't match patterns)`);
          continue;
        }

        await patchEntry(id, { title, raw_text, summary_text });
        console.log(`   ✅ Patched (text replacements applied)`);
        patched++;
      }
      // If full override mode, use provided title/raw_text/summary_text
      else {
        const updates = {};
        if (correction.title) updates.title = correction.title;
        if (correction.raw_text) updates.raw_text = correction.raw_text;
        if (correction.summary_text) updates.summary_text = correction.summary_text;

        await patchEntry(id, updates);
        console.log(`   ✅ Patched (full text override)`);
        patched++;
      }
    } catch (err) {
      console.log(`   ❌ Error: ${err.message.slice(0, 100)}`);
      failed++;
    }

    // Rate limit for OpenAI embedding calls
    await new Promise(r => setTimeout(r, 400));
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`✅ Patching complete: ${patched} patched, ${failed} failed`);
  console.log('═'.repeat(60) + '\n');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
