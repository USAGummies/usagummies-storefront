import { NextResponse } from "next/server";
import { storeTokens, validateOAuthState } from "@/lib/ops/qbo-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OAuth2 callback for QuickBooks Online API.
 * Exchanges the authorization code for access + refresh tokens.
 *
 * Flow:
 * 1. User visits /api/ops/qbo/authorize -> redirected to Intuit consent screen
 * 2. User approves -> Intuit redirects here with ?code=...&state=...&realmId=...
 * 3. We exchange code for tokens and store them in Vercel KV
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const realmId = url.searchParams.get("realmId");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.json(
      { error, description: url.searchParams.get("error_description") },
      { status: 400 },
    );
  }

  if (!code) {
    return NextResponse.json(
      { error: "No authorization code in callback" },
      { status: 400 },
    );
  }

  if (!realmId) {
    return NextResponse.json(
      { error: "No realmId (company ID) in callback" },
      { status: 400 },
    );
  }

  // Validate CSRF state
  if (state) {
    const valid = await validateOAuthState(state);
    if (!valid) {
      return NextResponse.json(
        { error: "Invalid OAuth state parameter — possible CSRF attack" },
        { status: 400 },
      );
    }
  }

  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const redirectUri = process.env.QBO_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      { error: "Missing QBO_CLIENT_ID, QBO_CLIENT_SECRET, or QBO_REDIRECT_URI env vars" },
      { status: 500 },
    );
  }

  // Exchange authorization code for tokens
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );

  const tokenRes = await fetch(
    "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }).toString(),
    },
  );

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok) {
    return NextResponse.json(
      { error: "Token exchange failed", details: tokenData },
      { status: 500 },
    );
  }

  // Store tokens securely in Vercel KV
  try {
    await storeTokens({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
      realmId,
    });
  } catch (err) {
    console.error("[qbo] Failed to save tokens:", err);
    return NextResponse.json(
      { error: "Token exchange succeeded but failed to store tokens" },
      { status: 500 },
    );
  }

  // Redirect to finance page with success indicator
  return NextResponse.redirect(
    new URL("/ops/finance?qbo=connected", url.origin),
  );
}
