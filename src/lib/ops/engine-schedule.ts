/**
 * @deprecated 2026-04-17 — was the entry point for the retired 70-agent Abra
 * registry. Replaced by the USA Gummies 3.0 control plane.
 *
 * Do not add behavior here. New code belongs in:
 *   src/lib/ops/control-plane/
 *
 * See /contracts/governance.md and the canonical blueprint §14 / §15.
 *
 * This file is kept as an empty stub so existing imports do not break.
 * Once all callers migrate, delete it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ENGINE_REGISTRY: any[] = [];
export function getDueAgents() {
  return [];
}
