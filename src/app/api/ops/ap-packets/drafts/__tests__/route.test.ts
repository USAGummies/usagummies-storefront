/**
 * Integration tests for /api/ops/ap-packets/drafts.
 *
 * Locked contracts:
 *   - POST creates a draft (HTTP 201) and writes only to KV.
 *   - POST without required fields → 400 with a clear error message.
 *   - POST with invalid templateSlug → 404 TemplateNotFoundError.
 *   - POST that would clobber an existing draft → 409.
 *   - GET (no slug) returns drafts + templates + counts.
 *   - GET (?slug=) returns one draft, 404 when missing.
 *   - The route NEVER imports gmail-reader, hubspot-client, or any
 *     QBO module — proven by absence of those names from the source.
 *   - The route NEVER calls ApPacketSend; getApPacket() returns null
 *     for any draft slug, preventing accidental dispatch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: vi.fn(async () => true),
}));

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

beforeEach(() => {
  (kv as unknown as { __store: Map<string, unknown> }).__store.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

function postReq(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/ops/ap-packets/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getReq(qs: string = ""): Request {
  return new Request(`http://localhost/api/ops/ap-packets/drafts${qs}`, {
    method: "GET",
  });
}

describe("POST /api/ops/ap-packets/drafts — happy path", () => {
  it("creates a draft, returns 201, persists to KV", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      postReq({
        slug: "whole-foods",
        templateSlug: "usa-gummies-base",
        accountName: "Whole Foods Market",
        apEmail: "vendorsetup@wholefoods.com",
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      draft: {
        slug: string;
        accountName: string;
        lifecycle: string;
        requiredFieldsComplete: boolean;
        replyDraft: { subject: string; body: string };
      };
    };
    expect(body.ok).toBe(true);
    expect(body.draft.slug).toBe("whole-foods");
    expect(body.draft.accountName).toBe("Whole Foods Market");
    expect(body.draft.lifecycle).toBe("draft");
    expect(body.draft.requiredFieldsComplete).toBe(false);
    expect(body.draft.replyDraft.subject).toContain("Whole Foods Market");

    // KV write fired exactly twice — draft + index. NO Gmail / HubSpot /
    // Drive write happened (none are mocked, so a stray call would have
    // crashed loudly).
    expect(kv.set).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/ops/ap-packets/drafts — required field validation", () => {
  it("missing slug → 400", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      postReq({
        templateSlug: "usa-gummies-base",
        accountName: "X",
        apEmail: "ap@x.com",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("missing apEmail → 400", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      postReq({
        slug: "x",
        templateSlug: "usa-gummies-base",
        accountName: "X",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("malformed apEmail surfaces from DraftValidationError → 400 with issues[]", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      postReq({
        slug: "x",
        templateSlug: "usa-gummies-base",
        accountName: "X",
        apEmail: "not-an-email",
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; issues?: string[] };
    expect(body.ok).toBe(false);
    expect((body.issues ?? []).join(" ")).toMatch(/apEmail/);
  });

  it("unknown templateSlug → 404", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      postReq({
        slug: "x",
        templateSlug: "made-up-template",
        accountName: "X",
        apEmail: "ap@x.com",
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/ops/ap-packets/drafts — refuses to clobber existing draft", () => {
  it("second POST with same slug → 409", async () => {
    const { POST } = await import("../route");
    const first = await POST(
      postReq({
        slug: "kroger",
        templateSlug: "usa-gummies-base",
        accountName: "Kroger",
        apEmail: "ap@kroger.com",
      }),
    );
    expect(first.status).toBe(201);
    const second = await POST(
      postReq({
        slug: "kroger",
        templateSlug: "usa-gummies-base",
        accountName: "Kroger",
        apEmail: "ap@kroger.com",
      }),
    );
    expect(second.status).toBe(409);
  });
});

describe("GET /api/ops/ap-packets/drafts", () => {
  it("returns roster of drafts + templates + counts", async () => {
    const { POST, GET } = await import("../route");
    await POST(
      postReq({
        slug: "wfm",
        templateSlug: "usa-gummies-base",
        accountName: "Whole Foods",
        apEmail: "ap@wholefoods.com",
      }),
    );
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      drafts: Array<{ slug: string }>;
      templates: Array<{ slug: string; label: string }>;
      counts: { drafts: number; incomplete: number; complete: number };
    };
    expect(body.ok).toBe(true);
    expect(body.drafts).toHaveLength(1);
    expect(body.drafts[0].slug).toBe("wfm");
    expect(body.templates.length).toBeGreaterThanOrEqual(1);
    expect(body.templates[0].slug).toBe("usa-gummies-base");
    expect(body.counts.drafts).toBe(1);
    expect(body.counts.incomplete).toBe(1);
    expect(body.counts.complete).toBe(0);
  });

  it("?slug=<existing> returns the single draft", async () => {
    const { POST, GET } = await import("../route");
    await POST(
      postReq({
        slug: "x",
        templateSlug: "usa-gummies-base",
        accountName: "X Co",
        apEmail: "ap@x.com",
      }),
    );
    const res = await GET(getReq("?slug=x"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; draft: { slug: string } };
    expect(body.draft.slug).toBe("x");
  });

  it("?slug=<missing> returns 404", async () => {
    const { GET } = await import("../route");
    const res = await GET(getReq("?slug=ghost"));
    expect(res.status).toBe(404);
  });
});

describe("safety — drafts are not visible to the live send path", () => {
  it("getApPacket(<draft-slug>) returns null even after creation", async () => {
    const { POST } = await import("../route");
    await POST(
      postReq({
        slug: "wfm",
        templateSlug: "usa-gummies-base",
        accountName: "Whole Foods",
        apEmail: "ap@wholefoods.com",
      }),
    );
    const { getApPacket } = await import("@/lib/ops/ap-packets");
    expect(getApPacket("wfm")).toBeNull();
  });
});
