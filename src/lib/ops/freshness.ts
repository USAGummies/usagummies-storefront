export const STALE_MINUTES = 60;
export const CRITICAL_MINUTES = 6 * 60;

export type FreshnessStatus = "fresh" | "stale" | "critical" | "missing";

export type FreshnessMeta = {
  status: FreshnessStatus;
  ageMinutes: number | null;
  timestamp: string | null;
};

export function freshnessFromTimestamp(
  timestamp: string | null | undefined,
  nowMs = Date.now(),
): FreshnessMeta {
  if (!timestamp) {
    return {
      status: "missing",
      ageMinutes: null,
      timestamp: null,
    };
  }

  const ts = Date.parse(timestamp);
  if (Number.isNaN(ts)) {
    return {
      status: "missing",
      ageMinutes: null,
      timestamp: null,
    };
  }

  const ageMinutes = Math.max(0, Math.round((nowMs - ts) / 60000));
  if (ageMinutes > CRITICAL_MINUTES) {
    return { status: "critical", ageMinutes, timestamp };
  }
  if (ageMinutes > STALE_MINUTES) {
    return { status: "stale", ageMinutes, timestamp };
  }
  return { status: "fresh", ageMinutes, timestamp };
}

