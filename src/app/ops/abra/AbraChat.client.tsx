"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  NAVY,
  GOLD,
  CREAM,
  RED,
  SURFACE_CARD,
  SURFACE_BORDER,
  SURFACE_TEXT_DIM,
} from "@/app/ops/tokens";

// ─── Types ───

type Source = {
  id: string;
  source_table: "brain" | "email";
  title: string;
  similarity: number;
  temporal_score?: number;
  days_ago?: number;
  category?: string;
  department?: string;
  metadata?: Record<string, unknown>;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  intent?: "initiative" | "session" | "cost" | null;
  initiative_id?: string;
  session_id?: string;
};

type Initiative = {
  id: string;
  department: string;
  title: string | null;
  goal: string;
  status: string;
  open_question_count: number;
};

type CostSummary = {
  total: number;
  budget: number;
  remaining: number;
  pctUsed: number;
};

type SessionState = {
  id: string;
  title: string | null;
  agenda: string[];
  status: string;
};

// ─── Constants ───

const QUICK_ACTIONS = [
  { label: "Get finance under control", icon: "💰" },
  { label: "Start a meeting", icon: "📋" },
  { label: "Review operations", icon: "⚙️" },
  { label: "Check AI spend", icon: "📊" },
  { label: "B2B pipeline status", icon: "🤝" },
  { label: "Supply chain updates", icon: "📦" },
];

const STATUS_COLORS: Record<string, string> = {
  researching: "#6366f1",
  planning: "#eab308",
  asking_questions: GOLD,
  approved: "#22c55e",
  executing: "#3b82f6",
  paused: SURFACE_TEXT_DIM,
  completed: "#16a34a",
};

const DEPT_ICONS: Record<string, string> = {
  finance: "💰",
  operations: "⚙️",
  sales_and_growth: "📈",
  supply_chain: "📦",
  executive: "👔",
};

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function daysAgoLabel(days: number | undefined): string {
  if (days === undefined || days === null) return "";
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 7) return `${Math.round(days)}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 30)}mo ago`;
}

function isPlaybookLine(line: string): boolean {
  return /following(?: the)? .+ playbook/i.test(line);
}

// ─── Sub-components ───

