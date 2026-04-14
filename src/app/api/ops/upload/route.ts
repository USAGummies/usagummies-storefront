/**
 * File Upload API — /api/ops/upload
 *
 * POST — Upload a file (NCS form, trade show docs, etc.)
 * Stores to local filesystem (or cloud storage later) and notifies Slack.
 *
 * Body: multipart/form-data
 *   - file: the uploaded file
 *   - customer_name: customer name (for filing)
 *   - form_type: "ncs" | "cif" | "booth" | "other"
 *   - notes: optional notes
 */

import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const customerName = (formData.get("customer_name") as string || "unknown").trim();
    const formType = (formData.get("form_type") as string || "ncs").trim();
    const notes = (formData.get("notes") as string || "").trim();

    if (!file || file.size === 0) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = [
      "application/pdf",
      "image/png", "image/jpeg", "image/jpg", "image/heic",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "File type not allowed. Please upload PDF, image, or Word document." },
        { status: 400 },
      );
    }

    // Max 10MB
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large. Maximum 10MB." }, { status: 400 });
    }

    // Create upload directory
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = customerName.replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_");
    const ext = path.extname(file.name) || ".pdf";
    const fileName = `${formType.toUpperCase()}-001_${safeName}_${dateStr}${ext}`;
    const uploadPath = path.join(UPLOAD_DIR, formType);

    await mkdir(uploadPath, { recursive: true });

    const bytes = await file.arrayBuffer();
    const fullPath = path.join(uploadPath, fileName);
    await writeFile(fullPath, Buffer.from(bytes));

    // Notify via webhook if configured
    const webhookUrl = process.env.SLACK_SUPPORT_WEBHOOK_URL;
    if (webhookUrl) {
      const slackMsg = {
        text: `📎 *New ${formType.toUpperCase()} Upload*\n• Customer: ${customerName}\n• File: ${fileName} (${(file.size / 1024).toFixed(1)} KB)\n• Notes: ${notes || "None"}\n• Time: ${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}`,
      };
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slackMsg),
      }).catch(() => { /* best effort */ });
    }

    return NextResponse.json({
      ok: true,
      fileName,
      size: file.size,
      customer: customerName,
      formType,
      message: `File uploaded successfully. We'll process it shortly.`,
    });
  } catch (error) {
    console.error("[upload] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
