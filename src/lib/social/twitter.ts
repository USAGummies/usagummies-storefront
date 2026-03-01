import "server-only";

import * as crypto from "node:crypto";

type TwitterPublicMetrics = {
  like_count?: number;
  retweet_count?: number;
  reply_count?: number;
  quote_count?: number;
  impression_count?: number;
};

// ---------------------------------------------------------------------------
// Credential helpers
// ---------------------------------------------------------------------------

/** Bearer token for read-only (app-only) requests */
function twitterBearerToken(): string {
  return (process.env.TWITTER_BEARER_TOKEN || "").trim();
}

/** OAuth 1.0a credentials for write operations */
function oauth1Credentials() {
  return {
    consumerKey: (process.env.TWITTER_API_KEY || "").trim(),
    consumerSecret: (process.env.TWITTER_API_SECRET || "").trim(),
    accessToken: (process.env.TWITTER_ACCESS_TOKEN || "").trim(),
    accessTokenSecret: (process.env.TWITTER_ACCESS_TOKEN_SECRET || "").trim(),
  };
}

function twitterUserId(): string {
  return (process.env.TWITTER_USER_ID || "").trim();
}

export function isTwitterConfigured(): boolean {
  const bearer = twitterBearerToken();
  const { consumerKey, accessToken } = oauth1Credentials();
  return !!(bearer || (consumerKey && accessToken));
}

