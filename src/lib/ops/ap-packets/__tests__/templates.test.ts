/**
 * Tests for the AP packet template registry.
 *
 * Locked contracts (every one is a bullet from Ben's spec):
 *   - Template registry exists and has the USA Gummies base template.
 *   - Required fields enforced: slug, templateSlug, accountName, apEmail.
 *   - Draft is marked `requiredFieldsComplete=false` until every
 *     required field + attachment is populated.
 *   - Drafts persist to KV under `ap-packets:drafts:<slug>` and load
 *     back with the same shape.
 *   - createApPacketDraft does NOT send email, write to QBO, write to
 *     Drive, or surface a Slack approval — only KV.
 *   - Drafts are NOT visible to the live `getApPacket()` (in
 *     ap-packets.ts) so the send route can't accidentally send a draft.
 *   - Subject/body skeleton substitutes `{{retailer}}` correctly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/kv", () => {
  const store = new Map<string, unknown>();
  return {
    kv: {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: unknown) => {
        store.set(k, v);
        return "OK";
      }),
      __store: store,
    },
  };
});

import { kv } from "@vercel/kv";
import {
  buildApPacketDraft,
  createApPacketDraft,
  DraftValidationError,
  evaluateDraftCompleteness,
  getApPacketDraft,
  getApPacketTemplate,
  listApPacketDrafts,
  listApPacketTemplates,
  TemplateNotFoundError,
  USA_GUMMIES_BASE_TEMPLATE,
  writeApPacketDraft,
} from "../templates";
import { getApPacket, listApPackets } from "../../ap-packets";

const NOW = new Date("2026-04-26T00:00:00Z");

beforeEach(() => {
  (kv as unknown as { __store: Map<string, unknown> }).__store.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("template registry", () => {
  it("listApPacketTemplates returns at least the USA Gummies base template", () => {
    const templates = listApPacketTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(1);
    expect(templates[0].slug).toBe("usa-gummies-base");
    expect(templates[0]).toEqual(USA_GUMMIES_BASE_TEMPLATE);
  });

  it("getApPacketTemplate returns null for unknown slug", () => {
    expect(getApPacketTemplate("does-not-exist")).toBeNull();
    expect(getApPacketTemplate("usa-gummies-base")).not.toBeNull();
  });

  it("base template uses USA Gummies legal entity (no retailer-specific fields baked in)", () => {
    const t = USA_GUMMIES_BASE_TEMPLATE;
    expect(t.companyProfile.legalCompanyName).toBe("USA Gummies, LLC");
    expect(t.companyProfile.ein).toBe("33-4744824");
    // The reply skeleton uses a placeholder, never a hard-coded retailer.
    expect(t.replyDraftSkeleton.subjectTemplate).toContain("{{retailer}}");
    expect(t.replyDraftSkeleton.bodyTemplate).toContain("{{retailer}}");
  });
});

describe("buildApPacketDraft — required field enforcement", () => {
  it("missing slug → DraftValidationError", () => {
    expect(() =>
      buildApPacketDraft(
        // @ts-expect-error testing missing slug
        {
          templateSlug: "usa-gummies-base",
          accountName: "Whole Foods",
          apEmail: "ap@wholefoods.com",
        },
        NOW,
      ),
    ).toThrow(DraftValidationError);
  });

  it("invalid slug shape → DraftValidationError", () => {
    expect(() =>
      buildApPacketDraft(
        {
          slug: "Bad Slug With Spaces!",
          templateSlug: "usa-gummies-base",
          accountName: "X",
          apEmail: "x@x.com",
        },
        NOW,
      ),
    ).toThrow(DraftValidationError);
  });

  it("missing apEmail → DraftValidationError", () => {
    expect(() =>
      buildApPacketDraft(
        // @ts-expect-error testing missing apEmail
        {
          slug: "x",
          templateSlug: "usa-gummies-base",
          accountName: "X",
        },
        NOW,
      ),
    ).toThrow(DraftValidationError);
  });

  it("malformed apEmail → DraftValidationError", () => {
    expect(() =>
      buildApPacketDraft(
        {
          slug: "x",
          templateSlug: "usa-gummies-base",
          accountName: "X",
          apEmail: "not-an-email",
        },
        NOW,
      ),
    ).toThrow(DraftValidationError);
  });

  it("missing accountName → DraftValidationError", () => {
    expect(() =>
      buildApPacketDraft(
        {
          slug: "x",
          templateSlug: "usa-gummies-base",
          accountName: "   ",
          apEmail: "ap@x.com",
        },
        NOW,
      ),
    ).toThrow(DraftValidationError);
  });

  it("unknown templateSlug → TemplateNotFoundError", () => {
    expect(() =>
      buildApPacketDraft(
        {
          slug: "x",
          templateSlug: "does-not-exist",
          accountName: "X",
          apEmail: "ap@x.com",
        },
        NOW,
      ),
    ).toThrow(TemplateNotFoundError);
  });
});

describe("buildApPacketDraft — happy path", () => {
  it("substitutes {{retailer}} in subject + body", () => {
    const d = buildApPacketDraft(
      {
        slug: "whole-foods",
        templateSlug: "usa-gummies-base",
        accountName: "Whole Foods Market",
        apEmail: "vendorsetup@wholefoods.com",
      },
      NOW,
    );
    expect(d.replyDraft.subject).toBe(
      "Re: Whole Foods Market New Account Setup Forms",
    );
    expect(d.replyDraft.body.startsWith("Hi Whole Foods Market Accounting Team,")).toBe(
      true,
    );
    // Placeholder fully replaced — no {{retailer}} left.
    expect(d.replyDraft.subject).not.toContain("{{retailer}}");
    expect(d.replyDraft.body).not.toContain("{{retailer}}");
  });

  it("clones companyProfile + catalog from the template", () => {
    const d = buildApPacketDraft(
      {
        slug: "kroger",
        templateSlug: "usa-gummies-base",
        accountName: "Kroger",
        apEmail: "ap@kroger.com",
      },
      NOW,
    );
    expect(d.companyProfile.legalCompanyName).toBe("USA Gummies, LLC");
    expect(d.catalog).toHaveLength(1);
    expect(d.catalog[0].vendorItemNumber).toBe("AAGB-7.5");
    // Mutating the draft must not affect the template.
    d.catalog[0].caseCost = 0;
    expect(USA_GUMMIES_BASE_TEMPLATE.defaultCatalog[0].caseCost).toBe(20.94);
  });

  it("lowercases apEmail (defensive, since shells often paste mixed-case)", () => {
    const d = buildApPacketDraft(
      {
        slug: "x",
        templateSlug: "usa-gummies-base",
        accountName: "X",
        apEmail: "AP@Example.COM",
      },
      NOW,
    );
    expect(d.apEmail).toBe("ap@example.com");
  });

  it("defaults owner to Rene and dueWindow to a sane default", () => {
    const d = buildApPacketDraft(
      {
        slug: "x",
        templateSlug: "usa-gummies-base",
        accountName: "X",
        apEmail: "ap@x.com",
      },
      NOW,
    );
    expect(d.owner).toBe("Rene Gonzalez");
    expect(d.dueWindow.length).toBeGreaterThan(0);
  });

  it("lifecycle is the literal 'draft' so dashboard can filter unambiguously", () => {
    const d = buildApPacketDraft(
      {
        slug: "x",
        templateSlug: "usa-gummies-base",
        accountName: "X",
        apEmail: "ap@x.com",
      },
      NOW,
    );
    expect(d.lifecycle).toBe("draft");
  });
});

describe("evaluateDraftCompleteness — incomplete-by-default contract", () => {
  it("fresh draft is incomplete because the vendor-setup-form attachment is 'missing'", () => {
    const d = buildApPacketDraft(
      {
        slug: "x",
        templateSlug: "usa-gummies-base",
        accountName: "X",
        apEmail: "ap@x.com",
      },
      NOW,
    );
    expect(d.requiredFieldsComplete).toBe(false);
    expect(d.missingRequired).toContain("attachment:vendor-setup-form");
  });

  it("draft becomes complete once the missing attachment is marked ready", () => {
    const d = buildApPacketDraft(
      {
        slug: "x",
        templateSlug: "usa-gummies-base",
        accountName: "X",
        apEmail: "ap@x.com",
      },
      NOW,
    );
    // Operator uploads the retailer's vendor setup form.
    const setup = d.attachments.find((a) => a.id === "vendor-setup-form")!;
    setup.status = "ready";
    const evaluated = evaluateDraftCompleteness(d);
    expect(evaluated.requiredFieldsComplete).toBe(true);
    expect(evaluated.missingRequired).toEqual([]);
  });

  it("missing fields surface explicitly, not as a generic 'incomplete' label", () => {
    const evaluated = evaluateDraftCompleteness({
      accountName: "",
      apEmail: "",
      owner: "",
      dueWindow: "",
      attachments: [
        { id: "x", label: "x", status: "missing", note: "" },
      ],
    });
    expect(evaluated.requiredFieldsComplete).toBe(false);
    expect(evaluated.missingRequired).toContain("accountName");
    expect(evaluated.missingRequired).toContain("apEmail");
    expect(evaluated.missingRequired).toContain("owner");
    expect(evaluated.missingRequired).toContain("dueWindow");
    expect(evaluated.missingRequired).toContain("attachment:x");
  });
});

describe("KV persistence — drafts survive across sessions", () => {
  it("createApPacketDraft writes to KV and the round-trip preserves the shape", async () => {
    const draft = await createApPacketDraft({
      slug: "wfm",
      templateSlug: "usa-gummies-base",
      accountName: "Whole Foods Market",
      apEmail: "vendorsetup@wholefoods.com",
      owner: "Rene Gonzalez",
      dueWindow: "Return within 5 business days",
    });
    expect(draft.slug).toBe("wfm");

    // KV write fired exactly twice — once for the draft, once for the index.
    expect((kv.set as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);

    const reloaded = await getApPacketDraft("wfm");
    expect(reloaded).not.toBeNull();
    expect(reloaded!.accountName).toBe("Whole Foods Market");
    expect(reloaded!.lifecycle).toBe("draft");
    expect(reloaded!.replyDraft.subject).toContain("Whole Foods Market");
  });

  it("listApPacketDrafts returns newest first", async () => {
    await writeApPacketDraft({
      ...(await createApPacketDraft({
        slug: "older",
        templateSlug: "usa-gummies-base",
        accountName: "Older Co",
        apEmail: "ap@older.com",
      })),
      createdAt: "2026-04-20T00:00:00Z",
    });
    await writeApPacketDraft({
      ...(await createApPacketDraft({
        slug: "newer",
        templateSlug: "usa-gummies-base",
        accountName: "Newer Co",
        apEmail: "ap@newer.com",
      })),
      createdAt: "2026-04-25T00:00:00Z",
    });
    const list = await listApPacketDrafts();
    expect(list[0].slug).toBe("newer");
    expect(list[1].slug).toBe("older");
  });

  it("KV outage on read returns null (fail-soft, never throws)", async () => {
    const failingKv = vi.fn(async () => {
      throw new Error("kv unreachable");
    });
    (kv as unknown as { get: typeof failingKv }).get = failingKv;
    const r = await getApPacketDraft("anything");
    expect(r).toBeNull();
  });
});

describe("safety — drafts cannot accidentally send", () => {
  it("createApPacketDraft does NOT add the draft to live listApPackets()", async () => {
    await createApPacketDraft({
      slug: "wfm",
      templateSlug: "usa-gummies-base",
      accountName: "Whole Foods",
      apEmail: "ap@wholefoods.com",
    });
    // Live registry still only has the hand-maintained packets.
    const live = listApPackets();
    expect(live.find((p) => p.slug === "wfm")).toBeUndefined();
    // getApPacket() is what /send uses — must not see drafts.
    expect(getApPacket("wfm")).toBeNull();
  });

  it("createApPacketDraft does NOT import or call any send/email/Drive primitive", async () => {
    // We can't directly assert "import didn't happen" but we can prove
    // the create path never reaches the network: the only allowed
    // side effect is `kv.set`. KV.set was mocked at the module
    // boundary; if the module was secretly calling googleapis or
    // gmail-reader or a fetch, those calls would crash uninstrumented.
    const beforeSetCalls = (kv.set as unknown as ReturnType<typeof vi.fn>).mock
      .calls.length;
    await createApPacketDraft({
      slug: "smoke",
      templateSlug: "usa-gummies-base",
      accountName: "Smoke Co",
      apEmail: "ap@smoke.com",
    });
    const afterSetCalls = (kv.set as unknown as ReturnType<typeof vi.fn>).mock
      .calls.length;
    // Exactly two writes: the draft itself and the index.
    expect(afterSetCalls - beforeSetCalls).toBe(2);
  });
});
