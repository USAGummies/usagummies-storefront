import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { readState, writeState } from "@/lib/ops/state";
import type { CacheEnvelope } from "@/lib/amazon/types";
import { DB, NotionProp, createPage, queryDatabase, extractText, extractDate } from "@/lib/notion/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL = 10 * 60 * 1000;

type ImageRecord = {
  id: string;
  title: string;
  url: string;
  tags: string[];
  category: string;
  source: "upload" | "ai-dalle";
  prompt: string;
  created: string;
  usedIn: string;
};

type ImagesResponse = {
  images: ImageRecord[];
  summary: {
    total: number;
    uploadCount: number;
    aiCount: number;
  };
  generatedAt: string;
  error?: string;
};

function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseTags(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toImageRecord(row: Record<string, unknown>): ImageRecord {
  const props = (row.properties || {}) as Record<string, unknown>;
  return {
    id: String(row.id || ""),
    title: extractText(props.Title) || extractText(props.Name) || "Untitled",
    url: extractText(props.URL),
    tags: parseTags(extractText(props.Tags)),
    category: extractText(props.Category) || "uncategorized",
    source: (extractText(props.Source) || "upload") as "upload" | "ai-dalle",
    prompt: extractText(props.Prompt),
    created: extractDate(props.Created) || String(row.created_time || new Date().toISOString()),
    usedIn: extractText(props["Used In"]),
  };
}

function localPublicPath(filename: string): { absPath: string; publicUrl: string } {
  const clean = sanitizeFileName(filename);
  const file = clean || `asset-${Date.now()}.png`;
  const absPath = path.join(process.cwd(), "public", "content-library", file);
  const publicUrl = `/content-library/${file}`;
  return { absPath, publicUrl };
}

async function ensureContentLibraryDir() {
  await fs.mkdir(path.join(process.cwd(), "public", "content-library"), { recursive: true });
}

async function createNotionImageEntry(record: {
  title: string;
  url: string;
  tags: string[];
  category: string;
  source: "upload" | "ai-dalle";
  prompt: string;
}) {
  if (!DB.IMAGE_LIBRARY || DB.IMAGE_LIBRARY.startsWith("0000")) {
    return null;
  }

  return createPage(DB.IMAGE_LIBRARY, {
    Title: NotionProp.title(record.title),
    URL: NotionProp.url(record.url),
    Tags: NotionProp.richText(record.tags.join(", ")),
    Category: NotionProp.select(record.category),
    Source: NotionProp.select(record.source === "ai-dalle" ? "ai-dalle" : "upload"),
    Prompt: NotionProp.richText(record.prompt || ""),
    Created: NotionProp.date(new Date().toISOString().slice(0, 10)),
  });
}

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const cached = await readState<CacheEnvelope<ImagesResponse> | null>("image-library-cache", null);
  if (!force && cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    if (!DB.IMAGE_LIBRARY || DB.IMAGE_LIBRARY.startsWith("0000")) {
      return NextResponse.json({
        images: [],
        summary: { total: 0, uploadCount: 0, aiCount: 0 },
        generatedAt: new Date().toISOString(),
        error: "NOTION_DB_IMAGE_LIBRARY not configured",
      } satisfies ImagesResponse);
    }
    const rows = await queryDatabase(DB.IMAGE_LIBRARY, undefined, [{ property: "Created", direction: "descending" }], 100);
    const images = (rows || []).map(toImageRecord);

    const result: ImagesResponse = {
      images,
      summary: {
        total: images.length,
        uploadCount: images.filter((img) => img.source === "upload").length,
        aiCount: images.filter((img) => img.source === "ai-dalle").length,
      },
      generatedAt: new Date().toISOString(),
    };

    await writeState("image-library-cache", {
      data: result,
      cachedAt: Date.now(),
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        images: [],
        summary: { total: 0, uploadCount: 0, aiCount: 0 },
        generatedAt: new Date().toISOString(),
        error: message,
      } satisfies ImagesResponse,
      { status: 500 },
    );
  }
}

type UploadBody = {
  action?: "upload" | "generate";
  title?: string;
  filename?: string;
  contentBase64?: string;
  tags?: string[];
  category?: string;
  prompt?: string;
};

async function uploadAction(body: UploadBody) {
  if (!body.filename || !body.contentBase64) {
    throw new Error("filename and contentBase64 are required for upload");
  }

  await ensureContentLibraryDir();
  const { absPath, publicUrl } = localPublicPath(body.filename);

  const content = body.contentBase64.includes(",") ? body.contentBase64.split(",").pop() || "" : body.contentBase64;
  const buffer = Buffer.from(content, "base64");
  await fs.writeFile(absPath, buffer);

  await createNotionImageEntry({
    title: body.title || body.filename,
    url: publicUrl,
    tags: body.tags || [],
    category: body.category || "blog",
    source: "upload",
    prompt: "",
  });

  return {
    ok: true,
    image: {
      title: body.title || body.filename,
      url: publicUrl,
      category: body.category || "blog",
      tags: body.tags || [],
      source: "upload",
    },
  };
}

async function generateAction(body: UploadBody) {
  const prompt = (body.prompt || "").trim();
  if (!prompt) {
    throw new Error("prompt is required for generate");
  }

  const key = process.env.OPENAI_API_KEY || "";
  if (!key) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const title = body.title || `AI Image ${new Date().toISOString().slice(0, 10)}`;
  const fileBase = sanitizeFileName(title) || `ai-${Date.now()}`;
  const fileName = `${fileBase}.png`;

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt,
      size: "1024x1024",
      response_format: "b64_json",
      n: 1,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DALL-E request failed (${res.status}): ${text.slice(0, 220)}`);
  }

  const json = (await res.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };

  await ensureContentLibraryDir();
  const { absPath, publicUrl } = localPublicPath(fileName);

  if (json.data?.[0]?.b64_json) {
    await fs.writeFile(absPath, Buffer.from(json.data[0].b64_json, "base64"));
  } else if (json.data?.[0]?.url) {
    const remote = await fetch(json.data[0].url, { cache: "no-store" });
    if (!remote.ok) throw new Error("Generated image URL download failed");
    const arrayBuffer = await remote.arrayBuffer();
    await fs.writeFile(absPath, Buffer.from(arrayBuffer));
  } else {
    throw new Error("DALL-E response had no image payload");
  }

  await createNotionImageEntry({
    title,
    url: publicUrl,
    tags: body.tags || [],
    category: body.category || "blog",
    source: "ai-dalle",
    prompt,
  });

  return {
    ok: true,
    image: {
      title,
      url: publicUrl,
      category: body.category || "blog",
      tags: body.tags || [],
      source: "ai-dalle",
      prompt,
    },
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as UploadBody;

    if (body.action === "upload") {
      const result = await uploadAction(body);
      // Bust cache so next GET returns fresh data
      await writeState("image-library-cache", { data: null, cachedAt: 0 });
      return NextResponse.json(result);
    }

    if (body.action === "generate") {
      const result = await generateAction(body);
      await writeState("image-library-cache", { data: null, cachedAt: 0 });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Unsupported action. Use upload | generate" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
