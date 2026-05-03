/**
 * Ad-spend kill-switch card renderer — pure markdown for the
 * #ops-approvals card body when severity = kill (or
 * #ops-alerts when severity = warn).
 *
 * Surfaces yesterday's spend + conversions per-platform with the
 * specific reason each platform triggered. Includes Meta + Google
 * deep-links so Ben can tap once into the right platform's UI to
 * pause manually.
 *
 * The card text says "Pause all <platform> ads" — but the actual
 * pause is a manual action today (we don't have write-access tested
 * for either platform). The kill-switch surface is the SIGNAL; Ben
 * is the actuator.
 */
import type {
  KillSwitchDecision,
  KillSwitchPlatformDecision,
} from "./decision";

const META_ADS_MANAGER_URL = "https://business.facebook.com/adsmanager";
const GOOGLE_ADS_URL = "https://ads.google.com/";

function escapeBackticks(s: string): string {
  return s.replace(/`/g, "ʹ");
}

function platformLabel(p: "meta" | "google"): string {
  return p === "meta" ? "Meta (Facebook/Instagram)" : "Google Ads";
}

function severityEmoji(sev: KillSwitchPlatformDecision["severity"]): string {
  if (sev === "kill") return ":rotating_light:";
  if (sev === "warn") return ":warning:";
  return ":white_check_mark:";
}

function platformDeepLink(p: "meta" | "google"): string {
  return p === "meta" ? META_ADS_MANAGER_URL : GOOGLE_ADS_URL;
}

function renderPlatformLine(d: KillSwitchPlatformDecision): string {
  const emoji = severityEmoji(d.severity);
  const label = platformLabel(d.platform);
  const link = platformDeepLink(d.platform);
  if (d.unavailableReason) {
    return `${emoji} *${label}:* unavailable — ${escapeBackticks(d.unavailableReason)}`;
  }
  const spendStr =
    d.spendUsd !== null ? `$${d.spendUsd.toFixed(2)}` : "n/a";
  const convStr =
    d.conversions !== null ? `${d.conversions} conv` : "n/a";
  const cpaStr =
    d.cpaUsd !== null ? ` · CPA $${d.cpaUsd.toFixed(2)}` : "";
  return `${emoji} *${label}:* ${spendStr} spend → ${convStr}${cpaStr} — ${escapeBackticks(d.reason)} · <${link}|Open>`;
}

/**
 * Render the kill-switch card body. Caller (route) decides whether
 * to post it as a Class B approval card to #ops-approvals (when
 * decision.shouldKill is true) or a P2 warning to #ops-alerts.
 */
export function renderKillSwitchCard(
  decision: KillSwitchDecision,
  forDate: string,
): string {
  const headerEmoji =
    decision.overallSeverity === "kill"
      ? ":rotating_light:"
      : decision.overallSeverity === "warn"
        ? ":warning:"
        : ":white_check_mark:";
  const headerLabel =
    decision.overallSeverity === "kill"
      ? "AD-SPEND KILL — yesterday burned, no conversions"
      : decision.overallSeverity === "warn"
        ? "Ad-spend warning — yesterday looked rough"
        : "Ad-spend check — yesterday clean";
  const lines = [
    `${headerEmoji} *${headerLabel}*`,
    `*Date:* \`${forDate}\``,
    `*Total:* $${decision.totalSpendUsd.toFixed(2)} spend → ${decision.totalConversions} conv`,
    "",
    "*Per platform:*",
  ];
  for (const d of decision.perPlatform) {
    lines.push(`  ${renderPlatformLine(d)}`);
  }

  if (decision.shouldKill) {
    lines.push("");
    lines.push(
      "*What approving this card does:*",
    );
    lines.push(
      "  • Posts a `:white_check_mark: Approved — paused` confirmation in this thread.",
    );
    lines.push(
      "  • Records the kill in the audit ledger.",
    );
    lines.push(
      "  • _Does NOT pause ads via API yet._ You still need to open the platform UI (links above) and pause manually. Auto-pause via API is the next iteration; this card is the ALERT layer.",
    );
    lines.push("");
    lines.push(
      "*Rollback:* Re-enable ads in the platform UI. The kill-switch detector will silence for 24h on this date so it won't re-fire.",
    );
  } else if (decision.overallSeverity === "warn") {
    lines.push("");
    lines.push(
      "*This is a warning, not a kill.* Posted to <#C0ATUGGUZL6|ops-alerts> for visibility — operator decides whether to act. The detector flips to KILL when spend exceeds $100 with zero conversions.",
    );
  }

  return lines.join("\n");
}
