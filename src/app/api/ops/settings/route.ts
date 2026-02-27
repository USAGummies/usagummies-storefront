import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  DB,
  NotionProp,
  extractDate,
  extractText,
  queryDatabase,
  updatePage,
} from "@/lib/notion/client";
import { getNotionApiKey } from "@/lib/notion/credentials";
import { checkIntegrations, type IntegrationStatus } from "@/lib/ops/env-check";
import { readState } from "@/lib/ops/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SettingsUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  lastLogin: string | null;
  active: boolean;
};

type SettingsResponse = {
  users: SettingsUser[];
  integrations: {
    shopify: boolean;
    plaid: boolean;
    ga4: boolean;
    gmail: boolean;
    notion: boolean;
    amazon: boolean;
    slack: boolean;
  };
  integrationDetails: IntegrationStatus[];
  auditTimestamp: string | null;
  version: {
    build: string;
    appVersion: string;
    cacheTtlMinutes: {
      dashboard: number;
      channels: number;
      pipeline: number;
      inventory: number;
      supplyChain: number;
      marketing: number;
      alerts: number;
      audit: number;
    };
  };
  canEditRoles: boolean;
  generatedAt: string;
  error?: string;
};

const VALID_ROLES = ["admin", "investor", "employee", "partner", "banker"] as const;

function integrationSummary(details: IntegrationStatus[]) {
  const lookup = new Map(details.map((d) => [d.name, d.configured]));
  return {
    shopify: lookup.get("Shopify Admin") || false,
    plaid: lookup.get("Plaid") || false,
    ga4: lookup.get("GA4") || false,
    gmail: lookup.get("Gmail") || false,
    notion: lookup.get("Notion") || false,
    amazon: lookup.get("Amazon SP-API") || false,
    slack: lookup.get("Slack") || false,
  };
}

function parseUser(page: Record<string, unknown>): SettingsUser {
  const props = (page.properties as Record<string, unknown>) || {};
  const activeProp = props["Active"] as { type?: string; checkbox?: boolean } | undefined;
  const active = activeProp?.type === "checkbox" ? Boolean(activeProp.checkbox) : true;

  return {
    id: String(page.id || ""),
    name:
      extractText(props["Name"]) ||
      extractText(props["Full Name"]) ||
      "Unknown",
    email: extractText(props["Email"]),
    role: extractText(props["Role"]) || "employee",
    lastLogin:
      extractDate(props["Last Login"]) ||
      extractText(props["Last Login"]) ||
      null,
    active,
  };
}

async function getAuditTimestamp(): Promise<string | null> {
  const cached = await readState<{
    data?: { generatedAt?: string; lastFetched?: string };
  } | null>("audit-cache", null);

  return cached?.data?.lastFetched || cached?.data?.generatedAt || null;
}

export async function GET() {
  try {
    const session = await auth();
    const canEditRoles = session?.user?.role === "admin";
    const integrationDetails = checkIntegrations();

    const [rows, auditTimestamp] = await Promise.all([
      queryDatabase(
        DB.PLATFORM_USERS,
        undefined,
        [{ property: "Last Login", direction: "descending" }],
        200,
      ),
      getAuditTimestamp(),
    ]);

    const users = (rows || []).map(parseUser);

    const result: SettingsResponse = {
      users,
      integrations: integrationSummary(integrationDetails),
      integrationDetails,
      auditTimestamp,
      version: {
        build: (process.env.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 7),
        appVersion: process.env.npm_package_version || "0.1.0",
        cacheTtlMinutes: {
          dashboard: 5,
          channels: 5,
          pipeline: 10,
          inventory: 10,
          supplyChain: 15,
          marketing: 10,
          alerts: 5,
          audit: 10,
        },
      },
      canEditRoles,
      generatedAt: new Date().toISOString(),
      ...(rows ? {} : { error: "Notion users unavailable" }),
    };

    return NextResponse.json(result);
  } catch (err) {
    const integrationDetails = checkIntegrations();
    return NextResponse.json(
      {
        users: [],
        integrations: integrationSummary(integrationDetails),
        integrationDetails,
        auditTimestamp: null,
        version: {
          build: (process.env.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 7),
          appVersion: process.env.npm_package_version || "0.1.0",
          cacheTtlMinutes: {
            dashboard: 5,
            channels: 5,
            pipeline: 10,
            inventory: 10,
            supplyChain: 15,
            marketing: 10,
            alerts: 5,
            audit: 10,
          },
        },
        canEditRoles: false,
        generatedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      } satisfies SettingsResponse,
      { status: 200 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (session?.user?.role !== "admin") {
      return NextResponse.json({ error: "Admin role required" }, { status: 403 });
    }

    const body = (await req.json()) as { userId?: string; role?: string };
    const userId = String(body.userId || "").trim();
    const role = String(body.role || "").trim();

    if (!userId || !role) {
      return NextResponse.json({ error: "userId and role are required" }, { status: 400 });
    }
    if (!VALID_ROLES.includes(role as (typeof VALID_ROLES)[number])) {
      return NextResponse.json({ error: `Invalid role: ${role}` }, { status: 400 });
    }
    if (!getNotionApiKey()) {
      return NextResponse.json({ error: "Notion API not configured" }, { status: 503 });
    }

    const updated = await updatePage(userId, {
      Role: NotionProp.select(role),
    });

    if (!updated) {
      return NextResponse.json({ error: "Failed to update role in Notion" }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      userId,
      role,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
