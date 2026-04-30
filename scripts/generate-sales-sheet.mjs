#!/usr/bin/env node
/**
 * generate-sales-sheet.mjs — PDF Sell Sheet Generator v3
 *
 * Usage:
 *   node scripts/generate-sales-sheet.mjs                  # Generate all variants
 *   node scripts/generate-sales-sheet.mjs airport           # Generate one variant
 *
 * Output: sales-sheets/usa-gummies-sell-sheet-{channel}.pdf
 */

import puppeteer from "puppeteer-core";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(ROOT, "sales-sheets");

// Encode assets as base64
const logoBase64 = `data:image/png;base64,${readFileSync(resolve(ROOT, "public/brand/logo-full.png")).toString("base64")}`;
// Amazon main listing image (white bg, bag + 5 gummy bears, Made in USA seal)
const productBase64 = `data:image/jpeg;base64,${readFileSync(resolve(ROOT, "public/brand/product-hero-amazon.jpg")).toString("base64")}`;
// B17 Bomber art asset (brand element from packaging)
const bomberBase64 = `data:image/png;base64,${readFileSync(resolve(ROOT, "public/brand/website assets/B17Bomber.png")).toString("base64")}`;
// Horizontal logo (wide format)
const logoHorizBase64 = `data:image/png;base64,${readFileSync(resolve(ROOT, "public/brand/logo-horizontal.png")).toString("base64")}`;

// ── Product info (AUDITED — all claims verifiable) ────────────────────────────
const PRODUCT = {
  name: "All American Gummy Bears",
  weight: "7.5 oz (213g)",
  upc: "199284715530",
  // NOT resealable — removed false claim
  casePack: "6 bags/case (with strip clip for hanging)",
  masterCarton: "36 bags (6 cases) per master carton",
  caseWeight: "3.4 lbs gross",
  masterWeight: "22.0 lbs gross",
  masterDims: '22" × 14" × 8"',
  shelfLife: "18 months",
  flavors: "Cherry, Watermelon, Orange, Green Apple, Lemon",
  allergens: "Free of Top 9 allergens",
  certifications: "FDA-registered facilities (manufacturing & packing) · cGMP compliant · Made in USA — product, packaging film, and all components domestically sourced",
  // Ingredients: exact from product/ingredients page
  ingredients: "Corn syrup, sugar, water, gelatin, citric acid, natural flavor, pectin, colors added (from fruits, vegetables, spirulina, and curcumin), vegetable oil (coconut, canola), carnauba leaf wax.",
  // Colors: matched to ingredient label — "colors from fruits, vegetables, spirulina, and curcumin"
  colors: "Natural colors only — from fruits, vegetables, spirulina, and curcumin. Zero artificial dyes. Compliant with California AB 418 and pending state dye-ban legislation.",
};

// Pallet: 25 master cartons (5 per layer × 5 layers high). Confirmed by Ben.
// 25 MC × 22 lbs = 550 lbs. 25 MC × 36 bags = 900 bags.
const PALLET = {
  masterCartons: 25,
  totalBags: 25 * 36, // 900
  weight: "~550 lbs",
  config: "5 per layer × 5 layers",
};

const MOQ_NOTE = `Minimum order: 1 master carton (36 bags / 6 cases). All cases include strip clips for retail hanging display.`;

// Suggested retail across ALL channels: $4.99–$5.99 (never below $4.99, never above $5.99)
// Confirmed by Ben 2026-04-30 — canonical MSRP ceiling is $5.99, not $6.49.
const SUGGESTED_RETAIL = "$4.99–$5.99";
const RETAILER_MARGIN = "42–50%";

