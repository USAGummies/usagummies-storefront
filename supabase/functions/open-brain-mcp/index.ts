// ============================================================================
// Open Brain MCP Server — USA Gummies
// Based on Nate B Jones OB1 spec, adapted for Abra OS open_brain_entries table
// ============================================================================
// Deploy: supabase functions deploy open-brain-mcp --no-verify-jwt
// Secrets required: MCP_ACCESS_KEY, OPENAI_API_KEY (or OPENROUTER_API_KEY)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

// Environment variables
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const OPENAI_BASE = "https://api.openai.com/v1";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- Embedding via OpenAI directly ---
async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENAI_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
    }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenAI embeddings failed: ${r.status} ${msg}`);
  }
  const d = await r.json();
  return d.data[0].embedding;
}

// --- Metadata extraction via GPT-4o-mini ---
async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract metadata from the user's captured thought for USA Gummies (CPG candy company making dye-free, made-in-USA gummy bears). Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "finding", "research", "field_note", "summary", "alert", "system_log"
- "category": one of "market_intel", "financial", "operational", "regulatory", "customer_insight", "deal_data", "email_triage", "competitive", "research", "field_note", "system_log"
- "department": relevant department (executive, operations, finance, sales_and_growth, supply_chain, revenue, agent_resources, systems) or null
- "priority": one of "critical", "important", "normal", "low"
- "confidence": one of "high", "medium", "low"
Only extract what's explicitly there.`,
        },
        { role: "user", content: text },
      ],
    }),
  });
  const d = await r.json();
  try {
    return JSON.parse(d.choices[0].message.content);
  } catch {
    return {
      topics: ["uncategorized"],
      type: "finding",
      category: "research",
      priority: "normal",
      confidence: "medium",
    };
  }
}

// --- MCP Server Setup ---
const server = new McpServer({
  name: "usa-gummies-brain",
  version: "1.0.0",
});

