import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { storeOAuthState } from "@/lib/ops/qbo-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Initiates the QuickBooks Online OAuth2 Authorization Code flow.
 * Visit this URL to connect QBO to the ops platform.
 *
 * GET /api/ops/qbo/authorize -> 302 redirect to Intuit consent screen
 */
export async function GET() {
  const clientId = (process.env.QBO_CLIENT_ID ?? "").trim();
  const redirectUri = (process.env.QBO_REDIRECT_URI ?? "").trim();

  if (!clientId) {
    return NextResponse.json(
      { error: "Missing QBO_CLIENT_ID env var" },
      { status: 500 },
    );
  }

  if (!redirectUri) {
    return NextResponse.json(
      { error: "Missing QBO_REDIRECT_URI env var" },
      { status: 500 },
    );
  }

  // Generate and store CSRF state parameter
  const state = randomBytes(16).toString("hex");
  await storeOAuthState(state);

  const authorizeUrl = new URL(
    "https://appcenter.intuit.com/connect/oauth2",
  );
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "com.intuit.quickbooks.accounting");
  authorizeUrl.searchParams.set("state", state);

  return NextResponse.redirect(authorizeUrl.toString());
}
