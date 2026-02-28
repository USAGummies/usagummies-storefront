import "server-only";
import { postTweet } from "@/lib/social/twitter";
import { postStatus } from "@/lib/social/truthsocial";

export type CrossPostInput = {
  text: string;
  platforms: Array<"x" | "truth">;
  imageUrl?: string;
};

export async function crossPost(input: CrossPostInput) {
  const results: Array<{ platform: "x" | "truth"; ok: boolean; id?: string; error?: string }> = [];

  for (const platform of input.platforms) {
    try {
      if (platform === "x") {
        const res = await postTweet(input.text);
        results.push({ platform, ok: true, id: res.data?.id });
      } else {
        const res = await postStatus(input.text);
        results.push({ platform, ok: true, id: res.id });
      }
    } catch (err) {
      results.push({
        platform,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ok: results.some((r) => r.ok),
    results,
  };
}

function openAiKey(): string {
  return process.env.OPENAI_API_KEY || "";
}

async function chatCompletion(system: string, user: string): Promise<string> {
  const key = openAiKey();
  if (!key) throw new Error("OPENAI_API_KEY not configured");

  // 20s timeout to stay within Vercel serverless 25s limit
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI completion failed (${res.status}): ${text.slice(0, 220)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return json.choices?.[0]?.message?.content?.trim() || "";
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateSocialPosts(input: {
  blogTitle: string;
  description: string;
  url: string;
}) {
  const base = `${input.blogTitle}\n${input.description}\n${input.url}`;

  const system =
    "You write on-brand social copy for USA Gummies. Avoid political statements and competitor attacks. Keep claims factual.";

  const [xPost, truthPost, igCaption] = await Promise.all([
    chatCompletion(system, `Write one X post (max 280 chars) with 2-3 relevant hashtags:\n${base}`),
    chatCompletion(system, `Write one Truth Social post (max 500 chars), patriotic but factual tone:\n${base}`),
    chatCompletion(system, `Write one Instagram caption with emojis and 5 hashtags:\n${base}`),
  ]);

  return { xPost, truthPost, igCaption };
}
