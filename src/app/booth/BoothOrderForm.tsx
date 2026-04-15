"use client";

import { useState } from "react";

type FormState = "idle" | "submitting" | "success" | "error";
type PricingTier = "standard" | "pallet";
type PaymentMethod = "pay_now" | "invoice_me";

export function BoothOrderForm() {
  const [state, setState] = useState<FormState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [shipAddress, setShipAddress] = useState("");
  const [shipCity, setShipCity] = useState("");
  const [shipState, setShipState] = useState("");
  const [shipZip, setShipZip] = useState("");
  const [quantityCases, setQuantityCases] = useState("1");
  const [pricingTier, setPricingTier] = useState<PricingTier>("standard");
  const [showDeal, setShowDeal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("invoice_me");
  const [notes, setNotes] = useState("");

  const qty = Math.max(1, Number(quantityCases) || 1);
  const bagsPerCase = 36;
  const totalBags = qty * bagsPerCase;
  const basePrice = pricingTier === "pallet" ? 3.0 : 3.25;
  // Pay-Now customers get a 5% prepay discount on the standard tier. Pallet
  // already has volume pricing so no extra discount. Rounded to 2 decimals
  // so the displayed per-bag price × quantity == displayed total (customer
  // can verify the math on their own).
  const prepayMultiplier =
    paymentMethod === "pay_now" && pricingTier === "standard" ? 0.95 : 1;
  const pricePerBag = Math.round(basePrice * prepayMultiplier * 100) / 100;
  const subtotal = Number((totalBags * pricePerBag).toFixed(2));
  const freightNote =
    pricingTier === "standard" || showDeal
      ? "Free shipping included"
      : "Freight — buyer pays shipping";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("submitting");
    setErrorMsg("");

    try {
      const res = await fetch("/api/booth-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName.trim(),
          contact_name: contactName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          ship_address: shipAddress.trim(),
          ship_city: shipCity.trim(),
          ship_state: shipState.trim(),
          ship_zip: shipZip.trim(),
          quantity_cases: qty,
          pricing_tier: pricingTier,
          show_deal: showDeal,
          payment_method: paymentMethod,
          notes: notes.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || "Order submission failed. Please try again.");
        setState("error");
        return;
      }
      // If Pay Now, the API returns a Shop Pay checkout URL — redirect the
      // browser immediately so the customer can complete payment.
      if (paymentMethod === "pay_now" && data.payment_url) {
        window.location.href = data.payment_url;
        return;
      }
      setState("success");
    } catch {
      setErrorMsg("Network error. Please check your connection and try again.");
      setState("error");
    }
  };

  if (state === "success") {
    return (
      <div className="text-center py-10">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-xl font-bold text-[#0a1e3d] mb-2">Order Submitted!</h3>
        <p className="text-sm text-gray-600 max-w-xs mx-auto">
          Thank you! Our team has been notified and will follow up with a quote
          and invoice. You&apos;ll hear from us shortly.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Company Info */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-[#0a1e3d] uppercase tracking-wide">
          Your Info
        </h3>
        <div>
          <label htmlFor="company_name" className="block text-sm font-medium text-gray-700 mb-1">
            Company Name *
          </label>
          <input
            id="company_name"
            type="text"
            required
            autoComplete="organization"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="e.g. Jungle Jim's International Market"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
          />
        </div>
        <div>
          <label htmlFor="contact_name" className="block text-sm font-medium text-gray-700 mb-1">
            Contact Name *
          </label>
          <input
            id="contact_name"
            type="text"
            required
            autoComplete="name"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="Your name"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Email *
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
          />
        </div>
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
            Phone
          </label>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 123-4567"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
          />
        </div>
      </div>

      {/* Shipping Address */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-[#0a1e3d] uppercase tracking-wide">
          Shipping Address
        </h3>
        <div>
          <input
            type="text"
            autoComplete="street-address"
            value={shipAddress}
            onChange={(e) => setShipAddress(e.target.value)}
            placeholder="Street address"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
          />
        </div>
        <div className="grid grid-cols-5 gap-3">
          <input
            type="text"
            autoComplete="address-level2"
            value={shipCity}
            onChange={(e) => setShipCity(e.target.value)}
            placeholder="City"
            className="col-span-2 px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
          />
          <input
            type="text"
            autoComplete="address-level1"
            value={shipState}
            onChange={(e) => setShipState(e.target.value.toUpperCase())}
            placeholder="State"
            maxLength={2}
            className="col-span-1 px-4 py-3 border border-gray-300 rounded-lg text-base text-center uppercase focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
          />
          <input
            type="text"
            inputMode="numeric"
            autoComplete="postal-code"
            value={shipZip}
            onChange={(e) => setShipZip(e.target.value)}
            placeholder="ZIP"
            className="col-span-2 px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
          />
        </div>
      </div>

      {/* Order Details */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-[#0a1e3d] uppercase tracking-wide">
          Order
        </h3>

        {/* Quantity */}
        <div>
          <label htmlFor="quantity" className="block text-sm font-medium text-gray-700 mb-1">
            Master Cases (36 bags each)
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setQuantityCases(String(Math.max(1, qty - 1)))}
              className="w-12 h-12 rounded-lg border border-gray-300 text-xl font-bold text-gray-600 hover:bg-gray-50 flex items-center justify-center"
            >
              -
            </button>
            <input
              id="quantity"
              type="number"
              min="1"
              value={quantityCases}
              onChange={(e) => setQuantityCases(e.target.value)}
              className="w-20 px-4 py-3 border border-gray-300 rounded-lg text-base text-center focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
            />
            <button
              type="button"
              onClick={() => setQuantityCases(String(qty + 1))}
              className="w-12 h-12 rounded-lg border border-gray-300 text-xl font-bold text-gray-600 hover:bg-gray-50 flex items-center justify-center"
            >
              +
            </button>
            <span className="text-sm text-gray-500">{totalBags} bags</span>
          </div>
        </div>

        {/* Pricing Tier */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Pricing Tier
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setPricingTier("standard")}
              className={`p-4 rounded-lg border-2 text-left transition-colors ${
                pricingTier === "standard"
                  ? "border-[#b22234] bg-red-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="text-sm font-semibold text-[#0a1e3d]">Standard</div>
              <div className="text-lg font-bold text-[#b22234]">$3.25/bag</div>
              <div className="text-xs text-gray-500 mt-1">Free shipping</div>
            </button>
            <button
              type="button"
              onClick={() => setPricingTier("pallet")}
              className={`p-4 rounded-lg border-2 text-left transition-colors ${
                pricingTier === "pallet"
                  ? "border-[#b22234] bg-red-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="text-sm font-semibold text-[#0a1e3d]">Pallet</div>
              <div className="text-lg font-bold text-[#b22234]">$3.00/bag</div>
              <div className="text-xs text-gray-500 mt-1">Buyer pays freight</div>
            </button>
          </div>
        </div>

        {/* Show Deal CTA */}
        <button
          type="button"
          onClick={() => setShowDeal(!showDeal)}
          className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
            showDeal
              ? "border-green-600 bg-green-50"
              : "border-gray-200 hover:border-green-400 bg-white"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-[#0a1e3d]">
                🎪 Show Special — FREE Shipping
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                Freight absorbed on all show orders
              </div>
            </div>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
              showDeal ? "bg-green-600" : "bg-gray-200"
            }`}>
              {showDeal && (
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </div>
        </button>

        {/* Payment method picker */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            How would you like to pay?
          </label>
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setPaymentMethod("pay_now")}
              className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                paymentMethod === "pay_now"
                  ? "border-[#b22234] bg-red-50"
                  : "border-gray-200 hover:border-gray-300 bg-white"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-[#0a1e3d]">
                    💳 Pay now by card
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Shop Pay · Visa · MC · Amex · ACH — 5% prepay discount
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  paymentMethod === "pay_now" ? "border-[#b22234]" : "border-gray-300"
                }`}>
                  {paymentMethod === "pay_now" && (
                    <div className="w-2.5 h-2.5 rounded-full bg-[#b22234]" />
                  )}
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod("invoice_me")}
              className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                paymentMethod === "invoice_me"
                  ? "border-[#b22234] bg-red-50"
                  : "border-gray-200 hover:border-gray-300 bg-white"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-[#0a1e3d]">
                    📄 Invoice me, Net 10
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    We&apos;ll email an invoice — pay by ACH, check, or card link
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  paymentMethod === "invoice_me" ? "border-[#b22234]" : "border-gray-300"
                }`}>
                  {paymentMethod === "invoice_me" && (
                    <div className="w-2.5 h-2.5 rounded-full bg-[#b22234]" />
                  )}
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Order Summary */}
        <div className="bg-[#f8f5f0] rounded-lg p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">
              {totalBags} bags × ${pricePerBag.toFixed(2)}
              {paymentMethod === "pay_now" && pricingTier === "standard" ? " (5% prepay)" : ""}
            </span>
            <span className="font-semibold text-[#0a1e3d]">${subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Shipping</span>
            <span className="font-medium text-[#0a1e3d]">{freightNote}</span>
          </div>
          {(pricingTier === "standard" || showDeal) && (
            <div className="text-xs text-green-700 text-right">
              Show special — shipping shown on invoice at 100% discount
            </div>
          )}
          <div className="border-t border-gray-200 pt-2 flex justify-between">
            <span className="text-sm font-semibold text-[#0a1e3d]">Order total</span>
            <span className="text-lg font-bold text-[#0a1e3d]">${subtotal.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
          Notes (optional)
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Anything else we should know..."
          className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none resize-none"
        />
      </div>

      {/* Error */}
      {state === "error" && errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
          {errorMsg}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={state === "submitting"}
        className="w-full bg-[#b22234] text-white font-semibold py-4 px-6 rounded-lg hover:bg-[#8b1a29] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-base"
      >
        {state === "submitting"
          ? paymentMethod === "pay_now"
            ? "Opening secure checkout…"
            : "Submitting…"
          : paymentMethod === "pay_now"
            ? `Continue to payment · $${subtotal.toFixed(2)}`
            : "Submit order"}
      </button>

      <p className="text-xs text-gray-400 text-center">
        {paymentMethod === "pay_now"
          ? "You'll be redirected to a secure Shop Pay checkout to complete payment."
          : "You'll receive a welcome email with a short form to finish setup. No charge yet."}
      </p>
    </form>
  );
}
