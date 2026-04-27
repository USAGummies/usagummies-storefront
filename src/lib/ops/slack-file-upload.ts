/**
 * Slack File Upload — USA Gummies
 *
 * Generates and uploads files (CSV, XLSX) to Slack channels.
 * All file generation happens in memory (no disk I/O) for serverless compatibility.
 *
 * XLSX generation uses exceljs for full formatting support (fonts, colors, borders,
 * number formats, frozen panes, auto-filters). The xlsx library is kept for reading only.
 *
 * Requires OAuth scope: files:write (add to Slack app + reinstall)
 * Env var: SLACK_BOT_TOKEN
 */

import ExcelJS from "exceljs";
import { kv } from "@vercel/kv";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileFormat = "csv" | "xlsx";

export type SlackFileUploadResult = {
  ok: boolean;
  fileId?: string;
  permalink?: string;
  /**
   * Phase 27 — Slack `message_ts` of the parent file post. Lets the
   * caller thread follow-up files (e.g. packing slip under the
   * label). Parsed from `permalink` since
   * `files.completeUploadExternal` doesn't return the parent
   * message ts directly. `undefined` when permalink is missing or
   * not parseable.
   */
  messageTs?: string;
  error?: string;
  skipped?: boolean;
};

/**
 * Phase 27 — extract the Slack `message_ts` from a permalink.
 * Slack permalinks are formatted as `…/archives/<channel>/p<digits>`
 * where `<digits>` is the message_ts with the decimal removed (last
 * 6 digits are microseconds). Returns `undefined` on any unparseable
 * input (defensive — never fabricates a ts).
 */
export function permalinkToMessageTs(
  permalink: string | undefined,
): string | undefined {
  if (typeof permalink !== "string" || permalink.length === 0) return undefined;
  const m = permalink.match(/\/p(\d+)(?:\?|$|#)/);
  if (!m) return undefined;
  const digits = m[1];
  if (digits.length < 7) return undefined;
  return `${digits.slice(0, -6)}.${digits.slice(-6)}`;
}

export type SpreadsheetData = {
  /** Sheet name (for XLSX; ignored for CSV) */
  sheetName?: string;
  /** Column headers */
  headers: string[];
  /** Row data — each row is an array of cell values */
  rows: (string | number | boolean | null)[][];
};

type SlackHistoryMessage = {
  ts?: string;
  files?: Array<{
    id?: string;
    name?: string;
    title?: string;
    permalink?: string;
  }>;
};

const recentUploadFallback = new Map<string, { permalink?: string; expiresAt: number }>();

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F4E79" }, // dark blue
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" }, // white
  size: 11,
};

const ROW_FILL_LIGHT: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF2F2F2" }, // light gray
};

const ROW_FILL_WHITE: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFFFFF" }, // white
};

const THIN_BORDER: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFD0D0D0" } };

const CELL_BORDER: Partial<ExcelJS.Borders> = {
  top: THIN_BORDER,
  left: THIN_BORDER,
  bottom: THIN_BORDER,
  right: THIN_BORDER,
};

/** Infer Excel number format string from header label */
/**
 * After `files.completeUploadExternal` succeeds, query
 * `conversations.history` for the channel-message that carries our
 * just-uploaded file and return its `ts`. This is the message-ts
 * downstream callers need to thread replies under (Phase 28a's
 * packing-slip thread reply, dispatch confirmations, etc.).
 *
 * Why this exists: `files.completeUploadExternal` returns
 * `file.permalink` shaped as `…/files/<userId>/<fileId>/<filename>`,
 * NOT the channel-message permalink `…/archives/<channel>/p<digits>`.
 * `permalinkToMessageTs` parses the latter shape only, so for live
 * uploads it always returned undefined — silently breaking every
 * downstream "thread under the upload" path.
 *
 * Implementation: we already have `channels:history`, not `files:read`,
 * so `conversations.history` is the cheaper scope. Bounded scan: 50
 * most-recent messages in the channel. The file just landed; if it's
 * older than 50 messages something's gone very wrong upstream and
 * threading under it isn't the priority anyway.
 *
 * Fail-soft: any error / no match → return undefined. Callers fall
 * back to the (always-undefined) `permalinkToMessageTs(file.permalink)`
 * and the thread-reply branch becomes a no-op, which is the
 * pre-fix behavior. We do NOT reject the upload result — the file
 * already landed in Slack.
 */
