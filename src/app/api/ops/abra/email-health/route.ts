/**
 * GET /api/ops/abra/email-health — Diagnose Gmail API send capability
 * POST /api/ops/abra/email-health — Send a test email and report which method was used
 *
 * Auth: CRON_SECRET bearer token
 */

import { NextResponse } from "next/server";
import { sendViaGmailApi } from "@/lib/ops/gmail-reader";
import { sendOpsEmail } from "@/lib/ops/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function checkAuth(req: Request): boolean {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  return Boolean(cronSecret && token === cronSecret);
}

export async function GET(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checks = {
    GMAIL_OAUTH_CLIENT_ID: Boolean(process.env.GMAIL_OAUTH_CLIENT_ID),
    GCP_GMAIL_OAUTH_CLIENT_ID: Boolean(process.env.GCP_GMAIL_OAUTH_CLIENT_ID),
    GMAIL_OAUTH_CLIENT_SECRET: Boolean(process.env.GMAIL_OAUTH_CLIENT_SECRET),
    GCP_GMAIL_OAUTH_CLIENT_SECRET: Boolean(process.env.GCP_GMAIL_OAUTH_CLIENT_SECRET),
    GMAIL_OAUTH_REFRESH_TOKEN: Boolean(process.env.GMAIL_OAUTH_REFRESH_TOKEN),
    GCP_GMAIL_OAUTH_REFRESH_TOKEN: Boolean(process.env.GCP_GMAIL_OAUTH_REFRESH_TOKEN),
    GMAIL_SERVICE_ACCOUNT_JSON: Boolean(process.env.GMAIL_SERVICE_ACCOUNT_JSON),
    GMAIL_APP_PASSWORD: Boolean(process.env.GMAIL_APP_PASSWORD),
    SMTP_PASS: Boolean(process.env.SMTP_PASS),
    SMTP_HOST: Boolean(process.env.SMTP_HOST),
  };

  const hasOAuth = (checks.GMAIL_OAUTH_CLIENT_ID || checks.GCP_GMAIL_OAUTH_CLIENT_ID) &&
    (checks.GMAIL_OAUTH_CLIENT_SECRET || checks.GCP_GMAIL_OAUTH_CLIENT_SECRET) &&
    (checks.GMAIL_OAUTH_REFRESH_TOKEN || checks.GCP_GMAIL_OAUTH_REFRESH_TOKEN);

  const hasSA = checks.GMAIL_SERVICE_ACCOUNT_JSON;
  const hasSMTP = checks.GMAIL_APP_PASSWORD || checks.SMTP_PASS;

  return NextResponse.json({
    gmail_api_available: hasOAuth || hasSA,
    gmail_oauth: hasOAuth,
    gmail_service_account: hasSA,
    smtp_fallback: hasSMTP,
    preferred_method: hasOAuth ? "Gmail API (OAuth2)" : hasSA ? "Gmail API (Service Account)" : hasSMTP ? "SMTP (no Sent folder)" : "NONE",
    env_vars: checks,
  });
}

export async function POST(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { to } = (await req.json().catch(() => ({}))) as { to?: string };
  const recipient = to || "ben@usagummies.com";

  // Step 1: Try Gmail API directly
  const gmailApiResult = await sendViaGmailApi({
    to: recipient,
    subject: `[Abra Health Check] Gmail API send test — ${new Date().toISOString()}`,
    body: `This is an automated health check from Abra's email system.\n\nIf you received this, the Gmail API send is working correctly and emails appear in your Sent folder.\n\nTimestamp: ${new Date().toISOString()}`,
  });

  if (gmailApiResult) {
    return NextResponse.json({
      ok: true,
      method: "Gmail API",
      saved_to_sent: true,
      message: `Test email sent to ${recipient} via Gmail API — check Sent folder`,
    });
  }

  // Step 2: If Gmail API failed, try full sendOpsEmail (which includes SMTP fallback)
  const opsResult = await sendOpsEmail({
    to: recipient,
    subject: `[Abra Health Check] SMTP fallback test — ${new Date().toISOString()}`,
    body: `This is an automated health check from Abra's email system.\n\nWARNING: This email was sent via SMTP, NOT the Gmail API. It will NOT appear in your Sent folder.\n\nThe Gmail API send failed. Check Vercel logs for details.\n\nTimestamp: ${new Date().toISOString()}`,
  });

  return NextResponse.json({
    ok: opsResult.ok,
    method: "SMTP (fallback)",
    saved_to_sent: false,
    gmail_api_failed: true,
    warning: "Gmail API send failed — email sent via SMTP but will NOT appear in Sent folder",
    smtp_result: opsResult.message,
  });
}
