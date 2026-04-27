/**
 * Vendor portal registry — Phase 31.2.a.
 *
 * Hand-curated registry of the vendors who can use the external
 * portal. The HMAC token primitive (Phase 31.2 / `vendor-portal-
 * token.ts`) only validates that a `vendorId` is well-formed kebab
 * case — it does NOT check that the id corresponds to a real vendor.
 * That's this module's job: the registry maps `vendorId` → vendor
 * metadata (display name, Drive folder for COIs, default email).
 *
 * **Why a hand-curated manifest** (vs reading from QBO or Notion):
 *   - Explicit registration step. Adding a vendor here is a
 *     deliberate operator action with a paper trail in git.
 *   - No drift between the portal's auth boundary and the canonical
 *     vendor list — the boundary IS this file.
 *   - Empty by default. We never fabricate vendor metadata; the
 *     issue route refuses to mint a token for an unregistered
 *     vendorId.
 *
 * **Convention when adding an entry:**
 *   1. Use a stable kebab-case id matching the HMAC primitive's
 *      validator (`/^[a-z0-9][a-z0-9-]*$/`).
 *   2. `displayName` is what the vendor sees on the portal page.
 *   3. `coiDriveFolderId` is the Google Drive folder ID where
 *      uploaded COIs land. Populate when the folder exists; before
 *      that, the upload route will refuse with a clear "destination
 *      not configured" error (fail-loud).
 *   4. `defaultEmail` is where the issue route sends the URL by
 *      default. Operator can override per-issue.
 *   5. Once you commit a vendor here, treat the id as immutable —
 *      changing it would invalidate any tokens already issued.
 *
 * Pure — no I/O.
 */

export interface VendorPortalEntry {
  /** Stable kebab-case id; matches the HMAC primitive's validator. */
  vendorId: string;
  /** Vendor display name (shown on the portal page + in audit). */
  displayName: string;
  /** Google Drive folder ID for COI uploads. null when not yet set up. */
  coiDriveFolderId: string | null;
  /** Default email recipient when the issue route sends the URL. */
  defaultEmail: string | null;
  /** Optional operator notes. */
  notes?: string;
}

/**
 * Live registry. **Empty by default — Ben drops in real vendors as
 * they're onboarded to the portal.** Adding entries here is the
 * registration step; the issue route + public page consume from
 * here.
 */
export const VENDOR_PORTAL_REGISTRY: readonly VendorPortalEntry[] = [] as const;

/**
 * Look up a registry entry by vendorId. Returns null when the id is
 * not registered. Pure.
 *
 * Callers MUST check the return value — the issue route refuses to
 * mint a token for an unregistered vendor (otherwise an attacker
 * who guessed a kebab-case string could potentially get tokens for
 * arbitrary vendor ids).
 */
export function getVendorPortalEntry(
  vendorId: string,
  registry: readonly VendorPortalEntry[] = VENDOR_PORTAL_REGISTRY,
): VendorPortalEntry | null {
  if (!vendorId) return null;
  for (const e of registry) {
    if (e.vendorId === vendorId) return e;
  }
  return null;
}

/** List all registered vendor ids. Pure. */
export function listVendorPortalIds(
  registry: readonly VendorPortalEntry[] = VENDOR_PORTAL_REGISTRY,
): string[] {
  return registry.map((e) => e.vendorId);
}