// Tool 1: Semantic Search
server.registerTool(
  "search_thoughts",
  {
    title: "Search Thoughts",
    description:
      "Search USA Gummies operational memory by meaning. Use when asking about topics, people, decisions, or ideas previously captured.",
    inputSchema: {
      query: z.string().describe("What to search for"),
      limit: z.number().optional().default(10),
      threshold: z.number().optional().default(0.5),
    },
  },
  async ({ query, limit, threshold }) => {
    try {
      const qEmb = await getEmbedding(query);
      const { data, error } = await supabase.rpc("match_thoughts", {
        query_embedding: qEmb,
        match_threshold: threshold,
        match_count: limit,
        filter: {},
      });

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Search error: ${error.message}` }],
          isError: true,
        };
      }

      if (!data || data.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No thoughts found matching "${query}".` }],
        };
      }

      const results = data.map(
        (t: {
          content: string;
          metadata: Record<string, unknown>;
          similarity: number;
          created_at: string;
        }, i: number) => {
          const m = t.metadata || {};
          const parts = [
            `--- Result ${i + 1} (${(t.similarity * 100).toFixed(1)}% match) ---`,
            `Captured: ${new Date(t.created_at).toLocaleDateString()}`,
            `Type: ${m.type || "unknown"}`,
            `Category: ${m.category || "unknown"}`,
          ];
          if (m.department) parts.push(`Department: ${m.department}`);
          if (Array.isArray(m.topics) && m.topics.length)
            parts.push(`Topics: ${(m.topics as string[]).join(", ")}`);
          if (m.priority && m.priority !== "normal")
            parts.push(`Priority: ${m.priority}`);
          parts.push(`\n${t.content}`);
          return parts.join("\n");
        }
      );

      return {
        content: [
          { type: "text" as const, text: `Found ${data.length} thought(s):\n\n${results.join("\n\n")}` },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 2: List Recent
server.registerTool(
  "list_thoughts",
  {
    title: "List Recent Thoughts",
    description:
      "List recently captured thoughts. Filter by category, department, priority, or time range.",
    inputSchema: {
      limit: z.number().optional().default(10),
      category: z.string().optional().describe("Filter by category"),
      department: z.string().optional().describe("Filter by department"),
      priority: z.string().optional().describe("Filter by priority: critical, important, normal, low"),
      days: z.number().optional().describe("Only thoughts from the last N days"),
    },
  },
  async ({ limit, category, department, priority, days }) => {
    try {
      let q = supabase
        .from("open_brain_entries")
        .select("raw_text, category, department, entry_type, priority, confidence, tags, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (category) q = q.eq("category", category);
      if (department) q = q.eq("department", department);
      if (priority) q = q.eq("priority", priority);
      if (days) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        q = q.gte("created_at", since.toISOString());
      }

      const { data, error } = await q;

      if (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
      if (!data || !data.length) {
        return { content: [{ type: "text" as const, text: "No thoughts found." }] };
      }

      const results = data.map(
        (t: {
          raw_text: string;
          category: string;
          department: string;
          entry_type: string;
          priority: string;
          tags: string[];
          created_at: string;
        }, i: number) => {
          const tagStr = t.tags?.length ? t.tags.join(", ") : "";
          return `${i + 1}. [${new Date(t.created_at).toLocaleDateString()}] (${t.entry_type} | ${t.category}${tagStr ? " - " + tagStr : ""})\n   ${t.raw_text}`;
        }
      );

      return {
        content: [{ type: "text" as const, text: `${data.length} recent thought(s):\n\n${results.join("\n\n")}` }],
      };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// Tool 3: Stats
server.registerTool(
  "thought_stats",
  {
    title: "Thought Statistics",
    description: "Get a summary of all captured thoughts: totals, categories, departments, and priorities.",
    inputSchema: {},
  },
  async () => {
    try {
      const { count } = await supabase
        .from("open_brain_entries")
        .select("*", { count: "exact", head: true });

      const { data } = await supabase
        .from("open_brain_entries")
        .select("category, department, priority, entry_type, tags, created_at")
        .order("created_at", { ascending: false });

      const categories: Record<string, number> = {};
      const departments: Record<string, number> = {};
      const priorities: Record<string, number> = {};
      const allTags: Record<string, number> = {};

      for (const r of data || []) {
        if (r.category) categories[r.category] = (categories[r.category] || 0) + 1;
        if (r.department) departments[r.department] = (departments[r.department] || 0) + 1;
        if (r.priority) priorities[r.priority] = (priorities[r.priority] || 0) + 1;
        if (Array.isArray(r.tags))
          for (const t of r.tags) allTags[t] = (allTags[t] || 0) + 1;
      }

      const sort = (o: Record<string, number>): [string, number][] =>
        Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 10);

      const lines: string[] = [
        `Total thoughts: ${count}`,
        `Date range: ${
          data?.length
            ? new Date(data[data.length - 1].created_at).toLocaleDateString() +
              " -> " +
              new Date(data[0].created_at).toLocaleDateString()
            : "N/A"
        }`,
        "",
        "Categories:",
        ...sort(categories).map(([k, v]) => `  ${k}: ${v}`),
        "",
        "Priorities:",
        ...sort(priorities).map(([k, v]) => `  ${k}: ${v}`),
      ];

      if (Object.keys(departments).length) {
        lines.push("", "Top departments:");
        for (const [k, v] of sort(departments)) lines.push(`  ${k}: ${v}`);
      }
      if (Object.keys(allTags).length) {
        lines.push("", "Top tags:");
        for (const [k, v] of sort(allTags)) lines.push(`  ${k}: ${v}`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// Tool 4: Capture Thought
server.registerTool(
  "capture_thought",
  {
    title: "Capture Thought",
    description:
      "Save a new thought to the USA Gummies Open Brain. Auto-generates embedding and extracts metadata. Use for notes, insights, decisions, learnings.",
    inputSchema: {
      content: z.string().describe("The thought to capture"),
    },
  },
  async ({ content }) => {
    try {
      const [embedding, metadata] = await Promise.all([
        getEmbedding(content),
        extractMetadata(content),
      ]);

      const { data: upsertResult, error: upsertError } = await supabase.rpc("upsert_thought", {
        p_content: content,
        p_payload: { metadata: { ...metadata, source: "mcp" } },
      });

      if (upsertError) {
        return {
          content: [{ type: "text" as const, text: `Failed to capture: ${upsertError.message}` }],
          isError: true,
        };
      }

      const thoughtId = (upsertResult as { id?: string })?.id;
      if (thoughtId) {
        const { error: embError } = await supabase
          .from("open_brain_entries")
          .update({ embedding })
          .eq("id", thoughtId);

        if (embError) {
          return {
            content: [{ type: "text" as const, text: `Saved text but failed to save embedding: ${embError.message}` }],
            isError: true,
          };
        }
      }

      const meta = metadata as Record<string, unknown>;
      let confirmation = `Captured as ${meta.type || "thought"} in ${meta.category || "general"}`;
      if (Array.isArray(meta.topics) && meta.topics.length)
        confirmation += ` | Topics: ${(meta.topics as string[]).join(", ")}`;
      if (Array.isArray(meta.people) && meta.people.length)
        confirmation += ` | People: ${(meta.people as string[]).join(", ")}`;
      if (Array.isArray(meta.action_items) && meta.action_items.length)
        confirmation += ` | Actions: ${(meta.action_items as string[]).join("; ")}`;

      return { content: [{ type: "text" as const, text: confirmation }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// --- Hono App with Auth + CORS ---
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-brain-key, accept, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

const app = new Hono();

app.options("*", (c) => c.text("ok", 200, corsHeaders));

app.all("*", async (c) => {
  const provided =
    c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) {
    return c.json({ error: "Invalid or missing access key" }, 401, corsHeaders);
  }

  // Claude Desktop doesn't always send Accept header for StreamableHTTPTransport
  if (!c.req.header("accept")?.includes("text/event-stream")) {
    const headers = new Headers(c.req.raw.headers);
    headers.set("Accept", "application/json, text/event-stream");
    const patched = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers,
      body: c.req.raw.body,
      // @ts-ignore -- duplex required for streaming body in Deno
      duplex: "half",
    });
    Object.defineProperty(c.req, "raw", { value: patched, writable: true });
  }

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve(app.fetch);
