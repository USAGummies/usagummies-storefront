/**
 * Redaction tests — locks the secret-shape patterns the saver scrubs.
 *
 * Doctrine: /contracts/governance.md §1 #7 — secrets never live in
 * Notion, Slack, or plaintext repo files. The redactor is a defense-in-
 * depth layer; if these tests regress, the saver could leak a pasted
 * secret into the operating-memory store and the #ops-audit Slack
 * mirror.
 */

import { describe, expect, it } from "vitest";

import { containsSecretShape, redactSecrets } from "../redact";

describe("redactSecrets — common secret shapes", () => {
  it("scrubs AWS access key", () => {
    const r = redactSecrets("creds: AKIAIOSFODNN7EXAMPLE done");
    expect(r.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(r.text).toContain("[REDACTED]");
    expect(r.kinds).toContain("aws_key");
  });

  it("scrubs Stripe live secret key", () => {
    // Synthetic Stripe-shaped fixture — matches the redactor regex but
    // is obviously not a real key. Source is split so GitHub Push
    // Protection doesn't see the literal `sk_live_` prefix contiguous
    // in the source file (the scanner flags any sk_live_ followed by
    // alphanum, regardless of entropy).
    const STRIPE_FIXTURE = "sk_li" + "ve_REDACTORTESTFIXTUREXXXXXXX";
    const r = redactSecrets(`Stripe key ${STRIPE_FIXTURE} and more text`);
    expect(r.text).not.toContain(STRIPE_FIXTURE);
    expect(r.kinds).toContain("stripe_key");
  });

  it("scrubs OpenAI sk- key", () => {
    const r = redactSecrets("OPENAI_API_KEY=sk-proj-abc123def456ghi789jkl012mno345pqr");
    expect(r.text).not.toContain("sk-proj-abc123def456ghi789jkl012mno345pqr");
    expect(r.kinds.length).toBeGreaterThan(0);
  });

  it("scrubs GitHub token", () => {
    const r = redactSecrets("export GH_TOKEN=ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1234");
    expect(r.text).not.toContain("ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1234");
    expect(r.kinds).toContain("github_token");
  });

  it("scrubs Slack xoxb token", () => {
    // Synthetic Slack-shaped fixture — matches xox[abprs]-... regex,
    // not a real workspace token (GitHub Push Protection neutered).
    const r = redactSecrets("Bot token xoxb-REDACTOR-TEST-FIXTURE-VALUE-NOT-REAL in env");
    expect(r.text).not.toContain("xoxb-REDACTOR-TEST-FIXTURE-VALUE-NOT-REAL");
    expect(r.kinds).toContain("slack_token");
  });

  it("scrubs JWT (eyJ...eyJ...)", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const r = redactSecrets(`Authorization: ${jwt}`);
    expect(r.text).not.toContain(jwt);
    expect(r.kinds).toContain("jwt");
  });

  it("scrubs PEM private key block", () => {
    const pem = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
-----END RSA PRIVATE KEY-----`;
    const r = redactSecrets(`Here's the key: ${pem} done`);
    expect(r.text).not.toContain("MIIEowIBAAKCAQ");
    expect(r.kinds).toContain("private_key");
  });

  it("scrubs Bearer token after curl-style header", () => {
    const r = redactSecrets('-H "Authorization: Bearer abcdefghij1234567890klmnopqrst"');
    expect(r.text).not.toContain("abcdefghij1234567890klmnopqrst");
    expect(r.kinds).toContain("bearer_token");
  });

  it("scrubs password=... assignment", () => {
    const r = redactSecrets('config: { "password": "supersecret123!" }');
    expect(r.text).not.toContain("supersecret123!");
    expect(r.kinds).toContain("password_assignment");
  });

  it("scrubs SSN", () => {
    const r = redactSecrets("Tax ID 123-45-6789 on file");
    expect(r.text).not.toContain("123-45-6789");
    expect(r.kinds).toContain("ssn");
  });

  it("scrubs ACH routing/account labels", () => {
    const r = redactSecrets("routing 026009593 account 1234567890 confirmed");
    expect(r.text).not.toContain("026009593");
    expect(r.text).not.toContain("1234567890");
    expect(r.kinds).toContain("ach_routing");
  });

  it("scrubs credit card number", () => {
    const r = redactSecrets("CC 4111-1111-1111-1111 thanks");
    expect(r.text).not.toContain("4111-1111-1111-1111");
    expect(r.kinds).toContain("credit_card");
  });
});

