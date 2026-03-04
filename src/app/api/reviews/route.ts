import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import crypto from "node:crypto";

function json(data: unknown, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type StoredReview = {
  id: string;
  rating: number;
  name: string;
  email: string;
  title: string;
  body: string;
  photoKeys: string[];
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

// ---------------------------------------------------------------------------
// POST — submit a review
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return json({ ok: false, error: "Invalid form data." }, 400);
  }

  const rating = Number(formData.get("rating") || 0);
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const title = String(formData.get("title") || "").trim();
  const body = String(formData.get("body") || "").trim();

  // Validation
  if (rating < 1 || rating > 5) {
    return json({ ok: false, error: "Rating must be between 1 and 5." }, 400);
  }
  if (!name || name.length > 60) {
    return json({ ok: false, error: "Name is required (max 60 chars)." }, 400);
  }
  if (!email || !email.includes("@")) {
    return json({ ok: false, error: "Valid email is required." }, 400);
  }
  if (!body || body.length < 10) {
    return json({ ok: false, error: "Review must be at least 10 characters." }, 400);
  }
  if (body.length > 1500) {
    return json({ ok: false, error: "Review must be 1500 characters or fewer." }, 400);
  }
  if (title.length > 120) {
    return json({ ok: false, error: "Title must be 120 characters or fewer." }, 400);
  }

  // Rate limit: max 3 reviews per email per day
  const rateLimitKey = `review:ratelimit:${email}:${new Date().toISOString().slice(0, 10)}`;
  const dailyCount = (await kv.get<number>(rateLimitKey)) || 0;
  if (dailyCount >= 3) {
    return json({ ok: false, error: "You can submit up to 3 reviews per day." }, 429);
  }

  // Process photos — store as base64 in KV (simple approach for now)
  const photoKeys: string[] = [];
  const photos = formData.getAll("photos") as File[];
  for (const photo of photos.slice(0, 3)) {
    if (!(photo instanceof File) || !photo.type.startsWith("image/")) continue;
    if (photo.size > 5 * 1024 * 1024) continue; // 5MB max

    const buffer = Buffer.from(await photo.arrayBuffer());
    const photoId = crypto.randomUUID();
    const photoKey = `review:photo:${photoId}`;
    // Store photo as base64 with content type, expire after 1 year
    await kv.set(
      photoKey,
      { data: buffer.toString("base64"), type: photo.type, name: photo.name },
      { ex: 365 * 86400 },
    );
    photoKeys.push(photoId);
  }

  // Store review
  const reviewId = crypto.randomUUID();
  const review: StoredReview = {
    id: reviewId,
    rating,
    name,
    email,
    title,
    body,
    photoKeys,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  await kv.set(`review:${reviewId}`, review);

  // Add to review index (list of review IDs)
  const index = (await kv.get<string[]>("review:index")) || [];
  index.push(reviewId);
  await kv.set("review:index", index);

  // Increment rate limit counter
  await kv.set(rateLimitKey, dailyCount + 1, { ex: 86400 });

  // Notify ops team (fire-and-forget)
  notifyNewReview(review).catch(() => {});

  return json({ ok: true, reviewId });
}

// ---------------------------------------------------------------------------
// GET — fetch approved reviews (public) or all reviews (with admin key)
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const adminKey = searchParams.get("admin");
  const isAdmin = adminKey === process.env.OPS_API_KEY;

  const index = (await kv.get<string[]>("review:index")) || [];
  if (!index.length) {
    return json({ ok: true, reviews: [] });
  }

  // Fetch all reviews from index
  const pipeline = kv.pipeline();
  for (const id of index) {
    pipeline.get(`review:${id}`);
  }
  const results = await pipeline.exec();

  const reviews = (results as (StoredReview | null)[])
    .filter((r): r is StoredReview => r !== null)
    .filter((r) => isAdmin || r.status === "approved")
    .map((r) => ({
      id: r.id,
      rating: r.rating,
      name: r.name,
      title: r.title,
      body: r.body,
      hasPhotos: r.photoKeys.length > 0,
      photoCount: r.photoKeys.length,
      photoKeys: r.photoKeys,
      status: isAdmin ? r.status : undefined,
      email: isAdmin ? r.email : undefined,
      createdAt: r.createdAt,
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return json({ ok: true, reviews });
}

// ---------------------------------------------------------------------------
// Notify ops team about new review
// ---------------------------------------------------------------------------
async function notifyNewReview(review: StoredReview) {
  try {
    const { sendOpsEmail } = await import("@/lib/ops/email");
    await sendOpsEmail({
      to: "ben@usagummies.com",
      subject: `New Review (${review.rating}★) from ${review.name}`,
      body: [
        `New review submitted:`,
        "",
        `Rating: ${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}`,
        `Name: ${review.name}`,
        `Email: ${review.email}`,
        review.title ? `Title: ${review.title}` : "",
        `Review: ${review.body}`,
        review.photoKeys.length > 0 ? `Photos: ${review.photoKeys.length} attached` : "",
        "",
        `Approve at: ${process.env.NEXT_PUBLIC_SITE_URL || "https://www.usagummies.com"}/ops/reviews`,
      ]
        .filter(Boolean)
        .join("\n"),
      allowRepeat: true,
    });
  } catch (err) {
    console.warn("[reviews] Could not send notification:", err);
  }
}
