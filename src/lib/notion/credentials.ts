import "server-only";
import fs from "node:fs";
import path from "node:path";

function isCloud(): boolean {
  return process.env.VERCEL === "1";
}

const HOME = process.env.HOME || "/Users/ben";
const CONFIG_DIR = path.join(HOME, ".config/usa-gummies-mcp");
const CREDS_FILE = path.join(CONFIG_DIR, ".notion-credentials");

let cachedCreds: Record<string, string> | null = null;

function parseCredentialsFile(): Record<string, string> {
  if (cachedCreds) return cachedCreds;

  const result: Record<string, string> = {};
  try {
    if (!fs.existsSync(CREDS_FILE)) {
      cachedCreds = result;
      return result;
    }
    const raw = fs.readFileSync(CREDS_FILE, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key) result[key] = value;
    }
  } catch {
    // Silent fallback to env-only mode.
  }

  cachedCreds = result;
  return result;
}

export function getNotionCredential(key: string): string {
  const fromEnv = String(process.env[key] || "").trim();
  if (fromEnv) return fromEnv;
  if (isCloud()) return "";
  return parseCredentialsFile()[key] || "";
}

export function getNotionApiKey(): string {
  return getNotionCredential("NOTION_API_KEY");
}
