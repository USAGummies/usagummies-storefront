#!/usr/bin/env node
/**
 * export-pinterest-csv.mjs — Export Pinterest pins as CSV for Tailwind / Pinterest scheduler
 *
 * Generates a CSV compatible with:
 *   - Tailwind (bulk upload)
 *   - Pinterest native scheduler (manual copy-paste)
 *   - Notion/Airtable (import for tracking)
 *
 * Usage:
 *   node growth-ops/content-pipeline/export-pinterest-csv.mjs
 *
 * Output:
 *   growth-ops/content-pipeline/exports/pinterest-pins-YYYY-MM-DD.csv
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXPORT_DIR = path.join(__dirname, "exports");
const PINS_FILE = path.join(__dirname, "pinterest-pins.json");

// Load pin data
const data = JSON.parse(fs.readFileSync(PINS_FILE, "utf-8"));

// ── Build schedule dates ─────────────────────────────────────────────
// Start pinning tomorrow, 3 pins/day at 8pm, 9pm, 10pm EST
const START_DATE = new Date();
START_DATE.setDate(START_DATE.getDate() + 1); // tomorrow

const TIME_SLOTS = ["20:00", "21:00", "22:00"]; // EST

function getScheduleDate(dayOffset, slotIndex) {
  const d = new Date(START_DATE);
  d.setDate(d.getDate() + dayOffset - 1); // day 1 = tomorrow
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${TIME_SLOTS[slotIndex - 1]}`;
}

// ── CSV escape ───────────────────────────────────────────────────────
function csvEscape(str) {
  if (!str) return "";
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ── Generate CSV rows ────────────────────────────────────────────────
const headers = [
  "Pin Title",
  "Pin Description",
  "Destination URL",
  "Board Name",
  "Secondary Board 1",
  "Secondary Board 2",
  "Alt Text",
  "Pin Type",
  "Image Size",
  "Scheduled Date",
  "Hashtags",
];

const rows = data.pins.map((pin) => {
  const boardName = data.boards[pin.board]?.name || pin.board;
  const secBoards = (pin.secondary_boards || []).map(
    (b) => data.boards[b]?.name || b
  );
  const scheduleDate = getScheduleDate(pin.schedule_day, pin.schedule_slot);

  return [
    pin.title,
    `${pin.description} ${pin.hashtags}`,
    pin.link_with_utm,
    boardName,
    secBoards[0] || "",
    secBoards[1] || "",
    pin.alt_text,
    pin.pin_type,
    pin.image_spec.size,
    scheduleDate,
    pin.hashtags,
  ].map(csvEscape);
});

// ── Write CSV ────────────────────────────────────────────────────────
if (!fs.existsSync(EXPORT_DIR)) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

const today = new Date().toISOString().split("T")[0];
const csvPath = path.join(EXPORT_DIR, `pinterest-pins-${today}.csv`);

const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join(
  "\n"
);

fs.writeFileSync(csvPath, csvContent, "utf-8");
console.log(`✅ Pinterest CSV exported: ${csvPath}`);
console.log(`   ${data.pins.length} pins across ${Object.keys(data.boards).length} boards`);

// ── Also print a quick summary ───────────────────────────────────────
console.log("\n📌 Pin Schedule:");
data.pins.forEach((pin) => {
  const scheduleDate = getScheduleDate(pin.schedule_day, pin.schedule_slot);
  const boardName = data.boards[pin.board]?.name || pin.board;
  console.log(`   ${scheduleDate}  →  ${boardName}  →  ${pin.title}`);
});
