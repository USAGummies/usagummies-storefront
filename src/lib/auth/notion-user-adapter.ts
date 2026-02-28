/**
 * Notion User Adapter — queries the "Platform Users" database for authentication.
 *
 * Enterprise-grade: retries on transient failures + hardcoded admin fallback
 * so login never depends on a single external API call.
 *
 * Database ID: f1f7500b35d34908addeba4b94b21c6e
 */

import bcrypt from "bcryptjs";

const NOTION_API_KEY = process.env.NOTION_API_KEY || "";
const PLATFORM_USERS_DB_ID =
  process.env.NOTION_PLATFORM_USERS_DB_ID || "f1f7500b35d34908addeba4b94b21c6e";
const NOTION_VERSION = "2022-06-28";

/** Max retries for transient Notion errors (429 / 5xx) */
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 400;
/** Abort Notion request if it takes longer than this (ms) */
const NOTION_TIMEOUT_MS = 4000;

export type UserRole = "admin" | "investor" | "employee" | "partner" | "banker";

export type PlatformUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  passwordHash: string;
  active: boolean;
};

// ---------------------------------------------------------------------------
// Hardcoded admin fallback — login works even when Notion is down / rate-limited
// The hash is generated from the admin password via bcrypt (cost 12).
// To rotate: `node -e "require('bcryptjs').hash('NEW_PW',12).then(console.log)"`
// ---------------------------------------------------------------------------
const ADMIN_FALLBACK: PlatformUser = {
  id: "local-admin",
  name: "Benjamin Stutman",
  email: "ben@usagummies.com",
  role: "admin",
  // bcrypt hash of "Slaterson1!"
  passwordHash:
    "$2b$12$1acXOlXv2fCkw5yXC5AWtOsUD3y8jNTaa5hETXWCdSvrN4M.U7x.S",
  active: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNotionId(raw: string): string {
  const clean = raw.replace(/-/g, "");
  if (clean.length !== 32) return raw;
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractPlainText(prop: any): string {
  if (!prop) return "";
  if (prop.type === "title" && Array.isArray(prop.title)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return prop.title.map((t: any) => t.plain_text || "").join("");
  }
  if (prop.type === "rich_text" && Array.isArray(prop.rich_text)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return prop.rich_text.map((t: any) => t.plain_text || "").join("");
  }
  if (prop.type === "email") return prop.email || "";
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "checkbox") return prop.checkbox ? "true" : "false";
  return "";
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch with timeout + exponential back-off on 429 / 5xx */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), NOTION_TIMEOUT_MS);
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      // Success or client error (4xx except 429) — return immediately
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
        return res;
      }
      // Retryable: 429 or 5xx — short delay, capped at 1s
      const delayMs = Math.min(RETRY_BASE_MS * Math.pow(2, attempt), 1000);
      console.warn(
        `[notion-user-adapter] ${res.status} on attempt ${attempt + 1}/${MAX_RETRIES}, retrying in ${delayMs}ms`,
      );
      await sleep(delayMs);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `[notion-user-adapter] Error on attempt ${attempt + 1}/${MAX_RETRIES}: ${lastError.message}`,
      );
      if (attempt < MAX_RETRIES - 1) {
        await sleep(Math.min(RETRY_BASE_MS * Math.pow(2, attempt), 1000));
      }
    }
  }
  throw lastError ?? new Error("fetchWithRetry exhausted retries");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function findUserByEmail(
  email: string,
): Promise<PlatformUser | null> {
  const normalizedEmail = email.toLowerCase().trim();

  // --- Try Notion first (with retries) ---
  if (NOTION_API_KEY) {
    try {
      const dbId = toNotionId(PLATFORM_USERS_DB_ID);
      const res = await fetchWithRetry(
        `https://api.notion.com/v1/databases/${dbId}/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${NOTION_API_KEY}`,
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filter: { property: "Email", email: { equals: normalizedEmail } },
            page_size: 1,
          }),
          cache: "no-store",
        },
      );

      if (res.ok) {
        const data = await res.json();
        const results = data.results || [];
        if (results.length > 0) {
          const page = results[0];
          const props = page.properties || {};
          const active = props["Active"]?.checkbox === true;
          if (active) {
            return {
              id: page.id,
              name: extractPlainText(props["Name"]),
              email: extractPlainText(props["Email"]),
              role:
                (extractPlainText(props["Role"]) as UserRole) || "employee",
              passwordHash: extractPlainText(props["Password Hash"]),
              active,
            };
          }
        }
        // User not found in Notion — don't fall through to fallback
        // (only fall through on Notion failure)
        if (normalizedEmail !== ADMIN_FALLBACK.email) return null;
      }
      // If res not ok after retries, fall through to admin fallback
      console.warn("[notion-user-adapter] Notion unavailable after retries, checking admin fallback");
    } catch (err) {
      console.warn("[notion-user-adapter] Notion query failed, checking admin fallback:", err);
    }
  } else {
    console.warn("[notion-user-adapter] NOTION_API_KEY not set, using admin fallback only");
  }

  // --- Admin fallback — always available ---
  if (normalizedEmail === ADMIN_FALLBACK.email) {
    console.log("[notion-user-adapter] Using admin fallback credentials");
    return { ...ADMIN_FALLBACK };
  }

  return null;
}

/**
 * Verify password against a user record. Separated from findUserByEmail
 * so the auth config stays clean.
 */
export async function verifyPassword(
  password: string,
  user: PlatformUser,
): Promise<boolean> {
  return bcrypt.compare(password, user.passwordHash);
}

export async function updateLastLogin(userId: string): Promise<void> {
  // Skip for local fallback user
  if (!NOTION_API_KEY || userId === "local-admin") return;

  const now = new Date().toISOString().split("T")[0];
  try {
    await fetch(`https://api.notion.com/v1/pages/${toNotionId(userId)}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: { "Last Login": { date: { start: now } } },
      }),
    });
  } catch (err) {
    console.error("[notion-user-adapter] Failed to update last login:", err);
  }
}
