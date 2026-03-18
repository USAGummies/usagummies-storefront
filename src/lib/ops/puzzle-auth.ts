/**
 * Puzzle OAuth Token Management
 *
 * Stores and refreshes OAuth tokens for the Puzzle Accounting API.
 * Tokens are persisted in Vercel KV (Redis) for cross-request access.
 * Access tokens expire after 24h; refresh tokens never expire.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PuzzleTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in ms
  scope: string;
};

const KV_KEY = "puzzle:oauth:tokens";

// ---------------------------------------------------------------------------
// Storage (Vercel KV / Redis)
// ---------------------------------------------------------------------------

async function getKV() {
  // Dynamic import to avoid build errors if @vercel/kv isn't available
  try {
    const { kv } = await import("@vercel/kv");
    return kv;
  } catch {
    return null;
  }
}

/** Save tokens to KV store. */
export async function savePuzzleTokens(tokens: PuzzleTokens): Promise<void> {
  const store = await getKV();
  if (store) {
    await store.set(KV_KEY, JSON.stringify(tokens));
    console.log("[puzzle-auth] Tokens saved to KV");
  } else {
    // Fallback: store in env-style (for local dev)
    console.warn(
      "[puzzle-auth] KV not available — tokens stored in memory only. Set KV_REST_API_URL + KV_REST_API_TOKEN for persistence.",
    );
    cachedTokens = tokens;
  }
}

// In-memory fallback for local dev
let cachedTokens: PuzzleTokens | null = null;

/** Load tokens from KV store. */
export async function loadPuzzleTokens(): Promise<PuzzleTokens | null> {
  const store = await getKV();
  if (store) {
    const raw = await store.get<string>(KV_KEY);
    if (!raw) return null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    cachedTokens = parsed as PuzzleTokens;
    return cachedTokens;
  }
  return cachedTokens;
}

// ---------------------------------------------------------------------------
// Token Refresh
// ---------------------------------------------------------------------------

/**
 * Get a valid access token, refreshing if expired.
 * Returns null if no tokens are stored (user needs to authorize first).
 */
export async function getValidAccessToken(): Promise<string | null> {
  let tokens = await loadPuzzleTokens();
  if (!tokens) return null;

  // Refresh if expired or expiring within 5 minutes
  const BUFFER_MS = 5 * 60 * 1000;
  if (tokens.expiresAt - BUFFER_MS < Date.now()) {
    console.log("[puzzle-auth] Access token expired, refreshing...");
    tokens = await refreshAccessToken(tokens);
    if (!tokens) return null;
  }

  return tokens.accessToken;
}

/** Exchange a refresh token for a new access token. */
async function refreshAccessToken(
  tokens: PuzzleTokens,
): Promise<PuzzleTokens | null> {
  const clientId = process.env.PUZZLE_CLIENT_ID;
  const clientSecret = process.env.PUZZLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("[puzzle-auth] Missing PUZZLE_CLIENT_ID or PUZZLE_CLIENT_SECRET");
    return null;
  }

  try {
    const res = await fetch("https://api.puzzle.io/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[puzzle-auth] Refresh failed: ${res.status} — ${text.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const updated: PuzzleTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? tokens.refreshToken, // Keep old if not returned
      expiresAt: Date.now() + (data.expires_in ?? 86400) * 1000,
      scope: data.scope ?? tokens.scope,
    };

    await savePuzzleTokens(updated);
    console.log("[puzzle-auth] Token refreshed successfully");
    return updated;
  } catch (err) {
    console.error("[puzzle-auth] Refresh error:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Status check
// ---------------------------------------------------------------------------

/** Check if Puzzle OAuth is configured and tokens exist. */
export async function isPuzzleConnected(): Promise<boolean> {
  const tokens = await loadPuzzleTokens();
  return tokens !== null && !!tokens.refreshToken;
}
