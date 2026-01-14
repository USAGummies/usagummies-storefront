import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  createCustomerAccessToken,
  deleteCustomerAccessToken,
  getCustomerOrders,
  recoverCustomer,
} from "@/lib/shopify/customer";

const CUSTOMER_COOKIE = "usa_customer_token";

type Body = {
  action?: "login" | "recover" | "logout" | "session";
  email?: string;
  password?: string;
};

function json(data: any, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setCustomerCookie(res: NextResponse, token: string, expiresAt?: string | null) {
  let maxAge = 60 * 60 * 24 * 30;
  if (expiresAt) {
    const expiresMs = new Date(expiresAt).getTime();
    if (Number.isFinite(expiresMs)) {
      const diff = Math.max(60, Math.floor((expiresMs - Date.now()) / 1000));
      maxAge = diff;
    }
  }
  res.cookies.set(CUSTOMER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge,
    path: "/",
  });
}

function clearCustomerCookie(res: NextResponse) {
  res.cookies.set(CUSTOMER_COOKIE, "", {
    maxAge: 0,
    path: "/",
  });
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  const action = body.action ?? "session";

  if (action === "login") {
    const email = String(body.email || "").trim();
    const password = String(body.password || "").trim();
    if (!email || !password) {
      return json({ ok: false, error: "Email and password are required." }, 400);
    }
    const result = await createCustomerAccessToken(email, password);
    if (!result.ok) {
      return json({ ok: false, error: result.error || "Unable to sign in." }, 400);
    }
    const res = json({ ok: true });
    setCustomerCookie(res, result.accessToken, result.expiresAt);
    return res;
  }

  if (action === "recover") {
    const email = String(body.email || "").trim();
    if (!email) {
      return json({ ok: false, error: "Email is required." }, 400);
    }
    const result = await recoverCustomer(email);
    if (!result.ok) {
      return json({ ok: false, error: result.error || "Unable to send reset email." }, 400);
    }
    return json({ ok: true });
  }

  if (action === "logout") {
    const cookieStore = await cookies();
    const token = cookieStore.get(CUSTOMER_COOKIE)?.value;
    if (token) {
      await deleteCustomerAccessToken(token).catch(() => null);
    }
    const res = json({ ok: true });
    clearCustomerCookie(res);
    return res;
  }

  if (action === "session") {
    const cookieStore = await cookies();
    const token = cookieStore.get(CUSTOMER_COOKIE)?.value;
    if (!token) {
      return json({ ok: false, error: "Not signed in." }, 401);
    }
    const customer = await getCustomerOrders(token);
    if (!customer) {
      const res = json({ ok: false, error: "Session expired." }, 401);
      clearCustomerCookie(res);
      return res;
    }
    return json({ ok: true, customer });
  }

  return json({ ok: false, error: "Unsupported action." }, 400);
}
