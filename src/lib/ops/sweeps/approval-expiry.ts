import { expireStaleApprovals } from "@/lib/ops/abra-actions";
import { proactiveMessage } from "@/lib/ops/abra-slack-responder";

export async function runApprovalExpirySweep(): Promise<number> {
  const expired = await expireStaleApprovals(24);
  if (expired > 0) {
    await proactiveMessage({
      target: "channel",
      channelOrUserId: process.env.SLACK_CHANNEL_ALERTS || "C0ALS6W7VB4",
      message: `⏰ Expired ${expired} stale approval${expired === 1 ? "" : "s"} (>24h old). Run /abra approvals to review.`,
    }).catch(() => {});
  }
  return expired;
}
