/**
 * VIKTOR_W9_REGEX coverage — pins the canonical close phrases Rene uses.
 *
 * The regex needs to match the trigger phrases without false positives
 * on general "booke" chatter ("update booke" / "I logged into booke" /
 * etc. should NOT trigger).
 */
import { describe, expect, it } from "vitest";

// Re-declare locally to avoid importing the route (which pulls in runtime).
const VIKTOR_W9_REGEX =
  /^\/?(?:booke\s+(?:status|today|prep|prepare|ready|review|next)|prepare\s+booke?|is\s+booke?\s+(?:next|ready|done)|booke?\s+to\s+complete|prep\s+booke?)\s*$/i;

describe("VIKTOR_W9_REGEX — should match", () => {
  it.each([
    "booke status",
    "booke today",
    "booke prep",
    "booke prepare",
    "booke ready",
    "booke review",
    "booke next",
    "prepare booke",
    "prepare book",
    "is booke next",
    "is book next",
    "is booke ready",
    "is booke done",
    "booke to complete",
    "book to complete",
    "prep booke",
    "prep book",
    "/booke status",
    "/prepare booke",
    "BOOKE STATUS", // case-insensitive
    "Prepare Booke",
  ])("matches %p", (phrase) => {
    expect(VIKTOR_W9_REGEX.test(phrase)).toBe(true);
  });
});

describe("VIKTOR_W9_REGEX — should NOT match", () => {
  it.each([
    "I logged into booke", // sentence, not a command
    "update booke", // generic chatter
    "where is booke",
    "booke is fine",
    "did you book the trip",
    "complete booke entries", // close but not the canonical trigger
    "booke", // bare word
    "viktor", // unrelated
    "booke says hi", // chatter
    "log into booke please",
    "the booke status is fine", // sentence with chatter
    "viktor finish booke", // related but not the canonical W-9 trigger
  ])("does NOT match %p", (phrase) => {
    expect(VIKTOR_W9_REGEX.test(phrase)).toBe(false);
  });
});
