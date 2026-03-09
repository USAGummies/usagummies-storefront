import { readState, writeState } from "@/lib/ops/state";

export type SupabaseCircuitState = {
  failureCount: number;
  openedAt: string | null;
  cooldownUntil: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
};

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 5 * 60 * 1000;

const INITIAL_STATE: SupabaseCircuitState = {
  failureCount: 0,
  openedAt: null,
  cooldownUntil: null,
  lastFailureAt: null,
  lastError: null,
};

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function fromIso(value: string | null): number | null {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
}

export async function getSupabaseCircuitState(): Promise<SupabaseCircuitState> {
  const state = await readState<SupabaseCircuitState>("supabase-circuit-state", INITIAL_STATE);
  return {
    failureCount: Number.isFinite(state?.failureCount) ? state.failureCount : 0,
    openedAt: state?.openedAt || null,
    cooldownUntil: state?.cooldownUntil || null,
    lastFailureAt: state?.lastFailureAt || null,
    lastError: state?.lastError || null,
  };
}

export function isCircuitOpen(state: SupabaseCircuitState): boolean {
  const cooldownUntil = fromIso(state.cooldownUntil);
  if (!cooldownUntil) return false;
  return Date.now() < cooldownUntil;
}

export async function canUseSupabase(): Promise<{
  allowed: boolean;
  state: SupabaseCircuitState;
}> {
  const state = await getSupabaseCircuitState();
  return { allowed: !isCircuitOpen(state), state };
}

export async function markSupabaseSuccess(): Promise<SupabaseCircuitState> {
  await writeState("supabase-circuit-state", INITIAL_STATE);
  return INITIAL_STATE;
}

export async function markSupabaseFailure(error: unknown): Promise<SupabaseCircuitState> {
  const prev = await getSupabaseCircuitState();
  const nowMs = Date.now();
  const failureCount = prev.failureCount + 1;
  const shouldOpen = failureCount >= FAILURE_THRESHOLD;

  const next: SupabaseCircuitState = {
    failureCount,
    openedAt: shouldOpen ? toIso(nowMs) : prev.openedAt,
    cooldownUntil: shouldOpen ? toIso(nowMs + COOLDOWN_MS) : prev.cooldownUntil,
    lastFailureAt: toIso(nowMs),
    lastError: error instanceof Error ? error.message : String(error),
  };

  await writeState("supabase-circuit-state", next);
  return next;
}
