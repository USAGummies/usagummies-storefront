#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output", "playwright", "day0-live");
const profileDir = path.join(outputDir, "profile");
const storageFile = path.join(outputDir, "storage-state.json");

const args = process.argv.slice(2);
const minutesArgIdx = args.findIndex((arg) => arg === "--minutes");
const minutes = minutesArgIdx >= 0 ? Number(args[minutesArgIdx + 1] || "8") : 8;
const waitMs = Math.max(1, Math.min(30, minutes)) * 60 * 1000;

const authTargets = [
  { name: "x", url: "https://x.com/i/flow/login" },
  { name: "linkedin", url: "https://www.linkedin.com/login" },
  { name: "medium", url: "https://medium.com/m/signin" },
  { name: "reddit", url: "https://www.reddit.com/login/" },
  { name: "gmail", url: "https://accounts.google.com/signin/v2/identifier?service=mail" },
];

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(profileDir, { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const firstPage = context.pages()[0] || (await context.newPage());

  for (let i = 0; i < authTargets.length; i += 1) {
    const target = authTargets[i];
    const page = i === 0 ? firstPage : await context.newPage();
    await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(outputDir, `auth-bootstrap-${target.name}.png`), fullPage: true });
  }

  console.log(`Auth bootstrap running. Complete logins in opened browser tabs within ${Math.round(waitMs / 60000)} minute(s).`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  await context.storageState({ path: storageFile });

  for (const page of context.pages()) {
    const host = new URL(page.url()).host;
    const fileSafe = host.replace(/[^a-z0-9.-]/gi, "_");
    await page.screenshot({ path: path.join(outputDir, `auth-postwait-${fileSafe}.png`), fullPage: true });
  }

  await context.close();
  console.log(`Saved storage state: ${storageFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
