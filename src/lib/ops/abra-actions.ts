/** abra-actions — DISABLED stub. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function isReneInvestorTransfer(..._a: any[]): boolean { return false; }
export function qboCategorize(..._a: any[]): { accountId: number; accountName: string } | null { return null; }
export const QBO_CATEGORIZATION_RULES: unknown[] = [];
export async function executeAction(..._a: any[]): Promise<{ ok: boolean; success: boolean; message: string }> { return { ok: false, success: false, message: "Disabled" }; }
export async function proposeAction(..._a: any[]): Promise<any> { return null; }
export async function executeActionByType(..._a: any[]): Promise<any> { return { ok: false }; }
export function requiresExplicitPermission(..._a: any[]): boolean { return true; }
export async function proposeAndMaybeExecute(..._a: any[]): Promise<any> { return null; }
export type AbraAction = any;
export type ActionResult = any;
