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

const ENGINE_SCRIPT_MAP: Record<string, string> = {
  b2b: "usa-gummies-agentic.mjs",
  seo: "usa-gummies-seo-engine.mjs",
  dtc: "usa-gummies-dtc-engine.mjs",
  "supply-chain": "usa-gummies-supply-chain.mjs",
  "revenue-intel": "usa-gummies-revenue-intel.mjs",
  finops: "usa-gummies-finops.mjs",
  social: "usa-gummies-social-engine.mjs",
  "abra-sync": "abra-brain-sync.mjs",
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
      return async () => {
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
        return { summary: "Morning brief posted to Slack" };
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
  },
};

export async function runAgent(
  engineId: string,
  agentKey: string,
  timeoutMs = 270_000 // 4.5 min (leave buffer for Vercel's 5 min limit)
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
