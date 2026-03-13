#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const ENV_PATH = resolve(PROJECT_ROOT, ".env.local");

function parseEnvLocal(content) {
  const env = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function getEnv() {
  const parsed = parseEnvLocal(readFileSync(ENV_PATH, "utf8"));
  const baseUrl = parsed.SUPABASE_URL || parsed.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = parsed.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
  }
  return { baseUrl, serviceRoleKey };
}

async function sbFetch(path, init = {}) {
  const { baseUrl, serviceRoleKey } = getEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceRoleKey);
  headers.set("Authorization", `Bearer ${serviceRoleKey}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(15000),
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    throw new Error(
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${
        typeof data === "string" ? data : JSON.stringify(data)
      }`,
    );
  }

  return data;
}

async function fetchSchemaColumns(tableName) {
  const openApi = await sbFetch("/rest/v1/", {
    headers: { Accept: "application/openapi+json" },
  });
  const schema =
    openApi?.components?.schemas?.[tableName] ||
    openApi?.definitions?.[tableName] ||
    openApi?.definitions?.[`public.${tableName}`];
  if (!schema || typeof schema !== "object") {
    throw new Error(`Could not load schema for table "${tableName}" from OpenAPI`);
  }
  const properties =
    schema && typeof schema.properties === "object" ? schema.properties : {};
  return new Set(Object.keys(properties));
}

function encodeStringInClause(values) {
  const escaped = values
    .map((value) => `"${String(value).replaceAll('"', '\\"')}"`)
    .join(",");
  return encodeURIComponent(`(${escaped})`);
}

function asDealRows(columns) {
  const samples = [
    {
      company_name: "ABC Grocery",
      status: "prospecting",
      stage: "prospecting",
      value: 5000,
      contact_name: "Jamie Porter",
      contact_email: "jamie@abcgrocery.com",
      notes:
        "12 locations. Regional grocery chain evaluating launch assortment and shelf placement.",
      metadata: { locations: 12, segment: "grocery", requested_terms: "Net 30" },
    },
    {
      company_name: "Sweet Stop Candy",
      status: "negotiation",
      stage: "negotiation",
      value: 2500,
      contact_name: "Lena Wu",
      contact_email: "lena@sweetstopcandy.com",
      notes: "Negotiating intro order and promo support for specialty candy stores.",
      metadata: { segment: "specialty", replenishment: "monthly" },
    },
    {
      company_name: "Faire Wholesale",
      status: "active",
      stage: "active",
      value: 1500,
      contact_name: "Faire Team",
      contact_email: "orders@faire.com",
      notes: "Active marketplace partner with auto-replenish enabled.",
      metadata: { channel: "faire", auto_replenish: true },
    },
    {
      company_name: "Northeast Distributors",
      status: "proposal_sent",
      stage: "proposal_sent",
      value: 8000,
      contact_name: "Marco Diaz",
      contact_email: "marco@northeastdist.com",
      notes: "Regional distributor proposal sent. Awaiting commercial review and slotting terms.",
      metadata: { region: "Northeast", segment: "distributor" },
    },
    {
      company_name: "Campus Snack Co",
      status: "prospecting",
      stage: "prospecting",
      value: 1200,
      contact_name: "Taylor King",
      contact_email: "taylor@campussnack.co",
      notes:
        "University convenience store program opportunity; pilot requested for exam season.",
      metadata: { segment: "university_convenience", locations: 6 },
    },
  ];

  return samples.map((sample) => {
    const row = {};
    if (columns.has("company_name")) row.company_name = sample.company_name;
    if (columns.has("status")) row.status = sample.status;
    if (columns.has("stage")) row.stage = sample.stage;
    if (columns.has("value")) row.value = sample.value;
    if (columns.has("contact_name")) row.contact_name = sample.contact_name;
    if (columns.has("contact_email")) row.contact_email = sample.contact_email;
    if (columns.has("notes")) row.notes = sample.notes;
    if (columns.has("department")) row.department = "sales_and_growth";
    if (columns.has("source")) row.source = "manual_seed";
    if (columns.has("metadata")) {
      row.metadata = {
        ...sample.metadata,
        seeded_by: "seed-deals-pipeline.mjs",
        seeded_at: new Date().toISOString(),
      };
    }
    if (columns.has("updated_at")) row.updated_at = new Date().toISOString();
    if (columns.has("created_at")) row.created_at = new Date().toISOString();
    return row;
  });
}

async function main() {
  const columns = await fetchSchemaColumns("abra_deals");
  const rows = asDealRows(columns);

  if (!columns.has("company_name")) {
    throw new Error("abra_deals schema is missing company_name");
  }

  const companyNames = rows.map((row) => row.company_name).filter(Boolean);
  const existing = (await sbFetch(
    `/rest/v1/abra_deals?select=id,company_name&company_name=in.${encodeStringInClause(companyNames)}`,
  )) || [];
  const existingByCompany = new Map(
    Array.isArray(existing)
      ? existing.map((row) => [String(row.company_name).toLowerCase(), row])
      : [],
  );

  const inserts = [];
  let updated = 0;

  for (const row of rows) {
    const company = String(row.company_name || "").toLowerCase();
    const existingRow = existingByCompany.get(company);
    if (!existingRow?.id) {
      inserts.push(row);
      continue;
    }

    await sbFetch(`/rest/v1/abra_deals?id=eq.${existingRow.id}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(row),
    });
    updated += 1;
  }

  if (inserts.length > 0) {
    await sbFetch("/rest/v1/abra_deals", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(inserts),
    });
  }

  console.log(
    `Seeded abra_deals. Inserted: ${inserts.length}, Updated: ${updated}, Total sample deals: ${rows.length}.`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`seed-deals-pipeline failed: ${message}`);
  process.exit(1);
});
