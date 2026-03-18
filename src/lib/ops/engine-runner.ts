/**
 * Engine Runner — Bridge between cloud executor and .mjs engine scripts
 *
 * Spawns the existing engine scripts as child processes with `run <agentKey>`.
 * The scripts already have cloud-aware branching via the shared library:
 *   - safeJsonRead/safeJsonWrite → Vercel KV on cloud
 *   - sendEmail → nodemailer on cloud
 *   - sendIMessage → Slack on cloud
 *
 * This avoids rewriting 12,800+ lines of agent logic.
 */

import { spawn } from "child_process";
import path from "path";
import { ENGINE_REGISTRY } from "@/lib/ops/engine-schedule";
import {
  recordAgentRun,
  isAgentDisabled,
  shouldAutoDisable,
  disableAgent,
  type AgentRunRecord,
} from "@/lib/ops/agent-performance";

const ENGINE_SCRIPT_MAP: Record<string, string> = {
  b2b: "usa-gummies-agentic.mjs",
  seo: "usa-gummies-seo-engine.mjs",
  dtc: "usa-gummies-dtc-engine.mjs",
  "supply-chain": "usa-gummies-supply-chain.mjs",
  "revenue-intel": "usa-gummies-revenue-intel.mjs",
  finops: "usa-gummies-finops.mjs",
  social: "usa-gummies-social-engine.mjs",
  "abra-sync": "abra-brain-sync.mjs",
  "marketing-autopost": "usa-gummies-marketing-autopost.mjs",
};

export type AgentResult = {
  status: "success" | "failed" | "skipped";
  summary: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
};

/**
 * Run an agent by spawning its engine script as a child process.
 * Returns structured result with stdout/stderr captured.
 */
// ---------------------------------------------------------------------------
// Internal API agents — TypeScript modules called directly (no child process)
// These handle jobs that live in src/ rather than scripts/
// ---------------------------------------------------------------------------

type InternalAgentFn = () => Promise<{ summary: string }>;

