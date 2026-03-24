import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { createQBOCustomer } from "@/lib/ops/qbo-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      name: string;
      company?: string;
      email?: string;
      phone?: string;
    };

    if (!body.name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const result = await createQBOCustomer({
      DisplayName: body.name,
      ...(body.company ? { CompanyName: body.company } : {}),
      ...(body.email
        ? { PrimaryEmailAddr: { Address: body.email } }
        : {}),
      ...(body.phone
        ? { PrimaryPhone: { FreeFormNumber: body.phone } }
        : {}),
    });

    if (!result) {
      return NextResponse.json(
        { error: "QBO customer creation failed" },
        { status: 500 },
      );
    }

    const custData =
      (result as Record<string, unknown>).Customer || result;
    const custId =
      (custData as Record<string, unknown>).Id || "unknown";

    return NextResponse.json({
      ok: true,
      customer_id: custId,
      name: body.name,
      message: `Created customer "${body.name}" (ID: ${custId})`,
    });
  } catch (error) {
    console.error("[qbo/customer] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Customer creation failed" },
      { status: 500 },
    );
  }
}
