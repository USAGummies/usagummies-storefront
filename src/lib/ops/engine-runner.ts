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
export async function runAgent(
  engineId: string,
  agentKey: string,
  timeoutMs = 270_000 // 4.5 min (leave buffer for Vercel's 5 min limit)
): Promise<AgentResult> {
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
