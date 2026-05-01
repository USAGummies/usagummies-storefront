/**
 * GET /api/ops/email-agents/status
 *
 * Read-only readiness surface for the email-agent system. Reads docs,
 * vercel.json, and boolean env state only. It does not call Gmail,
 * HubSpot, Slack, QBO, Shopify, or the email-intel runner.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { deriveEmailAgentsStatus } from "@/lib/ops/email-agents-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = process.cwd();

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [
      incidentMarkdown,
      systemMarkdown,
      hubspotPropertyMarkdown,
      vercelJson,
    ] = await Promise.all([
      readText("contracts/incident-2026-04-30-email-intel.md"),
      readText("contracts/email-agents-system.md"),
      readText("contracts/email-agents-hubspot-property-spec.md"),
      readText("vercel.json"),
    ]);

    return NextResponse.json({
      ok: true,
      status: deriveEmailAgentsStatus({
        incidentMarkdown,
        systemMarkdown,
        hubspotPropertyMarkdown,
        vercelJson,
        env: {
          EMAIL_INTEL_ENABLED: process.env.EMAIL_INTEL_ENABLED,
        },
      }),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        code: "email_agents_status_failed",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

function readText(relativePath: string): Promise<string> {
  return readFile(join(ROOT, relativePath), "utf8");
}
