"use client";

import { useEffect, useState } from "react";

import { addToCart } from "@/lib/cart";
import {
  formatFinancialStatus,
  formatFulfillmentStatus,
  formatOrderDate,
  formatOrderTotal,
  greetingFor,
  shouldQueryB2BStatus,
  type CustomerOrderShape,
  type CustomerSummaryShape,
} from "@/lib/account/display";
import {
  copyForSkipReason,
  intentFromOrder,
  type ReorderIntent,
} from "@/lib/account/reorder";

interface SessionResponse {
  ok: boolean;
  customer?: CustomerSummaryShape;
  error?: string;
}

interface B2BDeal {
  id: string;
  name: string;
  amount: string;
  stage: string;
  stageLabel: string;
  paymentMethod: string;
  onboardingComplete: boolean;
  paymentReceived: boolean;
  onboardingUrl: string;
}

interface B2BResponse {
  ok: boolean;
  email?: string;
  contact?: { firstname: string; company: string };
  deals?: B2BDeal[];
  message?: string;
  error?: string;
}

type ViewState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "signed-in"; customer: CustomerSummaryShape }
  | { kind: "error"; message: string };

export function AccountView() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [b2b, setB2b] = useState<B2BResponse | null>(null);
  const [b2bErr, setB2bErr] = useState<string | null>(null);
  const [b2bLoading, setB2bLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/member", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "session" }),
        });
        if (cancelled) return;
        if (res.status === 401) {
          window.location.href = "/account/login";
          return;
        }
        const data = (await res.json().catch(() => ({}))) as SessionResponse;
        if (!res.ok || data.ok !== true || !data.customer) {
          setView({
            kind: "error",
            message: data.error ?? `HTTP ${res.status}`,
          });
          return;
        }
        setView({ kind: "signed-in", customer: data.customer });

        // Best-effort B2B lookup. Skip the noise for consumer mailboxes
        // — see shouldQueryB2BStatus comment in display.ts.
        const email = data.customer.email;
        if (shouldQueryB2BStatus(email)) {
          setB2bLoading(true);
          try {
            const r = await fetch(
              `/api/wholesale-status?email=${encodeURIComponent(email!)}`,
              { cache: "no-store" },
            );
            const body = (await r.json()) as B2BResponse;
            if (!cancelled) {
              if (!r.ok || body.ok !== true) {
                setB2bErr(body.error ?? `HTTP ${r.status}`);
              } else {
                setB2b(body);
              }
            }
          } catch (err) {
            if (!cancelled)
              setB2bErr(err instanceof Error ? err.message : String(err));
          } finally {
            if (!cancelled) setB2bLoading(false);
          }
        }
      } catch (err) {
        if (!cancelled)
          setView({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    setSigningOut(true);
    try {
      await fetch("/api/member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
    } catch {
      // Even on logout error, send the user away — the cookie is the
      // important thing and the route clears it on success or failure.
    }
    window.location.href = "/account/login";
  }

  if (view.kind === "loading") {
    return (
      <main className="max-w-3xl mx-auto px-6 py-12 text-[#0a1e3d]">
        <p className="text-sm text-gray-500">Loading your account…</p>
      </main>
    );
  }

  if (view.kind === "signed-out") {
    return (
      <main className="max-w-md mx-auto px-6 py-16 text-[#0a1e3d]">
        <p className="text-sm text-gray-600">
          You&apos;re signed out.{" "}
          <a href="/account/login" className="text-[#b22234] underline">
            Sign in
          </a>
        </p>
      </main>
    );
  }

  if (view.kind === "error") {
    return (
      <main className="max-w-md mx-auto px-6 py-16 text-[#0a1e3d]">
        <h1 className="text-xl font-bold mb-2">Account temporarily unavailable</h1>
        <p className="text-sm text-gray-600">
          {view.message}. Try{" "}
          <a href="/account/login" className="text-[#b22234] underline">
            signing in again
          </a>{" "}
          or email ben@usagummies.com.
        </p>
      </main>
    );
  }

  const c = view.customer;

  return (
    <main className="max-w-3xl mx-auto px-6 py-12 text-[#0a1e3d]">
      <header className="mb-10 flex justify-between items-start gap-4 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500">
            USA Gummies · Account
          </div>
          <h1 className="text-3xl font-bold mt-1">{greetingFor(c)}</h1>
          {c.email && (
            <p className="text-sm text-gray-500 mt-1">Signed in as {c.email}</p>
          )}
        </div>
        <button
          onClick={logout}
          disabled={signingOut}
          className="text-xs px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </header>

      <OrdersSection orders={c.orders} />

      <B2BSection
        loading={b2bLoading}
        data={b2b}
        error={b2bErr}
        emailQueried={shouldQueryB2BStatus(c.email)}
      />

      <footer className="mt-12 text-center text-xs text-gray-400">
        Need help? Email{" "}
        <a href="mailto:ben@usagummies.com" className="underline">
          ben@usagummies.com
        </a>
      </footer>
    </main>
  );
}

function OrdersSection({ orders }: { orders: CustomerOrderShape[] }) {
  return (
    <section className="bg-white rounded-2xl shadow-md p-6 mb-6">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#b22234]">
          Recent orders
        </h2>
        <span className="text-xs text-gray-500">
          Showing the last {orders.length}
        </span>
      </div>
      {orders.length === 0 ? (
        <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-md p-4">
          You don&apos;t have any orders yet.{" "}
          <a href="/" className="text-[#b22234] underline">
            Browse the storefront
          </a>{" "}
          or{" "}
          <a href="/wholesale" className="text-[#b22234] underline">
            request wholesale pricing
          </a>
          .
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {orders.map((o) => (
            <OrderRow key={o.id} order={o} />
          ))}
        </ul>
      )}
    </section>
  );
}

function OrderRow({ order }: { order: CustomerOrderShape }) {
  const intent = intentFromOrder(order);
  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Order #{order.orderNumber}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {formatOrderDate(order.processedAt)} ·{" "}
            {formatFinancialStatus(order.financialStatus)} ·{" "}
            {formatFulfillmentStatus(order.fulfillmentStatus)}
          </div>
          {order.lineItems.length > 0 && (
            <div className="text-xs text-gray-500 mt-0.5 truncate">
              {order.lineItems
                .slice(0, 3)
                .map((li) => `${li.quantity}× ${li.title}`)
                .join(" · ")}
              {order.lineItems.length > 3
                ? ` +${order.lineItems.length - 3} more`
                : ""}
            </div>
          )}
        </div>
        <div className="text-sm font-bold whitespace-nowrap">
          {formatOrderTotal(order.currentTotalPrice)}
        </div>
      </div>
      <ReorderControls intent={intent} />
    </li>
  );
}

function ReorderControls({ intent }: { intent: ReorderIntent }) {
  const [state, setState] = useState<"idle" | "adding" | "added" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  // Nothing to add and nothing to flag → keep the row clean.
  if (!intent.hasAnyAddable && intent.skipped.length === 0) {
    return null;
  }

  async function handleClick() {
    setState("adding");
    setError(null);
    try {
      // Sequential calls through the existing single-variant
      // `addToCart` server action. Shopify computes the current price.
      for (const item of intent.addable) {
        await addToCart(item.variantId, item.quantity);
      }
      setState("added");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }

  return (
    <div className="mt-2 flex items-center gap-3 flex-wrap">
      {intent.hasAnyAddable && state !== "added" && (
        <button
          onClick={handleClick}
          disabled={state === "adding"}
          className="text-xs px-3 py-1.5 rounded-md bg-[#b22234] text-white font-semibold hover:bg-[#8b1a29] disabled:opacity-50"
        >
          {state === "adding"
            ? "Adding…"
            : intent.addable.length === 1
              ? `Buy this again (${intent.addable[0].quantity})`
              : `Buy these again (${intent.addable.reduce(
                  (n, a) => n + a.quantity,
                  0,
                )})`}
        </button>
      )}
      {state === "added" && (
        <span className="text-xs text-green-700">
          Added to your cart.{" "}
          <a href="/cart" className="underline">
            Open cart →
          </a>
        </span>
      )}
      {state === "error" && error && (
        <span className="text-xs text-red-700">
          Couldn&apos;t add to cart: {error}
        </span>
      )}
      {intent.skipped.length > 0 && (
        <span className="text-xs text-gray-500">
          Skipped:{" "}
          {intent.skipped
            .map((s) => `"${s.title}" ${copyForSkipReason(s.reason)}`)
            .join("; ")}
          .
        </span>
      )}
    </div>
  );
}

function B2BSection({
  loading,
  data,
  error,
  emailQueried,
}: {
  loading: boolean;
  data: B2BResponse | null;
  error: string | null;
  emailQueried: boolean;
}) {
  // Hide the section entirely when we deliberately skipped the lookup
  // (consumer mailbox). Only DTC customers — most accounts — see this.
  if (!emailQueried) return null;

  if (loading) {
    return (
      <section className="bg-white rounded-2xl shadow-md p-6 mb-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#b22234] mb-3">
          Wholesale status
        </h2>
        <p className="text-sm text-gray-500">Checking your B2B pipeline…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="bg-white rounded-2xl shadow-md p-6 mb-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#b22234] mb-3">
          Wholesale status
        </h2>
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
          B2B status is temporarily unavailable: {error}. Email
          ben@usagummies.com for an update.
        </p>
      </section>
    );
  }

  // Hide the panel when there are no deals — DTC-only users with a
  // business-domain email shouldn't see an empty wholesale section.
  if (!data || !data.deals || data.deals.length === 0) {
    return null;
  }

  return (
    <section className="bg-white rounded-2xl shadow-md p-6 mb-6">
      <h2 className="text-sm font-bold uppercase tracking-wide text-[#b22234] mb-3">
        Wholesale status
      </h2>
      <p className="text-xs text-gray-500 mb-4">
        Read-only view of your open USA Gummies B2B deals. To submit customer
        info on a deal, use the link inside the deal card.
      </p>
      <div className="space-y-3">
        {data.deals.map((d) => (
          <DealCard key={d.id} deal={d} />
        ))}
      </div>
    </section>
  );
}

function DealCard({ deal }: { deal: B2BDeal }) {
  const isPayNow = deal.paymentMethod === "pay_now";
  const amountNum = Number(deal.amount) || 0;
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 flex justify-between items-center">
        <div>
          <div className="font-semibold text-sm">{deal.name}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {deal.stageLabel} · {isPayNow ? "Paid by card" : "Invoice / Net 10"}
          </div>
        </div>
        <div className="text-sm font-bold">${amountNum.toFixed(2)}</div>
      </div>
      <div className="px-4 py-3 text-xs space-y-1">
        <div className="flex justify-between">
          <span className={deal.paymentReceived ? "text-green-700" : "text-gray-500"}>
            {deal.paymentReceived ? "✓ Payment received" : "• Payment pending"}
          </span>
          <span
            className={deal.onboardingComplete ? "text-green-700" : "text-gray-500"}
          >
            {deal.onboardingComplete
              ? "✓ Customer info on file"
              : "• Customer info pending"}
          </span>
        </div>
      </div>
      {!deal.onboardingComplete && (
        <a
          href={deal.onboardingUrl}
          className="block text-center bg-[#b22234] text-white text-sm font-semibold py-2 hover:bg-[#8b1a29]"
        >
          Submit customer info →
        </a>
      )}
    </div>
  );
}
