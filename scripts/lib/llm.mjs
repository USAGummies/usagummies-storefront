#!/usr/bin/env node
/**
 * USA Gummies — Shared LLM Utility for .mjs Scripts
 *
 * Provides Claude API access for all agentic engine scripts.
 * Supports versioned prompt loading from Supabase (Auto Research).
 *
 * Usage:
 *   import { callLLM, loadVersionedPrompt } from "./lib/llm.mjs";
 *
 *   const result = await callLLM({
 *     system: "You are a sales analyst...",
 *     user: "Analyze this data...",
 *     maxTokens: 1024,
 *     temperature: 0.3,
 *   });
 *
 *   // Or with versioned prompts:
 *   const prompt = await loadVersionedPrompt("b2b_outreach");
 *   const result = await callLLM({
 *     system: prompt || FALLBACK_PROMPT,
 *     user: "...",
 *   });
 */

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Call Claude API with a system prompt and user message.
 * Returns the text response, or null if the call fails.
 */
export async function callLLM({
  system,
  user,
  maxTokens = 1024,
  temperature = 0.3,
  model = DEFAULT_MODEL,
  timeoutMs = 30000,
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[llm] ANTHROPIC_API_KEY not set — skipping LLM call");
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      console.error(`[llm] API error (${res.status}): ${errorText.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();

    // Log cost to Supabase (best-effort)
    if (data.usage) {
      logCost(model, data.usage.input_tokens, data.usage.output_tokens).catch(() => {});
    }

    const text = (data.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text || "")
      .join("\n");

    return text || null;
  } catch (error) {
    console.error("[llm] Call failed:", error.message || error);
    return null;
  }
}

/**
 * Parse a JSON response from the LLM.
 * Handles markdown code fences and extracts the first JSON object/array.
 */
export function parseLLMJson(text) {
  if (!text) return null;
  try {
    // Try direct parse first
    return JSON.parse(text);
  } catch {
    // Try extracting from markdown code fences
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {
        // fall through
      }
    }
    // Try extracting first JSON object or array
    const jsonMatch = text.match(/[\[{][\s\S]*[\]}]/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // give up
      }
    }
    return null;
  }
}

/**
 * Load the active versioned prompt for a target from Supabase.
 * Returns the prompt text or null if unavailable.
 */
export async function loadVersionedPrompt(targetKey) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return null;
  }

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/auto_research_prompt_versions?target_key=eq.${encodeURIComponent(targetKey)}&status=eq.active&select=prompt_text&limit=1`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!res.ok) return null;

    const rows = await res.json();
    if (Array.isArray(rows) && rows.length > 0 && rows[0].prompt_text) {
      return rows[0].prompt_text;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Log LLM cost to Supabase (best-effort, never throws).
 */
async function logCost(model, inputTokens, outputTokens) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return;

  // Approximate pricing per million tokens
  const pricing = {
    "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
    "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
    "claude-3-5-haiku-latest": { input: 0.8, output: 4.0 },
  };
  const p = pricing[model] || pricing["claude-sonnet-4-6"];
  const cost =
    (inputTokens / 1_000_000) * p.input +
    (outputTokens / 1_000_000) * p.output;

  try {
    await fetch(`${supabaseUrl}/rest/v1/abra_cost_log`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        model,
        provider: "anthropic",
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: cost,
        endpoint: "mjs-agent",
        department: "operations",
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // best-effort
  }
}
