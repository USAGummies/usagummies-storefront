/**
 * Slack Block Kit renderer for the `shipping today` command.
 *
 * Same pattern as finance-today / marketing-today / email-queue cards
 * per blueprint §5 standard.
 *
 * Card shape:
 *   1. Header w/ posture chip
 *   2. 6-field stats grid (retry pending / exhausted / approvals /
 *      stamps_com / ups_walleted / wallet alerts)
 *   3. Brief block (what this means)
 *   4. Top retry-queue rows + oldest pending approvals (when any)
 *   5. Wallet alert section (red banner)
 *   6. Context block — generation time + degraded
 *   7. Actions — Open shipping dashboard
 */
import type {
  ShippingTodaySummary,
  ShippingWalletBalance,
} from "./shipping-today";

const DASHBOARD_URL = "https://www.usagummies.com/ops/shipping";

export interface ShippingTodayCard {
  text: string;
  blocks: unknown[];
}

export function renderShippingTodayCard(args: {
  summary: ShippingTodaySummary;
}): ShippingTodayCard {
  const { summary } = args;
  const postureEmoji = postureLabel(summary.posture);

  const text = formatTopLine(summary, postureEmoji);

  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🚚 Shipping today — ${postureEmoji}`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Retry pending*\n${summary.retryQueue.pending}`,
        },
        {
          type: "mrkdwn",
          text: `*Retry exhausted*\n${summary.retryQueue.exhausted}`,
        },
        {
          type: "mrkdwn",
          text: `*Pending approvals*\n${summary.pendingApprovals}`,
        },
        {
          type: "mrkdwn",
          text: `*Wallet alerts*\n${summary.walletAlerts.length}`,
        },
        {
          type: "mrkdwn",
          text: `*stamps_com*\n${formatWalletBalance(
            findWallet(summary.wallet, "stamps_com"),
          )}`,
        },
        {
          type: "mrkdwn",
          text: `*ups_walleted*\n${formatWalletBalance(
            findWallet(summary.wallet, "ups_walleted"),
          )}`,
        },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: buildBriefText(summary) },
    },
  ];

  if (summary.walletAlerts.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*🚨 Wallet alerts*\n` +
          summary.walletAlerts
            .map((w) => `• \`${w.carrierCode}\` — $${w.balanceUsd.toFixed(2)}`)
            .join("\n"),
      },
    });
  }

  if (summary.retryQueue.oldestPending.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Oldest pending retries*\n` +
          summary.retryQueue.oldestPending
            .map(
              (e) =>
                `• ${truncate(e.reason, 60)} — _${e.attempts} attempt${e.attempts === 1 ? "" : "s"}, ${e.ageMinutes}m old_`,
            )
            .join("\n"),
      },
    });
  }

  if (summary.oldestPendingApprovals.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Oldest pending approvals*\n` +
          summary.oldestPendingApprovals
            .slice(0, 3)
            .map(
              (a) =>
                `• \`${a.id.slice(0, 14)}\` · ${truncate(a.action, 70)} _(${a.ageDays}d old)_`,
            )
            .join("\n"),
      },
    });
  }

  const contextLines: string[] = [
    `Generated ${formatShortTime(summary.generatedAt)} · Read-only — no label is bought from this card`,
  ];
  if (summary.degraded.length > 0) {
    contextLines.push(`:warning: Degraded: ${summary.degraded.join(" · ")}`);
  }
  blocks.push({
    type: "context",
    elements: contextLines.map((t) => ({ type: "mrkdwn", text: t })),
  });

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Open shipping dashboard",
          emoji: true,
        },
        url: DASHBOARD_URL,
        action_id: "open_shipping_dashboard",
      },
    ],
  });

  return { text, blocks };
}

function formatTopLine(
  s: ShippingTodaySummary,
  postureEmoji: string,
): string {
  if (s.posture === "green") {
    return `🚚 Shipping today — ${postureEmoji} clean`;
  }
  const parts: string[] = [];
  if (s.retryQueue.exhausted > 0) {
    parts.push(`${s.retryQueue.exhausted} exhausted`);
  }
  if (s.retryQueue.pending > 0) {
    parts.push(`${s.retryQueue.pending} pending retries`);
  }
  if (s.walletAlerts.length > 0) parts.push("wallet alert");
  if (s.pendingApprovals > 0) {
    parts.push(`${s.pendingApprovals} pending approvals`);
  }
  return `🚚 Shipping today — ${postureEmoji} ${parts.join(" · ")}`;
}

function buildBriefText(s: ShippingTodaySummary): string {
  const parts: string[] = [];
  if (s.posture === "red") {
    if (s.retryQueue.exhausted > 0) {
      parts.push(
        `*🚨 ${s.retryQueue.exhausted} exhausted retr${s.retryQueue.exhausted === 1 ? "y" : "ies"}.* These dispatches gave up — operator must intervene before the order ships.`,
      );
    }
    if (s.walletAlerts.length > 0) {
      parts.push(
        `*🚨 ${s.walletAlerts.length} carrier wallet${s.walletAlerts.length === 1 ? "" : "s"} below threshold.* Top up before next label buy.`,
      );
    }
    if (s.oldestPendingApprovals.some((a) => a.ageDays >= 3)) {
      parts.push(
        "*🚨 Stale shipping approval (≥3d).* Decide or stand it down.",
      );
    }
  }
  if (s.posture === "yellow") {
    if (s.retryQueue.pending > 0) {
      parts.push(
        `*${s.retryQueue.pending} pending retry${s.retryQueue.pending === 1 ? "" : "ies"}* — drain runs every 30 min during business hours.`,
      );
    }
    if (s.pendingApprovals > 0) {
      parts.push(
        `*${s.pendingApprovals} shipping approval${s.pendingApprovals === 1 ? "" : "s"} waiting on Ben.*`,
      );
    }
    if (s.wallet.some((w) => w.balanceUsd === null)) {
      parts.push(
        "_Wallet balances unavailable — ShipStation read failed; counts are still accurate._",
      );
    }
  }
  if (s.posture === "green") {
    parts.push(
      "_Clean shipping posture — retry queue empty, wallets healthy, no pending approvals._",
    );
  }
  return parts.join(" ");
}

function formatWalletBalance(w: ShippingWalletBalance | null): string {
  if (!w) return "—";
  if (w.balanceUsd === null) return ":warning: error";
  return `$${w.balanceUsd.toFixed(2)}`;
}

function findWallet(
  wallet: ReadonlyArray<ShippingWalletBalance>,
  carrierCode: string,
): ShippingWalletBalance | null {
  return wallet.find((w) => w.carrierCode === carrierCode) ?? null;
}

function postureLabel(p: ShippingTodaySummary["posture"]): string {
  if (p === "green") return "🟢 clean";
  if (p === "yellow") return "🟡 work waiting";
  return "🔴 alert";
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function formatShortTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(11, 16) + "Z";
  } catch {
    return iso;
  }
}
