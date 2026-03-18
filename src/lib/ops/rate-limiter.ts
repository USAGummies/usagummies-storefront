import { NextResponse } from "next/server";

export type RateLimitConfig = {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export const RATE_LIMITS = {
  chat: { windowMs: 60_000, maxRequests: 30, keyPrefix: "rl:chat" },
  inboxScan: { windowMs: 60_000, maxRequests: 2, keyPrefix: "rl:inbox" },
  slackCommand: { windowMs: 60_000, maxRequests: 20, keyPrefix: "rl:slack" },
  actions: { windowMs: 60_000, maxRequests: 60, keyPrefix: "rl:actions" },
  default: { windowMs: 60_000, maxRequests: 120, keyPrefix: "rl:default" },
} as const;

function getKvClient() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return null;
  }
  try {
    return require("@vercel/kv").kv as {
      get: (key: string) => Promise<number | null>;
      incr: (key: string) => Promise<number>;
      expire: (key: string, seconds: number) => Promise<unknown>;
    };
  } catch {
    return null;
  }
}

function failOpen(config: RateLimitConfig): RateLimitResult {
  return {
    allowed: true,
    remaining: config.maxRequests,
    resetAt: Date.now() + config.windowMs,
  };
}

function getRequestIdentifier(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || req.headers.get("cf-connecting-ip");
  if (ip) return ip;

  const authHeader = req.headers.get("authorization");
  if (authHeader) return `auth:${authHeader.slice(0, 32)}`;

  return "anonymous";
}

export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const kv = getKvClient();
  if (!kv) return failOpen(config);

  const now = Date.now();
  const bucketStart = Math.floor(now / config.windowMs) * config.windowMs;
  const previousBucketStart = bucketStart - config.windowMs;
  const ttlSeconds = Math.max(1, Math.ceil((config.windowMs * 2) / 1000));
  const elapsed = now - bucketStart;
  const previousWeight = Math.max(0, 1 - elapsed / config.windowMs);

  const currentKey = `${config.keyPrefix}:${identifier}:${bucketStart}`;
  const previousKey = `${config.keyPrefix}:${identifier}:${previousBucketStart}`;

  try {
    const [currentCount, previousCount] = await Promise.all([
      kv.incr(currentKey),
      kv.get(previousKey),
    ]);
    await kv.expire(currentKey, ttlSeconds);

    const weightedUsage = currentCount + (Number(previousCount || 0) * previousWeight);
    const remaining = Math.max(0, Math.floor(config.maxRequests - weightedUsage));

    return {
      allowed: weightedUsage <= config.maxRequests,
      remaining,
      resetAt: bucketStart + config.windowMs,
    };
  } catch {
    return failOpen(config);
  }
}

export function rateLimitResponse(result: RateLimitResult): NextResponse {
  const retryAfter = Math.max(
    1,
    Math.ceil((result.resetAt - Date.now()) / 1000),
  );
  return NextResponse.json(
    {
      error: "rate_limited",
      message: "Too many requests",
      resetAt: result.resetAt,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(result.resetAt),
      },
    },
  );
}

export function withRateLimit(
  config: RateLimitConfig,
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const identifier = getRequestIdentifier(req);
    const result = await checkRateLimit(identifier, config);
    if (!result.allowed) {
      return rateLimitResponse(result);
    }
    return handler(req);
  };
}
