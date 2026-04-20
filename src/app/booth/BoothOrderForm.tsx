"use client";

import { useEffect, useRef, useState } from "react";

type FormState = "idle" | "submitting" | "success" | "error";
type Step = "capture" | "order";
type PackagingType = "case" | "master_carton" | "pallet";
type PaymentMethod = "pay_now" | "invoice_me";
type DeliveryMethod = "shipping" | "in_person";

type FreightQuote = {
  rate: number;
  carrier: string;
  service: string;
  delivery_days: number | null;
};

type FreightStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; quote: FreightQuote }
  | { kind: "error"; message: string };

const PACK_LABELS: Record<PackagingType, string> = {
  case: "Case",
  master_carton: "Master Case",
  pallet: "Pallet",
};

const PACK_SUBLABELS: Record<PackagingType, string> = {
  case: "6 bags",
  master_carton: "36 bags",
  pallet: "25 master cases · 900 bags",
};

const BAGS_PER_PACK: Record<PackagingType, number> = {
  case: 6,
  master_carton: 36,
  pallet: 900,
};

function getBasePrice(packagingType: PackagingType, qty: number) {
  if (packagingType === "pallet") {
    return 3;
  }
  if (packagingType === "master_carton") {
    return qty >= 6 ? 3.1 : 3.25;
  }
  return 3.49;
}

