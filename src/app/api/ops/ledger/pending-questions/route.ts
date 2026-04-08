import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { listPendingQuestions, upsertPendingQuestion, answerQuestion } from "@/lib/ops/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || undefined;
    const asked_to = url.searchParams.get("asked_to") || undefined;
    const topic = url.searchParams.get("topic") || undefined;

    const questions = await listPendingQuestions({ status, asked_to, topic });
    return NextResponse.json({ ok: true, questions, count: questions.length });
  } catch (error) {
    console.error("[ledger/pending-questions] GET failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to list questions" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.id || !body.question || !body.asked_by || !body.asked_to || !body.topic) {
      return NextResponse.json(
        { error: "Required: id, question, asked_by, asked_to, topic" },
        { status: 400 }
      );
    }

    const question = await upsertPendingQuestion({
      id: body.id,
      question: body.question,
      asked_by: body.asked_by,
      asked_to: body.asked_to,
      topic: body.topic,
      asked_at: body.asked_at || new Date().toISOString(),
      source_thread: body.source_thread,
      status: body.status || "waiting",
      answer: body.answer,
      answered_by: body.answered_by,
      answered_at: body.answered_at,
      notes: body.notes,
    });

    return NextResponse.json({ ok: true, question });
  } catch (error) {
    console.error("[ledger/pending-questions] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to save question" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.id || !body.answer || !body.answered_by) {
      return NextResponse.json(
        { error: "Required: id, answer, answered_by" },
        { status: 400 }
      );
    }

    const question = await answerQuestion(body.id, body.answer, body.answered_by);
    if (!question) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, question });
  } catch (error) {
    console.error("[ledger/pending-questions] PATCH failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to answer question" }, { status: 500 });
  }
}
