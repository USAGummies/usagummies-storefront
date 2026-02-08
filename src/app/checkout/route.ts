import { NextResponse } from "next/server";
import { normalizeCheckoutUrl } from "@/lib/checkout";

export function GET(req: Request) {
  const url = new URL(req.url);
  const candidate = `${url.origin}${url.pathname}${url.search}`;
  const target = normalizeCheckoutUrl(candidate);
  if (!target) {
    const response = NextResponse.redirect(new URL("/", url.origin));
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }
  const response = NextResponse.redirect(target);
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
