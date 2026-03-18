import { describe, expect, it } from "vitest";
import { getVipSender } from "@/lib/ops/abra-vip-senders";

describe("abra-vip-senders", () => {
  it("matches exact VIP sender for Rene", () => {
    const sender = getVipSender("gonz1rene@outlook.com");
    expect(sender?.name).toBe("Rene Gonzalez");
    expect(sender?.category).toBe("finance");
  });

  it("matches exact VIP sender case-insensitively", () => {
    const sender = getVipSender("BEN@USAGUMMIES.COM");
    expect(sender?.relationship).toBe("self");
  });

  it("matches domain-based VIP sender for Powers", () => {
    const sender = getVipSender("bill@powersconfections.com");
    expect(sender?.name).toBe("Powers Confections (co-packer)");
    expect(sender?.category).toBe("production");
  });

  it("matches domain-based distributor sender", () => {
    const sender = getVipSender("contact@inderbitzin.com");
    expect(sender?.relationship).toBe("partner");
    expect(sender?.priority).toBe("critical");
  });

  it("returns undefined for unknown senders", () => {
    expect(getVipSender("unknown@example.com")).toBeUndefined();
  });

  it("returns self entries for Ben personal email", () => {
    const sender = getVipSender("benjamin.stutman@gmail.com");
    expect(sender?.relationship).toBe("self");
    expect(sender?.suggestedAction).toContain("no action");
  });

  it("preserves drafting context on exact matches", () => {
    const sender = getVipSender("gonz1rene@outlook.com");
    expect(sender?.draftingContext).toContain("Bookkeeping Hub");
  });

  it("returns organization fallback names for domain matches", () => {
    const sender = getVipSender("ops@seebiz.com");
    expect(sender?.name).toBe("SeeBiz Marketplace");
  });
});
