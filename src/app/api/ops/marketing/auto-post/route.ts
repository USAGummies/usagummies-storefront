import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { generateMarketingImage, isGeminiConfigured } from "@/lib/ai/gemini-image";
import { crossPost } from "@/lib/social/cross-poster";
import { generateSocialPosts } from "@/lib/social/cross-poster";
import { readState, writeState } from "@/lib/ops/state";
import { validateRequest, AutoPostSchema } from "@/lib/ops/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Marketing Auto-Post Pipeline
 *
 * 1. Generate social copy (GPT-4o-mini)
 * 2. Generate image (Gemini Nano Banana 2)
 * 3. Cross-post to X and/or Truth Social
 *
 * POST body:
 *   topic: string           — what the post is about
 *   platforms: ["x","truth"] — where to post
 *   style?: string           — image style (product-hero, lifestyle, patriotic, health-wellness, social-post)
 *   blogUrl?: string         — optional blog URL to promote
 *   dryRun?: boolean         — if true, generate content but don't post
 */

type AutoPostBody = {
  topic: string;
  platforms?: Array<"x" | "truth">;
  style?: "product-hero" | "lifestyle" | "patriotic" | "health-wellness" | "social-post";
  blogUrl?: string;
  dryRun?: boolean;
};

type AutoPostLog = {
  ts: string;
  topic: string;
  platforms: string[];
  imageGenerated: boolean;
  postResults: Array<{ platform: string; ok: boolean; id?: string; error?: string }>;
};

function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function POST(req: Request) {
  try {
    const v = await validateRequest(req, AutoPostSchema);
    if (!v.success) return v.response;

    const { topic, platforms, style, dryRun } = v.data;

    // ── Step 1: Generate social copy ──────────────────────────────
    const blogUrl = v.data.blogUrl || "https://usagummies.com";
    const posts = await generateSocialPosts({
      blogTitle: topic,
      description: `Marketing post about: ${topic}`,
      url: blogUrl,
    });

    // ── Step 2: Generate image with Nano Banana 2 ─────────────────
    let imageUrl: string | undefined;
    let imageGenerated = false;

    if (isGeminiConfigured()) {
      try {
        const img = await generateMarketingImage(topic, style);

        // Save to content-library
        const dir = path.join(process.cwd(), "public", "content-library");
        await fs.mkdir(dir, { recursive: true });
        const fileName = `autopost-${sanitizeFileName(topic)}-${Date.now()}.png`;
        const absPath = path.join(dir, fileName);
        await fs.writeFile(absPath, Buffer.from(img.base64, "base64"));
        imageUrl = `/content-library/${fileName}`;
        imageGenerated = true;
      } catch (err) {
        // Image generation is non-blocking — post without image if it fails
        console.error("[auto-post] Image generation failed:", err);
      }
    }

    // ── Step 3: Post to platforms ──────────────────────────────────
    const postResults: AutoPostLog["postResults"] = [];

    if (!dryRun) {
      for (const platform of platforms) {
        const text = platform === "x" ? posts.xPost : posts.truthPost;
        try {
          const result = await crossPost({
            text,
            platforms: [platform],
            imageUrl,
          });
          for (const r of result.results) {
            postResults.push({
              platform: r.platform,
              ok: r.ok,
              id: r.id,
              error: r.error,
            });
          }
        } catch (err) {
          postResults.push({
            platform,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // ── Step 4: Log the auto-post ─────────────────────────────────
    const logEntry: AutoPostLog = {
      ts: new Date().toISOString(),
      topic,
      platforms,
      imageGenerated,
      postResults,
    };

    const existing = await readState<AutoPostLog[]>("auto-post-log", []);
    const log = Array.isArray(existing) ? existing : [];
    log.push(logEntry);
    // Keep last 200 entries
    if (log.length > 200) log.splice(0, log.length - 200);
    await writeState("auto-post-log", log);

    return NextResponse.json({
      ok: true,
      dryRun,
      topic,
      copy: {
        x: posts.xPost,
        truth: posts.truthPost,
        instagram: posts.igCaption,
      },
      imageUrl,
      imageGenerated,
      postResults: dryRun ? [] : postResults,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** GET: Return auto-post history */
export async function GET() {
  const log = await readState<AutoPostLog[]>("auto-post-log", []);
  return NextResponse.json({
    entries: Array.isArray(log) ? log.slice(-50).reverse() : [],
    total: Array.isArray(log) ? log.length : 0,
  });
}
