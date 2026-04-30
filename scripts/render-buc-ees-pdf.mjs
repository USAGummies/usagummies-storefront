// Render the Buc-ee's economics doc to PDF with the canonical USA Gummies
// financial-doc letterhead — matches the design Rene + Viktor built for
// NCS-001 / COSQ-001 / VND-001 + the shipped /tmp/sends/buc-ees-proposal.html.
//
// Run: cd /Users/ben/usagummies-storefront && node scripts/render-buc-ees-pdf.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const requireFromTmp = createRequire('/tmp/pdfgen/package.json');
const { marked } = requireFromTmp('marked');

const MD_PATH = '/Users/ben/usagummies-storefront/contracts/proposals/buc-ees-private-label-economics.md';
const PDF_PATH = '/Users/ben/usagummies-storefront/contracts/proposals/buc-ees-private-label-economics.pdf';
const TMP_HTML = '/tmp/buc-ees-economics.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOGO_PATH = '/Users/ben/usagummies-storefront/public/brand/logo-full.png';

marked.setOptions({ gfm: true, breaks: false });

const md = await readFile(MD_PATH, 'utf8');
const htmlBody = marked.parse(md);

const today = new Date().toLocaleDateString('en-US', {
  year: 'numeric', month: '2-digit', day: '2-digit',
});

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>USA Gummies — Buc-ee's Internal Economics Analysis</title>
<style>
  @page { size: letter; margin: 0.5in 0.55in; }
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #222; font-size: 10pt; line-height: 1.45; margin: 0; padding: 0; }

  /* ========= LETTERHEAD ========= */
  .letterhead { display: flex; justify-content: space-between; align-items: center; padding: 0 0 12px 0; }
  .letterhead-logo img { height: 64px; width: auto; }
  .letterhead-address { text-align: right; font-size: 9pt; line-height: 1.45; color: #1B2A4A; }
  .letterhead-address .company { font-size: 12pt; font-weight: 700; }
  .letterhead-address .web { color: #C42026; }

  .title-bar { background: #1B2A4A; color: #fff; display: flex; justify-content: space-between; padding: 7px 14px; font-weight: 700; }
  .title-bar .doc-title { font-size: 11pt; letter-spacing: 0.02em; }
  .title-bar .form-code { font-size: 9pt; letter-spacing: 0.05em; }
  .subtitle-bar { background: #ECEEF2; text-align: center; padding: 5px; font-size: 8.5pt; color: #555; letter-spacing: 0.04em; border-bottom: 1px solid #d0d4dc; }

  /* ========= BODY ========= */
  .body { padding: 14px 0 20px 0; }
  /* H1 from markdown becomes the doc title — hide it (we show it in title-bar) */
  .body > h1:first-child { display: none; }
  h1 { color: #1B2A4A; font-size: 14pt; margin: 14px 0 6px 0; page-break-after: avoid; }
  h2 {
    background: #1B2A4A; color: #fff; font-size: 10.5pt; font-weight: 700;
    letter-spacing: 0.04em; text-transform: uppercase;
    padding: 6px 12px; margin: 16px 0 10px 0; page-break-after: avoid;
  }
  h3 { color: #1B2A4A; font-size: 11pt; margin: 12px 0 5px 0; page-break-after: avoid; }
  h4 { color: #1B2A4A; font-size: 10pt; margin: 10px 0 4px 0; page-break-after: avoid; }
  p, ul, ol { margin: 4px 0 8px 0; }
  ul, ol { padding-left: 22px; }
  li { margin: 2px 0; }
  strong, b { font-weight: 700; }

  blockquote { background: #F3F6FA; border-left: 3px solid #1B2A4A; padding: 8px 14px; margin: 8px 0; color: #333; font-size: 9.5pt; }
  code { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 9pt; background: #f3f3f3; padding: 1px 4px; border-radius: 2px; color: #1B2A4A; }
  pre { background: #f7f7f7; padding: 8px 10px; border-radius: 3px; font-size: 8.5pt; white-space: pre-wrap; border-left: 3px solid #1B2A4A; }
  pre code { background: transparent; padding: 0; color: inherit; }
  a { color: #C42026; text-decoration: none; }
  hr { border: none; border-top: 1px solid #d0d4dc; margin: 14px 0; }

  /* ========= TABLES ========= */
  table { border-collapse: collapse; width: 100%; margin: 8px 0 12px 0; font-size: 9pt; page-break-inside: auto; }
  thead th { background: #1B2A4A; color: #fff; padding: 5px 8px; text-align: left; font-weight: 700; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.04em; }
  tbody td { padding: 4px 8px; border-bottom: 1px solid #e3e6ec; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #FAFBFC; }
  tbody td[align="right"], thead th[align="right"] { text-align: right; font-variant-numeric: tabular-nums; }
  tr { page-break-inside: avoid; }

  /* ========= FOOTER ========= */
  .footer { text-align: center; padding: 12px 0 0 0; border-top: 2px solid #1B2A4A; margin-top: 18px; font-size: 8pt; line-height: 1.55; color: #555; }
  .footer .l1 { font-weight: 700; color: #1B2A4A; }
  .footer .l2 { letter-spacing: 0.04em; }
  .footer .l4 { color: #C42026; font-weight: 700; }
  .footer .l5 { color: #888; font-size: 7.5pt; margin-top: 4px; font-style: italic; }
</style>
</head>
<body>

<!-- LETTERHEAD -->
<div class="letterhead">
  <div class="letterhead-logo">
    <img src="file://${LOGO_PATH}" alt="USA Gummies" />
  </div>
  <div class="letterhead-address">
    <div class="company">USA Gummies, LLC</div>
    1309 Coffeen Ave, Ste 1200<br>
    Sheridan, WY 82801-5777<br>
    (307) 209-4928<br>
    <span class="web">www.usagummies.com</span>
  </div>
</div>

<!-- TITLE / SUBTITLE BAR -->
<div class="title-bar">
  <div class="doc-title">INTERNAL ECONOMICS ANALYSIS — BUC-EE'S</div>
  <div class="form-code">FORM ECN-001 · ${today}</div>
</div>
<div class="subtitle-bar">CONFIDENTIAL — INTERNAL PRICING &amp; COST FRAMEWORK · NOT FOR EXTERNAL DISTRIBUTION</div>

<!-- BODY -->
<div class="body">
${htmlBody}
</div>

<!-- FOOTER -->
<div class="footer">
  <div class="l1">USA Gummies, LLC &middot; Sheridan, Wyoming &middot; Made in USA</div>
  <div class="l2">FDA-REGISTERED FACILITIES &middot; cGMP COMPLIANT &middot; EVERYTHING MADE IN AMERICA</div>
  <div>ben@usagummies.com &middot; usagummies.com &middot; (307) 209-4928</div>
  <div class="l5">Internal pricing analysis · Companion to PROP-001 (Buc-ee's external proposal)</div>
</div>

</body>
</html>`;

await writeFile(TMP_HTML, html, 'utf8');

const result = spawnSync(
  CHROME,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--no-pdf-header-footer',
    '--print-to-pdf-no-header',
    '--virtual-time-budget=2000',
    `--print-to-pdf=${PDF_PATH}`,
    `file://${TMP_HTML}`,
  ],
  { stdio: 'inherit' },
);

if (result.status !== 0) {
  console.error('Chrome PDF render failed', result.status);
  process.exit(result.status ?? 1);
}

console.log('PDF written:', PDF_PATH);