// ── Channel configs ───────────────────────────────────────────────────────────
const CHANNELS = {
  airport: {
    label: "Airport Retail Edition",
    headline: "America's Gummy Bear — For Airport Retail",
    subheadline: "The impulse-buy American souvenir travelers reach for.",
    pricing: [
      { tier: "Pallet (25 MC / 900 bags)", price: "$3.00/unit", terms: "Net 30 · Freight Negotiable" },
      { tier: "6 Master Cartons (216 bags)", price: "$3.25/unit", terms: "Net 15 · Shipping applies" },
      { tier: "1 Master Carton (36 bags)", price: "$3.49/unit", terms: "Net 15 · Shipping applies" },
    ],
    color: "#1B4D8C",
    accent: "#D4AF37",
    bullets: [
      "Impulse-friendly 7.5 oz bags — grab-and-go format for terminals",
      "Patriotic packaging stands out in terminal newsstands and gift shops",
      "Made in USA — product, packaging film, and all components are American-made",
      "FREE FROM ARTIFICIAL DYES — compliant with California and upcoming state bans",
      "Natural colors from fruits, vegetables, spirulina, and curcumin",
      "18-month shelf life — minimal shrink risk for high-turnover airport retail",
      "Every stocking location gets a piggyback listing on usagummies.com",
      "Also available on Amazon for consumer awareness and cross-channel discovery",
    ],
    cta: "Perfect for Hudson, Paradies Lagardère, OTG, HMSHost, and airport authority local vendor programs.",
  },
  museum_gift: {
    label: "Museum & Gift Store Edition",
    headline: "America's Gummy Bear — For Museum & Gift Stores",
    subheadline: "A museum-store-appropriate American souvenir with a story worth telling.",
    pricing: [
      { tier: "Pallet (25 MC / 900 bags)", price: "$3.25/unit", terms: "Net 30 · Freight Negotiable" },
      { tier: "6 Master Cartons (216 bags)", price: "$3.39/unit", terms: "Net 15 · Shipping applies" },
      { tier: "1 Master Carton (36 bags)", price: "$3.49/unit", terms: "Net 15 · Shipping applies" },
    ],
    color: "#4A2D7A",
    accent: "#C5A55A",
    bullets: [
      "Made in USA with natural colors — fits the American story your store tells",
      "America 250 (2026) — patriotic product perfectly timed for the anniversary",
      "MSA vendor directory category: Food → Candy, Made in America",
      "FREE FROM ARTIFICIAL DYES — a guilt-free souvenir purchase for visitors",
      "Everything — down to the packaging film — is made in the United States",
      "Great take-home gift item with bold patriotic packaging",
      "Every stocking location gets a piggyback listing on usagummies.com",
      "Also available on Amazon for consumer awareness and cross-channel discovery",
    ],
    cta: "Ideal for MSA member stores, historic site gift shops, and America 250 commemorative retail.",
  },
  national_park: {
    label: "National Park Edition",
    headline: "America's Gummy Bear — For National Park Gift Shops",
    subheadline: "Made in USA. Natural colors. A treat visitors take home as a piece of America.",
    pricing: [
      { tier: "Pallet (25 MC / 900 bags)", price: "$3.00/unit", terms: "Net 30 · Freight Negotiable" },
      { tier: "6 Master Cartons (216 bags)", price: "$3.15/unit", terms: "Net 15 · Shipping applies" },
      { tier: "1 Master Carton (36 bags)", price: "$3.25/unit", terms: "Net 15 · Shipping applies" },
    ],
    color: "#2D5F2D",
    accent: "#D4AF37",
    bullets: [
      "100% Made in USA — fits Xanterra's 80% domestic inventory standard",
      "FREE FROM ARTIFICIAL DYES — natural colors from fruits & vegetables only",
      "Everything — product, packaging film, components — is American-made",
      "Perfect for trail-side and campground retail gift shops",
      "18-month shelf life with cool/dry storage — full seasonal flexibility",
      "Free of Top 9 allergens — family-friendly for all park visitors",
      "Every stocking location gets a piggyback listing on usagummies.com",
      "Also available on Amazon for consumer awareness and cross-channel discovery",
    ],
    cta: "Built for Xanterra, Delaware North, Aramark, Eastern National, and WNPA properties.",
  },
  military_exchange: {
    label: "Military Exchange Edition",
    headline: "America's Gummy Bear — For Military Exchanges",
    subheadline: "Patriotic. American-made. Free from artificial dyes. Proudly serving military families.",
    pricing: [
      { tier: "Pallet (25 MC / 900 bags)", price: "$2.75/unit", terms: "Net 30 · Freight Negotiable" },
      { tier: "6 Master Cartons (216 bags)", price: "$2.90/unit", terms: "Net 15 · Shipping applies" },
      { tier: "1 Master Carton (36 bags)", price: "$3.00/unit", terms: "Net 15 · Shipping applies" },
    ],
    color: "#1B2A4A",
    accent: "#CC0000",
    bullets: [
      "100% Made in USA — manufactured and packed in American FDA-registered facilities",
      "FREE FROM ARTIFICIAL DYES — proudly clean-label for military families",
      "Everything — down to the packaging film — is made in the United States",
      "Patriotic packaging that resonates with service members and their families",
      "AAFES small business supplier program compatible (submit via RangeMe)",
      "Free of Top 9 allergens — safe for the whole family",
      "Every stocking location gets a piggyback listing on usagummies.com",
      "Also available on Amazon for consumer awareness and cross-channel discovery",
    ],
    cta: "Ready for AAFES supplier onboarding. Small business, American-made, mission-aligned.",
  },
  general: {
    label: "General Wholesale Edition",
    headline: "America's Gummy Bear — Wholesale Partner Program",
    subheadline: "Clean ingredients. Made in USA. Free from artificial dyes. Built for retail.",
    pricing: [
      { tier: "Pallet (25 MC / 900 bags)", price: "Channel-dependent", terms: "Net 30 · Freight Negotiable" },
      { tier: "6 Master Cartons (216 bags)", price: "Channel-dependent", terms: "Net 15 · Shipping applies" },
      { tier: "1 Master Carton (36 bags)", price: "Channel-dependent", terms: "Net 15 · Shipping applies" },
    ],
    color: "#1B2A4A",
    accent: "#D4AF37",
    bullets: [
      "Made in USA — product, packaging film, and all components are American-made",
      "FREE FROM ARTIFICIAL DYES — natural colors from fruits, vegetables, spirulina, curcumin",
      "State dye-ban compliant (California AB 418 + more states pending)",
      "7.5 oz bags, 5 classic fruit flavors, 18-month shelf life",
      "Cases include strip clips for hanging retail display (6 bags per case)",
      "Custom pricing available for large orders — contact us for a quote",
      "Every stocking location gets a piggyback listing on usagummies.com",
      "Also available on Amazon for consumer awareness and cross-channel discovery",
    ],
    cta: "Contact us for channel-specific pricing. MOQ: 1 master carton (36 bags / 6 cases).",
  },
};

