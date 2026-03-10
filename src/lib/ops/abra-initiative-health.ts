import { notify } from "@/lib/ops/notify";

export type InitiativeHealth = {
  id: string;
  title: string;
  department: string;
  status: string;
  days_since_update: number;
  unanswered_questions: number;
  health: "healthy" | "stale" | "abandoned";
};

type InitiativeRow = {
  id: string;
  title: string | null;
  department: string | null;
  status: string | null;
  updated_at: string | null;
  questions: unknown[] | null;
  answers: Record<string, unknown> | null;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials");
  }
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}) {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  headers.set("Content-Type", "application/json");

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(12000),
  });

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!res.ok) {
    throw new Error(
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${typeof json === "string" ? json : JSON.stringify(json)}`,
    );
  }

  return json;
}

function daysSince(iso: string | null): number {
  if (!iso) return 999;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return 999;
  const delta = Date.now() - ts;
  return Math.max(0, Math.floor(delta / (1000 * 60 * 60 * 24)));
}

function isAnswered(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function countUnansweredQuestions(questions: unknown[] | null, answers: Record<string, unknown> | null): number {
  if (!Array.isArray(questions) || questions.length === 0) return 0;
  const answerMap = answers || {};
  let unanswered = 0;

  for (let i = 0; i < questions.length; i += 1) {
    const question = questions[i];
    const key =
      question && typeof question === "object" && "key" in (question as Record<string, unknown>)
        ? String((question as Record<string, unknown>).key || "")
        : `q${i}`;
    if (!key) {
      unanswered += 1;
      continue;
    }
    if (!isAnswered(answerMap[key])) {
      unanswered += 1;
    }
  }

  return unanswered;
}

function toHealth(status: string, days: number): "healthy" | "stale" | "abandoned" {
  const normalizedStatus = status.toLowerCase();
  if (normalizedStatus === "completed" || normalizedStatus === "paused") {
    return "healthy";
  }
  if (days >= 30) return "abandoned";
  if (days >= 7) return "stale";
  return "healthy";
}

export async function checkInitiativeHealth(): Promise<InitiativeHealth[]> {
  const rows = (await sbFetch(
    "/rest/v1/abra_initiatives?select=id,title,department,status,updated_at,questions,answers&order=updated_at.asc&limit=500",
  )) as InitiativeRow[];

  return rows
    .map((row) => {
      const days = daysSince(row.updated_at);
      const status = (row.status || "unknown").toLowerCase();
      return {
        id: row.id,
        title: (row.title || "Untitled initiative").trim(),
        department: (row.department || "unknown").trim(),
        status,
        days_since_update: days,
        unanswered_questions: countUnansweredQuestions(row.questions, row.answers),
        health: toHealth(status, days),
      } satisfies InitiativeHealth;
    })
    .sort((a, b) => b.days_since_update - a.days_since_update);
}

function fmtDept(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function autoManageInitiatives(): Promise<{
  nudged: string[];
  paused: string[];
}> {
  const health = await checkInitiativeHealth();
  const stale = health.filter((item) => item.health === "stale");
  const abandoned = health.filter((item) => item.health === "abandoned");

  const nudged = stale.map((item) => item.id);
  const paused: string[] = [];

  if (stale.length > 0) {
    const staleLines = stale
      .slice(0, 8)
      .map((item) => {
        const base = `• [${fmtDept(item.department)}] "${item.title}" — ${item.days_since_update} days without update`;
        if (item.unanswered_questions > 0) {
          return `${base}, ${item.unanswered_questions} unanswered questions`;
        }
        return base;
      })
      .join("\n");

    await notify({
      channel: "alerts",
      text: `⏰ *Stale Initiative Alert*\n${staleLines}\nReply in Abra chat or Slack to continue these initiatives.`,
    });
  }

  for (const item of abandoned) {
    try {
      await sbFetch(`/rest/v1/abra_initiatives?id=eq.${item.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "paused",
          updated_at: new Date().toISOString(),
        }),
      });
      paused.push(item.id);
    } catch {
      // Best effort; continue remaining initiatives.
    }
  }

  if (abandoned.length > 0) {
    const pausedLines = abandoned
      .slice(0, 8)
      .map(
        (item) =>
          `• [${fmtDept(item.department)}] "${item.title}" — paused after ${item.days_since_update} days`,
      )
      .join("\n");

    await notify({
      channel: "alerts",
      text: `⏸️ *Initiative Auto-Paused* (30+ days inactive)\n${pausedLines}\nUse /abra initiative:resume <department> to restart.`,
    });
  }

  return { nudged, paused };
}
