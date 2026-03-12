#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const OUTPUT_DIR = path.resolve(process.cwd(), "output");
const ENV_PATH = path.resolve(process.cwd(), ".env.local");

function parseEnvLocal(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const content = fs.readFileSync(filePath, "utf8");
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ")
      ? line.slice("export ".length).trim()
      : line;
    const idx = normalized.indexOf("=");
    if (idx <= 0) continue;
    const key = normalized.slice(0, idx).trim();
    let value = normalized.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function findArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return "";
  return process.argv[idx + 1] || "";
}

function latestAnswerTemplate() {
  if (!fs.existsSync(OUTPUT_DIR)) return "";
  const file = fs
    .readdirSync(OUTPUT_DIR)
    .filter((name) => name.startsWith("abra-training-answers-template-") && name.endsWith(".json"))
    .sort()
    .pop();
  return file ? path.resolve(OUTPUT_DIR, file) : "";
}

function loadEnv() {
  const env = parseEnvLocal(ENV_PATH);
  const pick = (key, fallback = "") => (process.env[key] || env[key] || fallback || "").trim();
  const supabaseUrl = pick("SUPABASE_URL", pick("NEXT_PUBLIC_SUPABASE_URL"));
  const supabaseKey = pick("SUPABASE_SERVICE_ROLE_KEY");
  const openaiKey = pick("OPENAI_API_KEY");
  return { supabaseUrl, supabaseKey, openaiKey };
}

async function sbFetch(supabaseUrl, supabaseKey, route, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", supabaseKey);
  headers.set("Authorization", `Bearer ${supabaseKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${supabaseUrl}${route}`, {
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
      `Supabase ${init.method || "GET"} ${route} failed (${res.status}): ${typeof data === "string" ? data : JSON.stringify(data)}`,
    );
  }
  return data;
}

async function embed(openaiKey, input) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: input.slice(0, 8000),
      dimensions: 1536,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Embedding failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  return json?.data?.[0]?.embedding || [];
}

async function main() {
  const fileArg = findArg("--file");
  const filePath = fileArg ? path.resolve(process.cwd(), fileArg) : latestAnswerTemplate();
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error("Answer file not found. Use --file <path-to-json>.");
  }

  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const questions = Array.isArray(payload?.questions) ? payload.questions : [];
  const answered = questions.filter((q) => typeof q?.answer === "string" && q.answer.trim());
  if (answered.length === 0) {
    console.log("[abra-training-answers] no answered questions found; nothing to ingest");
    return;
  }

  const { supabaseUrl, supabaseKey, openaiKey } = loadEnv();
  if (!supabaseUrl || !supabaseKey || !openaiKey) {
    throw new Error(
      "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or OPENAI_API_KEY",
    );
  }

  let created = 0;
  let updated = 0;

  for (const item of answered) {
    const id = String(item.id || "");
    const department = String(item.department || "executive");
    const question = String(item.question || "").trim();
    const answer = String(item.answer || "").trim();
    if (!question || !answer) continue;

    const sourceRef = `training-answer:${id || Buffer.from(question).toString("hex").slice(0, 12)}`;
    const title = `Founder Answer: ${question.slice(0, 90)}`;
    const rawText = `Question: ${question}\n\nFounder Answer: ${answer}`;
    const embedding = await embed(openaiKey, `${question}\n${answer}`);

    const existing = (await sbFetch(
      supabaseUrl,
      supabaseKey,
      `/rest/v1/open_brain_entries?select=id&source_ref=eq.${encodeURIComponent(sourceRef)}&limit=1`,
    )) || [];

    if (Array.isArray(existing) && existing[0]?.id) {
      await sbFetch(
        supabaseUrl,
        supabaseKey,
        `/rest/v1/open_brain_entries?id=eq.${existing[0].id}`,
        {
          method: "PATCH",
          headers: {
            Prefer: "return=minimal",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title,
            raw_text: rawText,
            summary_text: answer.slice(0, 500),
            category: "founder",
            department,
            confidence: "high",
            priority: "important",
            processed: true,
            embedding,
            updated_at: new Date().toISOString(),
          }),
        },
      );
      updated += 1;
      continue;
    }

    await sbFetch(supabaseUrl, supabaseKey, "/rest/v1/open_brain_entries", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_type: "manual",
        source_ref: sourceRef,
        entry_type: "teaching",
        title,
        raw_text: rawText,
        summary_text: answer.slice(0, 500),
        category: "founder",
        department,
        confidence: "high",
        priority: "important",
        processed: true,
        embedding,
      }),
    });
    created += 1;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  console.log(
    `[abra-training-answers] file=${filePath} answered=${answered.length} created=${created} updated=${updated}`,
  );
}

main().catch((error) => {
  console.error("[abra-training-answers] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
