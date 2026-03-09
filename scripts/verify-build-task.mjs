#!/usr/bin/env node
/**
 * verify-build-task.mjs — Verification script for Abra OS Build Tracker
 *
 * Usage: node scripts/verify-build-task.mjs <task-id> [--auto]
 *
 * Workflow:
 *   1. Reads the task from Notion Build Tracker
 *   2. Checks if referenced files exist
 *   3. Runs `npm run build` and checks exit code
 *   4. Updates Notion with verification results
 *
 * This is the verification agent that Claude runs after Codex completes a task.
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";

const NOTION_BUILD_TRACKER_DB = "31e4c0c42c2e81df8b93fd16b4fd2e5b";
const PROJECT_ROOT = resolve(new URL(".", import.meta.url).pathname, "..");

// ─── Notion helpers ───

function getNotionKey() {
  const envPath = resolve(PROJECT_ROOT, ".env.local");
  const content = execSync(`cat "${envPath}"`, { encoding: "utf8" });
  const match = content.match(/^NOTION_API_KEY=["']?([^"'\n]+)/m);
  if (!match) throw new Error("NOTION_API_KEY not found in .env.local");
  return match[1];
}

const NOTION_KEY = getNotionKey();

async function notionFetch(path, options = {}) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${NOTION_KEY}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function getTask(pageId) {
  return notionFetch(`/pages/${pageId}`);
}

async function updateTask(pageId, properties) {
  return notionFetch(`/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });
}

// ─── Verification logic ───

function extractPlainText(richTextArray) {
  if (!Array.isArray(richTextArray)) return "";
  return richTextArray.map((t) => t.plain_text || "").join("");
}

function parseFilesChanged(text) {
  if (!text) return [];
  return text
    .split(/[,;\n]/)
    .map((f) => f.trim())
    .filter(Boolean);
}

function checkFilesExist(files) {
  const results = [];
  for (const file of files) {
    const fullPath = resolve(PROJECT_ROOT, file);
    const exists = existsSync(fullPath);
    results.push({ file, exists });
  }
  return results;
}

function runBuild() {
  try {
    execSync("npm run build", {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      stdio: "pipe",
      timeout: 120_000,
    });
    return { success: true, output: "Build passed" };
  } catch (err) {
    return {
      success: false,
      output: (err.stderr || err.stdout || err.message || "").slice(-1000),
    };
  }
}

function getLatestCommit() {
  try {
    return execSync("git log -1 --format=%H", {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

// ─── Main ───

async function main() {
  const taskId = process.argv[2];
  const autoMode = process.argv.includes("--auto");

  if (!taskId) {
    console.error("Usage: node scripts/verify-build-task.mjs <task-id> [--auto]");
    process.exit(1);
  }

  console.log(`\n🔍 Verifying task: ${taskId}\n`);

  // 1. Fetch task from Notion
  const task = await getTask(taskId);
  const props = task.properties;
  const taskName = extractPlainText(props["Task"]?.title);
  const filesChanged = extractPlainText(props["Files Changed"]?.rich_text);
  const status = props["Status"]?.select?.name;
  const phase = props["Phase"]?.select?.name;

  console.log(`  Task: ${taskName}`);
  console.log(`  Phase: ${phase}`);
  console.log(`  Status: ${status}`);
  console.log(`  Files: ${filesChanged || "(none listed)"}`);

  // 2. Check files exist
  const files = parseFilesChanged(filesChanged);
  let fileResults = [];
  if (files.length > 0) {
    console.log("\n📁 Checking files...");
    fileResults = checkFilesExist(files);
    for (const r of fileResults) {
      console.log(`  ${r.exists ? "✅" : "❌"} ${r.file}`);
    }
  }

  // 3. Run build
  console.log("\n🔨 Running build...");
  const build = runBuild();
  console.log(`  Build: ${build.success ? "✅ PASS" : "❌ FAIL"}`);
  if (!build.success) {
    console.log(`  Error: ${build.output.slice(-500)}`);
  }

  // 4. Get latest commit
  const commitSha = getLatestCommit();
  console.log(`  Commit: ${commitSha.slice(0, 7)}`);

  // 5. Build verification notes
  const allFilesExist = fileResults.length === 0 || fileResults.every((r) => r.exists);
  const missingFiles = fileResults.filter((r) => !r.exists).map((r) => r.file);
  const verified = build.success && allFilesExist;

  const notes = [
    `Verified: ${new Date().toISOString().slice(0, 10)}`,
    `Build: ${build.success ? "PASS" : "FAIL"}`,
    files.length > 0
      ? `Files: ${allFilesExist ? "all exist" : `MISSING: ${missingFiles.join(", ")}`}`
      : "Files: none specified",
    `Commit: ${commitSha.slice(0, 7)}`,
    !build.success ? `Build error: ${build.output.slice(-300)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  console.log(`\n${verified ? "✅" : "❌"} Verification: ${verified ? "PASSED" : "FAILED"}`);

  // 6. Update Notion
  if (autoMode || verified) {
    console.log("\n📝 Updating Notion...");
    await updateTask(taskId, {
      Verification: { select: { name: verified ? "Verified" : "Failed" } },
      "Verification Notes": { rich_text: [{ text: { content: notes.slice(0, 2000) } }] },
      "Build Passes": { checkbox: build.success },
      "Commit SHA": { rich_text: [{ text: { content: commitSha.slice(0, 7) } }] },
      ...(verified ? { Status: { select: { name: "Verified" } } } : {}),
    });
    console.log("  ✅ Notion updated");
  } else {
    console.log("\n⏭️  Skipping Notion update (use --auto to force)");
  }

  console.log("\nDone.\n");
  process.exit(verified ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
