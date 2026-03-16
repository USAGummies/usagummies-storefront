/**
 * POST /api/ops/abra/sms — Twilio SMS webhook for Abra
 *
 * Handles incoming SMS:
 * - "approve <cmd-id>" — approve a pending email command
 * - "deny <cmd-id>" — deny a pending command
 * - "commands" — list pending commands
 * - "status" — get system status
 * - Anything else — forward to Abra chat for a response
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Known phone numbers that can interact with Abra
const ALLOWED_PHONES = new Set([
  process.env.ABRA_OWNER_PHONE || "+14358967765", // Ben
  process.env.ABRA_SECONDARY_PHONE || "+16102356973", // Secondary
]);

function twimlResponse(message: string): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(message)}</Message>
</Response>`;
  return new Response(xml, {
    headers: { "Content-Type": "text/xml" },
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sbHeaders() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
}

function sbUrl() {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
}

function hostUrl() {
  return (
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:4000")
  );
}

export async function POST(req: Request) {
  const bodyText = await req.text();
  const params = new URLSearchParams(bodyText);

  const from = params.get("From") || "";
  const body = (params.get("Body") || "").trim();
  const messageSid = params.get("MessageSid") || "";

  console.log(
    `[abra-sms] Incoming from ${from} (${messageSid}): ${body.slice(0, 100)}`,
  );

  // Auth: only allowed phones
  if (!ALLOWED_PHONES.has(from)) {
    console.log(`[abra-sms] Rejected — ${from} not in allowed list`);
    return twimlResponse("This number is not authorized to use Abra.");
  }

  if (!body) {
    return twimlResponse(
      "Send a message to interact with Abra. Try: commands, status, or ask a question.",
    );
  }

  const lower = body.toLowerCase();

  // Handle approve/deny commands
  const approveMatch = lower.match(
    /^(?:approve|yes|y)\s+(cmd-[\w-]+)$/i,
  );
  const denyMatch = lower.match(/^(?:deny|no|n)\s+(cmd-[\w-]+)$/i);
  const sendReplyMatch = lower.match(
    /^(?:send|sendreply)\s+(cmd-[\w-]+)$/i,
  );

  if (approveMatch || denyMatch) {
    const commandId = (approveMatch || denyMatch)![1];
    const decision = approveMatch ? "approved" : "denied";

    try {
      // Fetch the command
      const cmdRes = await fetch(
        `${sbUrl()}/rest/v1/abra_email_commands?id=eq.${encodeURIComponent(commandId)}&select=*&limit=1`,
        { headers: sbHeaders(), signal: AbortSignal.timeout(10000) },
      );
      if (!cmdRes.ok)
        return twimlResponse(`Error fetching command ${commandId}`);
      const cmds = await cmdRes.json();
      if (cmds.length === 0)
        return twimlResponse(`Command ${commandId} not found.`);

      const cmd = cmds[0];
      if (
        cmd.status !== "pending_approval" &&
        cmd.status !== "draft_reply_pending"
      ) {
        return twimlResponse(
          `Command ${commandId} is already ${cmd.status}.`,
        );
      }

      // Update status
      const newStatus =
        decision === "approved"
          ? cmd.status === "draft_reply_pending"
            ? "reply_approved"
            : "approved"
          : "denied";

      await fetch(
        `${sbUrl()}/rest/v1/abra_email_commands?id=eq.${encodeURIComponent(commandId)}&status=eq.${encodeURIComponent(cmd.status)}`,
        {
          method: "PATCH",
          headers: { ...sbHeaders(), Prefer: "return=minimal" },
          body: JSON.stringify({
            status: newStatus,
            decided_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
          signal: AbortSignal.timeout(10000),
        },
      );

      if (decision === "approved" && cmd.status === "pending_approval") {
        // Trigger execution via internal API
        fetch(`${hostUrl()}/api/ops/abra/execute-command`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.CRON_SECRET?.trim() || ""}`,
          },
          body: JSON.stringify({ commandId }),
          signal: AbortSignal.timeout(5000),
        }).catch(() => {}); // Fire and forget
      }

      return twimlResponse(
        `${decision === "approved" ? "\u2705" : "\u274C"} ${decision.toUpperCase()}: ${cmd.task.slice(0, 100)}`,
      );
    } catch (err) {
      return twimlResponse(
        `Error: ${err instanceof Error ? err.message : "Unknown"}`,
      );
    }
  }

  // Handle "commands" — list pending
  if (lower === "commands" || lower === "pending" || lower === "list") {
    try {
      const res = await fetch(
        `${sbUrl()}/rest/v1/abra_email_commands?status=in.(pending_approval,draft_reply_pending)&order=created_at.desc&limit=5&select=id,status,sender_name,task`,
        { headers: sbHeaders(), signal: AbortSignal.timeout(10000) },
      );
      if (!res.ok) return twimlResponse("Error fetching commands.");
      const cmds = await res.json();
      if (cmds.length === 0) return twimlResponse("No pending commands.");

      const lines = cmds.map((c: Record<string, string>) => {
        const action =
          c.status === "pending_approval"
            ? "Reply: approve"
            : "Reply: send";
        return `${c.id}\n${c.sender_name}: ${c.task.slice(0, 60)}\n${action} ${c.id}`;
      });
      return twimlResponse(
        `Pending (${cmds.length}):\n\n${lines.join("\n\n")}`,
      );
    } catch {
      return twimlResponse("Error fetching commands.");
    }
  }

  // Handle "status"
  if (lower === "status" || lower === "health") {
    return twimlResponse(
      "Abra is online. Text 'commands' to see pending items, or ask me anything.",
    );
  }

  // Handle sendreply
  if (sendReplyMatch) {
    const commandId = sendReplyMatch[1];
    try {
      const res = await fetch(`${hostUrl()}/api/ops/abra/sms-sendreply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.CRON_SECRET?.trim() || ""}`,
        },
        body: JSON.stringify({ commandId }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        return twimlResponse(
          `\uD83D\uDCE7 Reply sent for ${commandId}`,
        );
      } else {
        const err = await res.text().catch(() => "");
        return twimlResponse(
          `Failed to send reply: ${err.slice(0, 100)}`,
        );
      }
    } catch {
      return twimlResponse("Error sending reply.");
    }
  }

  // Default: forward to Abra chat
  try {
    const chatRes = await fetch(`${hostUrl()}/api/ops/abra/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CRON_SECRET?.trim() || ""}`,
      },
      body: JSON.stringify({
        message: body,
        channel: "sms",
        user: from,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!chatRes.ok) {
      return twimlResponse(
        "Abra is having trouble right now. Try again in a minute.",
      );
    }

    const chatData = await chatRes.json();
    const reply =
      chatData.reply ||
      chatData.message ||
      chatData.response ||
      "No response from Abra.";

    // SMS has 1600 char limit
    return twimlResponse(reply.slice(0, 1500));
  } catch {
    return twimlResponse(
      "Abra is having trouble right now. Try again in a minute.",
    );
  }
}
