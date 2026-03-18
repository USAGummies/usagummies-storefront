import { NextResponse } from "next/server";
import { savePuzzleTokens } from "@/lib/ops/puzzle-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OAuth2 callback for Puzzle Accounting API.
 * Exchanges the authorization code for access + refresh tokens.
 *
 * Flow:
 * 1. User visits /api/ops/puzzle/authorize → redirected to Puzzle consent screen
 * 2. User approves → Puzzle redirects here with ?code=...&state=...
 * 3. We exchange code for tokens and store them in Vercel KV
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
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

  const clientId = process.env.PUZZLE_CLIENT_ID;
  const clientSecret = process.env.PUZZLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Missing PUZZLE_CLIENT_ID or PUZZLE_CLIENT_SECRET env vars" },
      { status: 500 },
    );
  }

  // Exchange authorization code for tokens
  const tokenRes = await fetch("https://api.puzzle.io/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${url.origin}/api/ops/puzzle/callback`,
      code,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok) {
    return NextResponse.json(
      { error: "Token exchange failed", details: tokenData },
      { status: 500 },
    );
  }

  // Store tokens securely in Vercel KV
  try {
    await savePuzzleTokens({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in ?? 86400) * 1000,
      scope: tokenData.scope ?? "read:company offline_access",
    });
  } catch (err) {
    console.error("[puzzle] Failed to save tokens:", err);
    return NextResponse.json(
      { error: "Token exchange succeeded but failed to store tokens" },
      { status: 500 },
    );
  }

  const html = `
    <html><body style="font-family: sans-serif; max-width: 600px; margin: 40px auto;">
      <h2>✅ Puzzle API Connected</h2>
      <p>OAuth tokens stored successfully. Abra now has access to Puzzle financial data.</p>
      <p><strong>Scope:</strong> <code>${tokenData.scope || "read:company offline_access"}</code></p>
      <p><strong>Token expires:</strong> ${tokenData.expires_in ? `${Math.round(tokenData.expires_in / 3600)}h` : "unknown"}</p>
      <p style="color: #666;">You can close this window and return to the ops dashboard.</p>
      <a href="/ops" style="display: inline-block; margin-top: 16px; padding: 10px 24px; background: #000; color: #fff; text-decoration: none; border-radius: 6px;">← Back to Ops</a>
    </body></html>
  `;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html" },
  });
}
