import { readState, writeState } from "@/lib/ops/state";

export type DrivingModeState = {
  active: boolean;
  started: string;
  destination: string | null;
};

type DrivingBacklogState = {
  items: Array<{ ts: string; summary: string }>;
};

const DRIVING_MODE_KEY = "abra:driving_mode" as never;
const DRIVING_MODE_BACKLOG_KEY = "abra:driving_mode_backlog" as never;
const DRIVING_MODE_TIMEOUT_MS = 6 * 60 * 60 * 1000;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function isDrivingActivationText(text: string): boolean {
  return /\b(i'?m driving|heading out|on the road|in the car|driving to|heading to)\b/i.test(text);
}

export function isDrivingDeactivationText(text: string): boolean {
  return /\b(i'?m here|arrived|parked|back at desk|done driving)\b/i.test(text);
}

export function extractDrivingDestination(text: string): string | null {
  const match = text.match(/\b(?:driving|heading|on the road|going)\s+(?:to|toward[s]?)\s+([a-z0-9 ,.-]{2,80})/i);
  return match?.[1]?.replace(/[.!?]+$/g, "").trim() || null;
}

export async function getDrivingModeState(): Promise<DrivingModeState | null> {
  const value = await readState<DrivingModeState | null>(DRIVING_MODE_KEY, null).catch(() => null);
  if (!value?.active) return null;
  const started = Date.parse(value.started || "");
  if (!Number.isFinite(started) || Date.now() - started > DRIVING_MODE_TIMEOUT_MS) {
    await writeState(DRIVING_MODE_KEY, null).catch(() => {});
    return null;
  }
  return value;
}

export async function activateDrivingMode(text: string): Promise<DrivingModeState> {
  const state: DrivingModeState = {
    active: true,
    started: new Date().toISOString(),
    destination: extractDrivingDestination(text),
  };
  await writeState(DRIVING_MODE_KEY, state);
  return state;
}

export async function appendDrivingModeBacklog(summary: string): Promise<void> {
  const trimmed = summary.replace(/\s+/g, " ").trim();
  if (!trimmed) return;
  const active = await getDrivingModeState();
  if (!active) return;
  const backlog = await readState<DrivingBacklogState | null>(DRIVING_MODE_BACKLOG_KEY, null).catch(() => null);
  const items = Array.isArray(backlog?.items) ? backlog.items : [];
  if (items.some((item) => normalize(item.summary) === normalize(trimmed))) return;
  items.push({ ts: new Date().toISOString(), summary: trimmed });
  await writeState(DRIVING_MODE_BACKLOG_KEY, { items: items.slice(-20) });
}

export async function deactivateDrivingMode(): Promise<{ summary: string; count: number }> {
  const backlog = await readState<DrivingBacklogState | null>(DRIVING_MODE_BACKLOG_KEY, null).catch(() => null);
  await writeState(DRIVING_MODE_KEY, null).catch(() => {});
  await writeState(DRIVING_MODE_BACKLOG_KEY, { items: [] }).catch(() => {});
  const items = Array.isArray(backlog?.items) ? backlog.items : [];
  if (!items.length) {
    return { summary: "While you were driving: nothing urgent stacked up.", count: 0 };
  }
  const summary = `While you were driving: ${items.slice(0, 4).map((item) => item.summary).join(" | ")}`;
  return { summary, count: items.length };
}

function stripFormatting(text: string): string {
  return text
    .replace(/[*_`>#-]/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatDrivingModeReply(text: string): string {
  const stripped = stripFormatting(text);
  const shortened = stripped.length > 200 ? `${stripped.slice(0, 196).trim()}...` : stripped;
  if (/[?]$/.test(shortened)) return shortened;
  return `${shortened} Need anything else?`;
}