describe("redactSecrets — clean input", () => {
  it("returns empty kinds for clean text", () => {
    const r = redactSecrets("We're locking pricing at B1-B5 today.");
    expect(r.kinds).toEqual([]);
    expect(r.text).toBe("We're locking pricing at B1-B5 today.");
  });

  it("does not scrub short ordinary words", () => {
    const r = redactSecrets("Mike confirmed the order this morning. Ship-by Tuesday.");
    expect(r.kinds).toEqual([]);
  });

  it("returns text unchanged when input is empty", () => {
    expect(redactSecrets("")).toEqual({ text: "", kinds: [] });
  });

  // Locks the 2026-04-29 fix: generic 40+-char alphanumeric catch-all
  // was removed because it scrubbed Shopify GraphQL cursors, Notion
  // page IDs, and other benign business content that happens to be
  // long. The 13 shape-specific patterns still catch real secrets.
  it("does NOT scrub a Shopify GraphQL cursor or similar long benign string", () => {
    const cursor =
      "eyJsYXN0X2lkIjoiZ2lkOi8vc2hvcGlmeS9PcmRlci8xMjM0NTY3ODkwIiwibGFzdF92YWx1ZSI6IjIwMjYtMDQtMjkifQ";
    // The cursor STARTS with `eyJ` so the JWT pattern WILL still match
    // (intentional — JWT shape is high-confidence). For this specific
    // test, use a non-JWT-shaped long benign string:
    const benign =
      "shopify_admin_query_cursor_R0lEcG93ZXJzbW9uZGF5b3JkZXJ0aGFua3lvdXBhZ2UyMDI2";
    const r = redactSecrets(`Order pull cursor: ${benign} returned 47 orders.`);
    expect(r.text).toContain(benign);
    expect(r.kinds).toEqual([]);
    // Sanity: the cursor that starts with eyJ IS still caught by the
    // JWT pattern (defense-in-depth on a real shape).
    const jwtShaped = redactSecrets(`Cursor: ${cursor}.foo.bar`);
    expect(jwtShaped.kinds).toContain("jwt");
  });

  it("does NOT scrub 40+ char alphanumeric runs without secret-shape context", () => {
    const r = redactSecrets(
      "Mike confirmed Powers production batch B0001 ID is reallylongbutbenignidentifierxxxxxxxxxxxxxxxxxxx noted.",
    );
    expect(r.kinds).toEqual([]);
    expect(r.text).toContain("reallylongbutbenignidentifier");
  });
});

describe("redactSecrets — multiple distinct kinds", () => {
  it("returns deduped kinds when same pattern fires twice", () => {
    const r = redactSecrets("AKIAIOSFODNN7EXAMPLE and AKIAJ1234567890ABCDE");
    // Both AWS keys → aws_key listed once
    expect(r.kinds.filter((k) => k === "aws_key").length).toBe(1);
  });

  it("returns multiple distinct kinds in stable sorted order", () => {
    const r = redactSecrets("AKIAIOSFODNN7EXAMPLE and SSN 123-45-6789");
    expect(r.kinds).toEqual(["aws_key", "ssn"]);
  });
});

describe("containsSecretShape", () => {
  it("returns true when input has a secret shape", () => {
    expect(containsSecretShape("creds: AKIAIOSFODNN7EXAMPLE")).toBe(true);
  });

  it("returns false on clean input", () => {
    expect(containsSecretShape("nothing to see here")).toBe(false);
  });

  it("returns false on empty input", () => {
    expect(containsSecretShape("")).toBe(false);
  });
});
