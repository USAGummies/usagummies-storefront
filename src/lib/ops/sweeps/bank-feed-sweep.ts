/** bank-feed-sweep — DISABLED runtime, live dedup helpers for tests/control-plane. */

export type BankFeedSweepSignatureInput = {
  total: number;
  highConfidence: number;
  lowConfidence: number;
  applied: number;
  investorTransfers: number;
};

export function buildBankFeedSweepSignature(
  result: BankFeedSweepSignatureInput,
  executeErrors: number,
): string {
  return JSON.stringify({
    lowConfidence: result.lowConfidence,
    investorTransfers: result.investorTransfers,
    executeErrors,
  });
}

export function shouldPostBankFeedSweepUpdate(
  previous: { date: string; signature: string } | null | undefined,
  currentDate: string,
  currentSignature: string,
): boolean {
  if (!previous) return true;
  if (previous.date !== currentDate) return true;
  return previous.signature !== currentSignature;
}

const bankFeedSweep = {};
export default bankFeedSweep;