export function BoothOrderForm() {
  const formRef = useRef<HTMLFormElement>(null);

  const [step, setStep] = useState<Step>("capture");
  const [state, setState] = useState<FormState>("idle");
  const [capturePending, setCapturePending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [shipAddress, setShipAddress] = useState("");
  const [shipCity, setShipCity] = useState("");
  const [shipState, setShipState] = useState("");
  const [shipZip, setShipZip] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [packagingType, setPackagingType] = useState<PackagingType>("case");
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("in_person");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("pay_now");
  const [notes, setNotes] = useState("");
  const [freight, setFreight] = useState<FreightStatus>({ kind: "idle" });

  const contactName = `${firstName.trim()} ${lastName.trim()}`.trim();
  const qty = Math.max(1, Number(quantity) || 1);
  const bagsPerPack = BAGS_PER_PACK[packagingType];
  const totalBags = qty * bagsPerPack;
  const basePrice = getBasePrice(packagingType, qty);
  const prepayEligible = packagingType === "master_carton";
  const prepayMultiplier =
    paymentMethod === "pay_now" && prepayEligible ? 0.95 : 1;
  const pricePerBag = Number((basePrice * prepayMultiplier).toFixed(2));
  const subtotal = Number((totalBags * pricePerBag).toFixed(2));
  const freightAmount =
    deliveryMethod === "shipping" && freight.kind === "ok"
      ? freight.quote.rate
      : 0;
  const orderTotal = Number((subtotal + freightAmount).toFixed(2));
  const stateOk = /^[A-Z]{2}$/.test(shipState);
  const zipOk = /^\d{5}(-\d{4})?$/.test(shipZip);
  const wantsFreightQuote = step === "order" && deliveryMethod === "shipping";
  const infoLocked = step === "order";

  useEffect(() => {
    if (!wantsFreightQuote) {
      setFreight({ kind: "idle" });
      return;
    }
    if (!stateOk || !zipOk) {
      setFreight({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setFreight({ kind: "loading" });
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/booth-order/freight-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to_state: shipState,
            to_zip: shipZip,
            qty,
            packaging_type: packagingType,
          }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setFreight({
            kind: "error",
            message: data.error || "Freight quote unavailable",
          });
          return;
        }
        setFreight({
          kind: "ok",
          quote: {
            rate: data.rate,
            carrier: data.carrier,
            service: data.service,
            delivery_days: data.delivery_days,
          },
        });
      } catch {
        if (!cancelled) {
          setFreight({
            kind: "error",
            message: "Couldn't reach the shipping calculator",
          });
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [wantsFreightQuote, stateOk, zipOk, shipState, shipZip, qty, packagingType, step]);

  const handleUnlockPricing = async () => {
    setErrorMsg("");
    setState("idle");
    if (!formRef.current?.reportValidity()) {
      return;
    }

    setCapturePending(true);
    try {
      const res = await fetch("/api/booth-order/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName.trim(),
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          ship_address: shipAddress.trim(),
          ship_city: shipCity.trim(),
          ship_state: shipState.trim().toUpperCase(),
          ship_zip: shipZip.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || "Could not save your info. Please try again.");
        return;
      }
      setStep("order");
      setState("idle");
      setFreight({ kind: "idle" });
    } catch {
      setErrorMsg("Network error. Please try again.");
    } finally {
      setCapturePending(false);
    }
  };

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
          contact_name: contactName,
          email: email.trim(),
          phone: phone.trim(),
          ship_address: shipAddress.trim(),
          ship_city: shipCity.trim(),
          ship_state: shipState.trim().toUpperCase(),
          ship_zip: shipZip.trim(),
          quantity: qty,
          packaging_type: packagingType,
          delivery_method: deliveryMethod,
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
      if (paymentMethod === "pay_now") {
        if (data.payment_url) {
          window.location.href = data.payment_url;
          return;
        }
        setErrorMsg(
          "Card checkout is temporarily unavailable. Switch to invoice terms or try again in a moment.",
        );
        setState("error");
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
          Your order is in our wholesale queue. No extra onboarding step is required.
          Check your email for your invoice if you selected Net 10 terms.
        </p>
      </div>
    );
  }

  const freightBlocking =
    wantsFreightQuote &&
    (freight.kind !== "ok" || !(stateOk && zipOk));
  const submitDisabled =
    state === "submitting" ||
    freightBlocking;

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-[#0a1e3d] uppercase tracking-wide">
            Business Info
          </h3>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {step === "capture" ? "Step 1 of 2" : "Step 2 of 2"}
          </span>
        </div>

        <div>
          <label htmlFor="company_name" className="block text-sm font-medium text-gray-700 mb-1">
            Company Name *
          </label>
          <input
            id="company_name"
            type="text"
            required
            disabled={infoLocked}
            autoComplete="organization"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Store, hotel, event buyer, or distributor"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="first_name" className="block text-sm font-medium text-gray-700 mb-1">
              First Name *
            </label>
            <input
              id="first_name"
              type="text"
              required
              disabled={infoLocked}
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>
          <div>
            <label htmlFor="last_name" className="block text-sm font-medium text-gray-700 mb-1">
              Last Name *
            </label>
            <input
              id="last_name"
              type="text"
              required
              disabled={infoLocked}
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>
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
            disabled={infoLocked}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>

        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
            Phone *
          </label>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            disabled={infoLocked}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 123-4567"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-[#0a1e3d] uppercase tracking-wide">
            Delivery Address
          </h3>
          <div>
            <input
              type="text"
              autoComplete="street-address"
              required
              disabled={infoLocked}
              value={shipAddress}
              onChange={(e) => setShipAddress(e.target.value)}
              placeholder="Street address"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>
          <div className="grid grid-cols-5 gap-3">
            <input
              type="text"
              autoComplete="address-level2"
              required
              disabled={infoLocked}
              value={shipCity}
              onChange={(e) => setShipCity(e.target.value)}
              placeholder="City"
              className="col-span-2 px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none disabled:bg-gray-50 disabled:text-gray-500"
            />
            <input
              type="text"
              autoComplete="address-level1"
              required
              disabled={infoLocked}
              value={shipState}
              onChange={(e) => setShipState(e.target.value.toUpperCase())}
              placeholder="State"
              maxLength={2}
              className="col-span-1 px-4 py-3 border border-gray-300 rounded-lg text-base text-center uppercase focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none disabled:bg-gray-50 disabled:text-gray-500"
            />
            <input
              type="text"
              inputMode="numeric"
              autoComplete="postal-code"
              required
              disabled={infoLocked}
              value={shipZip}
              onChange={(e) => setShipZip(e.target.value)}
              placeholder="ZIP"
              className="col-span-2 px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>
          <p className="text-xs text-gray-500">
            We capture your company and delivery details before showing wholesale pricing.
          </p>
        </div>
      </div>

      {step === "capture" ? (
        <>
          {errorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
              {errorMsg}
            </div>
          )}

          <button
            type="button"
            onClick={handleUnlockPricing}
            disabled={capturePending}
            className="w-full bg-[#0a1e3d] text-white font-semibold py-4 px-6 rounded-lg hover:bg-[#08162c] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-base"
          >
            {capturePending ? "Saving your info…" : "Submit to view wholesale pricing"}
          </button>

          <p className="text-xs text-gray-400 text-center">
            Pricing unlocks after we capture your contact and delivery details.
          </p>
        </>
      ) : (
        <>
          <div className="rounded-lg border border-[#0a1e3d]/10 bg-[#f8f5f0] px-4 py-3 flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-[#0a1e3d]">
                Pricing unlocked
              </div>
              <div className="text-xs text-gray-600 mt-1">
                {companyName} · {contactName} · {email}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setStep("capture");
                setState("idle");
                setErrorMsg("");
                setFreight({ kind: "idle" });
              }}
              className="text-xs font-semibold text-[#b22234] hover:underline"
            >
              Edit info
            </button>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[#0a1e3d] uppercase tracking-wide">
              Order
            </h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Package
              </label>
              <div className="grid grid-cols-1 gap-3">
                {(["case", "master_carton", "pallet"] as PackagingType[]).map((option) => {
                  const selected = packagingType === option;
                  const optionQty = option === "master_carton" ? Math.max(qty, 1) : 1;
                  const optionBasePrice = getBasePrice(option, optionQty);
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setPackagingType(option)}
                      className={`p-4 rounded-lg border-2 text-left transition-colors ${
                        selected
                          ? "border-[#b22234] bg-red-50"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold text-[#0a1e3d]">
                            {PACK_LABELS[option]}
                          </div>
                          <div className="text-lg font-bold text-[#b22234]">
                            ${optionBasePrice.toFixed(2)}/unit
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {PACK_SUBLABELS[option]}
                            {option === "master_carton"
                              ? " · 6+ master cases drop to $3.10/unit"
                              : option === "pallet"
                                ? " · $2,700 per pallet · landed"
                                : " · One-off wholesale pricing"}
                          </div>
                        </div>
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            selected ? "border-[#b22234]" : "border-gray-300"
                          }`}
                        >
                          {selected && <div className="w-2.5 h-2.5 rounded-full bg-[#b22234]" />}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label htmlFor="quantity" className="block text-sm font-medium text-gray-700 mb-1">
                Quantity ({PACK_LABELS[packagingType]}
                {qty === 1 ? "" : "s"})
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setQuantity(String(Math.max(1, qty - 1)))}
                  className="w-12 h-12 rounded-lg border border-gray-300 text-xl font-bold text-gray-600 hover:bg-gray-50 flex items-center justify-center"
                >
                  -
                </button>
                <input
                  id="quantity"
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-24 px-4 py-3 border border-gray-300 rounded-lg text-base text-center focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
                />
                <button
                  type="button"
                  onClick={() => setQuantity(String(qty + 1))}
                  className="w-12 h-12 rounded-lg border border-gray-300 text-xl font-bold text-gray-600 hover:bg-gray-50 flex items-center justify-center"
                >
                  +
                </button>
                <span className="text-sm text-gray-500">
                  {totalBags} total unit{totalBags === 1 ? "" : "s"}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Delivery
              </label>
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={() => setDeliveryMethod("in_person")}
                  className={`p-4 rounded-lg border-2 text-left transition-colors ${
                    deliveryMethod === "in_person"
                      ? "border-[#b22234] bg-red-50"
                      : "border-gray-200 hover:border-gray-300 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-[#0a1e3d]">
                        In-person delivery / handoff
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        No shipping charge when you have inventory on hand.
                      </div>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      deliveryMethod === "in_person" ? "border-[#b22234]" : "border-gray-300"
                    }`}>
                      {deliveryMethod === "in_person" && (
                        <div className="w-2.5 h-2.5 rounded-full bg-[#b22234]" />
                      )}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setDeliveryMethod("shipping")}
                  className={`p-4 rounded-lg border-2 text-left transition-colors ${
                    deliveryMethod === "shipping"
                      ? "border-[#b22234] bg-red-50"
                      : "border-gray-200 hover:border-gray-300 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-[#0a1e3d]">
                        Ship it
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {packagingType === "pallet"
                          ? "LTL freight is included in pallet pricing."
                          : "UPS Ground quote from Ashford, WA added live before submit."}
                      </div>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      deliveryMethod === "shipping" ? "border-[#b22234]" : "border-gray-300"
                    }`}>
                      {deliveryMethod === "shipping" && (
                        <div className="w-2.5 h-2.5 rounded-full bg-[#b22234]" />
                      )}
                    </div>
                  </div>
                </button>
              </div>
            </div>

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
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-[#0a1e3d]">
                        Pay now by card
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        Shop Pay · Visa · MC · Amex · ACH
                        {prepayEligible
                          ? " · 5% prepay discount on master-case volume"
                          : " · no upfront-pay discount on cases or pallets"}
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
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-[#0a1e3d]">
                        Invoice me, Net 10
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        We&apos;ll email an invoice right away. No extra onboarding step.
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

            <div className="bg-[#f8f5f0] rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">
                  {qty} {PACK_LABELS[packagingType].toLowerCase()}
                  {qty === 1 ? "" : "s"} · {totalBags} total units
                </span>
                <span className="font-semibold text-[#0a1e3d]">
                  ${subtotal.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">
                  ${pricePerBag.toFixed(2)}/unit
                </span>
                <span className="font-medium text-[#0a1e3d] text-right">
                  {paymentMethod === "pay_now" && prepayEligible
                    ? "5% prepay discount applied"
                    : packagingType === "master_carton" && qty >= 6
                      ? "6+ master case price break"
                      : packagingType === "pallet"
                        ? "Pallet landed price"
                        : "Standard wholesale price"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">
                  {deliveryMethod === "in_person" ? "Delivery" : "Shipping"}
                </span>
                <span className="font-medium text-[#0a1e3d] text-right">
                  {deliveryMethod === "in_person" ? (
                    <span className="text-green-700">In person · no shipping charge</span>
                  ) : packagingType === "pallet" && freight.kind === "ok" ? (
                    <span className="text-green-700">LTL freight included in pallet price</span>
                  ) : freight.kind === "ok" ? (
                    <>
                      ${freight.quote.rate.toFixed(2)}
                      {freight.quote.delivery_days
                        ? ` · ~${freight.quote.delivery_days} day${freight.quote.delivery_days > 1 ? "s" : ""}`
                        : ""}
                    </>
                  ) : freight.kind === "loading" ? (
                    <span className="text-gray-400">Calculating…</span>
                  ) : freight.kind === "error" ? (
                    <span className="text-red-600 text-xs">{freight.message}</span>
                  ) : (
                    <span className="text-gray-400 text-xs">Enter state + ZIP for quote</span>
                  )}
                </span>
              </div>
              <div className="border-t border-gray-200 pt-2 flex justify-between">
                <span className="text-sm font-semibold text-[#0a1e3d]">Order total</span>
                <span className="text-lg font-bold text-[#0a1e3d]">
                  ${orderTotal.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
              Notes (optional)
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="PO reference, handoff notes, or anything we should know..."
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none resize-none"
            />
          </div>

          {state === "error" && errorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={submitDisabled}
            className="w-full bg-[#b22234] text-white font-semibold py-4 px-6 rounded-lg hover:bg-[#8b1a29] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-base"
          >
            {state === "submitting"
              ? paymentMethod === "pay_now"
                ? "Opening secure checkout…"
                : "Submitting order…"
              : paymentMethod === "pay_now"
                ? `Continue to payment · $${orderTotal.toFixed(2)}`
                : `Submit wholesale order · $${orderTotal.toFixed(2)}`}
          </button>

          <p className="text-xs text-gray-400 text-center">
            {paymentMethod === "pay_now"
              ? "You’ll be redirected to a secure checkout to complete payment."
              : "Your order is committed when you submit. We’ll email your Net 10 invoice right away."}
          </p>
        </>
      )}
    </form>
  );
}
