/**
 * GET /api/ops/fulfillment/oauth-consent-url
 *
 * One-click Gmail + Drive OAuth re-consent URL generator. Builds the
 * Google authorization URL with EVERY scope our platform needs so a
 * single consent covers:
 *
 *   - Gmail read (inbox, Sent folder, threads, search)
 *   - Gmail send (already works, re-granted for completeness)
 *   - Gmail compose/modify (for drafts.create — missing today)
 *   - Drive readonly (for AP-packet attachment fetching — missing today)
 *
 * Flow:
 *   1. Ben opens the returned `authorizationUrl`
 *   2. Google consent screen — Ben clicks Allow
 *   3. Google redirects to /api/ops/gmail-callback with ?code=...
 *   4. Callback exchanges the code for a refresh_token and displays
 *      it in plain HTML for Ben to copy
 *   5. Ben pastes the new token into Vercel env GMAIL_OAUTH_REFRESH_TOKEN
 *   6. Next deployment picks it up; all 3 blocked workflows unlock
 *
 * Why `prompt=consent` + `access_type=offline`: without these, Google
 * returns an access_token but no refresh_token on subsequent consents
 * for the same client+user. We want a refresh_token every time.
 *
 * Auth: session OR CRON_SECRET (under /api/ops/fulfillment/).
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUIRED_SCOPES = [
  // Gmail — full read + compose + send.
  // gmail.modify is a superset of compose + labels; we pair it with send
  // explicitly so a sharp-eyed reviewer sees both.
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  // Drive readonly — AP-packet W-9 / CIF / sell-sheet PDFs live here.
  "https://www.googleapis.com/auth/drive.readonly",
  // User profile — returned by default but listing it explicitly keeps
  // the consent screen truthful about what we're asking for.
  "openid",
  "email",
  "profile",
];

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId =
    process.env.GMAIL_OAUTH_CLIENT_ID ||
    process.env.GCP_GMAIL_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      {
        error:
          "GMAIL_OAUTH_CLIENT_ID env var is not set. Cannot generate consent URL without it.",
      },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  // Callback lives at /api/ops/gmail-callback and already exchanges
  // code → refresh_token. Re-use it so Ben sees the new token inline.
  const redirectUri = `${url.origin}/api/ops/gmail-callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: REQUIRED_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // force the consent screen + refresh_token issuance
    include_granted_scopes: "true",
  });

  const authorizationUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return NextResponse.json({
    ok: true,
    authorizationUrl,
    scopes: REQUIRED_SCOPES,
    redirectUri,
    instructions: [
      "1. Open authorizationUrl in a browser where you're signed in as ben@usagummies.com",
      "2. Click Allow on every scope (Gmail read + send + modify + Drive readonly)",
      "3. Google redirects back to /api/ops/gmail-callback and displays a page with the new GMAIL_OAUTH_REFRESH_TOKEN",
      "4. Copy the token value, open Vercel → Settings → Environment Variables → edit GMAIL_OAUTH_REFRESH_TOKEN → paste → Save",
      "5. Redeploy or wait for next auto-deploy; scope-gated workflows (Gmail drafts, Drive file fetch) unblock on the next request",
    ],
  });
}
