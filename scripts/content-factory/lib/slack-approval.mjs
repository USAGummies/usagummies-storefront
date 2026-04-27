/**
 * Slack approval poster for the Content Factory.
 *
 * Posts a generated image to #ops-approvals (or any channel) with two
 * Approve/Reject "buttons" rendered as styled link buttons that hit
 * /api/content-factory/approve and /api/content-factory/reject. We use
 * link buttons (not Slack's interactive buttons) because they don't
 * require setting up Slack interactivity OAuth + signing.
 *
 * The links route through Vercel-hosted endpoints which update the
 * registry.json in the repo. Ben's click → public URL → API mutates
 * registry → done. Simple, secure, no extra Slack config.
 *
 * Two transports are supported:
 *   1. Bot token (preferred — chat.postMessage to a specific channel)
 *   2. Incoming webhook URL (fallback — posts to whichever channel the
 *      webhook is configured for in Slack)
 * If both are provided, the bot token wins.
 */

const SLACK_APPROVALS_CHANNEL = "C0ATWJDHS74"; // #ops-approvals

export async function postForApproval({
  slackBotToken,
  slackWebhookUrl,
  channelId = SLACK_APPROVALS_CHANNEL,
  imageUrl,
  imageId, // unique ID like "comic-americana-12345"
  styleProfile,
  conceptText,
  prompt,
  metadata = {},
  baseUrl = "https://www.usagummies.com",
}) {
  if (!slackBotToken && !slackWebhookUrl) {
    throw new Error("slackBotToken or slackWebhookUrl required");
  }
  if (!imageUrl) throw new Error("imageUrl required");
  if (!imageId) throw new Error("imageId required");

  // Optional approval secret to prevent spammers from spamming the registry endpoints
  const secret = process.env.CONTENT_FACTORY_APPROVAL_SECRET || "";
  const tokenParam = secret ? `&token=${encodeURIComponent(secret)}` : "";

  const approveUrl = `${baseUrl}/api/content-factory/approve?id=${encodeURIComponent(imageId)}${tokenParam}`;
  const rejectUrl = `${baseUrl}/api/content-factory/reject?id=${encodeURIComponent(imageId)}${tokenParam}`;

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `🎨 New Creative — ${styleProfile.name}` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*ID:* \`${imageId}\`` },
        { type: "mrkdwn", text: `*Style:* ${styleProfile.name}` },
        { type: "mrkdwn", text: `*Dimensions:* ${styleProfile.dimensions}` },
        { type: "mrkdwn", text: `*Cost:* ~$0.04` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Concept:*\n>${conceptText.split("\n").map((l) => l.trim()).join("\n>").slice(0, 500)}`,
      },
    },
    {
      type: "image",
      image_url: imageUrl,
      alt_text: `${styleProfile.name} creative`,
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Approve" },
          style: "primary",
          url: approveUrl,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "❌ Reject" },
          style: "danger",
          url: rejectUrl,
        },
      ],
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `Generated ${new Date().toISOString()} • Click Approve/Reject above • Image saved at \`${metadata.imagePath || "?"}\`` },
      ],
    },
  ];

  if (slackBotToken) {
    // Preferred: bot token + chat.postMessage (gets thread support + ts)
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${slackBotToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: channelId,
        text: `New creative for approval: ${imageId}`,
        blocks,
        unfurl_links: false,
      }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(`Slack chat.postMessage failed: ${json.error}`);
    return {
      ts: json.ts,
      channel: json.channel,
      message_link: `https://usagummies.slack.com/archives/${json.channel}/p${json.ts.replace(".", "")}`,
    };
  } else {
    // Fallback: incoming webhook (no thread ts, but blocks render fine)
    const res = await fetch(slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        text: `New creative for approval: ${imageId}`,
        blocks,
        unfurl_links: false,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Slack webhook ${res.status}: ${errText.slice(0, 200)}`);
    }
    return { ts: null, channel: null, message_link: "(webhook — no message_link)" };
  }
}
