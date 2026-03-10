import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  getMonthlySpend,
  getSpendByDepartment,
  getSpendByModel,
} from "@/lib/ops/abra-cost-tracker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const breakdown = url.searchParams.get("breakdown") || "summary";

    const monthly = await getMonthlySpend();

    if (breakdown === "department") {
      const byDept = await getSpendByDepartment();
      return NextResponse.json({ ...monthly, byDepartment: byDept });
    }

    if (breakdown === "model") {
      const byModel = await getSpendByModel();
      return NextResponse.json({ ...monthly, byModel });
    }

    return NextResponse.json(monthly);
  } catch (error) {
    console.error("[cost] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch cost data" },
      { status: 500 },
    );
  }
}
