/**
 * GET /api/ops/control-plane/health
 *
 * Operator-usable readiness surface. Reports each dependency with one
 * of four states:
 *   - "ready"     — confirmed working (live probe succeeded)
 *   - "degraded"  — configured but with caveats (e.g. store empty,
 *                   Slack token absent so post is a no-op)
 *   - "unready"   — required env/config missing or live probe failed
 *   - "skipped"   — not applicable in this environment
 *
 * A component is `unready` → `ok: false` and the response returns 503
 * so cron monitors (and the daily brief "last-run health" panel) catch
 * outages without parsing the body. Otherwise returns 200 with
 * `ok: true` (possibly with `degraded: true` if any component is in
 * degraded state).
 *
 * Auth: bearer CRON_SECRET. No body.
 *
 * Canonical spec: blueprint §15.5 (sign-off checklist — "first audit
 * entries visible") + §6 (non-negotiables: connector failure must
 * surface explicitly, no silent green states).
 */

import { NextResponse } from "next/server";

import {
  approvalStore,
  auditStore,
  correctionStore,
  pauseSink,
  violationStore,
} from "@/lib/ops/control-plane/stores";
import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ComponentStatus = "ready" | "degraded" | "unready" | "skipped";

interface ComponentReport {
  status: ComponentStatus;
  detail: string;
  [extra: string]: unknown;
}

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  const components: Record<string, ComponentReport> = {};

  // ---- CRON_SECRET presence ----
  components.cronSecret = process.env.CRON_SECRET?.trim()
    ? { status: "ready", detail: "CRON_SECRET is configured" }
    : { status: "unready", detail: "CRON_SECRET missing — this very request should have failed auth; if you see this you are running in test-mode" };

  // ---- CONTROL_PLANE_ADMIN_SECRET presence ----
  //
  // Distinct from CRON_SECRET. Required for the admin-tier unpause
  // route (and any future admin-only mutations). Missing → admin routes
  // fail-closed 401 on every call. See admin-auth.ts.
  components.controlPlaneAdminSecret = process.env.CONTROL_PLANE_ADMIN_SECRET?.trim()
    ? {
        status: "ready",
        detail:
          "CONTROL_PLANE_ADMIN_SECRET is configured — admin-tier routes (unpause) are authenticable.",
      }
    : {
        status: "unready",
        detail:
          "CONTROL_PLANE_ADMIN_SECRET missing — /api/ops/control-plane/unpause returns 401 on every call. Set it in Vercel env; it MUST be a different value from CRON_SECRET (never reuse).",
      };

  // ---- Approval store ----
  components.approvalStore = await probe(async () => {
    const pending = await approvalStore().listPending();
    return {
      status: "ready" as const,
      detail: `listPending OK (${pending.length} pending)`,
      pendingCount: pending.length,
    };
  }, "approval store");

  // ---- Audit store ----
  components.auditStore = await probe(async () => {
    const recent = await auditStore().recent(1);
    return {
      status: "ready" as const,
      detail: `recent(1) OK (${recent.length === 0 ? "empty" : "has entries"})`,
      hasEntries: recent.length > 0,
    };
  }, "audit store");

  // ---- Pause sink ----
  components.pauseSink = await probe(async () => {
    const paused = await pauseSink().listPaused();
    return {
      status: "ready" as const,
      detail: `listPaused OK (${paused.length} paused)`,
      pausedCount: paused.length,
      pausedAgents: paused.map((p) => p.agentId),
    };
  }, "pause sink");

  // ---- Violation store (+ "ever populated" check) ----
  components.violationStore = await probe(async () => {
    const ever = await violationStore().hasAnyEverRecorded();
    if (!ever) {
      return {
        status: "degraded" as const,
        detail:
          "reachable but has never recorded a violation — drift-audit auto-pause cannot fire until agents or reviewers append entries via POST /api/ops/control-plane/violations",
        everRecorded: false,
      };
    }
    return { status: "ready" as const, detail: "hasAnyEverRecorded() → true", everRecorded: true };
  }, "violation store");

  // ---- Correction store ----
  components.correctionStore = await probe(async () => {
    const ever = await correctionStore().hasAnyEverRecorded();
    if (!ever) {
      return {
        status: "degraded" as const,
        detail:
          "reachable but has never recorded a correction — human-correction counts are structurally zero, not measured-zero. Seed with POST /api/ops/control-plane/corrections.",
        everRecorded: false,
      };
    }
    return { status: "ready" as const, detail: "hasAnyEverRecorded() → true", everRecorded: true };
  }, "correction store");

  // ---- Slack config ----
  const hasBotToken = !!process.env.SLACK_BOT_TOKEN?.trim();
  const hasSigningSecret = !!process.env.SLACK_SIGNING_SECRET?.trim();
  if (!hasBotToken && !hasSigningSecret) {
    components.slackConfig = {
      status: "unready",
      detail:
        "SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET are both missing. Daily brief post is a no-op; interactive approval route refuses all traffic (fail-closed). Ben: provision the 3.0 Slack app and set both env vars in Vercel.",
      hasBotToken,
      hasSigningSecret,
    };
  } else if (!hasBotToken) {
    components.slackConfig = {
      status: "degraded",
      detail: "SLACK_BOT_TOKEN missing — outbound posts no-op. Signing secret is present so approvals can still verify inbound.",
      hasBotToken,
      hasSigningSecret,
    };
  } else if (!hasSigningSecret) {
    components.slackConfig = {
      status: "unready",
      detail: "SLACK_SIGNING_SECRET missing — approval route refuses all Slack interactivity (fail-closed). Set it in Vercel env.",
      hasBotToken,
      hasSigningSecret,
    };
  } else {
    components.slackConfig = {
      status: "ready",
      detail: "SLACK_BOT_TOKEN + SLACK_SIGNING_SECRET both present",
      hasBotToken,
      hasSigningSecret,
    };
  }

  // ---- Slack approval route readiness (logical readiness from config) ----
  components.slackApprovalRoute = hasSigningSecret
    ? {
        status: "ready",
        detail: "signing secret present; route will verify inbound Slack interactivity",
      }
    : {
        status: "unready",
        detail: "SLACK_SIGNING_SECRET missing — /api/slack/approvals will return 503",
      };

  // ---- Daily brief route readiness ----
  components.dailyBriefRoute = (() => {
    const cronOk = components.cronSecret.status === "ready";
    if (!cronOk) return { status: "unready" as const, detail: "CRON_SECRET missing → route will 401 everything" };
    if (!hasBotToken) {
      return {
        status: "degraded" as const,
        detail: "route operational; Slack post will fail-gracefully with degraded:true until SLACK_BOT_TOKEN is set",
      };
    }
    return { status: "ready" as const, detail: "CRON_SECRET + SLACK_BOT_TOKEN both present" };
  })();

  // ---- Unpause route readiness ----
  //
  // Depends on both admin secret (auth) AND the pause sink (for the
  // isPaused + unpauseAgent operations the route performs).
  components.unpauseRoute = (() => {
    if (components.controlPlaneAdminSecret.status !== "ready") {
      return {
        status: "unready" as const,
        detail:
          "CONTROL_PLANE_ADMIN_SECRET missing → route will 401 every caller. Set it in Vercel.",
      };
    }
    if (components.pauseSink.status !== "ready") {
      return {
        status: "unready" as const,
        detail: "pause sink unreachable → unpause cannot modify state.",
      };
    }
    return { status: "ready" as const, detail: "admin secret configured, pause sink reachable" };
  })();

  // ---- Drift audit route readiness ----
  components.driftAuditRoute = (() => {
    if (components.cronSecret.status !== "ready") {
      return { status: "unready" as const, detail: "CRON_SECRET missing → route will 401" };
    }
    const degradedInputs =
      components.violationStore.status === "degraded" ||
      components.correctionStore.status === "degraded";
    if (degradedInputs) {
      return {
        status: "degraded" as const,
        detail:
          "route operational; auto-pause can never trigger until the violation store has real entries. Response envelope returns degraded:true in this state — by design.",
      };
    }
    return { status: "ready" as const, detail: "all upstream stores healthy" };
  })();

  // ---- Roll up ----
  const anyUnready = Object.values(components).some((c) => c.status === "unready");
  const anyDegraded = Object.values(components).some((c) => c.status === "degraded");
  const ok = !anyUnready;
  const degraded = anyDegraded;

  const body = {
    ok,
    degraded,
    summary: summarize(components, ok, degraded),
    components,
    asOf: new Date().toISOString(),
  };

  return NextResponse.json(body, { status: ok ? 200 : 503 });
}

async function probe(
  fn: () => Promise<ComponentReport>,
  label: string,
): Promise<ComponentReport> {
  try {
    return await fn();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { status: "unready", detail: `${label}: ${detail}` };
  }
}

function summarize(
  components: Record<string, ComponentReport>,
  ok: boolean,
  degraded: boolean,
): string {
  const unready = Object.entries(components)
    .filter(([, c]) => c.status === "unready")
    .map(([k]) => k);
  const degradedList = Object.entries(components)
    .filter(([, c]) => c.status === "degraded")
    .map(([k]) => k);
  if (!ok) {
    return `UNREADY — unhealthy components: ${unready.join(", ")}`;
  }
  if (degraded) {
    return `READY (degraded) — degraded components: ${degradedList.join(", ")}`;
  }
  return "READY — all components healthy";
}
