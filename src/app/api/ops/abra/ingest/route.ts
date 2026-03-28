import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { auth } from "@/lib/auth/config";
import { generateEmbeddings } from "@/lib/ops/abra-embeddings";
import { extractPdfTextFromBuffer } from "@/lib/ops/file-text-extraction";
import { validateRequest, IngestDeleteSchema } from "@/lib/ops/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

type StoredDocumentRow = {
  id: string;
  title: string | null;
  source_ref: string | null;
  created_at: string;
  superseded_at: string | null;
  tags: string[] | null;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials");
  }
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}) {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(20000),
  });

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!res.ok) {
    throw new Error(
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
    );
  }

  return json;
}

function parseExt(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx === -1 ? "" : fileName.slice(idx + 1).toLowerCase();
}

function chunkText(text: string): string[] {
  const normalized = text.split("\0").join("").trim();
  if (!normalized) return [];
  if (normalized.length <= CHUNK_SIZE) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + CHUNK_SIZE);
    const slice = normalized.slice(start, end).trim();
    if (slice) chunks.push(slice);
    if (end >= normalized.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks;
}

function parseCsvRows(text: string): string[] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const header = lines[0];
  const rows = lines.slice(1);
  return rows.map((row, idx) => `CSV Row ${idx + 1}\nHeader: ${header}\n${row}`);
}

function parseXlsxRows(buffer: Buffer): string[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const chunks: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
    });
    for (let idx = 0; idx < rows.length; idx += 1) {
      const row = rows[idx];
      const fields = Object.entries(row)
        .map(([key, value]) => `${key}: ${String(value).trim()}`)
        .join(" | ");
      if (!fields) continue;
      chunks.push(`Sheet: ${sheetName}\nRow: ${idx + 1}\n${fields}`);
    }
  }
  return chunks;
}

async function extractRawSegments(file: File): Promise<{ segments: string[]; mimeType: string }> {
  const mimeType = file.type || "application/octet-stream";
  const ext = parseExt(file.name);
  const buffer = Buffer.from(await file.arrayBuffer());

  if (mimeType.includes("pdf") || ext === "pdf") {
    const extracted = await extractPdfTextFromBuffer(buffer, {
      maxPages: 100,
      maxChars: 200_000,
    });
    return { segments: chunkText(extracted.text), mimeType };
  }

  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    ext === "xlsx" ||
    ext === "xls"
  ) {
    const rows = parseXlsxRows(buffer);
    return {
      segments: rows.flatMap((row) => chunkText(row)),
      mimeType,
    };
  }

  const text = await file.text();
  if (mimeType.includes("csv") || ext === "csv") {
    const rows = parseCsvRows(text);
    return {
      segments: rows.flatMap((row) => chunkText(row)),
      mimeType,
    };
  }

  if (mimeType.includes("json") || ext === "json") {
    const pretty = (() => {
      try {
        return JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        return text;
      }
    })();
    return { segments: chunkText(pretty), mimeType };
  }

  if (
    mimeType.startsWith("text/") ||
    ext === "txt" ||
    ext === "md" ||
    ext === "log"
  ) {
    return { segments: chunkText(text), mimeType };
  }

  throw new Error("Unsupported file type. Use PDF, CSV, XLSX, TXT, or JSON.");
}

function encodeUploadedBy(email: string): string {
  return email.toLowerCase().replace(/[^a-z0-9@._-]/g, "_");
}

async function requireUser() {
  const session = await auth();
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { email: session.user.email };
}

