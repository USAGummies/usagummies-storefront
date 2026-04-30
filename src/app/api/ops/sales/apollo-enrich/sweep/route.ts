/**
 * POST /api/ops/sales/apollo-enrich/sweep
 *
 * Bulk Apollo enrichment sweep (Phase D5 v0.2). Fetches recent
 * HubSpot contacts via `listRecentContacts`, projects each to the
 * EnrichableContact shape, runs `enrichContactById` for any contact
 * missing one or more enrichable fields, and returns a roll-up.
 *
 * Class A `lead.enrichment.write` per /contracts/approval-taxonomy.md
 * v1.6 — autonomous; no approval gate. Each contact's audit envelope
 * is written independently.
 *
 * Defaults:
 *   • `limit` — process up to 50 contacts per sweep (HubSpot rate
 *     limits + Apollo cost). Cap is 200.
 *   • `onlyMissingFields=true` — skip contacts where every enrichable
 *     field is already populated. Set false to force-touch every
 *     recent contact (only do this if you need a refresh sweep).
 *   • `dryRun=true` — run the proposal flow but skip the HubSpot
 *     write + audit-log write. Returns the proposals so callers
 *     can preview what would be written.
 *
 * Auth: session OR bearer CRON_SECRET. Middleware allowlisted.
 *
 * **Why not auto-cron yet:** D5 v0.2 ships the route + the cron can
 * be added in v0.3 once we've watched a few manual sweeps and
 * confirmed Apollo cost + HubSpot rate-limit behavior. Don't enable
 * autonomous bulk writes without a feedback loop on the volume.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  isHubSpotConfigured,
  listRecentContacts,
} from "@/lib/ops/hubspot-client";
import { isApolloConfigured } from "@/lib/ops/apollo-client";
import {
  enrichContactById,
  projectContactToEnrichable,
} from "@/lib/sales/apollo-enrichment-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Long enough for ~50 contacts × ~3s each (network-bound).
export const maxDuration = 180;

interface SweepBody {
  limit?: number;
  onlyMissingFields?: boolean;
  dryRun?: boolean;
}

interface SweepPerContactResult {
  contactId: string;
  email: string;
  ok: boolean;
  written: boolean;
  fillCount: number;
  skipReasons: string[];
  apolloPersonId: string | null;
  error?: string;
}

interface SweepResult {
  ok: boolean;
  scanned: number;
  candidates: number;
  enriched: number;
  written: number;
  errors: number;
  results: SweepPerContactResult[];
  errorsList: string[];
}

function hasMissingFields(props: Record<string, string | null>): boolean {
  const fields = ["firstname", "lastname", "jobtitle", "phone", "company", "city", "state"];
  return fields.some((f) => {
    const v = props[f];
    return v === null || v === undefined || v.trim() === "";
  });
}

async function runSweep(opts: SweepBody): Promise<SweepResult> {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
  const onlyMissingFields = opts.onlyMissingFields !== false;
  const dryRun = opts.dryRun === true;

  const errorsList: string[] = [];
  const results: SweepPerContactResult[] = [];

  if (!isHubSpotConfigured()) {
    return {
      ok: false,
      scanned: 0,
      candidates: 0,
      enriched: 0,
      written: 0,
      errors: 1,
      results: [],
      errorsList: ["HUBSPOT_PRIVATE_APP_TOKEN not configured"],
    };
  }
  if (!isApolloConfigured()) {
    return {
      ok: false,
      scanned: 0,
      candidates: 0,
      enriched: 0,
      written: 0,
      errors: 1,
      results: [],
      errorsList: ["APOLLO_API_KEY not configured"],
    };
  }

  let contacts: Array<{ id: string; properties: Record<string, string | null> }>;
  try {
    contacts = await listRecentContacts({ limit });
  } catch (err) {
    return {
      ok: false,
      scanned: 0,
      candidates: 0,
      enriched: 0,
      written: 0,
      errors: 1,
      results: [],
      errorsList: [
        `listRecentContacts failed: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  let candidates = 0;
  let enriched = 0;
  let written = 0;
  let errors = 0;

  for (const raw of contacts) {
    if (onlyMissingFields && !hasMissingFields(raw.properties)) continue;
    const projected = projectContactToEnrichable(raw);
    if (!projected) continue;
    candidates += 1;

    if (dryRun) {
      // Skip the actual flow; just report that this contact is a candidate.
      results.push({
        contactId: projected.id,
        email: projected.email,
        ok: true,
        written: false,
        fillCount: 0,
        skipReasons: ["dryRun"],
        apolloPersonId: null,
      });
      continue;
    }

    const flowRes = await enrichContactById(projected.id);
    if (!flowRes.ok) {
      errors += 1;
      errorsList.push(
        `contact ${projected.id}: ${flowRes.error ?? "unknown"}`,
      );
    }
    results.push({
      contactId: projected.id,
      email: projected.email,
      ok: flowRes.ok,
      written: flowRes.written ?? false,
      fillCount: flowRes.proposal?.fills.length ?? 0,
      skipReasons: flowRes.proposal?.skipReasons ?? [],
      apolloPersonId: flowRes.proposal?.apolloPersonId ?? null,
      error: flowRes.error,
    });
    if (flowRes.ok) enriched += 1;
    if (flowRes.written) written += 1;
  }

  return {
    ok: errors === 0 || enriched > 0,
    scanned: contacts.length,
    candidates,
    enriched,
    written,
    errors,
    results,
    errorsList,
  };
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: SweepBody = {};
  try {
    body = (await req.json()) as SweepBody;
  } catch {
    /* empty body fine */
  }
  const result = await runSweep(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

/** GET handler runs a default-options dry sweep (preview). Useful for cron readiness probes. */
export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
  const result = await runSweep({
    limit: Number.isFinite(limit) ? limit : 20,
    dryRun: url.searchParams.get("dryRun") !== "false",
    onlyMissingFields: url.searchParams.get("onlyMissingFields") !== "false",
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