function buildHTML(channelKey) {
  const ch = CHANNELS[channelKey];

  const pricingRows = ch.pricing.map(p => `
    <tr>
      <td style="font-weight:700">${p.tier}</td>
      <td style="font-size:14px;font-weight:900;color:${ch.color}">${p.price}</td>
      <td>${p.terms}</td>
    </tr>
  `).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @page { size: letter; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    color: #1a1a1a;
    width: 8.5in;
    height: 11in;
    position: relative;
    overflow: hidden;
  }

  .header {
    background: ${ch.color};
    color: white;
    padding: 18px 36px 16px;
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .header::after {
    content: '';
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 3px;
    background: ${ch.accent};
  }
  .header-left { max-width: 400px; }
  .header-right { text-align: right; }
  .logo { height: 40px; margin-bottom: 6px; }
  .badge {
    background: ${ch.accent};
    color: ${ch.color};
    font-size: 7px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 3px 10px;
    border-radius: 14px;
    display: inline-block;
    margin-bottom: 6px;
  }
  .headline {
    font-size: 18px;
    font-weight: 900;
    line-height: 1.15;
    margin-bottom: 4px;
  }
  .subheadline {
    font-size: 9.5px;
    opacity: 0.8;
  }
  .product-img {
    width: 120px;
    height: 160px;
    object-fit: cover;
    border-radius: 8px;
    border: 2px solid rgba(255,255,255,0.3);
  }
  .dead-space {
    text-align: center;
    padding: 12px 36px 0;
  }
  .dead-space .ds-logo {
    width: 380px;
    height: auto;
    margin-bottom: 4px;
  }
  .bomber-img {
    width: 360px;
    height: auto;
    opacity: 1;
  }

  .body { padding: 14px 36px 12px; }

  /* Dye-free banner */
  .dye-free-banner {
    background: linear-gradient(90deg, #CC0000, #8B0000);
    color: white;
    text-align: center;
    padding: 5px 20px;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  /* Pricing table */
  .pricing-section { margin-bottom: 10px; }
  .pricing-table { width: 100%; border-collapse: collapse; font-size: 9px; }
  .pricing-table th {
    background: ${ch.color};
    color: white;
    padding: 4px 8px;
    text-align: left;
    font-size: 7px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .pricing-table td { padding: 4px 8px; border-bottom: 1px solid #eee; }
  .pricing-table tr:last-child td { border-bottom: none; }
  .pricing-note {
    font-size: 7.5px;
    color: #666;
    margin-top: 3px;
    line-height: 1.4;
  }
  .prepay-note {
    background: #FFFBF0;
    border-left: 3px solid ${ch.accent};
    padding: 4px 10px;
    font-size: 7.5px;
    color: #555;
    margin-top: 5px;
    border-radius: 0 4px 4px 0;
  }

  .section-title {
    font-size: 7.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: ${ch.color};
    margin-bottom: 5px;
    padding-bottom: 2px;
    border-bottom: 2px solid ${ch.accent};
  }

  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-bottom: 8px;
  }

  .bullet-list { list-style: none; }
  .bullet-list li {
    font-size: 8.5px;
    line-height: 1.35;
    padding: 2px 0;
    padding-left: 13px;
    position: relative;
  }
  .bullet-list li::before {
    content: '★';
    position: absolute;
    left: 0;
    color: ${ch.accent};
    font-size: 7px;
  }
  .bullet-list li strong { color: #CC0000; }

  .specs-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px 10px;
  }
  .spec-row {
    display: flex;
    justify-content: space-between;
    font-size: 8px;
    padding: 2px 0;
    border-bottom: 1px solid #eee;
  }
  .spec-label { font-weight: 700; color: #555; }
  .spec-value { font-weight: 600; text-align: right; max-width: 55%; }

  .ingredients-box {
    background: #f7f7f5;
    border-radius: 5px;
    padding: 6px 8px;
    margin-top: 6px;
  }
  .ingredients-box .section-title { margin-bottom: 3px; }
  .ingredients-text {
    font-size: 7.5px;
    line-height: 1.4;
    color: #444;
  }

  .tags {
    display: flex;
    gap: 3px;
    flex-wrap: wrap;
    margin-top: 5px;
  }
  .tag {
    background: ${ch.color}12;
    color: ${ch.color};
    font-size: 6.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 2px 6px;
    border-radius: 8px;
    border: 1px solid ${ch.color}25;
  }
  .tag-red {
    background: #FFF0F0;
    color: #CC0000;
    border-color: #CC000025;
  }

  .cta-box {
    background: linear-gradient(135deg, ${ch.color}, ${ch.color}dd);
    color: white;
    border-radius: 6px;
    padding: 8px 12px;
    margin-top: 6px;
  }
  .cta-text { font-size: 8.5px; line-height: 1.4; opacity: 0.9; }

  .footer {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: #fafafa;
    border-top: 2px solid ${ch.accent};
    padding: 8px 36px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .footer-left { font-size: 7.5px; color: #666; line-height: 1.5; }
  .footer-right { text-align: right; }
  .footer-right .email { font-size: 9px; font-weight: 800; color: ${ch.color}; }
  .footer-right .web { font-size: 7.5px; color: #888; }
  .footer-logo { height: 20px; margin-right: 8px; vertical-align: middle; opacity: 0.4; }

  .suggested-retail-box { text-align: center; }
  .suggested-retail-box .label {
    font-size: 6.5px; text-transform: uppercase; letter-spacing: 0.12em; color: #888;
  }
  .suggested-retail-box .value {
    font-size: 16px; font-weight: 900; color: ${ch.color};
  }
  .suggested-retail-box .margin {
    font-size: 8px; color: #2D5F2D; font-weight: 700;
  }
</style>
</head>
<body>

  <!-- DYE-FREE BANNER -->
  <div class="dye-free-banner">
    ★ Free From Artificial Dyes — Made in the USA — Everything Down to the Film ★
  </div>

  <!-- Spacer to push dead-space content below CTA -->
  <div style="clear:both;"></div>

  <!-- HEADER -->
  <div class="header">
    <div class="header-left">
      <img src="${logoBase64}" class="logo" alt="USA Gummies" />
      <div class="badge">${ch.label}</div>
      <div class="headline">${ch.headline}</div>
      <div class="subheadline">${ch.subheadline}</div>
    </div>
    <div class="header-right">
      <img src="${productBase64}" class="product-img" alt="USA Gummies All American Gummy Bears" />
    </div>
  </div>

  <!-- BODY -->
  <div class="body">

    <!-- PRICING -->
    <div class="pricing-section">
      <div class="section-title">Wholesale Pricing & MOQs</div>
      <div style="display:flex;gap:14px;align-items:flex-start;">
        <div style="flex:1;">
          <table class="pricing-table">
            <tr><th>Order Tier</th><th>Unit Price</th><th>Payment Terms</th></tr>
            ${pricingRows}
          </table>
          <div class="pricing-note">${MOQ_NOTE}</div>
          <div class="prepay-note">
            <strong>Prepay discount:</strong> Pay upfront on any sub-pallet order and split the difference between your tier price and the next tier down. Custom pricing available for large orders — contact us.
          </div>
        </div>
        <div style="width:130px;text-align:center;">
          <div class="suggested-retail-box">
            <div class="label">Suggested Retail</div>
            <div class="value">${SUGGESTED_RETAIL}</div>
            <div class="margin">${RETAILER_MARGIN} retailer margin</div>
          </div>
          <div style="font-size:6.5px;color:#888;text-align:center;margin-top:4px;">
            Pallet: ${PALLET.masterCartons} MC (${PALLET.totalBags} bags)<br/>
            ${PALLET.weight} · ${PALLET.config}
          </div>
        </div>
      </div>
    </div>

    <!-- TWO COLUMN: BULLETS + SPECS -->
    <div class="two-col">
      <div>
        <div class="section-title">Why USA Gummies</div>
        <ul class="bullet-list">
          ${ch.bullets.map(b => {
            const formatted = b.replace(/FREE FROM ARTIFICIAL DYES/g, '<strong>FREE FROM ARTIFICIAL DYES</strong>');
            return `<li>${formatted}</li>`;
          }).join("\n          ")}
        </ul>
        <div class="tags">
          <span class="tag tag-red">Free From Artificial Dyes</span>
          <span class="tag">Made in USA</span>
          <span class="tag">Natural Colors</span>
          <span class="tag">Dye-Ban Compliant</span>
          <span class="tag">Allergen Free</span>
          <span class="tag">18-Month Shelf Life</span>
          <span class="tag">On Amazon</span>
        </div>
      </div>
      <div>
        <div class="section-title">Product Specifications</div>
        <div class="specs-grid">
          <div class="spec-row"><span class="spec-label">Product</span><span class="spec-value">${PRODUCT.name}</span></div>
          <div class="spec-row"><span class="spec-label">Net Weight</span><span class="spec-value">${PRODUCT.weight}</span></div>
          <div class="spec-row"><span class="spec-label">UPC</span><span class="spec-value">${PRODUCT.upc}</span></div>
          <div class="spec-row"><span class="spec-label">Case Pack</span><span class="spec-value">${PRODUCT.casePack}</span></div>
          <div class="spec-row"><span class="spec-label">Master Carton</span><span class="spec-value">${PRODUCT.masterCarton}</span></div>
          <div class="spec-row"><span class="spec-label">Master Weight</span><span class="spec-value">${PRODUCT.masterWeight}</span></div>
          <div class="spec-row"><span class="spec-label">Dimensions</span><span class="spec-value">${PRODUCT.masterDims}</span></div>
          <div class="spec-row"><span class="spec-label">Shelf Life</span><span class="spec-value">${PRODUCT.shelfLife}</span></div>
          <div class="spec-row"><span class="spec-label">Flavors</span><span class="spec-value">${PRODUCT.flavors}</span></div>
          <div class="spec-row"><span class="spec-label">Allergens</span><span class="spec-value">${PRODUCT.allergens}</span></div>
        </div>
        <div style="font-size:7px;color:#555;margin-top:3px;line-height:1.4;">
          <strong>Certifications:</strong> ${PRODUCT.certifications}
        </div>

        <div class="ingredients-box">
          <div class="section-title">Ingredients</div>
          <div class="ingredients-text">${PRODUCT.ingredients}</div>
          <div class="ingredients-text" style="margin-top:3px;"><strong>Colors:</strong> ${PRODUCT.colors}</div>
        </div>
      </div>
    </div>

    <!-- CTA -->
    <div class="cta-box">
      <div class="cta-text">
        <strong>Ready to stock USA Gummies?</strong> ${ch.cta}<br/>
        Request samples, pricing, or place a starter order. We ship fast and support our retail partners.
      </div>
    </div>

    <!-- Logo + Bomber in dead space -->
    <div class="dead-space">
      <img src="${logoHorizBase64}" class="ds-logo" alt="USA Gummies — Made in the U.S.A." /><br/>
      <img src="${bomberBase64}" class="bomber-img" alt="" />
    </div>
  </div>

  <!-- FOOTER -->
  <div class="footer">
    <div class="footer-left">
      <img src="${logoBase64}" class="footer-logo" alt="" />
      USA Gummies, Inc. · Sheridan, Wyoming · Made in USA<br/>
      FDA-Registered Facilities · cGMP Compliant · Everything Made in America · Also on Amazon
    </div>
    <div class="footer-right">
      <div class="email">ben@usagummies.com</div>
      <div class="web">usagummies.com/wholesale · (307) 209-4928</div>
    </div>
  </div>

</body>
</html>`;
}

async function generatePDF(channelKey) {
  const html = buildHTML(channelKey);
  const outPath = resolve(OUT_DIR, `usa-gummies-sell-sheet-${channelKey}.pdf`);

  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: "new",
    args: ["--no-sandbox"],
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.pdf({
    path: outPath,
    format: "Letter",
    printBackground: true,
    preferCSSPageSize: false,
  });

  await browser.close();
  console.log(`✅ Generated: ${outPath}`);
  return outPath;
}

const requestedChannel = process.argv[2];
const channelsToGenerate = requestedChannel ? [requestedChannel] : Object.keys(CHANNELS);

console.log(`🎨 Generating ${channelsToGenerate.length} sell sheet(s) v3...`);

for (const ch of channelsToGenerate) {
  if (!CHANNELS[ch]) {
    console.error(`❌ Unknown channel: ${ch}. Available: ${Object.keys(CHANNELS).join(", ")}`);
    process.exit(1);
  }
  await generatePDF(ch);
}

console.log(`\n📋 All sell sheets generated in: ${OUT_DIR}`);
