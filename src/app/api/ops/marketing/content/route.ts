import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { queryDatabase, DB, extractText, extractNumber, extractDate } from "@/lib/notion/client";
import { readState, writeState } from "@/lib/ops/state";
import type { CacheEnvelope } from "@/lib/amazon/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL = 10 * 60 * 1000;

type ContentResponse = {
  summary: {
    publishedPosts: number;
    totalBlogPageviews: number;
    avgEngagementTime: number;
    blogToPurchaseConversions: number;
  };
  topPosts: Array<{
    path: string;
    title: string;
    pageviews: number;
    avgEngagementTime: number;
    bounceRate: number;
  }>;
  draftQueue: Array<{
    id: string;
    title: string;
    targetKeyword: string;
    slug: string;
    status: string;
    seoScore: number;
    wordCount: number;
    generatedAt: string;
    publishedAt: string;
    body: string;
  }>;
  engineStatus: {
    s1LastRun: string | null;
    s3LastRun: string | null;
    s5LastRun: string | null;
  };
  generatedAt: string;
  error?: string;
};

function projectRoot(): string {
  return process.cwd();
}

function getPublishedPostCount(): number {
  try {
    const dir = path.join(projectRoot(), "content/blog");
    const files = fs.readdirSync(dir);
    return files.filter((f) => f.endsWith(".mdx")).length;
  } catch {
    return 0;
  }
}

function extractDraft(row: Record<string, unknown>) {
  const props = (row.properties || {}) as Record<string, unknown>;
  return {
    id: String(row.id || ""),
    title: extractText(props.Title) || extractText(props.Name) || "Untitled Draft",
    targetKeyword: extractText(props["Target Keyword"]),
    slug: extractText(props.Slug) || extractText(props["MDX Slug"]),
    status: extractText(props.Status) || "Draft",
    seoScore: extractNumber(props["SEO Score"]),
    wordCount: extractNumber(props["Word Count"]),
    generatedAt: extractDate(props["Generated At"]) || String(row.created_time || ""),
    publishedAt: extractDate(props["Published At"]),
    body: extractText(props.Body),
  };
}

function parseEngineRunAt(record: unknown): string | null {
  if (!record || typeof record !== "object") return null;
  const obj = record as Record<string, unknown>;
  return (obj.completedAt as string) || (obj.startedAt as string) || (obj.runAt as string) || null;
}

function toContentResponseError(message: string): ContentResponse {
  return {
    summary: {
      publishedPosts: getPublishedPostCount(),
      totalBlogPageviews: 0,
      avgEngagementTime: 0,
      blogToPurchaseConversions: 0,
    },
    topPosts: [],
    draftQueue: [],
    engineStatus: { s1LastRun: null, s3LastRun: null, s5LastRun: null },
    generatedAt: new Date().toISOString(),
    error: message,
  };
}

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const cached = await readState<CacheEnvelope<ContentResponse> | null>("content-cache", null);
  if (!force && cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    const canQueryDrafts = !!DB.CONTENT_DRAFTS && !DB.CONTENT_DRAFTS.startsWith("0000");
    const [draftRows, marketingCache, runLedger] = await Promise.all([
      canQueryDrafts
        ? queryDatabase(DB.CONTENT_DRAFTS, undefined, [{ property: "Created", direction: "descending" }], 100)
        : Promise.resolve([]),
      readState<CacheEnvelope<{
        topPages?: Array<{
          path: string;
          title: string;
          pageviews: number;
          avgEngagementTime: number;
          bounceRate?: number;
        }>;
      }> | null>("marketing-cache", null),
      readState<Record<string, unknown>>("run-ledger", {}),
    ]);

    const topPosts = (marketingCache?.data?.topPages || [])
      .filter((page) => (page.path || "").startsWith("/blog/"))
      .slice(0, 15)
      .map((page) => ({
        path: page.path,
        title: page.title || page.path,
        pageviews: page.pageviews || 0,
        avgEngagementTime: page.avgEngagementTime || 0,
        bounceRate: page.bounceRate || 0,
      }));

    const draftQueue = (draftRows || []).map(extractDraft);

    const seoLedger = ((runLedger || {}) as Record<string, unknown>).seo as
      | Record<string, unknown>
      | undefined;

    const engineStatus = {
      s1LastRun: parseEngineRunAt(seoLedger?.S1),
      s3LastRun: parseEngineRunAt(seoLedger?.S3),
      s5LastRun: parseEngineRunAt(seoLedger?.S5),
    };

    const totalBlogPageviews = topPosts.reduce((sum, row) => sum + row.pageviews, 0);
    const avgEngagementTime =
      topPosts.length > 0
        ? Math.round((topPosts.reduce((sum, row) => sum + row.avgEngagementTime, 0) / topPosts.length) * 10) / 10
        : 0;

    const result: ContentResponse = {
      summary: {
        publishedPosts: getPublishedPostCount(),
        totalBlogPageviews,
        avgEngagementTime,
        blogToPurchaseConversions: 0,
      },
      topPosts,
      draftQueue,
      engineStatus,
      generatedAt: new Date().toISOString(),
    };

    await writeState("content-cache", {
      data: result,
      cachedAt: Date.now(),
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[marketing/content] GET failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(toContentResponseError("Failed to load content data"), { status: 500 });
  }
}
