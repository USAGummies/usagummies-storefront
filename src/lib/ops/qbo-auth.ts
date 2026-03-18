/**
 * QuickBooks Online OAuth Token Management
 *
 * Stores and refreshes OAuth tokens for the QBO API.
 * Tokens are persisted in Vercel KV (Redis) for cross-request access.
 * Access tokens expire after 1 hour; refresh tokens expire after 100 days.
 *
 * Env vars required: QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QBOTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in ms
  realmId: string; // QBO Company ID
};

// ---------------------------------------------------------------------------
// KV Keys
// ---------------------------------------------------------------------------

const KV_ACCESS_TOKEN = "qbo:access_token";
const KV_REFRESH_TOKEN = "qbo:refresh_token";
const KV_REALM_ID = "qbo:realm_id";
const KV_TOKEN_EXPIRES_AT = "qbo:token_expires_at";
const KV_OAUTH_STATE = "qbo:oauth_state";

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

// In-memory fallback for local dev
let cachedTokens: QBOTokens | null = null;

/** Store tokens in KV (individual keys for easy access). */
export async function storeTokens(tokens: QBOTokens): Promise<void> {
  const store = await getKV();
  if (store) {
    await Promise.all([
      store.set(KV_ACCESS_TOKEN, tokens.accessToken),
      store.set(KV_REFRESH_TOKEN, tokens.refreshToken),
      store.set(KV_REALM_ID, tokens.realmId),
      store.set(KV_TOKEN_EXPIRES_AT, tokens.expiresAt),
    ]);
    console.log("[qbo-auth] Tokens saved to KV");
  } else {
    console.warn(
      "[qbo-auth] KV not available — tokens stored in memory only. Set KV_REST_API_URL + KV_REST_API_TOKEN for persistence.",
    );
  }
  cachedTokens = tokens;
}

/** Load tokens from KV store. */
async function loadTokens(): Promise<QBOTokens | null> {
  const store = await getKV();
  if (store) {
    const [accessToken, refreshToken, realmId, expiresAt] = await Promise.all([
      store.get<string>(KV_ACCESS_TOKEN),
      store.get<string>(KV_REFRESH_TOKEN),
      store.get<string>(KV_REALM_ID),
      store.get<number>(KV_TOKEN_EXPIRES_AT),
    ]);

    if (!accessToken || !refreshToken || !realmId || !expiresAt) return null;

    cachedTokens = { accessToken, refreshToken, realmId, expiresAt };
    return cachedTokens;
  }
  return cachedTokens;
}

/** Clear all tokens from KV. */
async function clearTokens(): Promise<void> {
  const store = await getKV();
  if (store) {
    await Promise.all([
      store.del(KV_ACCESS_TOKEN),
      store.del(KV_REFRESH_TOKEN),
      store.del(KV_REALM_ID),
      store.del(KV_TOKEN_EXPIRES_AT),
    ]);
    console.log("[qbo-auth] Tokens cleared from KV");
  }
  cachedTokens = null;
}

// ---------------------------------------------------------------------------
// OAuth State (CSRF protection)
// ---------------------------------------------------------------------------

/** Store OAuth state parameter for CSRF validation. */
export async function storeOAuthState(state: string): Promise<void> {
  const store = await getKV();
  if (store) {
    // Expire after 10 minutes
    await store.set(KV_OAUTH_STATE, state, { ex: 600 });
  }
}

/** Validate and consume OAuth state parameter. */
export async function validateOAuthState(state: string): Promise<boolean> {
  const store = await getKV();
  if (store) {
    const stored = await store.get<string>(KV_OAUTH_STATE);
    if (stored === state) {
      await store.del(KV_OAUTH_STATE);
      return true;
    }
    return false;
  }
  // In local dev without KV, skip state validation
  return true;
}

// ---------------------------------------------------------------------------
// Token Refresh
// ---------------------------------------------------------------------------

/**
 * Get a valid access token, refreshing if expired.
 * Returns null if no tokens are stored (user needs to authorize first).
 */
export async function getValidAccessToken(): Promise<string | null> {
  let tokens = await loadTokens();
  if (!tokens) return null;

  // Refresh if expired or expiring within 5 minutes
  const BUFFER_MS = 5 * 60 * 1000;
  if (tokens.expiresAt - BUFFER_MS < Date.now()) {
    console.log("[qbo-auth] Access token expired, refreshing...");
    tokens = await refreshAccessToken(tokens);
    if (!tokens) return null;
  }

  return tokens.accessToken;
}

/** Exchange a refresh token for a new access token. */
async function refreshAccessToken(
  tokens: QBOTokens,
): Promise<QBOTokens | null> {
  const clientId = (process.env.QBO_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.QBO_CLIENT_SECRET ?? "").trim();

  if (!clientId || !clientSecret) {
    console.error("[qbo-auth] Missing QBO_CLIENT_ID or QBO_CLIENT_SECRET");
    return null;
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );

  try {
    const res = await fetch(
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
        }).toString(),
      },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        `[qbo-auth] Refresh failed: ${res.status} — ${text.slice(0, 200)}`,
      );
      return null;
    }

    const data = await res.json();
    const updated: QBOTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? tokens.refreshToken,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
      realmId: tokens.realmId,
    };

    await storeTokens(updated);
    console.log("[qbo-auth] Token refreshed successfully");
    return updated;
  } catch (err) {
    console.error("[qbo-auth] Refresh error:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Status & Utility
// ---------------------------------------------------------------------------

/** Get the QBO realm (company) ID. */
export async function getRealmId(): Promise<string | null> {
  const tokens = await loadTokens();
  return tokens?.realmId ?? null;
}

/** Check if QBO OAuth is configured and tokens exist. */
export async function isQBOConnected(): Promise<boolean> {
  const tokens = await loadTokens();
  return tokens !== null && !!tokens.refreshToken && !!tokens.realmId;
}

/** Revoke tokens with Intuit and clear from KV. */
export async function revokeTokens(): Promise<boolean> {
  const tokens = await loadTokens();
  if (!tokens) return true; // Already disconnected

  const clientId = (process.env.QBO_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.QBO_CLIENT_SECRET ?? "").trim();

  if (clientId && clientSecret) {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64",
    );

    try {
      await fetch(
        "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${basicAuth}`,
            Accept: "application/json",
          },
          body: JSON.stringify({ token: tokens.refreshToken }),
        },
      );
      console.log("[qbo-auth] Token revoked with Intuit");
    } catch (err) {
      console.warn("[qbo-auth] Revoke request failed (continuing cleanup):", err);
    }
  }

  await clearTokens();
  return true;
}
