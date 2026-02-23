/**
 * USA Gummies — Operations Library
 *
 * Barrel export for all cloud-compatible operations modules.
 * Import from "@/lib/ops" in API routes and engine modules.
 */

// State persistence (KV on Vercel, filesystem locally)
export {
  isCloud,
  readState,
  writeState,
  readStateText,
  readStateTail,
  readStateArray,
  readStateObject,
  appendStateArray,
} from "./state";

export type { StateKey } from "./state-keys";

// Email sending (nodemailer SMTP)
export { sendOpsEmail } from "./email";
export type { SendEmailOpts, SendEmailResult } from "./email";

// Gmail inbox reading (Google API)
export { listEmails, readEmail, searchEmails } from "./gmail-reader";
export type { EmailEnvelope, EmailMessage, ListEmailsOpts } from "./gmail-reader";

// Notifications (Slack + SMS + iMessage fallback)
export {
  notify,
  notifyAlert,
  notifyPipeline,
  notifyDaily,
  textBen,
} from "./notify";
export type { NotifyChannel, NotifyOpts } from "./notify";