function InitiativePanel({
  initiatives,
  onSelect,
}: {
  initiatives: Initiative[];
  onSelect: (init: Initiative) => void;
}) {
  if (initiatives.length === 0) return null;

  return (
    <div
      style={{
        border: `1px solid ${SURFACE_BORDER}`,
        borderRadius: 14,
        background: SURFACE_CARD,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 14 }}>🎯</span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: NAVY,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Active Initiatives
        </span>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {initiatives.map((init) => (
          <button
            key={init.id}
            onClick={() => onSelect(init)}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 4,
              alignItems: "start",
              textAlign: "left",
              border: `1px solid ${SURFACE_BORDER}`,
              borderRadius: 10,
              background: "#fff",
              padding: "8px 10px",
              cursor: "pointer",
              transition: "border-color 0.15s",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.borderColor = GOLD)
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.borderColor = SURFACE_BORDER.toString())
            }
          >
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: NAVY,
                  lineHeight: 1.3,
                }}
              >
                {DEPT_ICONS[init.department] || "📂"}{" "}
                {init.title || init.goal}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: SURFACE_TEXT_DIM,
                  marginTop: 2,
                }}
              >
                {init.department.replace(/_/g, " ")}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: STATUS_COLORS[init.status] || NAVY,
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                }}
              >
                {init.status.replace(/_/g, " ")}
              </span>
              {init.open_question_count > 0 && (
                <span
                  style={{
                    fontSize: 10,
                    color: "#fff",
                    background: RED,
                    borderRadius: 999,
                    padding: "1px 6px",
                    fontWeight: 600,
                  }}
                >
                  {init.open_question_count} Q
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function SessionBanner({
  sessionId,
  title,
  agenda,
  onEnd,
}: {
  sessionId: string;
  title: string | null;
  agenda: string[];
  onEnd: () => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gap: 8,
        border: `1px solid ${GOLD}`,
        borderRadius: 10,
        background: "rgba(199,160,98,0.08)",
        padding: "8px 12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#22c55e",
              animation: "pulse 2s infinite",
            }}
          />
          <span style={{ fontSize: 12, fontWeight: 600, color: NAVY }}>
            Session Active
          </span>
          <span style={{ fontSize: 11, color: SURFACE_TEXT_DIM }}>
            ID: {sessionId.slice(0, 8)}…
          </span>
        </div>
        <button
          onClick={onEnd}
          style={{
            border: `1px solid ${RED}`,
            background: "rgba(199,54,44,0.06)",
            color: RED,
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 600,
            padding: "4px 10px",
            cursor: "pointer",
          }}
        >
          End Meeting
        </button>
      </div>

      {title && (
        <div style={{ fontSize: 12, color: NAVY, fontWeight: 600 }}>
          {title}
        </div>
      )}

      {agenda.length > 0 && (
        <div style={{ display: "grid", gap: 4 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: SURFACE_TEXT_DIM,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Agenda
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 2 }}>
            {agenda.slice(0, 6).map((item, idx) => (
              <li key={`${idx}-${item}`} style={{ fontSize: 12, color: NAVY }}>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CostFooter({ cost }: { cost: CostSummary | null }) {
  if (!cost) return null;

  const month = new Date().toLocaleString("en-US", { month: "long" });
  const pct = cost.pctUsed;
  const barColor =
    pct >= 90 ? RED : pct >= 70 ? "#eab308" : "#22c55e";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 14px",
        fontSize: 11,
        color: SURFACE_TEXT_DIM,
      }}
    >
      <span>📊</span>
      <span style={{ fontWeight: 500 }}>
        {month}: ${cost.total.toFixed(2)} / ${cost.budget}
      </span>
      <div
        style={{
          flex: 1,
          maxWidth: 120,
          height: 4,
          background: "rgba(27,42,74,0.06)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(pct, 100)}%`,
            height: "100%",
            background: barColor,
            borderRadius: 2,
            transition: "width 0.3s",
          }}
        />
      </div>
      <span style={{ color: barColor, fontWeight: 600 }}>
        {pct}%
      </span>
    </div>
  );
}

function SourcePill({ source, messageId }: { source: Source; messageId: string }) {
  const temporalLabel = daysAgoLabel(source.days_ago);
  const scoreLabel =
    source.temporal_score !== undefined
      ? Number(source.temporal_score).toFixed(2)
      : Number(source.similarity || 0).toFixed(2);

  return (
    <span
      key={`${messageId}-${source.id}`}
      title={`${source.title}\n${temporalLabel ? `Age: ${temporalLabel}` : ""}${source.department ? `\nDept: ${source.department}` : ""}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        color: NAVY,
        border: `1px solid ${SURFACE_BORDER}`,
        background: "#fff",
        borderRadius: 999,
        padding: "3px 8px",
      }}
    >
      <strong
        style={{
          color: source.source_table === "email" ? RED : NAVY,
          fontSize: 10,
        }}
      >
        {source.source_table.toUpperCase()}
      </strong>
      <span
        style={{
          maxWidth: 180,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {source.title}
      </span>
      {temporalLabel && (
        <span style={{ color: SURFACE_TEXT_DIM, fontSize: 10 }}>
          {temporalLabel}
        </span>
      )}
      <span
        style={{
          color: SURFACE_TEXT_DIM,
          fontFamily: "monospace",
          fontSize: 10,
        }}
      >
        {scoreLabel}
      </span>
    </span>
  );
}

// ─── Main Component ───

export function AbraChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionTitle, setActiveSessionTitle] = useState<string | null>(null);
  const [activeSessionAgenda, setActiveSessionAgenda] = useState<string[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const historyPayload = useMemo(
    () =>
      messages.slice(-12).map((message) => ({
        role: message.role,
        content: message.content,
      })),
    [messages],
  );

  const refreshCostSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/ops/abra/cost", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as Partial<CostSummary>;
      if (typeof data.total !== "number" || typeof data.budget !== "number") return;

      const pctUsed =
        typeof data.pctUsed === "number"
          ? data.pctUsed
          : data.budget > 0
            ? (data.total / data.budget) * 100
            : 0;

      setCostSummary({
        total: data.total,
        budget: data.budget,
        remaining:
          typeof data.remaining === "number"
            ? data.remaining
            : data.budget - data.total,
        pctUsed: Math.round(pctUsed),
      });
    } catch {
      // Best-effort
    }
  }, []);

  const refreshActiveSession = useCallback(
    async (sessionId?: string) => {
      try {
        const query = sessionId
          ? `?id=${encodeURIComponent(sessionId)}`
          : "?status=active";
        const res = await fetch(`/api/ops/abra/session${query}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        const rows = Array.isArray(data?.sessions)
          ? (data.sessions as SessionState[])
          : [];
        const active = sessionId
          ? rows.find((row) => row.id === sessionId)
          : rows.find((row) => row.status === "active");

        if (!active) {
          setActiveSessionId(null);
          setActiveSessionTitle(null);
          setActiveSessionAgenda([]);
          return;
        }

        setActiveSessionId(active.id);
        setActiveSessionTitle(
          typeof active.title === "string" ? active.title : null,
        );
        setActiveSessionAgenda(
          Array.isArray(active.agenda)
            ? active.agenda.filter(
                (item): item is string =>
                  typeof item === "string" && item.trim().length > 0,
              )
            : [],
        );
      } catch {
        // Best-effort
      }
    },
    [],
  );

  // Auto-scroll
  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, pending]);

  // Fetch initiatives + cost on mount
  useEffect(() => {
    async function loadContext() {
      try {
        const [initRes] = await Promise.all([
          fetch("/api/ops/abra/initiative?status=active").then((r) =>
            r.ok ? r.json() : null,
          ),
        ]);

        const initRows = Array.isArray(initRes?.initiatives)
          ? (initRes.initiatives as Array<{
              id: string;
              department: string;
              title: string | null;
              goal: string;
              status: string;
              questions?: Array<{ key: string }>;
              answers?: Record<string, string>;
            }>)
          : [];

        if (initRows.length > 0) {
          setInitiatives(
            initRows.map(
              (r: {
                id: string;
                department: string;
                title: string | null;
                goal: string;
                status: string;
                questions?: Array<{ key: string }>;
                answers?: Record<string, string>;
              }) => ({
                id: r.id,
                department: r.department,
                title: r.title,
                goal: r.goal,
                status: r.status,
                open_question_count: (r.questions || []).filter(
                  (q) => !r.answers?.[q.key],
                ).length,
              }),
            ),
          );
        } else {
          setInitiatives([]);
        }

      } catch {
        // Best-effort
      }
      await refreshActiveSession();
      await refreshCostSummary();
    }

    void loadContext();
  }, [refreshCostSummary, refreshActiveSession]);

  const sendMessage = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || pending) return;

      setError(null);
      setPending(true);

      const userMessage: ChatMessage = {
        id: makeId(),
        role: "user",
        content: message,
      };
      setMessages((prev) => [...prev, userMessage]);
      setInput("");

      try {
        const res = await fetch("/api/ops/abra/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            history: historyPayload,
            thread_id: threadId,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg =
            typeof data?.error === "string"
              ? data.error
              : "Chat request failed";
          throw new Error(msg);
        }

        const assistantMessage: ChatMessage = {
          id: makeId(),
          role: "assistant",
          content:
            typeof data?.reply === "string"
              ? data.reply
              : "No response returned.",
          sources: Array.isArray(data?.sources) ? data.sources : [],
          intent: data?.intent || null,
          initiative_id: data?.initiative_id,
          session_id: data?.session_id,
        };

        setMessages((prev) => [...prev, assistantMessage]);
        if (typeof data?.thread_id === "string" && data.thread_id.trim()) {
          setThreadId(data.thread_id.trim());
        }

        // Track session
        if (data?.session_id) {
          setActiveSessionId(data.session_id);
          void refreshActiveSession(data.session_id);
        }
        if (data?.initiative_id) {
          // Refresh initiatives
          try {
            const initRes = await fetch(
              "/api/ops/abra/initiative?status=active",
            );
            if (initRes.ok) {
              const initData = await initRes.json();
              if (Array.isArray(initData?.initiatives)) {
                setInitiatives(
                  initData.initiatives.map(
                    (r: {
                      id: string;
                      department: string;
                      title: string | null;
                      goal: string;
                      status: string;
                      questions?: Array<{ key: string }>;
                      answers?: Record<string, string>;
                    }) => ({
                      id: r.id,
                      department: r.department,
                      title: r.title,
                      goal: r.goal,
                      status: r.status,
                      open_question_count: (r.questions || []).filter(
                        (q) => !r.answers?.[q.key],
                      ).length,
                    }),
                  ),
                );
              } else {
                setInitiatives([]);
              }
            }
          } catch {
            // Best-effort
          }
        }

        void refreshCostSummary();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Request failed");
      } finally {
        setPending(false);
      }
    },
    [pending, historyPayload, refreshActiveSession, refreshCostSummary, threadId],
  );

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await sendMessage(input);
  }

  async function handleEndSession() {
    if (!activeSessionId) return;
    try {
      const res = await fetch("/api/ops/abra/session?action=end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: activeSessionId }),
      });
      if (!res.ok) {
        throw new Error("Failed to end session");
      }

      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: "assistant",
          content: "Meeting ended. Notes were saved and action items were queued as tasks.",
          intent: "session",
        },
      ]);
      setActiveSessionId(null);
      setActiveSessionTitle(null);
      setActiveSessionAgenda([]);
      await refreshCostSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to end session");
    }
  }

  function handleStartSession() {
    if (activeSessionId) return;
    void sendMessage("Start a meeting");
  }

  function handleInitiativeSelect(init: Initiative) {
    if (init.open_question_count > 0) {
      void sendMessage(
        `Show me the open questions for the ${init.department.replace(/_/g, " ")} initiative "${init.title || init.goal}"`,
      );
    } else {
      void sendMessage(
        `What's the status of the ${init.department.replace(/_/g, " ")} initiative "${init.title || init.goal}"?`,
      );
    }
  }

  function handleNewConversation() {
    if (pending) return;
    setMessages([]);
    setThreadId(null);
    setError(null);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: CREAM,
        padding: 20,
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: initiatives.length > 0 ? "280px 1fr" : "1fr",
          gap: 12,
          alignItems: "start",
        }}
      >
        {/* ─── Left: Initiative Panel ─── */}
        {initiatives.length > 0 && (
          <div style={{ position: "sticky", top: 20, display: "grid", gap: 12 }}>
            <InitiativePanel
              initiatives={initiatives}
              onSelect={handleInitiativeSelect}
            />
            <CostFooter cost={costSummary} />
          </div>
        )}

        {/* ─── Right: Chat Area ─── */}
        <div style={{ display: "grid", gap: 12 }}>
          {/* Header */}
          <div
            style={{
              border: `1px solid ${SURFACE_BORDER}`,
              borderRadius: 14,
              background: SURFACE_CARD,
              padding: "14px 16px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 20 }}>{"\u{1F9E0}"}</span>
                <div>
                  <h1
                    style={{
                      margin: 0,
                      color: NAVY,
                      fontSize: 22,
                      lineHeight: 1.2,
                    }}
                  >
                    Abra
                  </h1>
                  <p
                    style={{
                      margin: 0,
                      color: SURFACE_TEXT_DIM,
                      fontSize: 12,
                    }}
                  >
                    Company operating system — initiatives, meetings, &amp;
                    knowledge
                  </p>
                </div>
              </div>
              {/* Cost badge (when no initiative panel) */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {threadId && (
                  <span
                    style={{
                      fontSize: 10,
                      color: SURFACE_TEXT_DIM,
                      fontFamily: "monospace",
                    }}
                  >
                    thread {threadId.slice(0, 8)}…
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleNewConversation}
                  disabled={pending}
                  style={{
                    border: `1px solid ${SURFACE_BORDER}`,
                    background: "#fff",
                    color: NAVY,
                    borderRadius: 8,
                    padding: "5px 10px",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: pending ? "default" : "pointer",
                    opacity: pending ? 0.65 : 1,
                  }}
                >
                  New conversation
                </button>
                {/* Cost badge (when no initiative panel) */}
                {initiatives.length === 0 && costSummary && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11,
                      color: SURFACE_TEXT_DIM,
                    }}
                  >
                    <span>
                      ${costSummary.total.toFixed(2)} / ${costSummary.budget}
                    </span>
                    <span
                      style={{
                        color:
                          costSummary.pctUsed >= 90
                            ? RED
                            : costSummary.pctUsed >= 70
                              ? "#eab308"
                              : "#22c55e",
                        fontWeight: 600,
                      }}
                    >
                      ({costSummary.pctUsed}%)
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Session Banner */}
          {activeSessionId && (
            <SessionBanner
              sessionId={activeSessionId}
              title={activeSessionTitle}
              agenda={activeSessionAgenda}
              onEnd={() => void handleEndSession()}
            />
          )}

          {/* Messages Area */}
          <div
            ref={listRef}
            style={{
              border: `1px solid ${SURFACE_BORDER}`,
              borderRadius: 14,
              background: "#fff",
              minHeight: 480,
              maxHeight: "62vh",
              overflowY: "auto",
              padding: 16,
              display: "grid",
              gap: 12,
              alignContent: "start",
            }}
          >
            {/* Quick Actions (empty state) */}
            {messages.length === 0 && (
              <div
                style={{
                  display: "grid",
                  gap: 10,
                  alignContent: "start",
                }}
              >
                <p
                  style={{
                    margin: 0,
                    color: SURFACE_TEXT_DIM,
                    fontSize: 13,
                  }}
                >
                  What would you like to work on?
                </p>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                    gap: 8,
                  }}
                >
                  {QUICK_ACTIONS.map((action) => (
                    <button
                      key={action.label}
                      onClick={() => void sendMessage(action.label)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        border: `1px solid ${SURFACE_BORDER}`,
                        borderRadius: 10,
                        background: "#fff",
                        color: NAVY,
                        fontSize: 13,
                        padding: "10px 12px",
                        cursor: pending ? "default" : "pointer",
                        opacity: pending ? 0.7 : 1,
                        textAlign: "left",
                        transition: "border-color 0.15s, background 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = GOLD;
                        e.currentTarget.style.background = "rgba(199,160,98,0.04)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = SURFACE_BORDER.toString();
                        e.currentTarget.style.background = "#fff";
                      }}
                      disabled={pending}
                    >
                      <span style={{ fontSize: 16 }}>{action.icon}</span>
                      <span>{action.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Message list */}
            {messages.map((message) => {
              const isUser = message.role === "user";
              const isInitiative = message.intent === "initiative";
              const isSession = message.intent === "session";

              return (
                <div
                  key={message.id}
                  style={{
                    display: "grid",
                    justifyItems: isUser ? "end" : "start",
                    gap: 8,
                  }}
                >
                  {/* Intent badge */}
                  {!isUser && (isInitiative || isSession) && (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 10,
                        fontWeight: 600,
                        color: isInitiative ? "#6366f1" : GOLD,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        padding: "2px 0",
                      }}
                    >
                      <span>{isInitiative ? "🎯" : "📋"}</span>
                      {isInitiative ? "Initiative" : "Session"}
                    </div>
                  )}

                  {/* Message bubble */}
                  <div
                    style={{
                      maxWidth: "90%",
                      borderRadius: 12,
                      border: isUser
                        ? `1px solid ${GOLD}`
                        : isInitiative
                          ? "1px solid #6366f1"
                          : isSession
                            ? `1px solid ${GOLD}`
                            : `1px solid ${NAVY}`,
                      background: isUser
                        ? "#fffdf8"
                        : isInitiative
                          ? "rgba(99,102,241,0.04)"
                          : isSession
                            ? "rgba(199,160,98,0.04)"
                            : NAVY,
                      color: isUser
                        ? "#1f2f55"
                        : isInitiative || isSession
                          ? NAVY
                          : "#ffffff",
                      padding: "10px 12px",
                      whiteSpace: "pre-wrap",
                      fontSize: 14,
                      lineHeight: 1.5,
                    }}
                  >
                    {isUser
                      ? message.content
                      : message.content.split("\n").map((line, index) => {
                          const highlight = isPlaybookLine(line);
                          return (
                            <div
                              key={`${message.id}-line-${index}`}
                              style={
                                highlight
                                  ? {
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 6,
                                      background: `${GOLD}1f`,
                                      border: `1px solid ${GOLD}66`,
                                      borderRadius: 8,
                                      padding: "4px 8px",
                                      marginBottom: 4,
                                      color: NAVY,
                                      fontWeight: 700,
                                    }
                                  : undefined
                              }
                            >
                              {highlight ? "📋 " : ""}
                              {line || "\u00A0"}
                            </div>
                          );
                        })}
                  </div>

                  {/* Source pills */}
                  {!isUser &&
                    message.sources &&
                    message.sources.length > 0 && (
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 5,
                        }}
                      >
                        {message.sources.map((source) => (
                          <SourcePill
                            key={`${message.id}-${source.id}`}
                            source={source}
                            messageId={message.id}
                          />
                        ))}
                      </div>
                    )}
                </div>
              );
            })}

            {/* Thinking indicator */}
            {pending && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: SURFACE_TEXT_DIM,
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: GOLD,
                    animation: "pulse 1.5s infinite",
                  }}
                />
                Abra is thinking…
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={handleStartSession}
              disabled={pending || !!activeSessionId}
              style={{
                border: `1px solid ${NAVY}`,
                background: activeSessionId ? "rgba(27,42,74,0.08)" : NAVY,
                color: activeSessionId ? NAVY : "#fff",
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 600,
                cursor:
                  pending || !!activeSessionId ? "default" : "pointer",
                opacity: pending || !!activeSessionId ? 0.65 : 1,
              }}
            >
              Start meeting
            </button>
            <button
              type="button"
              onClick={() => void handleEndSession()}
              disabled={pending || !activeSessionId}
              style={{
                border: `1px solid ${RED}`,
                background: activeSessionId ? "rgba(199,54,44,0.08)" : "transparent",
                color: RED,
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 600,
                cursor:
                  pending || !activeSessionId ? "default" : "pointer",
                opacity: pending || !activeSessionId ? 0.65 : 1,
              }}
            >
              End meeting
            </button>
          </div>

          {/* Input Form */}
          <form
            onSubmit={onSubmit}
            style={{
              border: `1px solid ${SURFACE_BORDER}`,
              borderRadius: 14,
              background: "#fff",
              padding: 12,
              display: "flex",
              gap: 8,
            }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={
                activeSessionId
                  ? "Continue your session — add notes, discuss agenda items…"
                  : "Ask about ops, start an initiative, begin a meeting…"
              }
              style={{
                flex: 1,
                border: `1px solid ${SURFACE_BORDER}`,
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 14,
                outline: "none",
              }}
              disabled={pending}
            />
            <button
              type="submit"
              disabled={pending || !input.trim()}
              style={{
                border: `1px solid ${NAVY}`,
                background: NAVY,
                color: "#fff",
                borderRadius: 10,
                padding: "0 14px",
                fontSize: 13,
                cursor:
                  pending || !input.trim() ? "default" : "pointer",
                opacity: pending || !input.trim() ? 0.7 : 1,
              }}
            >
              Send
            </button>
          </form>

          {/* Error */}
          {error && (
            <div
              style={{
                border: "1px solid rgba(199,54,44,0.35)",
                background: "rgba(199,54,44,0.06)",
                borderRadius: 10,
                color: RED,
                fontSize: 13,
                padding: "8px 10px",
              }}
            >
              {error}
            </div>
          )}

          {/* Cost Footer (when no initiative panel) */}
          {initiatives.length === 0 && <CostFooter cost={costSummary} />}
        </div>
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
