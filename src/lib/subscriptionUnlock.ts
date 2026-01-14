export const PURCHASE_UNLOCK_STORAGE_KEY = "usa_has_purchased";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function getPurchaseUnlocked() {
  if (!canUseStorage()) return false;
  try {
    return window.localStorage.getItem(PURCHASE_UNLOCK_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPurchaseUnlocked(value = true) {
  if (!canUseStorage()) return;
  try {
    if (value) {
      window.localStorage.setItem(PURCHASE_UNLOCK_STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(PURCHASE_UNLOCK_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export function applyPurchaseUnlockFromUrl(params = ["unlock", "purchased", "purchase"]) {
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(window.location.href);
    let unlocked = false;
    for (const key of params) {
      const raw = url.searchParams.get(key);
      if (!raw) continue;
      const normalized = raw.toLowerCase();
      const truthy = normalized === "1" || normalized === "true" || normalized === "yes";
      if (truthy) {
        setPurchaseUnlocked(true);
        unlocked = true;
      }
      url.searchParams.delete(key);
    }
    if (unlocked) {
      window.history.replaceState({}, "", url.toString());
    }
    return unlocked;
  } catch {
    return false;
  }
}
