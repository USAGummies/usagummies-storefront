/**
 * Rate limiting for Abra ops API routes — Phase 1C Enterprise Hardening
 *
 * Uses @upstash/ratelimit with sliding window algorithm backed by Upstash Redis.
 * Falls back to no-op (fail open) if Redis is unavailable — graceful degradation.
 *
 * Tiers:
 *   strict   — 10 req/min  (AI endpoints that cost money)
 *   standard — 60 req/min  (authenticated ops routes)
 *   generous — 200 req/min (webhook receivers like Slack)
 */

import { NextRequest, NextResponse } from "next/server";

// Lazy-init singletons — created on first use so module import never throws
let _redis: import("@upstash/redis").Redis | null | undefined;
let _limiters: Record<string, import("@upstash/ratelimit").Ratelimit> | null =
  null;

function getRedis(): import("@upstash/redis").Redis | null {
  if (_redis !== undefined) return _redis;

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    _redis = null;
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require("@upstash/redis") as typeof import("@upstash/redis");
    _redis = new Redis({ url, token });
    return _redis;
  } catch {
    _redis = null;
    return null;
  }
}

export type RateLimitTier = "strict" | "standard" | "generous";

const TIER_CONFIG: Record<RateLimitTier, { requests: number; window: string }> =
  {
    strict: { requests: 10, window: "60 s" },
    standard: { requests: 60, window: "60 s" },
    generous: { requests: 200, window: "60 s" },
  };

function getLimiters(): Record<string, import("@upstash/ratelimit").Ratelimit> | null {
  if (_limiters !== null) return _limiters;

  const redis = getRedis();
  if (!redis) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Ratelimit } = require("@upstash/ratelimit") as typeof import("@upstash/ratelimit");

    _limiters = {};
    for (const [tier, config] of Object.entries(TIER_CONFIG)) {
      _limiters[tier] = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(config.requests, config.window as `${number} s`),
        prefix: `rl:${tier}`,
        analytics: false,
      });
    }
    return _limiters;
  } catch {
    return null;
  }
}

/**
 * Derive a stable client identifier from the request.
 *
 * Uses only the leftmost IP from x-forwarded-for (set by Vercel's edge proxy
 * and not spoofable behind their CDN). Falls back to cf-connecting-ip for
 * Cloudflare-proxied requests, then x-real-ip. Authorization headers are
 * intentionally NOT used — they are caller-controlled and trivially rotated.
 */
function getIdentifier(req: Request): string {
  // Vercel always sets x-forwarded-for with the real client IP as the
  // leftmost entry. Behind Vercel's edge, this header is trustworthy.
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const ip = forwarded.split(",")[0]?.trim();
    if (ip) return `ip:${ip}`;
  }

  // Cloudflare-proxied fallback
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return `ip:${cfIp}`;

  // Last resort — x-real-ip (set by some reverse proxies)
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return `ip:${realIp}`;

  return "anonymous";
}

export type RateLimitResponse = {
  limited: boolean;
  response?: NextResponse;
};

/**
 * Check rate limit for a request. Returns { limited: false } if allowed,
 * or { limited: true, response: NextResponse } with a 429 if blocked.
 *
 * Fails open (returns allowed) if Redis is unreachable.
 */
export async function checkRateLimit(
  req: Request,
  tier: RateLimitTier = "standard",
): Promise<RateLimitResponse> {
  const limiters = getLimiters();
  if (!limiters) {
    // Redis unavailable — fail open
    return { limited: false };
  }

  const limiter = limiters[tier];
  if (!limiter) {
    return { limited: false };
  }

  const identifier = getIdentifier(req);

  try {
    const result = await limiter.limit(identifier);

    if (!result.success) {
      const retryAfterMs = result.reset - Date.now();
      const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));

      const response = NextResponse.json(
        {
          error: "rate_limited",
          message: "Too many requests. Please slow down.",
          retryAfter: retryAfterSec,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSec),
            "X-RateLimit-Limit": String(TIER_CONFIG[tier].requests),
            "X-RateLimit-Remaining": String(result.remaining),
            "X-RateLimit-Reset": String(result.reset),
          },
        },
      );
      return { limited: true, response };
    }

    return { limited: false };
  } catch {
    // Redis error — fail open
    return { limited: false };
  }
}

/**
 * Higher-order wrapper that applies rate limiting to a Next.js route handler.
 *
 * Usage:
 *   export const POST = withRateLimitedRoute("strict", async (req) => { ... });
 */
export function withRateLimitedRoute(
  tier: RateLimitTier,
  handler: (req: NextRequest) => Promise<Response>,
): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest) => {
    const { limited, response } = await checkRateLimit(req, tier);
    if (limited && response) {
      return response;
    }
    return handler(req);
  };
}
