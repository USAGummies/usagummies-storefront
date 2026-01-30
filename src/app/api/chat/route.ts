import { NextResponse } from "next/server";
import OpenAI from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { SUPPORT_SYSTEM_PROMPT } from "@/lib/support/chat";

export const runtime = "nodejs";

type IncomingMessage = {
  role?: "user" | "assistant";
  content?: string;
};

function json(data: unknown, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return json({ ok: false, error: "Missing OPENAI_API_KEY." }, 500);
  }

  let body: { messages?: IncomingMessage[] } = {};
  try {
    body = (await req.json()) as { messages?: IncomingMessage[] };
  } catch {
    body = {};
  }

  const cleaned: ResponseInputItem[] =
    Array.isArray(body.messages) && body.messages.length
      ? body.messages
          .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
          .map((m) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: String(m.content || "").slice(0, 2000),
            type: "message",
          }))
      : [];

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini",
      input: [
        { role: "system", content: SUPPORT_SYSTEM_PROMPT, type: "message" },
        ...cleaned,
      ],
      temperature: 0.2,
      max_output_tokens: 500,
    });

    const reply = response.output_text?.trim() || "";
    if (!reply) {
      return json({ ok: false, error: "Empty response." }, 500);
    }

    return json({ ok: true, reply });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "Chat unavailable." }, 500);
  }
}
