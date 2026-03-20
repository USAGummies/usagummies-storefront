#!/usr/bin/env node
/**
 * Test script: generate a sample vendor list XLSX to verify professional formatting.
 * Run: node scripts/test-xlsx-formatting.mjs
 * Output: /tmp/vendor-list-test.xlsx
 */

import ExcelJS from "exceljs";
import { writeFileSync } from "fs";

const HEADER_FILL = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F4E79" },
};

const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };

const ROW_FILL_LIGHT = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
const ROW_FILL_WHITE = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };

const THIN = { style: "thin", color: { argb: "FFD0D0D0" } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

const vendors = [
  { name: "Albanese Confectionery",  category: "Raw Materials",  contact: "sales@albanese.com",       leadTime: "3 weeks",  unitCost: 2.85,   moq: 500,   terms: "Net 30" },
  { name: "Powers Candy",            category: "Raw Materials",  contact: "orders@powerscandy.com",    leadTime: "2 weeks",  unitCost: 3.10,   moq: 250,   terms: "Net 30" },
  { name: "Belmark",                 category: "Packaging",      contact: "quotes@belmark.com",        leadTime: "4 weeks",  unitCost: 0.38,   moq: 10000, terms: "Net 45" },
  { name: "PirateShip",              category: "Fulfillment",    contact: "support@pirateship.com",    leadTime: "Next day", unitCost: 0.00,   moq: 1,     terms: "Prepaid" },
];

const headers = ["Vendor Name", "Category", "Contact Email", "Lead Time", "Unit Cost", "MOQ", "Payment Terms"];
const rows = vendors.map(v => [v.name, v.category, v.contact, v.leadTime, v.unitCost, v.moq, v.terms]);

const workbook = new ExcelJS.Workbook();
workbook.creator = "Abra / USA Gummies";
workbook.created = new Date();

const ws = workbook.addWorksheet("Vendor List", {
  views: [{ state: "frozen", ySplit: 1 }],
});

// Header row
const headerRow = ws.addRow(headers);
headerRow.height = 20;
headerRow.eachCell((cell) => {
  cell.fill = HEADER_FILL;
  cell.font = HEADER_FONT;
  cell.border = BORDER;
  cell.alignment = { vertical: "middle", horizontal: "left" };
});

// Data rows
rows.forEach((row, ri) => {
  const dataRow = ws.addRow(row);
  const isEven = ri % 2 === 0;
  dataRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cell.fill = isEven ? ROW_FILL_LIGHT : ROW_FILL_WHITE;
    cell.border = BORDER;
    cell.alignment = { vertical: "middle" };
    // Currency format for Unit Cost column (index 5 = col 5)
    if (colNumber === 5 && typeof cell.value === "number") {
      cell.numFmt = '"$"#,##0.00';
    }
  });
});

// Auto-filter
ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

// Column widths
const widths = [28, 18, 32, 12, 12, 10, 16];
ws.columns.forEach((col, i) => { col.width = widths[i] ?? 15; });

const outPath = "/tmp/vendor-list-test.xlsx";
const buf = await workbook.xlsx.writeBuffer();
writeFileSync(outPath, Buffer.from(buf));

console.log(`✓ Written to ${outPath}`);
console.log("  Sheets: Vendor List");
console.log("  Rows:   4 vendors + 1 header");
console.log("  Features: dark blue header, zebra stripes, borders, frozen pane, auto-filter, currency format");
console.log("\nOpen with: open /tmp/vendor-list-test.xlsx");
