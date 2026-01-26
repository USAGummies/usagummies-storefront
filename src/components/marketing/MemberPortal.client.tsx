"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { trackEvent } from "@/lib/analytics";

type Order = {
  id: string;
  orderNumber: number;
  processedAt: string;
  financialStatus: string;
  fulfillmentStatus: string | null;
  currentTotalPrice: { amount: string; currencyCode: string } | null;
  lineItems: Array<{ title: string; quantity: number }>;
};

type Customer = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  orders: Order[];
};

type MemberPortalProps = {
  source: string;
  variant?: "light" | "dark";
};

const STATUS_LABELS: Record<string, string> = {
  PAID: "Paid",
  PENDING: "Pending",
  AUTHORIZED: "Authorized",
  PARTIALLY_PAID: "Partially paid",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Partially refunded",
  VOIDED: "Voided",
};

const FULFILLMENT_LABELS: Record<string, string> = {
  FULFILLED: "Fulfilled",
  IN_PROGRESS: "In progress",
  PARTIALLY_FULFILLED: "Partially fulfilled",
  RESTOCKED: "Restocked",
  ON_HOLD: "On hold",
  SCHEDULED: "Scheduled",
  UNFULFILLED: "Unfulfilled",
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatMoney(amount: string, currencyCode: string) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode || "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

export function MemberPortal({ source, variant = "light" }: MemberPortalProps) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailValue, setEmailValue] = useState("");
  const [activeAction, setActiveAction] = useState<"login" | "recover" | "session" | "logout" | null>(
    null
  );

  const isDark = variant === "dark";

  const eligible = useMemo(() => (customer?.orders?.length || 0) > 0, [customer?.orders]);

  async function loadSession() {
    setActiveAction("session");
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "session" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setCustomer(null);
        setStatus("idle");
        setActiveAction(null);
        return;
      }
      setCustomer(json.customer || null);
      setStatus("ready");
      setActiveAction(null);
    } catch (err: any) {
      setCustomer(null);
      setStatus("error");
      setError(err?.message || "Unable to load member session.");
      setActiveAction(null);
    }
  }

  useEffect(() => {
    loadSession();
  }, []);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "").trim();

    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }

    setStatus("loading");
    setActiveAction("login");
    setError(null);
    setMessage(null);
    trackEvent("member_login_attempt", { source });

    try {
      const res = await fetch("/api/member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", email, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Unable to sign in.");
      }
      trackEvent("member_login_success", { source });
      form.reset();
      setEmailValue("");
      await loadSession();
    } catch (err: any) {
      setStatus("error");
      setError(err?.message || "Unable to sign in.");
      setActiveAction(null);
    }
  }

  async function handleRecover(email: string) {
    if (!email) {
      setError("Add your email to send a reset link.");
      return;
    }
    setStatus("loading");
    setActiveAction("recover");
    setError(null);
    setMessage(null);
    trackEvent("member_password_reset", { source });

    try {
      const res = await fetch("/api/member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recover", email }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Unable to send reset email.");
      }
      setMessage("Reset email sent. Check your inbox to set a password.");
      setStatus("idle");
      setActiveAction(null);
    } catch (err: any) {
      setStatus("error");
      setError(err?.message || "Unable to send reset email.");
      setActiveAction(null);
    }
  }

  async function handleLogout() {
    setStatus("loading");
    setActiveAction("logout");
    setError(null);
    try {
      await fetch("/api/member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      trackEvent("member_logout", { source });
      setCustomer(null);
      setStatus("idle");
      setActiveAction(null);
    } catch (err: any) {
      setStatus("error");
      setError(err?.message || "Unable to sign out.");
      setActiveAction(null);
    }
  }

  if (!customer) {
    return (
      <div
        className={cn(
          "rounded-2xl p-4",
          isDark
            ? "metal-panel border border-white/12 text-white"
            : "card-solid border border-[var(--border)] text-[var(--text)]"
        )}
      >
        <div className={cn("text-sm font-black", isDark ? "text-white" : "text-[var(--text)]")}>
          Member sign-in
        </div>
        <div className={cn("mt-1 text-xs", isDark ? "text-white/65" : "text-[var(--muted)]")}>
          Use the email you checked out with. If you never set a password, request a reset link.
        </div>

        <form onSubmit={handleLogin} className="mt-3 flex flex-col gap-2">
          <input
            type="email"
            name="email"
            placeholder="Email"
            value={emailValue}
            onChange={(event) => setEmailValue(event.target.value)}
            className={cn(
              "rounded-full px-4 py-2 text-sm",
              isDark
                ? "border border-white/15 bg-white/5 text-white placeholder-white/50"
                : "usa-input"
            )}
            aria-label="Email"
          />
          <input
            type="password"
            name="password"
            placeholder="Password"
            className={cn(
              "rounded-full px-4 py-2 text-sm",
              isDark
                ? "border border-white/15 bg-white/5 text-white placeholder-white/50"
                : "usa-input"
            )}
            aria-label="Password"
          />
          <button
            type="submit"
            className={cn(
              "btn pressable",
              isDark ? "btn-outline-white" : "btn-candy",
              status === "loading" && "opacity-70 pointer-events-none"
            )}
          >
            {status === "loading" && activeAction === "login"
              ? "Signing in..."
              : status === "loading"
                ? "Working..."
                : "Sign in"}
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <button
            type="button"
            className={cn("link-underline", isDark ? "text-white/70" : "text-[var(--muted)]")}
            onClick={() => handleRecover(emailValue.trim())}
          >
            Send reset link
          </button>
          <Link href="/shop" className="link-underline">
            Shop now
          </Link>
        </div>

        {message ? (
          <div className={cn("mt-2 text-xs", isDark ? "text-white/70" : "text-[var(--muted)]")}>
            {message}
          </div>
        ) : null}
        {error ? <div className="mt-2 text-xs text-[var(--red)]">{error}</div> : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-2xl p-4",
        isDark
          ? "metal-panel border border-white/12 text-white"
          : "card-solid border border-[var(--border)] text-[var(--text)]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={cn("text-sm font-black", isDark ? "text-white" : "text-[var(--text)]")}>
            Member portal
          </div>
          <div className={cn("mt-1 text-xs", isDark ? "text-white/65" : "text-[var(--muted)]")}>
            Signed in as {customer.email || "member"}.
          </div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className={cn(
            "rounded-full border px-3 py-1 text-[11px] font-semibold",
            isDark ? "border-white/20 text-white/70" : "border-[var(--border)] text-[var(--muted)]"
          )}
        >
          Sign out
        </button>
      </div>

      <div className="mt-4 grid gap-3">
        <div
          className={cn(
            "rounded-2xl border p-3",
            isDark ? "border-white/10 bg-white/5" : "border-[var(--border)] bg-[var(--surface-strong)]"
          )}
        >
          <div className={cn("text-xs font-semibold", isDark ? "text-white" : "text-[var(--text)]")}>
            Subscription access
          </div>
          <div className={cn("mt-1 text-xs", isDark ? "text-white/70" : "text-[var(--muted)]")}>
            {eligible
              ? "Eligible now. Subscription activation will be emailed to you."
              : "Eligible after your first purchase. Shop now to unlock access."}
          </div>
        </div>

        <div
          className={cn(
            "rounded-2xl border p-3",
            isDark ? "border-white/10 bg-white/5" : "border-[var(--border)] bg-[var(--surface-strong)]"
          )}
        >
          <div className={cn("text-xs font-semibold", isDark ? "text-white" : "text-[var(--text)]")}>
            Order history
          </div>
          {customer.orders.length === 0 ? (
            <div className={cn("mt-2 text-xs", isDark ? "text-white/70" : "text-[var(--muted)]")}>
              No orders found yet.
            </div>
          ) : (
            <div className="mt-2 space-y-3">
              {customer.orders.map((order) => (
                <div
                  key={order.id}
                  className={cn(
                    "rounded-xl border p-3",
                    isDark ? "border-white/10 bg-white/5" : "border-[var(--border)] bg-white"
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className={cn("font-semibold", isDark ? "text-white" : "text-[var(--text)]")}>
                      Order #{order.orderNumber}
                    </div>
                    <div className={cn(isDark ? "text-white/60" : "text-[var(--muted)]")}>
                      {formatDate(order.processedAt)}
                    </div>
                  </div>
                  <div
                    className={cn(
                      "mt-1 flex flex-wrap gap-2 text-[11px]",
                      isDark ? "text-white/65" : "text-[var(--muted)]"
                    )}
                  >
                    <span>
                      {STATUS_LABELS[order.financialStatus] || order.financialStatus}
                    </span>
                    {order.fulfillmentStatus ? (
                      <span>
                        {FULFILLMENT_LABELS[order.fulfillmentStatus] || order.fulfillmentStatus}
                      </span>
                    ) : null}
                    {order.currentTotalPrice ? (
                      <span>
                        {formatMoney(
                          order.currentTotalPrice.amount,
                          order.currentTotalPrice.currencyCode
                        )}
                      </span>
                    ) : null}
                  </div>
                  <div className={cn("mt-2 space-y-1 text-xs", isDark ? "text-white/70" : "text-[var(--muted)]")}>
                    {order.lineItems.map((item) => (
                      <div key={`${order.id}-${item.title}`} className="flex justify-between gap-2">
                        <span>{item.title}</span>
                        <span>x{item.quantity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {error ? <div className="mt-2 text-xs text-[var(--red)]">{error}</div> : null}
    </div>
  );
}
