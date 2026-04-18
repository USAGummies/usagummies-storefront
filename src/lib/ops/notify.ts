/**
 * @deprecated 2026-04-17 — was the Slack/SMS/iMessage fan-out layer for Abra.
 *
 * Replaced by:
 *   - approval surfacing: src/lib/ops/control-plane/approvals.ts (ApprovalSlackSurface)
 *   - audit mirroring: src/lib/ops/control-plane/audit.ts (AuditSlackSurface)
 *   - alert posting: to be implemented under src/lib/ops/control-plane/slack/
 *
 * See /contracts/slack-operating.md for the canonical Slack contract and
 * /contracts/approval-taxonomy.md for what can be posted autonomously vs gated.
 *
 * This file is kept as an inert stub so existing imports do not break.
 * All functions return falsy so no notifications fire. Once all callers
 * migrate to the control plane, delete this file.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type NotifyChannel = "slack" | "sms" | "imessage";
export type NotifyOpts = any;
export async function notify(_opts: any): Promise<any> { return { slack: false, sms: false, imessage: false }; }
export async function notifyAlert(_text: string, ..._rest: any[]): Promise<boolean> { return false; }
export async function notifyPipeline(_text: string): Promise<boolean> { return false; }
export async function notifyDaily(_text: string): Promise<boolean> { return false; }
export async function textBen(_text: string): Promise<boolean> { return false; }
