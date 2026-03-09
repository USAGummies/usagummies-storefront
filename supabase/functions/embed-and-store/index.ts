import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_TABLES = ["open_brain_entries", "email_events", "decision_log"] as const;
type AllowedTable = (typeof ALLOWED_TABLES)[number];

const MAX_CONTENT_LENGTH = 50_000; // 50KB max for raw content
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

const REQUIRED_FIELDS: Record<AllowedTable, string[]> = {
  open_brain_entries: ["raw_text", "category"],
  email_events: ["sender_email", "received_at"],
  decision_log: ["requesting_agent_id", "action_proposed", "decision"],
};

const ALLOWED_FIELDS: Record<AllowedTable, string[]> = {
  open_brain_entries: [
    "source_type", "source_ref", "entry_type", "title", "raw_text",
    "summary_text", "category", "department", "source_agent_id",
    "confidence", "priority", "tags", "related_entity_type",
    "related_entity_id", "cross_ref_ids", "thread_id",
    "parent_entry_id", "processed",
  ],
  email_events: [
    "provider_message_id", "source_thread_id", "sender_name",
    "sender_email", "subject", "received_at", "raw_text", "summary",
    "category", "secondary_categories", "classification_confidence",
    "needs_human_review", "priority", "action_required",
    "suggested_action", "routed_agent_ids", "status",
    "open_brain_entry_ids", "user_action", "user_action_at",
    "processed_at",
  ],
  decision_log: [
    "approval_id", "requesting_agent_id", "action_proposed",
    "action_pattern", "supporting_data", "confidence_level",
    "cross_department_impact", "risk_assessment", "decision",
    "reasoning", "modification_notes", "decided_by", "outcome",
    "outcome_quality", "outcome_recorded_at", "pattern_match_score",
    "matches_count",
  ],
};

// Text field to embed for each table
const EMBED_SOURCE_FIELD: Record<AllowedTable, string> = {
  open_brain_entries: "raw_text",
  email_events: "raw_text",
  decision_log: "action_proposed",
};

function isAllowedTable(table: string): table is AllowedTable {
  return ALLOWED_TABLES.includes(table as AllowedTable);
}

serve(async (req: Request) => {
  // POST only
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Verify auth — accept either user JWT or service role
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

    // Allow service role calls (token matches JWT) OR authenticated users
    const isServiceRole = token === serviceRoleJwt;
    let authError = null;
    let user = null;
    if (!isServiceRole) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const authClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const authResult = await authClient.auth.getUser(token);
      authError = authResult.error;
      user = authResult.data?.user;
    }
    if (!isServiceRole && (authError || !user)) {
      return new Response(JSON.stringify({ error: "Invalid authentication" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse and validate body
    const body = await req.json();
    const { table, record } = body;

    if (!table || !record || typeof record !== "object") {
      return new Response(JSON.stringify({ error: "Missing table or record" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!isAllowedTable(table)) {
      return new Response(JSON.stringify({ error: "Table not allowed" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Validate required fields
    const required = REQUIRED_FIELDS[table];
    for (const field of required) {
      if (record[field] === undefined || record[field] === null || record[field] === "") {
        return new Response(
          JSON.stringify({ error: `Missing required field: ${field}` }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    // Strip unknown fields
    const allowed = ALLOWED_FIELDS[table];
    const cleanRecord: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      if (allowed.includes(key)) {
        cleanRecord[key] = record[key];
      }
    }

    // Check content length
    const embedField = EMBED_SOURCE_FIELD[table];
    const textToEmbed = String(cleanRecord[embedField] || "");
    if (textToEmbed.length > MAX_CONTENT_LENGTH) {
      return new Response(
        JSON.stringify({ error: `Content exceeds max length of ${MAX_CONTENT_LENGTH} characters` }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Generate embedding via OpenAI
    let embedding: number[] | null = null;
    if (textToEmbed.length > 0) {
      const embeddingRes = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: textToEmbed,
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
      embedding = embeddingData.data?.[0]?.embedding;
    }

    // Insert using service role client (bypass RLS)
    const adminClient = createClient(supabaseUrl, serviceRoleJwt, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const insertData = { ...cleanRecord, ...(embedding ? { embedding } : {}) };

    // Use upsert for email_events (dedup on provider_message_id) to make
    // ingestion idempotent. Other tables use plain insert.
    const UPSERT_CONFLICT: Partial<Record<AllowedTable, string>> = {
      email_events: "provider_message_id",
    };
    const conflictCol = UPSERT_CONFLICT[table];

    const { data, error } = conflictCol
      ? await adminClient
          .from(table)
          .upsert(insertData, { onConflict: conflictCol })
          .select("id")
          .single()
      : await adminClient
          .from(table)
          .insert(insertData)
          .select("id")
          .single();

    if (error) {
      return new Response(JSON.stringify({ error: "Insert failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ success: true, id: data.id, table, embedded: !!embedding }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  } catch (_err) {
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
