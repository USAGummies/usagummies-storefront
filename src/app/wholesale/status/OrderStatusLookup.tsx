"use client";

import { useState } from "react";

type Deal = {
  id: string;
  name: string;
  amount: string;
  stage: string;
  stageLabel: string;
  closeDate: string;
  paymentMethod: string;
  onboardingComplete: boolean;
  paymentReceived: boolean;
  onboardingUrl: string;
};

type ApiResponse = {
  ok: boolean;
  email: string;
  contact?: { firstname: string; company: string };
  deals: Deal[];
  message?: string;
  error?: string;
};

export function OrderStatusLookup() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("loading");
    setErrorMsg("");
    setData(null);
    try {
      const res = await fetch(
        `/api/wholesale-status?email=${encodeURIComponent(email.trim().toLowerCase())}`,
      );
      const body = (await res.json()) as ApiResponse;
      if (!res.ok || !body.ok) {
        setErrorMsg(body.error || "Lookup failed. Please try again.");
        setState("error");
        return;
      }
      setData(body);
      setState("loaded");
    } catch {
      setErrorMsg("Network error. Please try again.");
      setState("error");
    }
  };

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-lg p-6 sm:p-8 space-y-4"
      >
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Email address
          </label>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">
            Use the same email you used when you placed your order.
          </p>
        </div>
        <button
          type="submit"
          disabled={state === "loading"}
          className="w-full bg-[#b22234] text-white font-semibold py-4 px-6 rounded-lg hover:bg-[#8b1a29] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-base"
        >
          {state === "loading" ? "Looking up…" : "Find my order"}
        </button>
        {state === "error" && errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
            {errorMsg}
          </div>
        )}
      </form>

      {state === "loaded" && data && (
        <div className="space-y-4">
          {data.deals.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8 text-center">
              <div className="text-4xl mb-2">🔍</div>
              <h2 className="text-xl font-bold text-[#0a1e3d] mb-2">No orders found</h2>
              <p className="text-sm text-gray-600">
                {data.message ??
                  "We couldn't find any orders for that email. Check the spelling or email ben@usagummies.com for help."}
              </p>
            </div>
          ) : (
            <>
              <div className="bg-white rounded-2xl shadow-lg p-4 text-center">
                <div className="text-xs uppercase tracking-wide text-[#0a1e3d]/60">
                  Orders for {data.contact?.firstname || data.email}
                </div>
                <div className="text-sm text-gray-600 mt-0.5">
                  {data.deals.length} order{data.deals.length === 1 ? "" : "s"} found
                </div>
              </div>
              {data.deals.map((deal) => (
                <DealCard key={deal.id} deal={deal} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DealCard({ deal }: { deal: Deal }) {
  const amountNum = Number(deal.amount) || 0;
  const amountStr = `$${amountNum.toFixed(2)}`;
  const isPayNow = deal.paymentMethod === "pay_now";
  const closedWon = deal.stage === "3502336730";
  const shipped = deal.stage === "3017718460";
  const clearToPack = deal.paymentReceived && deal.onboardingComplete;

  return (
    <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
      <div className="p-5 border-b border-gray-100">
        <div className="flex justify-between items-start gap-4">
          <div className="min-w-0">
            <div className="font-semibold text-[#0a1e3d] truncate">{deal.name}</div>
            <div className="text-sm text-gray-500 mt-1">
              {deal.stageLabel} · {isPayNow ? "Paid by card" : "Invoice / Net 10"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-[#0a1e3d]">{amountStr}</div>
          </div>
        </div>
      </div>

      <div className="px-5 py-4 bg-[#f8f5f0] space-y-2">
        <StatusRow
          label="Payment"
          done={deal.paymentReceived}
          detail={
            deal.paymentReceived
              ? "Received ✓"
              : isPayNow
                ? "Waiting for checkout"
                : "Waiting on invoice payment"
          }
        />
        <StatusRow
          label="Customer info"
          done={deal.onboardingComplete}
          detail={deal.onboardingComplete ? "Received ✓" : "Not yet submitted"}
        />
        <StatusRow label="Shipped" done={shipped || closedWon} detail={shipped || closedWon ? "On the way ✓" : "Not yet"} />
      </div>

      {(!deal.onboardingComplete || !clearToPack) && (
        <div className="px-5 py-4 border-t border-gray-100">
          {!deal.onboardingComplete && (
            <a
              href={deal.onboardingUrl}
              className="block w-full text-center bg-[#b22234] text-white font-semibold py-3 px-4 rounded-lg hover:bg-[#8b1a29] transition-colors text-sm"
            >
              {isPayNow ? "Finish setup (5 fields)" : "Submit customer info"}
            </a>
          )}
          {deal.onboardingComplete && !deal.paymentReceived && !isPayNow && (
            <p className="text-sm text-gray-600 text-center">
              ✓ Customer info submitted. Waiting on your invoice payment. Check your
              inbox for the invoice, or email ben@usagummies.com for a copy.
            </p>
          )}
          {deal.onboardingComplete && !deal.paymentReceived && isPayNow && (
            <p className="text-sm text-gray-600 text-center">
              ✓ Customer info submitted. Payment still pending — check your email
              for the Shop Pay checkout link.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StatusRow({
  label,
  done,
  detail,
}: {
  label: string;
  done: boolean;
  detail: string;
}) {
  return (
    <div className="flex justify-between items-center text-sm">
      <div className="flex items-center gap-2">
        <div
          className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
            done ? "bg-green-100" : "bg-gray-200"
          }`}
        >
          {done ? (
            <svg
              className="w-3 h-3 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M5 13l4 4L19 7"
              />
            </svg>
          ) : (
            <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
          )}
        </div>
        <span className="font-medium text-[#0a1e3d]">{label}</span>
      </div>
      <span className="text-xs text-gray-500">{detail}</span>
    </div>
  );
}