async function runInternalAgent(fn: InternalAgentFn): Promise<AgentResult> {
  const start = Date.now();
  try {
    const result = await fn();
    return {
      status: "success",
      summary: result.summary,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      status: "failed",
      summary: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

const INTERNAL_AGENTS: Record<string, Record<string, () => Promise<InternalAgentFn>>> = {
  "abra-sync": {
    ABRA10: async () => {
      const { expireStaleApprovals } = await import("@/lib/ops/abra-actions");
      return async () => {
        // Expire stale approvals before generating the brief
        let expired = 0;
        try {
          expired = await expireStaleApprovals(24);
        } catch {
          // non-fatal
        }
        // Call the morning brief API endpoint internally
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : process.env.NEXTAUTH_URL || "https://www.usagummies.com";
        const cronSecret = process.env.CRON_SECRET;
        const res = await fetch(`${baseUrl}/api/ops/abra/morning-brief`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
          },
          body: JSON.stringify({ triggeredBy: "scheduler" }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Morning brief failed: ${res.status} ${text.slice(0, 200)}`);
        }
        return { summary: `Morning brief posted to Slack. ${expired > 0 ? `${expired} stale approvals expired.` : ""}` };
      };
    },
    ABRA12: async () => {
      return async () => {
        const { getFailingAgents: getFailing } = await import("@/lib/ops/agent-performance");
        const { notify } = await import("@/lib/ops/notify");
        const failing = await getFailing();
        if (failing.length === 0) {
          return { summary: "Agent Health Monitor: all agents healthy" };
        }
        const lines = failing.map(
          (a) =>
            `  ${a.health.toUpperCase()} ${a.engineId}/${a.agentKey} (${a.agentName}) — ${a.last7Days.successRate}% success, ${a.consecutiveFailures} consecutive failures${a.disabled ? " [DISABLED]" : ""}`,
        );
        const text = [
          `Agent Health Monitor — ${failing.length} agent(s) need attention:`,
          ...lines,
        ].join("\n");
        await notify({ channel: "alerts", text });
        return { summary: `Agent Health Monitor: ${failing.length} degraded/failing agents reported` };
      };
    },
    ABRA11: async () => {
      return async () => {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : process.env.NEXTAUTH_URL || "https://www.usagummies.com";
        const cronSecret = process.env.CRON_SECRET;
        const res = await fetch(`${baseUrl}/api/ops/abra/proactive-alerts`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
          },
          signal: AbortSignal.timeout(55_000),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Proactive alert scan failed: ${res.status} ${text.slice(0, 200)}`);
        }
        const data = (await res.json()) as { alerts?: number; sent?: number; suppressed?: number };
        return {
          summary: `Proactive scan: ${data.alerts ?? 0} alerts, ${data.sent ?? 0} sent, ${data.suppressed ?? 0} suppressed`,
        };
      };
    },
    ABRA13: async () => {
      return async () => {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : process.env.NEXTAUTH_URL || "https://www.usagummies.com";
        const cronSecret = process.env.CRON_SECRET;
        const res = await fetch(`${baseUrl}/api/ops/abra/dead-letter`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
          },
          body: JSON.stringify({ action: "retry" }),
          signal: AbortSignal.timeout(90_000),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Dead letter retry failed: ${res.status} ${text.slice(0, 200)}`);
        }
        const data = (await res.json()) as { retried?: number; recovered?: number; abandoned?: number };
        return {
          summary: `Dead letter recovery: ${data.retried ?? 0} retried, ${data.recovered ?? 0} recovered, ${data.abandoned ?? 0} abandoned`,
        };
      };
    },
    ABRA14: async () => {
      return async () => {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : process.env.NEXTAUTH_URL || "https://www.usagummies.com";
        const cronSecret = process.env.CRON_SECRET;
        const res = await fetch(`${baseUrl}/api/ops/abra/weekly-digest`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
          },
          signal: AbortSignal.timeout(55_000),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Weekly digest failed: ${res.status} ${text.slice(0, 200)}`);
        }
        return { summary: "Weekly digest posted to Slack" };
      };
    },
    ABRA15: async () => {
      return async () => {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : process.env.NEXTAUTH_URL || "https://www.usagummies.com";
        const cronSecret = process.env.CRON_SECRET;
        const res = await fetch(`${baseUrl}/api/ops/abra/outcome-check`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
          },
          signal: AbortSignal.timeout(55_000),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Outcome check failed: ${res.status} ${text.slice(0, 200)}`);
        }
        const data = (await res.json()) as { checked?: number; updated?: number };
        return {
          summary: `Outcome Tracker: ${data.checked ?? 0} checked, ${data.updated ?? 0} updated`,
        };
      };
    },
  },
  "revenue-intel": {
    R13: async () => {
      return async () => {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : process.env.NEXTAUTH_URL || "https://www.usagummies.com";
        const cronSecret = process.env.CRON_SECRET;
        const res = await fetch(`${baseUrl}/api/ops/abra/collect-kpis`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
          },
          signal: AbortSignal.timeout(55_000),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`KPI collection failed: ${res.status} ${text.slice(0, 200)}`);
        }
        const data = (await res.json()) as { collected?: number; recorded?: number; collectionErrors?: string[] };
        const errNote = data.collectionErrors?.length
          ? ` (${data.collectionErrors.length} collection warnings)`
          : "";
        return {
          summary: `Daily KPI Collector: ${data.collected ?? 0} metrics collected, ${data.recorded ?? 0} recorded${errNote}`,
        };
      };
    },
  },
  finops: {
    F9: async () => {
      const mod = await import("@/lib/ops/abra-financial-statements");
      const { notify } = await import("@/lib/ops/notify");
      return async () => {
        const period = mod.buildMonthlyStatementPeriod();
        const statement = await mod.generatePnL(period);
        const text = mod.formatPnLAsText(statement);
        await notify({ channel: "daily", text: `Weekly P&L Update\n\n${text}` });
        return { summary: `P&L generated: ${period.label} — Net ${statement.netOperatingIncome >= 0 ? "+" : ""}$${statement.netOperatingIncome.toFixed(2)}` };
      };
    },
    F12: async () => {
      const { runMonthlyClose } = await import("@/lib/finance/monthly-close");
      return async () => {
        const now = new Date();
        // Close previous month (format: "YYYY-MM")
        const prevMonth = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
        const prevYear = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
        const period = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
        const result = await runMonthlyClose(period, "abra-scheduler");
        return { summary: `Monthly close: ${result.status} — ${result.notes?.length || 0} notes` };
      };
    },
    F13: async () => {
      const mod = await import("@/lib/ops/abra-financial-statements");
      const { notify } = await import("@/lib/ops/notify");
      return async () => {
        const now = new Date();
        const prevMonth = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
        const prevYear = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
        const period = mod.buildMonthlyStatementPeriod(prevMonth, prevYear);
        const { statement, notionPageId } = await mod.generateAndPostPnL(period);
        const text = mod.formatPnLAsText(statement);
        await notify({ channel: "daily", text: `Monthly P&L — ${period.label}\n\n${text}` });
        return { summary: `Monthly P&L posted: ${period.label}${notionPageId ? ` (Notion: ${notionPageId})` : ""}` };
      };
    },
    F14: async () => {
      const { bulkCategorize } = await import("@/lib/ops/transaction-categorizer");
      const { queryNotionDatabase } = await import("@/lib/ops/abra-notion-write");
      const { DB } = await import("@/lib/notion/client");
      const { notify } = await import("@/lib/ops/notify");
      return async () => {
        // Fetch uncategorized transactions from Notion
        const pages = await queryNotionDatabase({
          database_id: DB.CASH_TRANSACTIONS,
          filter: {
            or: [
              { property: "Account Code", rich_text: { is_empty: true } },
              { property: "GL Code", rich_text: { is_empty: true } },
            ],
          },
          sorts: [{ property: "Date", direction: "descending" }],
          page_size: 50,
        });

        if (pages.length === 0) {
          return { summary: "No uncategorized transactions found" };
        }

        // Extract transaction data from Notion pages
        const txs = pages.map((page) => {
          const p = page as Record<string, unknown>;
          const props = p.properties as Record<string, unknown> | undefined;
          return {
            id: typeof p.id === "string" ? p.id : "",
            description: f14Text(props, ["Name", "Description", "Transaction", "Memo"]),
            amount: f14Number(props, ["Amount", "Net Amount", "Total", "Value"]),
            counterparty: f14Text(props, ["Vendor", "Payee", "Merchant"]) || undefined,
            date: f14Date(props, ["Date", "Transaction Date"]),
          };
        });

        const results = await bulkCategorize(txs);
        const high = results.filter((r) => r.result.confidence > 0.9);
        const low = results.filter((r) => r.result.confidence <= 0.9);

        // Auto-apply high-confidence results
        let applied = 0;
        const notionToken = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
        if (notionToken && high.length > 0) {
          for (const item of high) {
            if (!item.id) continue;
            try {
              const res = await fetch(`https://api.notion.com/v1/pages/${item.id}`, {
                method: "PATCH",
                headers: {
                  Authorization: `Bearer ${notionToken}`,
                  "Notion-Version": "2022-06-28",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  properties: {
                    "Account Code": {
                      rich_text: [{ text: { content: item.result.account_code } }],
                    },
                    Category: {
                      rich_text: [{ text: { content: item.result.category } }],
                    },
                  },
                }),
                signal: AbortSignal.timeout(10_000),
              });
              if (res.ok) applied++;
            } catch {
              // Continue with next
            }
          }
        }

        const summaryText = `Auto-categorized ${results.length} transactions: ${high.length} high-confidence (${applied} applied), ${low.length} need review`;
        await notify({ channel: "daily", text: `[FinOps F14] ${summaryText}` });
        return { summary: summaryText };
      };
    },
    F15: async () => {
      const mod = await import("@/lib/ops/revenue-reconciliation");
      const { notify } = await import("@/lib/ops/notify");
      return async () => {
        const period = mod.buildReconciliationPeriod();
        const report = await mod.generateReconciliationReport(period);
        const text = mod.formatReconciliationAsText(report);
        await notify({ channel: "daily", text: `Revenue Reconciliation — ${period.label}\n\n${text}` });
        return { summary: `Reconciliation: ${period.label} — ${report.status} (variance ${report.totalVariance >= 0 ? "+" : ""}$${report.totalVariance.toFixed(2)})` };
      };
    },
  },
};

