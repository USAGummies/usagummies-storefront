import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  createWorkpack,
  listWorkpacks,
  validateWorkpackInput,
} from "@/lib/ops/workpacks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const workpacks = await listWorkpacks({ limit });
  return NextResponse.json({ ok: true, count: workpacks.length, workpacks });
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "invalid_json" },
      { status: 400 },
    );
  }

  const validation = validateWorkpackInput(body);
  if (!validation.ok) {
    return NextResponse.json(
      { ok: false, code: "invalid_workpack", issues: validation.issues },
      { status: 400 },
    );
  }

  const workpack = await createWorkpack(validation.value);
  return NextResponse.json({ ok: true, workpack }, { status: 201 });
}
