import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/ops/abra-auth";
import { createQBOVendor } from "@/lib/ops/qbo-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      name: string;
      company_name?: string;
      email?: string;
      phone?: string;
      address?: string;
      city?: string;
      state?: string;
      zip?: string;
    };

    if (!body.name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const result = await createQBOVendor({
      DisplayName: body.name,
      CompanyName: body.company_name || body.name,
      ...(body.email
        ? { PrimaryEmailAddr: { Address: body.email } }
        : {}),
      ...(body.phone
        ? { PrimaryPhone: { FreeFormNumber: body.phone } }
        : {}),
      ...(body.address
        ? {
            BillAddr: {
              Line1: body.address,
              City: body.city || "",
              CountrySubDivisionCode: body.state || "",
              PostalCode: body.zip || "",
            },
          }
        : {}),
    });

    if (!result) {
      return NextResponse.json(
        { error: "QBO vendor creation failed — check QBO connection" },
        { status: 500 },
      );
    }

    const vendorData =
      (result as Record<string, unknown>).Vendor || result;
    const vendorId =
      (vendorData as Record<string, unknown>).Id || "unknown";

    return NextResponse.json({
      ok: true,
      vendor_id: vendorId,
      name: body.name,
      message: `Created vendor "${body.name}" (ID: ${vendorId})`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Vendor creation failed",
      },
      { status: 500 },
    );
  }
}
