import { NextResponse } from "next/server";
import { randomBytes } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Initiates the Puzzle OAuth2 Authorization Code flow.
 * Visit this URL to connect Puzzle to the ops platform.
 *
 * GET /api/ops/puzzle/authorize → 302 redirect to Puzzle consent screen
 */
export async function GET(req: Request) {
  const clientId = process.env.PUZZLE_CLIENT_ID;

  if (!clientId) {
    return NextResponse.json(
      { error: "Missing PUZZLE_CLIENT_ID env var" },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const redirectUri = `${url.origin}/api/ops/puzzle/callback`;
  const state = randomBytes(16).toString("hex");

  const authorizeUrl = new URL(
    "https://api.puzzle.io/oauth/authorize",
  );
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("state", state);
  // Default scopes: read-only + offline (refresh token)
  authorizeUrl.searchParams.set("scope", "read:company offline_access");

  return NextResponse.redirect(authorizeUrl.toString());
}