async function resolveChannelMessageTs(opts: {
  token: string;
  channelId: string;
  fileId: string;
}): Promise<string | undefined> {
  if (!opts.fileId) return undefined;
  try {
    const url =
      `https://slack.com/api/conversations.history?channel=${encodeURIComponent(opts.channelId)}&limit=50`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${opts.token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      ok: boolean;
      messages?: Array<{
        ts?: string;
        files?: Array<{ id?: string }>;
      }>;
    };
    if (!data.ok || !Array.isArray(data.messages)) return undefined;
    for (const msg of data.messages) {
      if (!msg.ts || !Array.isArray(msg.files)) continue;
      for (const f of msg.files) {
        if (f?.id === opts.fileId) {
          return msg.ts;
        }
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function inferNumFmt(header: string): string | null {
  const h = header.toLowerCase();
  if (/\bpercent\b|%/.test(h)) return "0.00%";
  if (/price|cost|amount|revenue|sales|total|fee|balance|pay|earn|budget|spend|margin/.test(h)) return '"$"#,##0.00';
  return null;
}

/** Whether a column header suggests date values */
function isDateHeader(header: string): boolean {
  return /\bdate\b|\bcreated\b|\bupdated\b|\btime\b|\bdue\b|\bstart\b|\bend\b/.test(header.toLowerCase());
}

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

/** Generate professionally formatted XLSX Buffer (supports multiple sheets) */
export async function generateXlsx(sheets: SpreadsheetData[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Abra / USA Gummies";
  workbook.created = new Date();

  for (let si = 0; si < sheets.length; si++) {
    const sheet = sheets[si];
    const rawName = sheet.sheetName || `Sheet${si + 1}`;
    // Sheet names: max 31 chars, no special chars allowed by Excel
    const sheetName = rawName.replace(/[\\/*?:[\]]/g, "").slice(0, 31);
    const ws = workbook.addWorksheet(sheetName, {
      views: [{ state: "frozen", ySplit: 1 }], // freeze top row
    });

    const headers = sheet.headers;
    const numFmts = headers.map(inferNumFmt);
    const dateCols = headers.map(isDateHeader);

    // ---- Header row ----
    const headerRow = ws.addRow(headers);
    headerRow.height = 20;
    headerRow.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.border = CELL_BORDER;
      cell.alignment = { vertical: "middle", horizontal: "left" };
    });

    // ---- Data rows ----
    for (let ri = 0; ri < sheet.rows.length; ri++) {
      const rowData = sheet.rows[ri];
      const dataRow = ws.addRow(rowData);
      const isEven = ri % 2 === 0;

      dataRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const colIdx = colNumber - 1;
        cell.fill = isEven ? ROW_FILL_LIGHT : ROW_FILL_WHITE;
        cell.border = CELL_BORDER;
        cell.alignment = { vertical: "middle" };

        // Apply number format if detected
        const fmt = numFmts[colIdx];
        if (fmt) {
          if (typeof cell.value === "string" && !isNaN(Number(cell.value)) && cell.value !== "") {
            cell.value = Number(cell.value);
          }
          if (typeof cell.value === "number") {
            cell.numFmt = fmt;
          }
        }

        // Parse date strings for date columns
        if (dateCols[colIdx] && typeof cell.value === "string" && cell.value) {
          const d = new Date(cell.value);
          if (!isNaN(d.getTime())) {
            cell.value = d;
            cell.numFmt = "yyyy-mm-dd";
          }
        }
      });
    }

    // ---- Auto-filter on header row ----
    if (headers.length > 0) {
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length },
      };
    }

    // ---- Auto-size columns based on content ----
    ws.columns.forEach((col, i) => {
      const header = headers[i] ?? "";
      const maxContentLen = Math.max(
        header.length,
        ...sheet.rows.map((r) => String(r[i] ?? "").length),
      );
      col.width = Math.min(Math.max(maxContentLen + 3, 10), 55);
    });
  }

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ---------------------------------------------------------------------------
// Slack Upload
// ---------------------------------------------------------------------------

/**
 * Upload a file to a Slack channel.
 *
 * Uses the files.getUploadURLExternal + files.completeUploadExternal (v2) method
 * which is more reliable in serverless environments.
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

  const dedupeKey = `abra:file-upload:${opts.channelId}:${opts.filename.toLowerCase()}`;

  async function findRecentDuplicate(): Promise<{ permalink?: string } | null> {
    try {
      const cached = await kv.get<{ permalink?: string }>(dedupeKey);
      if (cached) return cached;
    } catch {
      const local = recentUploadFallback.get(dedupeKey);
      if (local && local.expiresAt > Date.now()) {
        return { permalink: local.permalink };
      }
      if (local) recentUploadFallback.delete(dedupeKey);
    }
    try {
      const url = new URL("https://slack.com/api/conversations.history");
      url.searchParams.set("channel", opts.channelId);
      url.searchParams.set("oldest", String(Math.floor(Date.now() / 1000) - (2 * 60 * 60)));
      url.searchParams.set("limit", "100");
      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        ok?: boolean;
        messages?: SlackHistoryMessage[];
      };
      if (!data.ok || !Array.isArray(data.messages)) return null;
      for (const message of data.messages) {
        for (const file of message.files || []) {
          const name = String(file.name || file.title || "").trim();
          if (name === opts.filename) {
            return { permalink: file.permalink };
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  const duplicate = await findRecentDuplicate();
  if (duplicate) {
    return {
      ok: true,
      skipped: true,
      permalink: duplicate.permalink,
    };
  }

  const format = opts.format || (opts.filename.endsWith(".xlsx") ? "xlsx" : "csv");
  const sheets = Array.isArray(opts.data) ? opts.data : [opts.data];

  let fileBuffer: Buffer;
  let mimeType: string;

  try {
    if (format === "xlsx") {
      fileBuffer = await generateXlsx(sheets);
      mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else {
      const csvStr = generateCsv(sheets[0]);
      fileBuffer = Buffer.from(csvStr, "utf-8");
      mimeType = "text/csv";
    }
  } catch (err) {
    return {
      ok: false,
      error: `File generation failed: ${err instanceof Error ? err.message : String(err)}`,
    };
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
    try {
      await kv.set(dedupeKey, { permalink: file?.permalink }, { ex: 2 * 60 * 60 });
    } catch {
      recentUploadFallback.set(dedupeKey, {
        permalink: file?.permalink,
        expiresAt: Date.now() + (2 * 60 * 60 * 1000),
      });
    }
    // Resolve the actual channel-message ts for the uploaded file.
    // `file.permalink` from `files.completeUploadExternal` is the
    // FILE permalink (e.g. `…/files/<userId>/<fileId>/<filename>`),
    // not the channel-message permalink (`…/archives/<channel>/p<digits>`).
    // `permalinkToMessageTs` regex doesn't match the file format, so
    // it returns undefined for every live upload — which silently
    // breaks every downstream caller that needs to thread under the
    // upload (the auto-ship route's packing-slip thread reply, etc.).
    //
    // Fix: ask `conversations.history` for recent messages in the
    // channel and find the one that carries our just-uploaded file.
    // We use the bot's existing `channels:history` scope rather than
    // `files:read` (which the bot doesn't have).
    const fileId = file?.id || urlData.file_id;
    const messageTs =
      (await resolveChannelMessageTs({
        token,
        channelId: opts.channelId,
        fileId,
      })) ?? permalinkToMessageTs(file?.permalink);
    return {
      ok: true,
      fileId,
      permalink: file?.permalink,
      messageTs,
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

/**
 * Upload an arbitrary binary Buffer (e.g. a shipping-label PDF) to Slack.
 *
 * Uses the same 3-step files.getUploadURLExternal + external POST +
 * files.completeUploadExternal flow as `uploadFileToSlack`, but skips
 * the CSV/XLSX generation step — the caller provides the final bytes.
 *
 * Primary consumer: the Amazon FBM auto-ship pipeline (drops the label
 * PDF into #operations or DM as soon as the label is purchased).
 */
export async function uploadBufferToSlack(opts: {
  channelId: string;
  filename: string;
  buffer: Buffer | Uint8Array;
  mimeType: string;
  title?: string;
  comment?: string;
  threadTs?: string;
}): Promise<SlackFileUploadResult> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return { ok: false, error: "SLACK_BOT_TOKEN not configured" };
  }
  const fileBuffer =
    opts.buffer instanceof Uint8Array ? Buffer.from(opts.buffer) : opts.buffer;

  // Step 1: Get upload URL
  let urlData: { ok: boolean; upload_url?: string; file_id?: string; error?: string };
  try {
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
    urlData = (await urlRes.json()) as typeof urlData;
  } catch (err) {
    return {
      ok: false,
      error: `getUploadURL error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!urlData.ok || !urlData.upload_url || !urlData.file_id) {
    return { ok: false, error: `getUploadURL failed: ${urlData.error || "unknown"}` };
  }

  // Step 2: POST bytes to the presigned URL.
  try {
    const uploadRes = await fetch(urlData.upload_url, {
      method: "POST",
      headers: { "Content-Type": opts.mimeType },
      body: new Uint8Array(fileBuffer),
      signal: AbortSignal.timeout(15000),
    });
    if (!uploadRes.ok) {
      return { ok: false, error: `Upload failed: HTTP ${uploadRes.status}` };
    }
  } catch (err) {
    return {
      ok: false,
      error: `Upload error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Step 3: Attach to channel/thread.
  const completePayload: Record<string, unknown> = {
    files: [{ id: urlData.file_id, title: opts.title || opts.filename }],
    channel_id: opts.channelId,
  };
  if (opts.comment) completePayload.initial_comment = opts.comment;
  if (opts.threadTs) completePayload.thread_ts = opts.threadTs;

  try {
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
      return {
        ok: false,
        error: `completeUpload failed: ${completeData.error || "unknown"}`,
      };
    }
    const file = completeData.files?.[0];
    // Resolve channel-message ts via conversations.history (file.permalink
    // is the file URL, not the message URL — see resolveChannelMessageTs
    // doc upstream). Threading replies under a buffer upload (e.g. the
    // auto-ship route's packing-slip thread reply) requires this ts.
    const fileId = file?.id || urlData.file_id;
    const messageTs =
      (await resolveChannelMessageTs({
        token,
        channelId: opts.channelId,
        fileId,
      })) ?? permalinkToMessageTs(file?.permalink);
    return {
      ok: true,
      fileId,
      permalink: file?.permalink,
      messageTs,
    };
  } catch (err) {
    return {
      ok: false,
      error: `completeUpload error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
