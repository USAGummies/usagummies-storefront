#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const OUTPUT_DIR = path.resolve(process.cwd(), "output");

function argHas(flag) {
  return process.argv.includes(flag);
}

function latestMatching(prefix, suffix) {
  if (!fs.existsSync(OUTPUT_DIR)) return null;
  const files = fs
    .readdirSync(OUTPUT_DIR)
    .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
    .sort();
  if (files.length === 0) return null;
  return path.resolve(OUTPUT_DIR, files[files.length - 1]);
}

function readJsonSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function run(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function nowTagStamp() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}Z`;
}

function summarizeReadiness(readinessJson) {
  const pass = Number(readinessJson?.summary?.pass || 0);
  const warn = Number(readinessJson?.summary?.warn || 0);
  const fail = Number(readinessJson?.summary?.fail || 0);
  const skip = Number(readinessJson?.summary?.skip || 0);
  const total = Number(readinessJson?.summary?.total || pass + warn + fail + skip);
  return { pass, warn, fail, skip, total };
}

function main() {
  const createTag = argHas("--tag");
  const pushTag = argHas("--push-tag");

  const sha = run("git rev-parse HEAD");
  const shortSha = sha.slice(0, 7);
  const branch = run("git rev-parse --abbrev-ref HEAD");
  const readinessJsonPath = latestMatching("abra-readiness-suite-", ".json");
  const readinessMdPath = latestMatching("abra-readiness-suite-", ".md");
  const auditJsonPath = latestMatching("production-readiness-audit-", ".json");
  const auditMdPath = latestMatching("production-readiness-audit-", ".md");
  const readiness = summarizeReadiness(readJsonSafe(readinessJsonPath));

  const stamp = nowTagStamp();
  const baselineId = `abra-baseline-${stamp}`;
  const markdownPath = path.resolve(OUTPUT_DIR, `${baselineId}.md`);
  const jsonPath = path.resolve(OUTPUT_DIR, `${baselineId}.json`);

  const payload = {
    baseline_id: baselineId,
    created_at: new Date().toISOString(),
    git: { branch, sha, short_sha: shortSha },
    readiness_summary: readiness,
    artifacts: {
      readiness_json: readinessJsonPath || null,
      readiness_md: readinessMdPath || null,
      audit_json: auditJsonPath || null,
      audit_md: auditMdPath || null,
    },
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const md = [
    `# Abra Baseline Lock — ${baselineId}`,
    ``,
    `- Created: ${payload.created_at}`,
    `- Branch: \`${branch}\``,
    `- Commit: \`${sha}\``,
    ``,
    `## Readiness`,
    `- Pass: ${readiness.pass}`,
    `- Warn: ${readiness.warn}`,
    `- Fail: ${readiness.fail}`,
    `- Skip: ${readiness.skip}`,
    `- Total: ${readiness.total}`,
    ``,
    `## Artifact Links`,
    `- Readiness JSON: ${readinessJsonPath || "(missing)"}`,
    `- Readiness MD: ${readinessMdPath || "(missing)"}`,
    `- Audit JSON: ${auditJsonPath || "(missing)"}`,
    `- Audit MD: ${auditMdPath || "(missing)"}`,
    ``,
    `## Baseline Files`,
    `- ${jsonPath}`,
    `- ${markdownPath}`,
    ``,
  ].join("\n");
  fs.writeFileSync(markdownPath, md, "utf8");

  console.log(`[baseline] created ${jsonPath}`);
  console.log(`[baseline] created ${markdownPath}`);

  if (createTag) {
    const tagName = `abra-stable-${stamp}`;
    const tagMessage =
      `Abra stable baseline ${stamp}\n` +
      `commit=${sha}\n` +
      `readiness=${readiness.pass}p/${readiness.warn}w/${readiness.fail}f/${readiness.total}t\n` +
      `artifact=${path.basename(markdownPath)}`;
    run(`git tag -a ${tagName} -m "${tagMessage.replaceAll('"', '\\"')}"`);
    console.log(`[baseline] created git tag ${tagName}`);

    if (pushTag) {
      run(`git push origin ${tagName}`);
      console.log(`[baseline] pushed tag ${tagName}`);
    }
  }
}

main();
