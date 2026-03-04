import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

type PhotoData = {
  data: string; // base64
  type: string; // mime type
  name: string;
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const photo = await kv.get<PhotoData>(`review:photo:${id}`);

  if (!photo) {
    return new NextResponse("Not found", { status: 404 });
  }

  const buffer = Buffer.from(photo.data, "base64");
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": photo.type || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
