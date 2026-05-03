import { describe, expect, it } from "vitest";

import { renderKillSwitchCard } from "../card";
import { decideKillSwitch } from "../decision";

describe("renderKillSwitchCard", () => {
  it("renders KILL header + per-platform breakdown + manual-pause guidance", () => {
    const d = decideKillSwitch([
      { platform: "meta", available: true, spendUsd: 0, conversions: 0 },
      { platform: "google", available: true, spendUsd: 1678, conversions: 0 },
    ]);
    const card = renderKillSwitchCard(d, "2026-04-21");
    expect(card).toContain(":rotating_light:");
    expect(card).toContain("AD-SPEND KILL");
    expect(card).toContain("2026-04-21");
    expect(card).toContain("$1678.00 spend → 0 conv");
    expect(card).toContain("Google Ads");
    expect(card).toContain("Meta (Facebook/Instagram)");
    expect(card).toContain("Open"); // deep-link label
    expect(card).toContain("Does NOT pause ads via API yet");
    expect(card).toContain("Rollback:");
  });

  it("renders WARN header without the kill-action footer", () => {
    const d = decideKillSwitch([
      { platform: "meta", available: true, spendUsd: 75, conversions: 0 },
      { platform: "google", available: true, spendUsd: 0, conversions: 0 },
    ]);
    const card = renderKillSwitchCard(d, "2026-05-03");
    expect(card).toContain(":warning:");
    expect(card).toContain("Ad-spend warning");
    expect(card).not.toContain("Does NOT pause ads via API yet");
    expect(card).toContain("ops-alerts");
  });

  it("renders OK header (silent path — caller decides whether to post)", () => {
    const d = decideKillSwitch([
      { platform: "meta", available: true, spendUsd: 30, conversions: 5 },
      { platform: "google", available: true, spendUsd: 25, conversions: 3 },
    ]);
    const card = renderKillSwitchCard(d, "2026-05-03");
    expect(card).toContain(":white_check_mark:");
    expect(card).toContain("Ad-spend check — yesterday clean");
  });

  it("renders unavailable platform as inline reason", () => {
    const d = decideKillSwitch([
      { platform: "meta", available: true, spendUsd: 40, conversions: 2 },
      {
        platform: "google",
        available: false,
        spendUsd: null,
        conversions: null,
        unavailableReason: "GOOGLE_ADS_* envs not configured",
      },
    ]);
    const card = renderKillSwitchCard(d, "2026-05-03");
    expect(card).toContain("Google Ads:* unavailable");
    expect(card).toContain("GOOGLE_ADS_* envs not configured");
  });

  it("includes deep-links to Meta + Google ads UIs", () => {
    const d = decideKillSwitch([
      { platform: "meta", available: true, spendUsd: 200, conversions: 0 },
      { platform: "google", available: true, spendUsd: 200, conversions: 0 },
    ]);
    const card = renderKillSwitchCard(d, "2026-05-03");
    expect(card).toContain("https://business.facebook.com/adsmanager");
    expect(card).toContain("https://ads.google.com/");
  });

  it("includes CPA when conversions > 0", () => {
    const d = decideKillSwitch([
      { platform: "meta", available: true, spendUsd: 75, conversions: 1 },
      { platform: "google", available: true, spendUsd: 0, conversions: 0 },
    ]);
    const card = renderKillSwitchCard(d, "2026-05-03");
    expect(card).toContain("CPA $75.00");
  });
});
