import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  getWorkpack,
  updateWorkpack,
  WorkpackUpdateError,
  type WorkpackUpdatePatch,
} from "@/lib/ops/workpacks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: RouteParams): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const workpack = await getWorkpack(id);
  if (!workpack) {
    return NextResponse.json(
      { ok: false, code: "not_found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, workpack });
}

export async function PATCH(req: Request, { params }: RouteParams): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: WorkpackUpdatePatch;
  try {
    body = (await req.json()) as WorkpackUpdatePatch;
  } catch {
    return NextResponse.json(
      { ok: false, code: "invalid_json" },
      { status: 400 },
    );
  }
  const { id } = await params;
  try {
    const workpack = await updateWorkpack(id, body);
    return NextResponse.json({ ok: true, workpack });
  } catch (err) {
    if (err instanceof WorkpackUpdateError) {
      const status =
        err.code === "not_found"
          ? 404
          : err.code === "no_changes"
            ? 400
            : 422;
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status },
      );
    }
    throw err;
  }
}
