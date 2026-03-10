#!/usr/bin/env node
/**
 * abra-correct-confectionery.mjs
 *
 * CRITICAL CORRECTION: USA Gummies sells confectionery gummies, NOT vitamins/supplements.
 *
 * 1. Inserts a correction entry (HOT tier, 2x boost)
 * 2. Supersedes incorrect vitamin/supplement teachings
 * 3. Inserts corrected confectionery-focused replacements
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

async function insertEntry(entry) {
  const embText = `${entry.title}. ${entry.raw_text}`;
  const embedding = await getEmbedding(embText);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/open_brain_entries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      ...entry,
      source_type: 'manual',
      source_ref: `correction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      processed: true,
      embedding,
    }),
  });

  const body = await res.text();
  if (!res.ok) throw new Error(`Insert failed (${res.status}): ${body.slice(0, 200)}`);
  const result = JSON.parse(body);
  return result[0]?.id || result.id;
}

async function supersede(oldId, newId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/open_brain_entries?id=eq.${oldId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({ superseded_by: newId }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.log(`   ⚠️ Supersede failed for ${oldId.slice(0,8)}: ${err.slice(0,100)}`);
  }
}

async function main() {
  console.log('\n🔧 ABRA CORRECTION: Confectionery, NOT Supplements\n');
  console.log('═'.repeat(60));

  // 1. INSERT CORRECTION (HOT tier — 2x boost, always shown first)
  console.log('\n📌 Inserting correction entry (HOT tier)...');
  const correctionId = await insertEntry({
    entry_type: 'correction',
    title: 'CORRECTION: USA Gummies Sells Confectionery Gummies, NOT Vitamins or Supplements',
    raw_text: `CRITICAL CORRECTION from founder (Ben Stutman):

USA Gummies is a CONFECTIONERY company. We sell candy gummy bears — NOT vitamins, NOT supplements, NOT dietary supplements.

Key facts:
- Our products are CONFECTIONERY gummies (candy gummy bears)
- We do NOT sell gummy vitamins, gummy supplements, or any dietary supplement products
- We are NOT regulated by FDA as a dietary supplement manufacturer
- We are regulated as a FOOD/CONFECTIONERY product under standard food safety regulations (FDA food safety, state food manufacturing licenses)
- Our category is CONFECTIONERY/CANDY, not health & wellness or supplements
- Our competitors are other gummy candy brands, NOT vitamin/supplement brands
- We do NOT need DSHEA compliance, supplement facts panels, or GMP for dietary supplements
- We DO need standard food labeling (nutrition facts panel, allergen declarations, ingredients list)
- Our retail buyers are in the CANDY/CONFECTIONERY aisle, not the vitamin/supplement aisle

Any previous entries referencing "gummy vitamins", "dietary supplements", "supplement manufacturing", or "FDA supplement regulations" are INCORRECT and should be disregarded in favor of this correction.`,
    summary_text: 'USA Gummies sells confectionery gummy bears (candy), NOT vitamins or dietary supplements. Regulated as food/confectionery.',
    category: 'teaching',
    department: 'executive',
    confidence: 'high',
    priority: 'critical',
  });
  console.log(`   ✅ Correction inserted: ${correctionId}`);

  // 2. SUPERSEDE INCORRECT TEACHINGS
  // These are the most egregiously wrong ones that need to be replaced
  const toSupersede = [
    { id: '3db6420a', title: 'Gummy Vitamin Manufacturing Process' },
    { id: '6ce86d7e', title: 'Gummy Vitamin Ingredient Sourcing' },
    { id: '0ac4c9b5', title: 'Gummy Vitamin Competitive Landscape' },
    { id: 'd3ad1c26', title: 'Amazon Selling Strategy for Supplements' },
    { id: 'a9012bda', title: 'FDA Regulatory Requirements for Dietary Supplements' },
  ];

  // Get full UUIDs for these entries
  console.log('\n🔍 Finding entries to supersede...');
  const allTeachings = await fetch(
    `${SUPABASE_URL}/rest/v1/open_brain_entries?entry_type=eq.teaching&select=id,title`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  ).then(r => r.json());

  const supersedeTitles = [
    'Gummy Vitamin Manufacturing Process',
    'Gummy Vitamin Ingredient Sourcing',
    'Gummy Vitamin Competitive Landscape',
    'Amazon Selling Strategy for Supplements',
    'FDA Regulatory Requirements for Dietary Supplements',
  ];

  const idsToSupersede = allTeachings
    .filter(t => supersedeTitles.includes(t.title))
    .map(t => ({ id: t.id, title: t.title }));

  console.log(`   Found ${idsToSupersede.length} entries to supersede`);

  // 3. INSERT CORRECTED REPLACEMENTS
  const replacements = [
    {
      entry_type: 'teaching',
      title: 'Confectionery Gummy Manufacturing Process',
      raw_text: `Taught by founder (Ben Stutman):

USA Gummies manufactures confectionery gummy bears — candy products, not supplements.

The confectionery gummy manufacturing process:
1. INGREDIENT MIXING: Gelatin (or pectin for vegan), sugar, corn syrup, citric acid, natural flavors, colors. No vitamins, minerals, or active ingredients.
2. COOKING: Ingredients heated and mixed in mogul systems or depositing lines. Temperature control is critical for texture.
3. DEPOSITING: Liquid gummy is deposited into starch molds or silicone molds in the desired shapes (bears, worms, rings, etc.).
4. CURING/DRYING: Gummies cure in the molds for 24-48 hours in controlled temperature/humidity rooms. This sets the texture.
5. DEMOLDING: Gummies are removed from molds, excess starch is cleaned off.
6. COATING: Oil coating or sour sugar coating applied depending on the product.
7. PACKAGING: Weighed and packed into bags, pouches, or bulk containers.
8. QUALITY CONTROL: Weight checks, texture testing, taste testing, microbial testing (standard food safety, not supplement GMP).

Key differences from supplement gummies:
- No active ingredient dosing or uniformity testing
- No supplement facts panel (uses nutrition facts instead)
- Regulated under food safety laws, not DSHEA
- Lower regulatory burden, faster time to market
- Focus is on TASTE and TEXTURE, not bioavailability`,
      summary_text: 'Confectionery gummy manufacturing: mixing, cooking, depositing into molds, curing, coating, packaging. Candy production, not supplements.',
      category: 'supply_chain',
      department: 'supply_chain',
      confidence: 'high',
      priority: 'important',
    },
    {
      entry_type: 'teaching',
      title: 'Confectionery Gummy Ingredient Sourcing',
      raw_text: `Taught by founder (Ben Stutman):

USA Gummies sources standard confectionery ingredients — NOT supplement-grade vitamins or nutraceuticals.

Core ingredients for confectionery gummies:
- GELATIN: Pork or beef gelatin (200-250 bloom strength). Sourced from established gelatin suppliers.
- SUGAR: Granulated cane or beet sugar
- CORN SYRUP / GLUCOSE SYRUP: For texture and moisture control
- CITRIC ACID: For sour flavor
- NATURAL FLAVORS: Fruit flavors (strawberry, raspberry, lemon, orange, cherry, grape, etc.)
- COLORS: Natural colors (fruit/vegetable juice concentrates) or FD&C approved colors
- COATINGS: Carnauba wax, mineral oil, or sour sugar coating

Supplier considerations:
- Food-grade ingredients (not pharma-grade)
- Standard food safety certifications (SQF, BRC, or equivalent)
- Allergen management (gelatin is an allergen in some markets)
- Kosher/Halal certifications if targeting those markets
- MOQ (minimum order quantities) vary by ingredient
- Lead times typically 2-4 weeks for domestic, 6-8 weeks for imported gelatin`,
      summary_text: 'Confectionery gummy ingredients: gelatin, sugar, corn syrup, citric acid, natural flavors, colors. Food-grade, not pharma-grade.',
      category: 'supply_chain',
      department: 'supply_chain',
      confidence: 'high',
      priority: 'important',
    },
    {
      entry_type: 'teaching',
      title: 'Confectionery Gummy Competitive Landscape',
      raw_text: `Taught by founder (Ben Stutman):

USA Gummies competes in the CONFECTIONERY/CANDY market, not the supplement market.

Our competitors are candy gummy brands:
- HARIBO: The global gummy bear leader. German brand, massive distribution, gold standard for texture.
- BLACK FOREST: Organic/natural positioning in the candy aisle. Strong in grocery.
- ALBANESE: Known for quality and variety. Strong in specialty/gift channels.
- TROLLI: Sour gummy specialist. Strong brand recognition with younger consumers.
- SMART SWEETS: Low-sugar candy positioning. Premium price point.
- SURF SWEETS: Organic, allergy-friendly gummies.
- Private label: Store brand gummies at Walmart, Target, grocery chains.

USA Gummies differentiator: American-made, patriotic branding, quality confectionery gummies. We compete on brand identity, quality ingredients, and our American-made story.

We are NOT competing with:
- Vitafusion, Nature Made, SmartyPants (those are supplement brands)
- Any gummy vitamin or supplement company

Our retail placement target: CANDY AISLE, not vitamin/supplement aisle.
Our Amazon category: Grocery & Gourmet Food > Candy & Chocolate > Gummy Candy`,
      summary_text: 'USA Gummies competes with Haribo, Black Forest, Albanese, Trolli in the candy/confectionery space. NOT a supplement brand.',
      category: 'competitive',
      department: 'sales_and_growth',
      confidence: 'high',
      priority: 'important',
    },
    {
      entry_type: 'teaching',
      title: 'Amazon Selling Strategy for Confectionery Gummies',
      raw_text: `Taught by founder (Ben Stutman):

USA Gummies sells on Amazon in the GROCERY & GOURMET FOOD category, specifically under Candy & Chocolate > Gummy Candy. We are NOT in the Health & Household > Vitamins & Supplements category.

Amazon strategy for confectionery:
- CATEGORY: Grocery & Gourmet Food > Candy & Chocolate > Gummy Candy
- LISTING OPTIMIZATION: Focus on taste, texture, quality ingredients, American-made
- KEYWORDS: gummy bears, candy, American candy, patriotic candy, gourmet gummies
- NOT: vitamins, supplements, health, wellness
- IMAGES: Lifestyle shots showing candy enjoyment, not health benefits
- A+ CONTENT: Brand story (American-made), ingredient quality, flavor variety
- PRICING: Competitive with premium candy brands ($8-15 per bag depending on size)
- REVIEWS: Drive reviews through quality product experience
- SUBSCRIBE & SAVE: Yes — candy is a repeat purchase category
- FBA vs FBM: FBA preferred for candy (fast shipping, Prime badge)
- SEASONAL: Holiday gift sets, summer candy, patriotic themes for July 4th/Memorial Day

Amazon fees for grocery:
- Referral fee: 8% for grocery items over $15, 15% for items under $15
- FBA fees: Based on weight and dimensions
- Estimated margin: 30-40% after all Amazon fees and COGS`,
      summary_text: 'Amazon strategy: sell in Grocery > Gummy Candy category. Focus on taste, American-made branding. Not vitamins/supplements.',
      category: 'sales',
      department: 'sales_and_growth',
      confidence: 'high',
      priority: 'important',
    },
    {
      entry_type: 'teaching',
      title: 'Food Safety Regulations for Confectionery Products',
      raw_text: `Taught by founder (Ben Stutman):

USA Gummies is a FOOD/CONFECTIONERY company, regulated under standard food safety laws — NOT dietary supplement regulations (DSHEA).

Applicable regulations for confectionery gummies:
1. FDA FOOD SAFETY: Regulated under the Federal Food, Drug, and Cosmetic Act as a food product
2. NUTRITION FACTS PANEL: Required (not "Supplement Facts" — that's for supplements)
3. INGREDIENT LIST: Listed in descending order by weight
4. ALLERGEN LABELING: FALCPA requires declaration of major allergens (gelatin may be relevant)
5. NET WEIGHT: Must be declared accurately
6. FACILITY REGISTRATION: Must register food facility with FDA under the Bioterrorism Act
7. cGMP FOR FOOD: 21 CFR Part 117 (Current Good Manufacturing Practice for food), NOT 21 CFR Part 111 (that's for supplements)
8. FSMA (Food Safety Modernization Act): Applies to food facilities
9. STATE REGULATIONS: State food manufacturing licenses, health department inspections
10. LABELING CLAIMS: Cannot make health claims (we're candy, not a health product)

What we do NOT need (because we're not supplements):
- DSHEA compliance
- Supplement Facts panel
- Dietary ingredient notifications
- Adverse event reporting under DSHEA
- 21 CFR Part 111 (supplement GMP)
- Structure/function claims

Our label must have: Product name, Net weight, Nutrition Facts, Ingredients, Allergen info, Manufacturer info, UPC barcode.`,
      summary_text: 'USA Gummies regulated as food/confectionery under FDA food safety rules, FSMA, cGMP for food (21 CFR 117). NOT under DSHEA supplement regulations.',
      category: 'regulatory',
      department: 'operations',
      confidence: 'high',
      priority: 'important',
    },
  ];

  for (const replacement of replacements) {
    console.log(`\n📝 Inserting: ${replacement.title}`);
    try {
      const newId = await insertEntry(replacement);
      console.log(`   ✅ Inserted: ${newId}`);

      // Supersede the old version
      const matchingOld = idsToSupersede.find(old => {
        if (replacement.title.includes('Manufacturing') && old.title.includes('Manufacturing')) return true;
        if (replacement.title.includes('Ingredient') && old.title.includes('Ingredient')) return true;
        if (replacement.title.includes('Competitive') && old.title.includes('Competitive')) return true;
        if (replacement.title.includes('Amazon') && old.title.includes('Amazon')) return true;
        if (replacement.title.includes('Food Safety') && old.title.includes('FDA')) return true;
        return false;
      });

      if (matchingOld) {
        await supersede(matchingOld.id, newId);
        console.log(`   🔄 Superseded old: ${matchingOld.title}`);
      }
    } catch (err) {
      console.log(`   ❌ Error: ${err.message.slice(0, 100)}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n' + '═'.repeat(60));
  console.log('✅ Correction complete — confectionery, not supplements');
  console.log('═'.repeat(60) + '\n');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
