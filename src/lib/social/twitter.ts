import "server-only";

type TwitterPublicMetrics = {
  like_count?: number;
  retweet_count?: number;
  reply_count?: number;
  quote_count?: number;
  impression_count?: number;
};

/** Bearer token for read-only (app-only) requests */
function twitterBearerToken(): string {
  return (process.env.TWITTER_BEARER_TOKEN || "").trim();
}

/** OAuth 2.0 user access token for write operations (posting tweets) */
function twitterWriteToken(): string {
  return (process.env.TWITTER_ACCESS_TOKEN || "").trim();
}

function twitterUserId(): string {
  return (process.env.TWITTER_USER_ID || "").trim();
}

export function isTwitterConfigured(): boolean {
  return !!(twitterBearerToken() || twitterWriteToken());
}

async function twitterRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  // Writes require OAuth user token; reads can use either (prefer Bearer)
  const isWrite = method === "POST";
  const token = isWrite ? twitterWriteToken() : (twitterBearerToken() || twitterWriteToken());

  if (!token) {
    throw new Error(
      isWrite
        ? "TWITTER_ACCESS_TOKEN (OAuth user token) is required for write operations"
        : "Twitter token not configured (need TWITTER_BEARER_TOKEN or TWITTER_ACCESS_TOKEN)",
    );
  }

  const res = await fetch(`https://api.twitter.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twitter API ${method} ${path} failed (${res.status}): ${text.slice(0, 220)}`);
  }

  return (await res.json()) as T;
}

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

export async function uploadMedia(_imageUrl: string): Promise<{ media_id_string: string } | null> {
  // v2 media upload requires OAuth 1.0a flow; this wrapper intentionally returns null for now.
  return null;
}
