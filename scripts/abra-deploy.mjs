#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, normalize, resolve, sep } from "node:path";

function out(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function fail(message) {
  out({
    kind: "code_deploy_v1",
    ok: false,
    error: message,
  });
  process.exit(1);
}

function runGit(args, cwd) {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });

  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(res.stderr || res.stdout || "unknown error").trim()}`);
  }

  return (res.stdout || "").trim();
}

function toSafePath(rawPath, repoRoot) {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    throw new Error("Invalid file path");
  }

  const trimmed = rawPath.trim();
  if (isAbsolute(trimmed)) {
    throw new Error(`Absolute paths are not allowed: ${trimmed}`);
  }

  const normalized = normalize(trimmed).replace(/\\/g, "/");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized === "..") {
    throw new Error(`Path escapes repository root: ${trimmed}`);
  }

  if (normalized === ".git" || normalized.startsWith(".git/")) {
    throw new Error(`Refusing to touch .git path: ${normalized}`);
  }

  const absolute = resolve(repoRoot, normalized);
  const rootPrefix = `${repoRoot}${sep}`;
  if (!absolute.startsWith(rootPrefix) && absolute !== repoRoot) {
    throw new Error(`Resolved path escapes repository root: ${trimmed}`);
  }

  return { normalized, absolute };
}

function getPayload() {
  const raw = readFileSync(0, "utf8").trim();
  if (!raw) throw new Error("Missing deploy payload on stdin");
  const payload = JSON.parse(raw);

  if (!payload || typeof payload !== "object") {
    throw new Error("Deploy payload must be an object");
  }

  if (payload.kind !== "code_deploy_v1") {
    throw new Error("Unsupported deploy payload kind");
  }

  if (typeof payload.commit_message !== "string" || payload.commit_message.trim().length === 0) {
    throw new Error("commit_message is required");
  }

  if (!Array.isArray(payload.files) || payload.files.length === 0) {
    throw new Error("files must be a non-empty array");
  }

  return {
    kind: "code_deploy_v1",
    commitMessage: payload.commit_message.trim(),
    files: payload.files,
  };
}

function main() {
  const payload = getPayload();
  const repoRoot = runGit(["rev-parse", "--show-toplevel"], process.cwd());

  const normalizedChanges = payload.files.map((item, idx) => {
    if (!item || typeof item !== "object") {
      throw new Error(`files[${idx}] must be an object`);
    }

    const file = item;
    const action = file.action;
    if (action !== "create" && action !== "modify" && action !== "delete") {
      throw new Error(`files[${idx}].action must be create|modify|delete`);
    }

    const { normalized, absolute } = toSafePath(file.path, repoRoot);
    const content = typeof file.content === "string" ? file.content : "";

    if (action !== "delete" && typeof file.content !== "string") {
      throw new Error(`files[${idx}].content is required for create/modify`);
    }

    return { action, normalized, absolute, content };
  });

  const targetPaths = normalizedChanges.map((f) => f.normalized);

  const preDirty = runGit(["status", "--porcelain", "--", ...targetPaths], repoRoot);
  if (preDirty.trim()) {
    throw new Error(`Target files are already dirty:\n${preDirty}`);
  }

  for (const change of normalizedChanges) {
    if (change.action === "delete") {
      rmSync(change.absolute, { force: true });
      continue;
    }

    mkdirSync(dirname(change.absolute), { recursive: true });
    writeFileSync(change.absolute, change.content, "utf8");
  }

  runGit(["add", "--", ...targetPaths], repoRoot);
  const staged = runGit(["diff", "--cached", "--name-only", "--", ...targetPaths], repoRoot)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (staged.length === 0) {
    out({
      kind: "code_deploy_v1",
      ok: true,
      noChanges: true,
      changedFiles: [],
    });
    return;
  }

  runGit(["commit", "-m", payload.commitMessage], repoRoot);
  const commitSha = runGit(["rev-parse", "--short", "HEAD"], repoRoot);
  runGit(["push", "origin", "main"], repoRoot);

  out({
    kind: "code_deploy_v1",
    ok: true,
    commitSha,
    changedFiles: staged,
  });
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  fail(message);
}
