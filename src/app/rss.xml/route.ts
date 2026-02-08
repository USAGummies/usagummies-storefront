import { NextResponse } from "next/server";
import { getAllPosts, resolveSiteUrl } from "@/lib/blog";

export const revalidate = 3600;

const FEED_TITLE = "USA Gummies Blog";
const FEED_DESCRIPTION =
  "Patriotic gummy stories, gifting guides, and behind-the-scenes updates from USA Gummies.";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toRfc2822(date: string | Date): string {
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return new Date().toUTCString();
  return parsed.toUTCString();
}

export async function GET() {
  const siteUrl = resolveSiteUrl();
  const posts = getAllPosts();

  const latestDate = posts.reduce<Date | null>((current, post) => {
    const candidate = new Date(post.updated || post.date);
    if (Number.isNaN(candidate.getTime())) return current;
    if (!current) return candidate;
    return candidate > current ? candidate : current;
  }, null);

  const lastBuildDate = toRfc2822(latestDate || new Date());

  const itemsXml = posts
    .map((post) => {
      const title = escapeXml(post.seoTitle || post.title);
      const description = escapeXml(post.seoDescription || post.description);
      const link = `${siteUrl}/blog/${post.slug}`;
      const pubDate = toRfc2822(post.updated || post.date);
      return [
        "<item>",
        `  <title>${title}</title>`,
        `  <link>${link}</link>`,
        `  <guid isPermaLink="true">${link}</guid>`,
        `  <description>${description}</description>`,
        `  <pubDate>${pubDate}</pubDate>`,
        "</item>",
      ].join("\n");
    })
    .join("\n");

  const rss = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "<channel>",
    `  <title>${escapeXml(FEED_TITLE)}</title>`,
    `  <link>${siteUrl}/blog</link>`,
    `  <description>${escapeXml(FEED_DESCRIPTION)}</description>`,
    `  <lastBuildDate>${lastBuildDate}</lastBuildDate>`,
    "  <language>en-us</language>",
    `  <atom:link href="${siteUrl}/rss.xml" rel="self" type="application/rss+xml" />`,
    itemsXml,
    "</channel>",
    "</rss>",
  ].join("\n");

  return new NextResponse(rss, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  });
}
