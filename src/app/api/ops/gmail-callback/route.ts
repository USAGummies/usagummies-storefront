import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OAuth2 callback for Gmail API.
 * Exchanges the authorization code for a refresh token.
 * One-time setup — save the refresh token to GMAIL_OAUTH_REFRESH_TOKEN env var.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({ error: "No code in callback" }, { status: 400 });
  }

  const clientId =
    process.env.GMAIL_OAUTH_CLIENT_ID ||
    process.env.GCP_GMAIL_OAUTH_CLIENT_ID;
  const clientSecret =
    process.env.GMAIL_OAUTH_CLIENT_SECRET ||
    process.env.GCP_GMAIL_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Missing GMAIL_OAUTH_CLIENT_ID or GMAIL_OAUTH_CLIENT_SECRET" },
      { status: 500 },
    );
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${url.origin}/api/ops/gmail-callback`,
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

  const refreshToken = tokenData.refresh_token;
  const html = `
    <html><body style="font-family: sans-serif; max-width: 600px; margin: 40px auto;">
      <h2>Gmail OAuth Complete</h2>
      <p>Add this to your <code>.env.local</code> and Vercel env vars:</p>
      <pre style="background: #f5f5f5; padding: 16px; border-radius: 8px; word-break: break-all;">GMAIL_OAUTH_REFRESH_TOKEN=${refreshToken || "(no refresh_token — re-run with prompt=consent)"}</pre>
      <p style="color: #666;">Access token (short-lived, for testing): <code>${tokenData.access_token?.substring(0, 20)}...</code></p>
    </body></html>
  `;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html" },
  });
}
