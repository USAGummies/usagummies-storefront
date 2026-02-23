/**
 * Notion User Adapter — queries the "Platform Users" database for authentication.
 *
 * Database ID: f1f7500b35d34908addeba4b94b21c6e
 * Data source: f1eaa394-9432-449b-be99-bece46e4172c
 */

const NOTION_API_KEY = process.env.NOTION_API_KEY || "";
const PLATFORM_USERS_DB_ID = process.env.NOTION_PLATFORM_USERS_DB_ID || "f1f7500b35d34908addeba4b94b21c6e";
const NOTION_VERSION = "2022-06-28";

export type UserRole = "admin" | "investor" | "employee" | "partner";

export type PlatformUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  passwordHash: string;
  active: boolean;
};

function toNotionId(raw: string): string {
  const clean = raw.replace(/-/g, "");
  if (clean.length !== 32) return raw;
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
}

function extractPlainText(prop: any): string {
  if (!prop) return "";
  // title type
  if (prop.type === "title" && Array.isArray(prop.title)) {
    return prop.title.map((t: any) => t.plain_text || "").join("");
  }
  // rich_text type
  if (prop.type === "rich_text" && Array.isArray(prop.rich_text)) {
    return prop.rich_text.map((t: any) => t.plain_text || "").join("");
  }
  // email type
  if (prop.type === "email") return prop.email || "";
  // select type
  if (prop.type === "select") return prop.select?.name || "";
  // checkbox type
  if (prop.type === "checkbox") return prop.checkbox ? "true" : "false";
  return "";
}

export async function findUserByEmail(email: string): Promise<PlatformUser | null> {
  if (!NOTION_API_KEY) {
    console.error("[notion-user-adapter] NOTION_API_KEY not set");
    return null;
  }

  const dbId = toNotionId(PLATFORM_USERS_DB_ID);
  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filter: {
        property: "Email",
        email: { equals: email.toLowerCase().trim() },
      },
      page_size: 1,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    console.error(`[notion-user-adapter] Notion query failed: ${res.status} ${res.statusText}`);
    return null;
  }

  const data = await res.json();
  const results = data.results || [];
  if (results.length === 0) return null;

  const page = results[0];
  const props = page.properties || {};

  const active = props["Active"]?.checkbox === true;
  if (!active) return null;

  return {
    id: page.id,
    name: extractPlainText(props["Name"]),
    email: extractPlainText(props["Email"]),
    role: (extractPlainText(props["Role"]) as UserRole) || "employee",
    passwordHash: extractPlainText(props["Password Hash"]),
    active,
  };
}

export async function updateLastLogin(userId: string): Promise<void> {
  if (!NOTION_API_KEY) return;

  const now = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  try {
    await fetch(`https://api.notion.com/v1/pages/${toNotionId(userId)}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          "Last Login": { date: { start: now } },
        },
      }),
    });
  } catch (err) {
    console.error("[notion-user-adapter] Failed to update last login:", err);
  }
}
