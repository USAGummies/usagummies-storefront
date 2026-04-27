/**
 * Buffer publishing client for the Content Factory.
 *
 * Used by /api/content-factory/approve to queue an approved image to
 * Buffer when the style profile's default_channels includes a
 * Buffer-eligible alias (fb, ig, gbp). Mirror logic also lives in
 * scripts/content-factory/lib/buffer-publish.mjs for the CLI.
 *
 * API: https://api.buffer.com (GraphQL)
 */

const CHANNEL_ALIAS: Record<string, string> = {
  fb: "BUFFER_CHANNEL_FACEBOOK",
  facebook: "BUFFER_CHANNEL_FACEBOOK",
  ig: "BUFFER_CHANNEL_INSTAGRAM",
  instagram: "BUFFER_CHANNEL_INSTAGRAM",
  gbp: "BUFFER_CHANNEL_GOOGLE_BUSINESS",
  "google-business": "BUFFER_CHANNEL_GOOGLE_BUSINESS",
  googlebusiness: "BUFFER_CHANNEL_GOOGLE_BUSINESS",
};

// Buffer scheduling types — matches Buffer's GraphQL ShareMode enum
export type ShareMode = "addToQueue" | "shareNow" | "shareNext" | "customScheduled" | "recommendedTime";

// Friendly aliases the rest of our codebase uses
export type SchedulingMode = "queue" | "now" | "draft";

const SHARE_MODE_BY_ALIAS: Record<SchedulingMode, ShareMode> = {
  queue: "addToQueue",
  now: "shareNow",
  // "draft" is encoded via saveToDraft=true + addToQueue (Buffer doesn't have a "draft" share mode — drafts live alongside scheduled posts)
  draft: "addToQueue",
};

export interface PublishToBufferOptions {
  apiToken: string;
  organizationId: string;
  channels: string[];
  imageUrl: string;
  caption?: string;
  mode?: SchedulingMode;
  env?: Record<string, string | undefined>;
}

export interface PublishToBufferResult {
  postIds: string[];
  errors: string[];
  resolvedChannelIds: string[];
}

export async function publishToBuffer({
  apiToken,
  organizationId,
  channels,
  imageUrl,
  caption = "",
  mode = "queue",
  env = process.env,
}: PublishToBufferOptions): Promise<PublishToBufferResult> {
  // organizationId is unused by createPost (it derives org from the bearer token + channelId)
  // but we keep it in the signature for consistency with the listChannels API.
  void organizationId;
  if (!apiToken) throw new Error("apiToken required");
  if (!channels || !channels.length) throw new Error("channels required");
  if (!imageUrl) throw new Error("imageUrl required");

  const SERVICE_BY_ALIAS: Record<string, "facebook" | "instagram" | "googlebusiness"> = {
    fb: "facebook", facebook: "facebook",
    ig: "instagram", instagram: "instagram",
    gbp: "googlebusiness", "google-business": "googlebusiness", googlebusiness: "googlebusiness",
  };

  const channelDescriptors: { channelId: string; service: "facebook" | "instagram" | "googlebusiness" }[] = [];
  for (const c of channels) {
    if (c.length === 24 && /^[a-f0-9]+$/.test(c)) continue; // direct IDs not supported (need service lookup)
    const aliasKey = c.toLowerCase();
    const envKey = CHANNEL_ALIAS[aliasKey];
    const service = SERVICE_BY_ALIAS[aliasKey];
    if (!envKey || !env[envKey] || !service) continue;
    channelDescriptors.push({ channelId: env[envKey] as string, service });
  }

  if (!channelDescriptors.length) {
    throw new Error(`No valid Buffer channels resolved from: ${channels.join(", ")}`);
  }

  const shareMode: ShareMode = SHARE_MODE_BY_ALIAS[mode];
  const saveToDraft = mode === "draft";

  const postIds: string[] = [];
  const errors: string[] = [];

  function buildMetadata(service: "facebook" | "instagram" | "googlebusiness"): Record<string, unknown> | null {
    if (service === "facebook") return { facebook: { type: "post" } };
    if (service === "instagram") return { instagram: { type: "post", shouldShareToFeed: true } };
    if (service === "googlebusiness") return { google: { type: "whats_new" } };
    return null;
  }

  for (const { channelId, service } of channelDescriptors) {
    const metadata = buildMetadata(service);
    const variables: Record<string, unknown> = {
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
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
      });
      const json: {
        data?: { createPost?: { post?: { id?: string; status?: string }; message?: string } };
        errors?: { message: string }[];
      } = await res.json();
      if (json.errors?.length) {
        errors.push(`channel ${channelId}: ${json.errors[0].message}`);
        continue;
      }
      const result = json.data?.createPost;
      if (result?.post?.id) {
        postIds.push(result.post.id);
      } else if (result?.message) {
        errors.push(`channel ${channelId}: ${result.message}`);
      } else {
        errors.push(`channel ${channelId}: unexpected response: ${JSON.stringify(json.data).slice(0, 200)}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`channel ${channelId}: ${msg}`);
    }
  }

  return { postIds, errors, resolvedChannelIds: channelDescriptors.map((d) => d.channelId) };
}

export async function listChannels({
  apiToken,
  organizationId,
}: {
  apiToken: string;
  organizationId: string;
}): Promise<{ id: string; name: string; service: string; isLocked: boolean }[]> {
  const query = `query { channels(input: { organizationId: "${organizationId}" }) { id name service isLocked } }`;
  const res = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const json: { data?: { channels?: { id: string; name: string; service: string; isLocked: boolean }[] }; errors?: { message: string }[] } = await res.json();
  if (json.errors?.length) throw new Error(`Buffer GraphQL: ${json.errors[0].message}`);
  return json.data?.channels || [];
}
