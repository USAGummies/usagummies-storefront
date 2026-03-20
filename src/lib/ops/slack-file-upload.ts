/**
 * Slack File Upload — USA Gummies
 *
 * Generates and uploads files (CSV, XLSX) to Slack channels.
 * All file generation happens in memory (no disk I/O) for serverless compatibility.
 *
 * Requires OAuth scope: files:write (add to Slack app + reinstall)
 * Env var: SLACK_BOT_TOKEN
 */

import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileFormat = "csv" | "xlsx";

export type SlackFileUploadResult = {
  ok: boolean;
  fileId?: string;
  permalink?: string;
  error?: string;
};

export type SpreadsheetData = {
  /** Sheet name (for XLSX; ignored for CSV) */
  sheetName?: string;
  /** Column headers */
  headers: string[];
  /** Row data — each row is an array of cell values */
  rows: (string | number | boolean | null)[][];
};

// ---------------------------------------------------------------------------
// File Generation (in-memory)
// ---------------------------------------------------------------------------

/** Generate CSV string from structured data */
export function generateCsv(data: SpreadsheetData): string {
  const escape = (value: unknown): string => {
    const str = String(value ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [
    data.headers.map(escape).join(","),
    ...data.rows.map((row) => row.map(escape).join(",")),
  ];
  return lines.join("\n");
}

/** Generate XLSX Buffer from structured data (supports multiple sheets) */
export function generateXlsx(
  sheets: SpreadsheetData[],
): Buffer {
  const workbook = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const wsData = [sheet.headers, ...sheet.rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Auto-size columns based on content
    const colWidths = sheet.headers.map((h, i) => {
      const maxLen = Math.max(
        h.length,
        ...sheet.rows.map((r) => String(r[i] ?? "").length),
      );
      return { wch: Math.min(maxLen + 2, 50) };
    });
    ws["!cols"] = colWidths;

    XLSX.utils.book_append_sheet(
      workbook,
      ws,
      (sheet.sheetName || `Sheet${sheets.indexOf(sheet) + 1}`).slice(0, 31),
    );
  }

  const buf = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(buf);
}

// ---------------------------------------------------------------------------
// Slack Upload
// ---------------------------------------------------------------------------

/**
 * Upload a file to a Slack channel.
 *
 * Uses the files.upload API (v1) which accepts file data directly.
 * Generates files in memory — no disk I/O.
 */
export async function uploadFileToSlack(opts: {
  channelId: string;
  filename: string;
  title?: string;
  comment?: string;
  threadTs?: string;
  data: SpreadsheetData | SpreadsheetData[];
  format?: FileFormat;
}): Promise<SlackFileUploadResult> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return { ok: false, error: "SLACK_BOT_TOKEN not configured" };
  }

  const format = opts.format || (opts.filename.endsWith(".xlsx") ? "xlsx" : "csv");
  const sheets = Array.isArray(opts.data) ? opts.data : [opts.data];

  let fileBuffer: Buffer;
  let mimeType: string;

  if (format === "xlsx") {
    fileBuffer = generateXlsx(sheets);
    mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  } else {
    const csvStr = generateCsv(sheets[0]);
    fileBuffer = Buffer.from(csvStr, "utf-8");
    mimeType = "text/csv";
  }

  // Use files.getUploadURLExternal + files.completeUploadExternal (v2 method)
  // This is more reliable in serverless environments than the legacy files.upload
  try {
    // Step 1: Get upload URL
    const urlRes = await fetch("https://slack.com/api/files.getUploadURLExternal", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        filename: opts.filename,
        length: String(fileBuffer.byteLength),
      }).toString(),
      signal: AbortSignal.timeout(10000),
    });

    const urlData = (await urlRes.json()) as {
      ok: boolean;
      upload_url?: string;
      file_id?: string;
      error?: string;
    };

    if (!urlData.ok || !urlData.upload_url || !urlData.file_id) {
      return { ok: false, error: `getUploadURL failed: ${urlData.error || "unknown"}` };
    }

    // Step 2: Upload file content to the presigned URL
    const uploadRes = await fetch(urlData.upload_url, {
      method: "POST",
      headers: { "Content-Type": mimeType },
      body: new Uint8Array(fileBuffer),
      signal: AbortSignal.timeout(15000),
    });

    if (!uploadRes.ok) {
      return { ok: false, error: `Upload failed: HTTP ${uploadRes.status}` };
    }

    // Step 3: Complete the upload (attach to channel/thread)
    const completePayload: Record<string, unknown> = {
      files: [{ id: urlData.file_id, title: opts.title || opts.filename }],
      channel_id: opts.channelId,
    };
    if (opts.comment) {
      completePayload.initial_comment = opts.comment;
    }
    if (opts.threadTs) {
      completePayload.thread_ts = opts.threadTs;
    }

    const completeRes = await fetch(
      "https://slack.com/api/files.completeUploadExternal",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(completePayload),
        signal: AbortSignal.timeout(10000),
      },
    );

    const completeData = (await completeRes.json()) as {
      ok: boolean;
      files?: Array<{ id: string; permalink?: string }>;
      error?: string;
    };

    if (!completeData.ok) {
      return { ok: false, error: `completeUpload failed: ${completeData.error || "unknown"}` };
    }

    const file = completeData.files?.[0];
    return {
      ok: true,
      fileId: file?.id || urlData.file_id,
      permalink: file?.permalink,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Upload error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Convenience Helpers
// ---------------------------------------------------------------------------

/** Upload a simple table as a CSV file to a Slack thread */
export async function uploadCsvToThread(
  channelId: string,
  threadTs: string,
  filename: string,
  headers: string[],
  rows: (string | number | boolean | null)[][],
  comment?: string,
): Promise<SlackFileUploadResult> {
  return uploadFileToSlack({
    channelId,
    threadTs,
    filename,
    format: "csv",
    data: { headers, rows },
    comment,
  });
}

/** Upload a multi-sheet XLSX workbook to a Slack thread */
export async function uploadXlsxToThread(
  channelId: string,
  threadTs: string,
  filename: string,
  sheets: SpreadsheetData[],
  comment?: string,
): Promise<SlackFileUploadResult> {
  return uploadFileToSlack({
    channelId,
    threadTs,
    filename,
    format: "xlsx",
    title: filename.replace(/\.xlsx$/, ""),
    data: sheets,
    comment,
  });
}
