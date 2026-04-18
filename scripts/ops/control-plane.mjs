#!/usr/bin/env node
/**
 * Shared helpers for scripts/ops/* operator CLIs.
 *
 * Env vars read:
 *   CRON_SECRET        — required for all admin routes
 *   CONTROL_PLANE_BASE_URL — optional, defaults to https://www.usagummies.com
 *                            (override to http://localhost:3000 for local dev)
 */

export function baseUrl() {
  const url = (process.env.CONTROL_PLANE_BASE_URL ?? "https://www.usagummies.com").replace(/\/$/, "");
  return url;
}

export function cronSecretOrDie() {
  const s = process.env.CRON_SECRET;
  if (!s || !s.trim()) {
    console.error(
      "[scripts/ops] CRON_SECRET is not set. Export it:\n  export CRON_SECRET=$(vercel env pull | grep CRON_SECRET | cut -d= -f2)",
    );
    process.exit(2);
  }
  return s.trim();
}

export function adminSecretOrDie() {
  const s = process.env.CONTROL_PLANE_ADMIN_SECRET;
  if (!s || !s.trim()) {
    console.error(
      "[scripts/ops] CONTROL_PLANE_ADMIN_SECRET is not set. This secret is REQUIRED for admin-tier routes like unpause — CRON_SECRET is not accepted for those. Export it:\n  export CONTROL_PLANE_ADMIN_SECRET=$(vercel env pull | grep CONTROL_PLANE_ADMIN_SECRET | cut -d= -f2)",
    );
    process.exit(2);
  }
  return s.trim();
}

export async function callJson(path, init = {}) {
  const url = `${baseUrl()}${path}`;
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${cronSecretOrDie()}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, ok: res.ok, body: parsed };
}

/**
 * Admin-tier request. Uses the SEPARATE X-Admin-Authorization header and
 * CONTROL_PLANE_ADMIN_SECRET. Do not use for routine CRON_SECRET calls.
 */
export async function callAdminJson(path, init = {}) {
  const url = `${baseUrl()}${path}`;
  const headers = new Headers(init.headers);
  headers.set("x-admin-authorization", `Bearer ${adminSecretOrDie()}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, ok: res.ok, body: parsed };
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

export function fail(msg, exitCode = 1) {
  console.error(`[scripts/ops] ${msg}`);
  process.exit(exitCode);
}

export function printResult(result, label = "result") {
  const prefix = result.ok ? "✓" : "✗";
  console.log(`${prefix} HTTP ${result.status} — ${label}`);
  console.log(JSON.stringify(result.body, null, 2));
  if (!result.ok) process.exit(1);
}