// ---------------------------------------------------------------------------
// OAuth 1.0a signing (HMAC-SHA1)
// ---------------------------------------------------------------------------

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function generateOAuthSignature(
  method: string,
  baseUrl: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string,
): string {
  // 1. Sort params alphabetically and build parameter string
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`).join("&");

  // 2. Create signature base string
  const signatureBase = `${method.toUpperCase()}&${percentEncode(baseUrl)}&${percentEncode(paramString)}`;

  // 3. Create signing key
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;

  // 4. HMAC-SHA1
  return crypto.createHmac("sha1", signingKey).update(signatureBase).digest("base64");
}

function buildOAuth1Header(
  method: string,
  url: string,
  creds: ReturnType<typeof oauth1Credentials>,
  extraParams?: Record<string, string>,
): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000).toString();

  // Parse URL to separate base URL from query params
  const urlObj = new URL(url);
  const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;

  // Collect all parameters (OAuth + query string + extra)
  const allParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
    ...extraParams,
  };

  // Add query params from URL
  urlObj.searchParams.forEach((value, key) => {
    allParams[key] = value;
  });

  // Generate signature
  const signature = generateOAuthSignature(method, baseUrl, allParams, creds.consumerSecret, creds.accessTokenSecret);

  // Build OAuth header (only oauth_* params + signature)
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: nonce,
    oauth_signature: signature,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(", ");

  return `OAuth ${headerParts}`;
}

// ---------------------------------------------------------------------------
// API request
// ---------------------------------------------------------------------------

async function twitterRequest<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const isWrite = method === "POST" || method === "DELETE";
  const url = `https://api.twitter.com${path}`;

  let headers: Record<string, string>;

  if (isWrite) {
    // Use OAuth 1.0a for writes
    const creds = oauth1Credentials();
    if (!creds.consumerKey || !creds.accessToken) {
      throw new Error(
        "Twitter OAuth 1.0a credentials required for writes: TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET",
      );
    }
    headers = {
      Authorization: buildOAuth1Header(method, url, creds),
      "Content-Type": "application/json",
    };
  } else {
    // Use Bearer token for reads (or fall back to OAuth 1.0a)
    const bearer = twitterBearerToken();
    if (bearer) {
      headers = {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      };
    } else {
      // Fallback: sign reads with OAuth 1.0a too
      const creds = oauth1Credentials();
      if (!creds.consumerKey || !creds.accessToken) {
        throw new Error("Twitter token not configured (need TWITTER_BEARER_TOKEN or OAuth 1.0a credentials)");
      }
      headers = {
        Authorization: buildOAuth1Header(method, url, creds),
        "Content-Type": "application/json",
      };
    }
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twitter API ${method} ${path} failed (${res.status}): ${text.slice(0, 220)}`);
  }

  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Tweet operations
// ---------------------------------------------------------------------------

export async function postTweet(text: string, mediaIds?: string[]) {
  return twitterRequest<{ data?: { id: string; text: string } }>("POST", "/2/tweets", {
    text,
    ...(mediaIds && mediaIds.length > 0 ? { media: { media_ids: mediaIds } } : {}),
  });
}

export async function replyToTweet(tweetId: string, text: string) {
  return twitterRequest<{ data?: { id: string; text: string } }>("POST", "/2/tweets", {
    text,
    reply: { in_reply_to_tweet_id: tweetId },
  });
}

// ---------------------------------------------------------------------------
// Read operations (mentions, timeline, engagement)
// ---------------------------------------------------------------------------

export async function getMentions(sinceId?: string) {
  const uid = twitterUserId();
  if (!uid) {
    return { data: [], meta: { result_count: 0, warning: "TWITTER_USER_ID not configured" } };
  }

  const params = new URLSearchParams({
    "tweet.fields": "created_at,author_id,public_metrics,conversation_id",
    expansions: "author_id",
    "user.fields": "name,username",
    max_results: "25",
  });
  if (sinceId) params.set("since_id", sinceId);

  return twitterRequest<{
    data?: Array<{
      id: string;
      text: string;
      created_at?: string;
      author_id?: string;
      public_metrics?: TwitterPublicMetrics;
    }>;
    includes?: { users?: Array<{ id: string; username: string; name: string }> };
    meta?: Record<string, unknown>;
  }>("GET", `/2/users/${uid}/mentions?${params.toString()}`);
}

export async function getRecentTweets(limit = 20) {
  const uid = twitterUserId();
  if (!uid) {
    return { data: [], meta: { result_count: 0, warning: "TWITTER_USER_ID not configured" } };
  }
  const params = new URLSearchParams({
    "tweet.fields": "created_at,public_metrics",
    max_results: String(Math.max(5, Math.min(100, limit))),
  });
  return twitterRequest<{
    data?: Array<{
      id: string;
      text: string;
      created_at?: string;
      public_metrics?: TwitterPublicMetrics;
    }>;
    meta?: Record<string, unknown>;
  }>("GET", `/2/users/${uid}/tweets?${params.toString()}`);
}

export async function getEngagement(tweetId: string) {
  const params = new URLSearchParams({ "tweet.fields": "public_metrics,created_at" });
  const result = await twitterRequest<{
    data?: { id: string; public_metrics?: TwitterPublicMetrics; created_at?: string };
  }>("GET", `/2/tweets/${tweetId}?${params.toString()}`);

  return {
    tweetId,
    metrics: result.data?.public_metrics || {},
    createdAt: result.data?.created_at || null,
  };
}

// ---------------------------------------------------------------------------
// Media upload (v1.1 — uses OAuth 1.0a, chunked for images)
// ---------------------------------------------------------------------------

export async function uploadMedia(imageUrl: string): Promise<{ media_id_string: string } | null> {
  const creds = oauth1Credentials();
  if (!creds.consumerKey || !creds.accessToken) return null;

  try {
    // Fetch the image
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return null;
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const base64 = buffer.toString("base64");

    // v1.1 media upload uses form-encoded params (not JSON)
    const uploadUrl = "https://upload.twitter.com/1.1/media/upload.json";
    const formData = new URLSearchParams();
    formData.set("media_data", base64);

    // Build OAuth header with form params included in signature
    const formParams: Record<string, string> = { media_data: base64 };
    const authHeader = buildOAuth1Header("POST", uploadUrl, creds, formParams);

    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    if (!res.ok) {
      console.error("[twitter] Media upload failed:", res.status, await res.text().catch(() => ""));
      return null;
    }

    const json = (await res.json()) as { media_id_string?: string };
    return json.media_id_string ? { media_id_string: json.media_id_string } : null;
  } catch (err) {
    console.error("[twitter] Media upload error:", err);
    return null;
  }
}
