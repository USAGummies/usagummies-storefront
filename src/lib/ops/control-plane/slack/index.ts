/**
 * Slack surfaces for the 3.0 control plane.
 *
 * Degraded mode: if SLACK_BOT_TOKEN is absent, all posts no-op and
 * return gracefully. Store state is authoritative.
 *
 * Canonical spec: /contracts/slack-operating.md + blueprint §15.4 T5c.
 */

import type { ApprovalSlackSurface } from "../approvals";
import type { AuditSlackSurface } from "../audit";

import { ApprovalSurface } from "./approval-surface";
import { AuditSurface } from "./audit-surface";

let approvalSurfaceRef: ApprovalSlackSurface | null = null;
let auditSurfaceRef: AuditSlackSurface | null = null;

export function approvalSurface(): ApprovalSlackSurface {
  if (approvalSurfaceRef) return approvalSurfaceRef;
  approvalSurfaceRef = new ApprovalSurface();
  return approvalSurfaceRef;
}

export function auditSurface(): AuditSlackSurface {
  if (auditSurfaceRef) return auditSurfaceRef;
  auditSurfaceRef = new AuditSurface();
  return auditSurfaceRef;
}

export function __setSurfacesForTest(opts: {
  approval?: ApprovalSlackSurface;
  audit?: AuditSlackSurface;
}): void {
  if (opts.approval) approvalSurfaceRef = opts.approval;
  if (opts.audit) auditSurfaceRef = opts.audit;
}

export function __resetSurfaces(): void {
  approvalSurfaceRef = null;
  auditSurfaceRef = null;
}

export { ApprovalSurface, AuditSurface };
export {
  postMessage,
  updateMessage,
  verifySlackSignature,
  slackUserIdToHumanOwner,
  conversationsHistory,
} from "./client";
export type { SlackResult, SlackHistoryMessage, SlackHistoryResult } from "./client";