export async function POST(req: Request) {
  const user = await requireUser();
  if ("error" in user) return user.error;

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: "Uploaded file is empty" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: "File exceeds 10MB limit" },
        { status: 400 },
      );
    }

    const { segments, mimeType } = await extractRawSegments(file);
    if (!segments.length) {
      return NextResponse.json(
        { error: "No text extracted from file" },
        { status: 400 },
      );
    }

    const maxChunks = 1500;
    const boundedSegments = segments.slice(0, maxChunks);
    const documentId = crypto.randomUUID();
    const uploader = encodeUploadedBy(user.email);
    const embeddings = await generateEmbeddings(
      boundedSegments.map((segment) => segment.slice(0, 8000)),
    );

    const now = new Date().toISOString();
    const rows = boundedSegments.map((segment, idx) => ({
      source_type: "manual",
      source_ref: `document:${documentId}:${idx + 1}`,
      entry_type: "research",
      title: file.name,
      raw_text: `[document:${documentId} chunk:${idx + 1}/${boundedSegments.length} mime:${mimeType} uploaded_by:${user.email}]\n${segment}`.slice(
        0,
        50000,
      ),
      summary_text: segment.slice(0, 500),
      category: "research",
      department: "operations",
      confidence: "medium",
      priority: "normal",
      processed: true,
      tags: ["document_upload", `uploaded_by:${uploader}`, `mime:${mimeType}`],
      embedding: embeddings[idx] || null,
      created_at: now,
    }));

    await sbFetch("/rest/v1/open_brain_entries", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(rows),
    });

    return NextResponse.json({
      chunks_created: rows.length,
      filename: file.name,
      document_id: documentId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Document ingestion failed",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  const user = await requireUser();
  if ("error" in user) return user.error;

  try {
    const likePattern = encodeURIComponent("document:%");
    const rows = (await sbFetch(
      `/rest/v1/open_brain_entries?source_ref=like.${likePattern}&select=id,title,source_ref,created_at,superseded_at,tags&order=created_at.desc&limit=5000`,
    )) as StoredDocumentRow[];

    const grouped = new Map<
      string,
      {
        document_id: string;
        filename: string;
        uploaded_at: string;
        chunk_count: number;
        active_chunks: number;
        uploaded_by: string;
      }
    >();

    for (const row of rows) {
      const sourceRef = row.source_ref || "";
      const parts = sourceRef.split(":");
      if (parts.length < 3 || parts[0] !== "document") continue;
      const documentId = parts[1];
      if (!documentId) continue;

      const existing = grouped.get(documentId);
      const tags = Array.isArray(row.tags) ? row.tags : [];
      const uploadedTag = tags.find((tag) => tag.startsWith("uploaded_by:"));
      const uploadedBy = uploadedTag
        ? uploadedTag.replace("uploaded_by:", "")
        : "unknown";
      if (!existing) {
        grouped.set(documentId, {
          document_id: documentId,
          filename: row.title || "Untitled document",
          uploaded_at: row.created_at,
          chunk_count: 1,
          active_chunks: row.superseded_at ? 0 : 1,
          uploaded_by: uploadedBy,
        });
      } else {
        existing.chunk_count += 1;
        if (!row.superseded_at) existing.active_chunks += 1;
        if (Date.parse(row.created_at) < Date.parse(existing.uploaded_at)) {
          existing.uploaded_at = row.created_at;
        }
      }
    }

    const documents = Array.from(grouped.values()).sort(
      (a, b) => Date.parse(b.uploaded_at) - Date.parse(a.uploaded_at),
    );
    return NextResponse.json({ documents });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list documents" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  const user = await requireUser();
  if ("error" in user) return user.error;

  const v = await validateRequest(req, IngestDeleteSchema);
  if (!v.success) return v.response;
  const { document_id: documentId } = v.data;

  try {
    const likePattern = encodeURIComponent(`document:${documentId}:%`);
    const updated = (await sbFetch(
      `/rest/v1/open_brain_entries?source_ref=like.${likePattern}&superseded_at=is.null`,
      {
        method: "PATCH",
        headers: {
          Prefer: "return=representation",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          superseded_at: new Date().toISOString(),
          processed: false,
        }),
      },
    )) as Array<{ id: string }>;

    return NextResponse.json({
      ok: true,
      superseded_chunks: Array.isArray(updated) ? updated.length : 0,
      document_id: documentId,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to supersede document" },
      { status: 500 },
    );
  }
}
