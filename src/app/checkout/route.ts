import { NextResponse } from "next/server";
import { normalizeCheckoutUrl } from "@/lib/checkout";

export function GET(req: Request) {
  const url = new URL(req.url);
  const candidate = `${url.origin}${url.pathname}${url.search}`;
  const target = normalizeCheckoutUrl(candidate);
  if (!target) {
    return NextResponse.redirect(new URL("/", url.origin));
  }
  return NextResponse.redirect(target);
}
