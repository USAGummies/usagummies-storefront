import fs from "node:fs";

function loadEnvFile() {
  const text = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    env[line.slice(0, idx)] = line.slice(idx + 1).replace(/^"|"$/g, "");
  }
  return env;
}

const env = loadEnvFile();
const baseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!baseUrl || !serviceKey) {
  throw new Error("Missing Supabase credentials");
}

async function sbFetch(path, init = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

function getNaturalKey(row) {
  return row?.execution_params?.natural_key || null;
}

async function fetchAllTasks() {
  return sbFetch("/rest/v1/abra_operator_tasks?select=id,created_at,execution_params&order=created_at.desc&limit=5000");
}

function findDuplicateIds(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const naturalKey = getNaturalKey(row);
    if (!naturalKey) continue;
    const list = grouped.get(naturalKey) || [];
    list.push(row);
    grouped.set(naturalKey, list);
  }
  const toDelete = [];
  for (const list of grouped.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    toDelete.push(...list.slice(1).map((row) => row.id));
  }
  return toDelete;
}

async function deleteIds(ids) {
  const chunkSize = 100;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize).join(",");
    await sbFetch(`/rest/v1/abra_operator_tasks?id=in.(${chunk})`, {
      method: "DELETE",
      headers: {
        Prefer: "return=minimal",
      },
    });
  }
}

const before = await fetchAllTasks();
const duplicateIds = findDuplicateIds(before);

if (duplicateIds.length > 0) {
  await deleteIds(duplicateIds);
}

const after = await fetchAllTasks();
const remainingDuplicateIds = findDuplicateIds(after);

console.log(
  JSON.stringify(
    {
      before_rows: before.length,
      deleted_rows: duplicateIds.length,
      after_rows: after.length,
      remaining_duplicate_rows: remainingDuplicateIds.length,
    },
    null,
    2,
  ),
);
