export async function listPurchaseOrders(_statuses?: string[]) {
  return [];
}

export async function getPurchaseOrderByNumber(_poNumber: string) {
  return null;
}

export async function getPurchaseOrderSummary(_poNumber: string) {
  return null;
}

export async function shipPO(_input: unknown) {
  throw new Error("PO pipeline compatibility shim is not wired to production.");
}

export async function markDelivered(_input: unknown) {
  throw new Error("PO pipeline compatibility shim is not wired to production.");
}

export async function matchPayment(_input: unknown) {
  throw new Error("PO pipeline compatibility shim is not wired to production.");
}

export async function closePO(_input: unknown) {
  throw new Error("PO pipeline compatibility shim is not wired to production.");
}
