/**
 * JE proposal payload store.
 *
 * The Slack approval card carries the markdown preview and the
 * `targetEntity` reference. The CLOSER (which fires hours later when
 * both Ben + Rene have approved) needs the full structured payload
 * — line debits/credits/account ids/amounts — to actually post the
 * JE to QBO. We persist the full proposal under the approval id at
 * propose-time so the closer can recall it.
 *
 * Mirrors `sample-order-dispatch/payload-store.ts` — same TTL,
 * same fail-soft contract: a KV miss in the closer falls through to
 * "no payload found, can't post" rather than throwing.
 */
import { kv } from "@vercel/kv";

import type { JeProposal } from "./types";

const PAYLOAD_KEY_PREFIX = "je-approval:payload:";
const PAYLOAD_TTL_SECONDS = 30 * 24 * 3600; // 30d, matches approval expiry pattern

export interface StoredJePayload {
  approvalId: string;
  proposal: JeProposal;
  persistedAt: string;
}

function payloadKey(approvalId: string): string {
  return `${PAYLOAD_KEY_PREFIX}${approvalId}`;
}

export async function persistJeProposalPayload(
  approvalId: string,
  proposal: JeProposal,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await kv.set(
      payloadKey(approvalId),
      JSON.stringify({
        approvalId,
        proposal,
        persistedAt: new Date().toISOString(),
      } satisfies StoredJePayload),
      { ex: PAYLOAD_TTL_SECONDS },
    );
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function loadJeProposalPayload(
  approvalId: string,
): Promise<StoredJePayload | null> {
  let raw: unknown = null;
  try {
    raw = await kv.get(payloadKey(approvalId));
  } catch {
    return null;
  }
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as StoredJePayload;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as StoredJePayload;
  return null;
}
