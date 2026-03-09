import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;
const DEFAULT_THRESHOLD = 0.5;
const UNIFIED_TABLES = new Set(["brain", "email"]);

serve(async (req: Request) => {
  // POST only
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleJwt = Deno.env.get("SERVICE_ROLE_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY");

    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "Embedding service not configured" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verify caller is authenticated user or service role
    const isServiceRole = token === serviceRoleJwt;
    if (!isServiceRole) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const authClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user }, error: authError } = await authClient.auth.getUser(token);
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Invalid authentication" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Parse body
    const body = await req.json();
    const {
      query,
      department,
      category,
      agent_id,
      tables: rawTables,
      limit: rawLimit,
      threshold: rawThreshold,
    } = body;

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Missing or empty query" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Validate limit
    const limit = rawLimit !== undefined ? Number(rawLimit) : DEFAULT_LIMIT;
    if (isNaN(limit) || limit < 1 || limit > MAX_LIMIT) {
      return new Response(
        JSON.stringify({ error: `Limit must be between 1 and ${MAX_LIMIT}` }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Validate threshold
    const threshold = rawThreshold !== undefined ? Number(rawThreshold) : DEFAULT_THRESHOLD;
    if (isNaN(threshold) || threshold < 0 || threshold > 1) {
      return new Response(
        JSON.stringify({ error: "Threshold must be between 0 and 1" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    let tables: string[] | null = null;
    if (rawTables !== undefined) {
      if (!Array.isArray(rawTables)) {
        return new Response(
          JSON.stringify({ error: "tables must be an array when provided" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const normalized = rawTables
        .map((value) => String(value || "").trim().toLowerCase())
        .filter((value) => UNIFIED_TABLES.has(value));

      tables = [...new Set(normalized)];
      if (tables.length === 0) {
        return new Response(
          JSON.stringify({ error: "tables must include at least one of: brain, email" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    // Generate query embedding via OpenAI
    const embeddingRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: query.trim(),
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });

    if (!embeddingRes.ok) {
      return new Response(JSON.stringify({ error: "Embedding generation failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const embeddingData = await embeddingRes.json();
    const queryEmbedding = embeddingData.data?.[0]?.embedding;

    if (!queryEmbedding) {
      return new Response(JSON.stringify({ error: "Failed to extract embedding" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Call search_memory RPC using service role client (bypass RLS)
    const adminClient = createClient(supabaseUrl, serviceRoleJwt, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const rpcName = tables ? "search_unified" : "search_memory";
    const rpcPayload = tables
      ? {
          query_embedding: queryEmbedding,
          match_count: limit,
          filter_tables: tables,
          filter_department: department || null,
          filter_category: category || null,
        }
      : {
          query_embedding: queryEmbedding,
          match_count: limit,
          filter_department: department || null,
          filter_category: category || null,
          filter_agent_id: agent_id || null,
        };

    const { data, error } = await adminClient.rpc(rpcName, rpcPayload);

    if (error) {
      return new Response(JSON.stringify({ error: "Search failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Filter by threshold
    const results = (data || []).filter(
      (r: { similarity: number }) => r.similarity >= threshold,
    );

    return new Response(
      JSON.stringify({
        query,
        count: results.length,
        threshold,
        results,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (_err) {
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
