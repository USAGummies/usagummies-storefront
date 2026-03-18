import { NextResponse } from "next/server";
import {
  DB,
  createPage,
  updatePage,
  extractText,
  NotionProp,
  toNotionId,
} from "@/lib/notion/client";
import { getNotionApiKey } from "@/lib/notion/credentials";
import { publishFileToGithub, isGithubPublishConfigured } from "@/lib/social/github-publisher";
import { crossPost, generateSocialPosts } from "@/lib/social/cross-poster";
import { validateRequest, ContentActionSchema } from "@/lib/ops/validation";

type ActionBody = {
  action?: "approve" | "reject" | "edit" | "generate";
  pageId?: string;
  title?: string;
  slug?: string;
  body?: string;
  keyword?: string;
  outline?: string;
  reason?: string;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function toRichTextChunks(value: string): Array<{ text: { content: string } }> {
  const text = value || "";
  if (!text) return [{ text: { content: "" } }];
  const chunks: Array<{ text: { content: string } }> = [];
  for (let i = 0; i < text.length; i += 1800) {
    chunks.push({ text: { content: text.slice(i, i + 1800) } });
  }
  return chunks;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchNotionPage(pageId: string): Promise<Record<string, unknown> | null> {
  const key = getNotionApiKey();
  if (!key) return null;

  const res = await fetch(`https://api.notion.com/v1/pages/${toNotionId(pageId)}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    return null;
  }

  return (await res.json()) as Record<string, unknown>;
}

function parseDraftPage(page: Record<string, unknown>): {
  title: string;
  slug: string;
  body: string;
  keyword: string;
} {
  const props = (page.properties || {}) as Record<string, unknown>;
  const title = extractText(props.Title) || extractText(props.Name) || "Untitled Draft";
  const slug = extractText(props.Slug) || extractText(props["MDX Slug"]) || slugify(title);
  const body = extractText(props.Body);
  const keyword = extractText(props["Target Keyword"]);
  return { title, slug, body, keyword };
}

async function generateDraft(keyword: string, outline?: string): Promise<{ title: string; slug: string; body: string }> {
  const openAiKey = process.env.OPENAI_API_KEY || "";
  if (!openAiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const prompt = `Create a complete MDX blog post draft for USA Gummies.\nTarget keyword: ${keyword}.\n${
    outline ? `Outline guidance:\n${outline}\n` : ""
  }\nRequirements:\n- 800-1200 words\n- Include YAML frontmatter with title, slug, description, date, tags\n- Include at least 2 internal links to /blog/* and one CTA link to /shop\n- Tone: patriotic, health-conscious, informative\n- No fabricated medical claims\nReturn only valid MDX.`;

  // 20s timeout to stay within Vercel serverless 25s limit
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content:
              "You write publication-ready MDX for USA Gummies. Keep content factual and avoid political statements.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI generation failed (${res.status}): ${text.slice(0, 220)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const body = json.choices?.[0]?.message?.content?.trim() || "";
  if (!body) {
    throw new Error("OpenAI returned an empty draft");
  }

  const titleMatch = body.match(/title:\s*"?([^"\n]+)"?/i);
  const slugMatch = body.match(/slug:\s*"?([^"\n]+)"?/i);

  const title = titleMatch?.[1]?.trim() || `USA Gummies Guide: ${keyword}`;
  const slug = slugify(slugMatch?.[1]?.trim() || keyword);

  return { title, slug, body };
}

async function createDraftInNotion(input: {
  title: string;
  slug: string;
  keyword: string;
  body: string;
}) {
  if (!DB.CONTENT_DRAFTS || DB.CONTENT_DRAFTS.startsWith("0000")) {
    throw new Error("NOTION_DB_CONTENT_DRAFTS not configured");
  }

  const page = await createPage(DB.CONTENT_DRAFTS, {
    Title: NotionProp.title(input.title),
    Slug: NotionProp.richText(input.slug),
    "Target Keyword": NotionProp.richText(input.keyword),
    Status: NotionProp.select("Draft"),
    "Word Count": NotionProp.number(input.body.split(/\s+/).filter(Boolean).length),
    "Generated At": NotionProp.date(todayIso()),
    Body: { rich_text: toRichTextChunks(input.body) },
    Author: NotionProp.richText("SEO Engine (GPT-4o-mini)"),
  });

  if (!page) {
    throw new Error("Failed to create Notion content draft");
  }

  return page;
}

async function approveDraft(body: ActionBody) {
  if (!body.pageId) {
    throw new Error("pageId is required for approve action");
  }

  if (!isGithubPublishConfigured()) {
    throw new Error("GITHUB_PAT not configured");
  }

  const notionPage = await fetchNotionPage(body.pageId);
  if (!notionPage && !body.title && !body.body) {
    throw new Error(`Could not fetch Notion page ${body.pageId}. Verify the page exists and NOTION_API_KEY is configured.`);
  }
  const parsed = notionPage ? parseDraftPage(notionPage) : null;

  const title = (body.title || parsed?.title || "").trim();
  const slug = slugify((body.slug || parsed?.slug || title || "untitled").trim());
  const mdxBody = (body.body || parsed?.body || "").trim();

  if (!title || !mdxBody) {
    throw new Error("Draft title/body missing. Pass title/body or ensure Notion draft has both.");
  }

  const publishPath = `content/blog/${slug}.mdx`;
  const publishResult = await publishFileToGithub({
    path: publishPath,
    content: mdxBody,
    message: `feat(content): publish ${slug}`,
    branch: process.env.GITHUB_CONTENT_BRANCH || "main",
    committerName: "USA Gummies Ops Bot",
    committerEmail: "ops@usagummies.com",
  });

  await updatePage(body.pageId, {
    Status: NotionProp.select("Published"),
    "Published At": NotionProp.date(todayIso()),
    Slug: NotionProp.richText(slug),
  });

  let crossPostResult: unknown = null;
  try {
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://usagummies.com").replace(/\/$/, "");
    const url = `${siteUrl}/blog/${slug}`;
    const socialCopy = await generateSocialPosts({
      blogTitle: title,
      description: parsed?.keyword || "New USA Gummies article",
      url,
    });

    crossPostResult = await crossPost({
      text: socialCopy.xPost || `${title}\n${url}`,
      platforms: ["x", "truth"],
    });
  } catch (err) {
    crossPostResult = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    ok: true,
    published: {
      path: publishResult.path,
      commitSha: publishResult.commitSha,
      branch: publishResult.branch,
      slug,
      title,
    },
    crossPost: crossPostResult,
  };
}

async function rejectDraft(body: ActionBody) {
  if (!body.pageId) {
    throw new Error("pageId is required for reject action");
  }

  await updatePage(body.pageId, {
    Status: NotionProp.select("Rejected"),
    ...(body.reason ? { "Rejection Reason": NotionProp.richText(body.reason) } : {}),
  });

  return { ok: true };
}

async function editDraft(body: ActionBody) {
  if (!body.pageId) {
    throw new Error("pageId is required for edit action");
  }

  const updates: Record<string, unknown> = {};
  if (body.title) updates.Title = NotionProp.title(body.title);
  if (body.slug) updates.Slug = NotionProp.richText(slugify(body.slug));
  if (body.body != null) {
    updates.Body = { rich_text: toRichTextChunks(body.body) };
    updates["Word Count"] = NotionProp.number(body.body.split(/\s+/).filter(Boolean).length);
  }

  if (Object.keys(updates).length > 0) {
    await updatePage(body.pageId, updates);
  }

  return { ok: true };
}

async function generateAction(body: ActionBody) {
  const keyword = (body.keyword || "").trim();
  if (!keyword) {
    throw new Error("keyword is required for generate action");
  }

  const draft = await generateDraft(keyword, body.outline);
  const notionPage = await createDraftInNotion({
    title: draft.title,
    slug: draft.slug,
    keyword,
    body: draft.body,
  });

  return {
    ok: true,
    draft: {
      pageId: notionPage.id,
      title: draft.title,
      slug: draft.slug,
      wordCount: draft.body.split(/\s+/).filter(Boolean).length,
    },
  };
}

export async function POST(req: Request) {
  try {
    const v = await validateRequest(req, ContentActionSchema);
    if (!v.success) return v.response;
    const body = v.data;
    const action = body.action;

    if (action === "approve") {
      return NextResponse.json(await approveDraft(body));
    }

    if (action === "reject") {
      return NextResponse.json(await rejectDraft(body));
    }

    if (action === "edit") {
      return NextResponse.json(await editDraft(body));
    }

    if (action === "generate") {
      return NextResponse.json(await generateAction(body));
    }

    return NextResponse.json(
      { error: "Unsupported action. Use approve | reject | edit | generate" },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