// ---------------------------------------------------------------------------
// F14 Notion property helpers (scoped to avoid naming conflicts)
// ---------------------------------------------------------------------------

function f14Text(props: Record<string, unknown> | undefined, names: string[]): string {
  if (!props) return "";
  for (const name of names) {
    const prop = props[name] as Record<string, unknown> | undefined;
    if (!prop) continue;
    if (Array.isArray(prop.title)) {
      const text = (prop.title as Array<{ plain_text?: string }>).map((t) => t.plain_text || "").join("").trim();
      if (text) return text;
    }
    if (Array.isArray(prop.rich_text)) {
      const text = (prop.rich_text as Array<{ plain_text?: string }>).map((t) => t.plain_text || "").join("").trim();
      if (text) return text;
    }
  }
  return "";
}

function f14Number(props: Record<string, unknown> | undefined, names: string[]): number {
  if (!props) return 0;
  for (const name of names) {
    const prop = props[name] as Record<string, unknown> | undefined;
    if (!prop) continue;
    if (typeof prop.number === "number") return prop.number;
  }
  return 0;
}

function f14Date(props: Record<string, unknown> | undefined, names: string[]): string {
  if (!props) return "";
  for (const name of names) {
    const prop = props[name] as Record<string, unknown> | undefined;
    if (!prop) continue;
    if (prop.date && typeof prop.date === "object") {
      const d = prop.date as { start?: string };
      if (d.start) return d.start.slice(0, 10);
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Helper: resolve agent name from registry
// ---------------------------------------------------------------------------

function resolveAgentName(engineId: string, agentKey: string): string {
  for (const engine of ENGINE_REGISTRY) {
    if (engine.id === engineId) {
      const agent = engine.agents.find((a) => a.key === agentKey);
      if (agent) return agent.name;
    }
  }
  return `${engineId}/${agentKey}`;
}

// ---------------------------------------------------------------------------
// Core runAgent with performance tracking
// ---------------------------------------------------------------------------

export async function runAgent(
  engineId: string,
  agentKey: string,
  timeoutMs = 270_000 // 4.5 min (leave buffer for Vercel's 5 min limit)
): Promise<AgentResult> {
  const agentName = resolveAgentName(engineId, agentKey);

  // Check if agent is disabled (auto-disabled due to consecutive failures)
  try {
    const disabled = await isAgentDisabled(engineId, agentKey);
    if (disabled) {
      const skipRecord: AgentRunRecord = {
        engineId,
        agentKey,
        agentName,
        status: "skipped",
        durationMs: 0,
        timestamp: new Date().toISOString(),
        error: "Agent is auto-disabled due to consecutive failures",
      };
      // Fire-and-forget: don't let recording failure block the skip
      recordAgentRun(skipRecord).catch(() => {});
      return {
        status: "skipped",
        summary: `Agent ${agentKey} is disabled — skipping`,
        durationMs: 0,
      };
    }
  } catch {
    // If disable check fails, proceed with running the agent
  }

  // Execute the agent
  const result = await runAgentCore(engineId, agentKey, timeoutMs);

  // Record the run (fire-and-forget — never block on tracking)
  try {
    const runRecord: AgentRunRecord = {
      engineId,
      agentKey,
      agentName,
      status: result.status === "failed" ? "failed" : result.status === "skipped" ? "skipped" : "success",
      durationMs: result.durationMs ?? 0,
      timestamp: new Date().toISOString(),
      error: result.status === "failed" ? result.summary?.slice(0, 500) : undefined,
    };
    recordAgentRun(runRecord).catch(() => {});

    // Check if we should auto-disable after a failure
    if (result.status === "failed") {
      shouldAutoDisable(engineId, agentKey)
        .then((should) => {
          if (should) {
            return disableAgent(
              engineId,
              agentKey,
              `Auto-disabled: 5+ consecutive failures. Last error: ${result.summary?.slice(0, 200)}`,
            );
          }
        })
        .catch(() => {});

      // Enqueue into dead letter queue for retry (lazy import to avoid circular dependency)
      import("@/lib/ops/dead-letter-queue")
        .then(({ enqueueFailedAgent }) =>
          enqueueFailedAgent({
            engineId,
            agentKey,
            agentName,
            failedAt: new Date().toISOString(),
            errorMessage: result.summary?.slice(0, 500) || "Unknown error",
            maxRetries: 3,
          }),
        )
        .catch(() => {});
    }
  } catch {
    // Never let performance tracking interfere with agent execution
  }

  return result;
}

async function runAgentCore(
  engineId: string,
  agentKey: string,
  timeoutMs: number,
): Promise<AgentResult> {
  // Check for internal API agents first
  const internalEngine = INTERNAL_AGENTS[engineId];
  if (internalEngine?.[agentKey]) {
    const agentFactory = await internalEngine[agentKey]();
    return runInternalAgent(agentFactory);
  }

  const scriptName = ENGINE_SCRIPT_MAP[engineId];
  if (!scriptName) {
    return {
      status: "skipped",
      summary: `Unknown engine "${engineId}" — no script mapping`,
    };
  }

  // Resolve script path relative to project root
  const projectRoot = process.env.VERCEL
    ? process.cwd()
    : path.resolve(__dirname, "../../..");
  const scriptPath = path.join(projectRoot, "scripts", scriptName);

  // Build CLI args — B2B engine uses `run-agent` while others use `run`
  let args: string[];
  if (engineId === "b2b") {
    // B2B engine: node scripts/usa-gummies-agentic.mjs run-agent <agentKey>
    args = [scriptPath, "run-agent", agentKey];
  } else {
    // Other engines: node scripts/<engine>.mjs run <AGENT_KEY>
    args = [scriptPath, "run", agentKey.toUpperCase()];
  }

  const startTime = Date.now();

  return new Promise<AgentResult>((resolve) => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let settled = false;

    const child = spawn("node", args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        // Ensure cloud mode is detected
        VERCEL: process.env.VERCEL || "",
        // Pass through all credentials
        NODE_ENV: process.env.NODE_ENV || "production",
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk.toString());
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
    });

    const finish = (exitCode: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;

      const durationMs = Date.now() - startTime;
      const stdout = stdoutChunks.join("").slice(-10_000); // Last 10KB
      const stderr = stderrChunks.join("").slice(-5_000); // Last 5KB

      if (signal === "SIGTERM" || signal === "SIGKILL") {
        resolve({
          status: "failed",
          summary: `Timeout after ${Math.round(durationMs / 1000)}s (signal: ${signal})`,
          stdout,
          stderr,
          exitCode: exitCode ?? -1,
          durationMs,
        });
        return;
      }

      if (exitCode !== 0) {
        resolve({
          status: "failed",
          summary: stderr.slice(0, 200) || `Exit code ${exitCode}`,
          stdout,
          stderr,
          exitCode: exitCode ?? -1,
          durationMs,
        });
        return;
      }

      // Extract summary from last few lines of stdout
      const lastLines = stdout.trim().split("\n").slice(-5).join(" ").slice(0, 300);

      resolve({
        status: "success",
        summary: lastLines || "Agent completed",
        stdout,
        stderr,
        exitCode: 0,
        durationMs,
      });
    };

    child.on("close", (code, signal) => finish(code, signal));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      resolve({
        status: "failed",
        summary: `Spawn error: ${err.message}`,
        exitCode: -1,
        durationMs: Date.now() - startTime,
      });
    });

    // Hard timeout safety net
    setTimeout(() => {
      if (!settled) {
        try {
          child.kill("SIGTERM");
        } catch { /* ignore */ }
      }
    }, timeoutMs + 5000);
  });
}
