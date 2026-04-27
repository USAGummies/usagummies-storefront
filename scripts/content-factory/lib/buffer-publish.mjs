/**
 * Buffer publishing adapter for the Content Factory.
 *
 * Once an image is approved (via /api/content-factory/approve), this
 * adapter pushes it to Buffer's queue across the channels specified
 * by the style profile's `default_channels` field (or an explicit
 * channel list passed to publishToBuffer).
 *
 * Buffer maps:
 *   "fb"               → BUFFER_CHANNEL_FACEBOOK (USA Gummies page)
 *   "ig"               → BUFFER_CHANNEL_INSTAGRAM (@usagummies)
 *   "gbp"              → BUFFER_CHANNEL_GOOGLE_BUSINESS
 *
 * By default, posts are added to Buffer's queue (NOT immediately
 * published). Buffer's posting schedule (configured in the Buffer UI)
 * picks them up at the next slot. Use `mode: "now"` to publish
 * immediately, or `mode: "draft"` to leave them as drafts requiring
 * manual review in the Buffer dashboard.
 *
 * API: https://api.buffer.com (GraphQL)
 * Auth: Bearer token from BUFFER_API_TOKEN
 */

const CHANNEL_ALIAS = {
  fb: "BUFFER_CHANNEL_FACEBOOK",
  facebook: "BUFFER_CHANNEL_FACEBOOK",
  ig: "BUFFER_CHANNEL_INSTAGRAM",
  instagram: "BUFFER_CHANNEL_INSTAGRAM",
  gbp: "BUFFER_CHANNEL_GOOGLE_BUSINESS",
  "google-business": "BUFFER_CHANNEL_GOOGLE_BUSINESS",
  googlebusiness: "BUFFER_CHANNEL_GOOGLE_BUSINESS",
};

function resolveChannelIds(channels, env) {
  const ids = [];
  for (const ch of channels) {
    const key = CHANNEL_ALIAS[ch.toLowerCase()];
    if (!key) {
      console.warn(`⚠ unknown channel alias: ${ch}`);
      continue;
    }
    const id = env[key];
    if (!id) {
      console.warn(`⚠ env var ${key} not set, skipping channel ${ch}`);
      continue;
    }
    ids.push(id);
  }
  return ids;
}

/**
 * Publishes an approved image to Buffer.
 *
 * @param {object} opts
 * @param {string} opts.apiToken - Buffer API bearer token
 * @param {string} opts.organizationId - Buffer org ID
 * @param {string[]} opts.channels - List of channel aliases (fb, ig, gbp) OR direct channel IDs
 * @param {string} opts.imageUrl - Public URL of the image to post
 * @param {string} opts.caption - Post caption text
 * @param {"queue"|"now"|"draft"} [opts.mode="queue"] - When to publish
 * @param {object} [opts.env=process.env] - Environment for channel ID lookups
 * @returns {Promise<{postIds: string[], errors: string[]}>}
 */
export async function publishToBuffer({
  apiToken,
  organizationId,
  channels,
  imageUrl,
  caption,
  mode = "queue",
  env = process.env,
}) {
  if (!apiToken) throw new Error("apiToken required");
  if (!organizationId) throw new Error("organizationId required");
  if (!channels || !channels.length) throw new Error("channels required");
  if (!imageUrl) throw new Error("imageUrl required");
  if (!caption) caption = ""; // Buffer accepts empty caption for image-only posts

  // Resolve aliases → channel IDs (supports passing real IDs directly)
  // Map alias → service so we can build platform-specific metadata
  const SERVICE_BY_ALIAS = {
    fb: "facebook", facebook: "facebook",
    ig: "instagram", instagram: "instagram",
    gbp: "googlebusiness", "google-business": "googlebusiness", googlebusiness: "googlebusiness",
  };

  // Resolve each input to {channelId, service}
  const channelDescriptors = [];
  for (const c of channels) {
    if (c.length === 24 && /^[a-f0-9]+$/.test(c)) {
      // direct ID — service must be looked up; for now skip (require aliases)
      // TODO: support direct IDs by querying listChannels once
      console.warn(`⚠ direct channel ID ${c} not supported in publishToBuffer (use alias like "fb"/"ig"/"gbp")`);
      continue;
    }
    const aliasKey = c.toLowerCase();
    const envKey = CHANNEL_ALIAS[aliasKey];
    const service = SERVICE_BY_ALIAS[aliasKey];
    if (!envKey || !env[envKey] || !service) continue;
    channelDescriptors.push({ channelId: env[envKey], service });
  }

  if (!channelDescriptors.length) {
    throw new Error(`No valid channels resolved from: ${channels.join(", ")}`);
  }

  const postIds = [];
  const errors = [];

  void organizationId; // not used by createPost — kept for signature consistency
  const shareModeMap = { queue: "addToQueue", now: "shareNow", draft: "addToQueue" };
  const shareMode = shareModeMap[mode] || "addToQueue";
  const saveToDraft = mode === "draft";

  function buildMetadata(service) {
    if (service === "facebook") return { facebook: { type: "post" } };
    if (service === "instagram") return { instagram: { type: "post", shouldShareToFeed: true } };
    if (service === "googlebusiness") {
      return { google: { type: "whats_new" } };
    }
    return null;
  }

  for (const { channelId, service } of channelDescriptors) {
    const metadata = buildMetadata(service);
    const variables = {
      input: {
        channelId,
        text: caption,
        assets: { images: [{ url: imageUrl }] },
        ...(metadata ? { metadata } : {}),
        schedulingType: "automatic",
        mode: shareMode,
        saveToDraft,
        source: "content-factory",
      },
    };
    const query = `
      mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
          ... on PostActionSuccess { post { id status } }
          ... on InvalidInputError { message }
          ... on LimitReachedError { message }
          ... on UnauthorizedError { message }
          ... on NotFoundError { message }
          ... on UnexpectedError { message }
          ... on RestProxyError { message }
        }
      }
    `;
    try {
      const res = await fetch("https://api.buffer.com", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      const json = await res.json();
      if (json.errors?.length) {
        errors.push(`channel ${channelId}: ${json.errors[0].message}`);
        continue;
      }
      const post = json.data?.createPost?.post;
      if (post?.id) {
        postIds.push(post.id);
      } else {
        errors.push(`channel ${channelId}: ${JSON.stringify(json.data).slice(0, 200)}`);
      }
    } catch (e) {
      errors.push(`channel ${channelId}: ${e.message}`);
    }
  }
  return { postIds, errors };
}

/**
 * Convenience: lists all channels in the org (for diagnostics).
 */
export async function listChannels({ apiToken, organizationId }) {
  const query = `query { channels(input: { organizationId: "${organizationId}" }) { id name service isLocked } }`;
  const res = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(`Buffer GraphQL: ${json.errors[0].message}`);
  return json.data.channels;
}
