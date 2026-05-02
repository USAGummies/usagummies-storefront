/**
 * I/O boundary for shipping-today: fetches retry queue + pending
 * shipping approvals + ShipStation wallet balances. Each source is
 * independently fail-soft — wallet read failures show up as
 * `balanceUsd: null` so the aggregator surfaces them as yellow, not
 * silent zeros.
 */
import { approvalStore } from "./control-plane/stores";
import { readRetryQueue, type DispatchRetryEntry } from "./dispatch-retry-queue";
import {
  getShipStationWalletBalance,
  isShipStationConfigured,
} from "./shipstation-client";
import type { ApprovalRequest } from "./control-plane/types";
import type { ShippingWalletBalance } from "./shipping-today";

export interface FetchShippingTodayResult {
  retryQueue: DispatchRetryEntry[];
  pendingApprovals: ApprovalRequest[];
  wallet: ShippingWalletBalance[];
  degraded: string[];
}

const WALLET_CARRIERS = ["stamps_com", "ups_walleted"] as const;

export async function fetchShippingTodayInputs(): Promise<FetchShippingTodayResult> {
  const degraded: string[] = [];

  let retryQueue: DispatchRetryEntry[] = [];
  try {
    retryQueue = await readRetryQueue();
  } catch (err) {
    degraded.push(
      `retry-queue:${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let pendingApprovals: ApprovalRequest[] = [];
  try {
    pendingApprovals = await approvalStore().listPending();
  } catch (err) {
    degraded.push(
      `approvals:${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const wallet: ShippingWalletBalance[] = [];
  if (isShipStationConfigured()) {
    for (const carrierCode of WALLET_CARRIERS) {
      try {
        const r = await getShipStationWalletBalance(carrierCode);
        // Defensive: handle any return shape — getShipStationWalletBalance
        // returns { balance: number; ... } when ok, or throws on error.
        const balanceUsd =
          typeof (r as { balance?: number })?.balance === "number"
            ? (r as { balance: number }).balance
            : null;
        wallet.push({
          carrierCode,
          balanceUsd,
          fetchError:
            balanceUsd === null
              ? (r as { error?: string })?.error ?? "unparseable"
              : undefined,
        });
        if (balanceUsd === null) {
          degraded.push(`wallet:${carrierCode}:no-balance`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        wallet.push({
          carrierCode,
          balanceUsd: null,
          fetchError: msg,
        });
        degraded.push(`wallet:${carrierCode}:${msg}`);
      }
    }
  }

  return { retryQueue, pendingApprovals, wallet, degraded };
}
