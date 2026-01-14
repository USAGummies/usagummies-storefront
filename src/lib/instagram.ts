export type InstagramMediaItem = {
  id: string;
  caption?: string | null;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url: string;
  permalink?: string | null;
  thumbnail_url?: string | null;
  timestamp?: string | null;
};

export type InstagramFeed = {
  items: InstagramMediaItem[];
  fetchedAt: string;
  source: "live" | "fallback";
};

// This helper fetches the Instagram Graph API.
// It is intentionally server-side only (used by /api/instagram) so tokens never reach the browser.
export async function fetchInstagramFeed(opts?: { limit?: number }): Promise<InstagramFeed> {
  const limit = Math.min(24, Math.max(6, opts?.limit ?? 12));

  // Support either Basic Display token (older) or Graph API token (recommended).
  // We keep the integration stable by:
  // - server-side fetch
  // - short caching via Next route cache headers
  // - graceful fallback if env vars are missing
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
  const userId = process.env.INSTAGRAM_USER_ID?.trim();

  if (!accessToken || !userId) {
    return {
      source: "fallback",
      fetchedAt: new Date().toISOString(),
      items: [],
    };
  }

  const fields = "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp";
  const endpoints = [
    "https://graph.instagram.com", // Basic Display
    "https://graph.facebook.com/v19.0", // Instagram Graph API (business/creator)
  ];

  for (const base of endpoints) {
    try {
      const url = new URL(`${base}/${encodeURIComponent(userId)}/media`);
      url.searchParams.set("fields", fields);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("access_token", accessToken);

      const res = await fetch(url.toString(), {
        // cache on the server / edge; the route will add Cache-Control too.
        next: { revalidate: 60 * 15 }, // 15 minutes
      });

      if (!res.ok) {
        continue;
      }

      const json: any = await res.json();
      const items: InstagramMediaItem[] = Array.isArray(json?.data)
        ? json.data
            .filter(Boolean)
            .map((x: any) => ({
              id: String(x?.id ?? ""),
              caption: x?.caption ?? null,
              media_type: x?.media_type,
              media_url: x?.media_url,
              permalink: x?.permalink ?? null,
              thumbnail_url: x?.thumbnail_url ?? null,
              timestamp: x?.timestamp ?? null,
            }))
            .filter((x: any) => x.id && x.media_type && x.media_url)
        : [];

      if (items.length) {
        return {
          source: "live",
          fetchedAt: new Date().toISOString(),
          items,
        };
      }
    } catch {
      // try the next endpoint
    }
  }

  return {
    source: "fallback",
    fetchedAt: new Date().toISOString(),
    items: [],
  };
}
