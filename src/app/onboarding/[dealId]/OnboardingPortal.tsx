"use client";

import { useMemo, useState } from "react";

type DealInfo = {
  id: string;
  name: string;
  amount: string;
  stage: string;
  paymentMethod: string; // "pay_now" | "invoice_me"
  onboardingComplete: boolean;
  paymentReceived: boolean;
};

type ContactInfo = {
  id: string;
  email: string;
  firstname: string;
  lastname: string;
  company: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
} | null;

type Props = {
  dealId: string;
  deal: DealInfo;
  contact: ContactInfo;
};

type FormState = "idle" | "submitting" | "success" | "error";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

export function OnboardingPortal({ dealId, deal, contact }: Props) {
  const isPayNow = deal.paymentMethod === "pay_now";
  const alreadyComplete = deal.onboardingComplete;

  const [state, setState] = useState<FormState>(alreadyComplete ? "success" : "idle");
  const [successMsg, setSuccessMsg] = useState<string>(
    alreadyComplete
      ? "Your onboarding is complete. We'll ship as soon as payment clears (or immediately if paid by card)."
      : "",
  );
  const [errorMsg, setErrorMsg] = useState("");

  // Tier 1 (always required)
  const [legalBusinessName, setLegalBusinessName] = useState(contact?.company ?? "");
  const [ein, setEin] = useState("");
  const [shipContactName, setShipContactName] = useState(
    [contact?.firstname, contact?.lastname].filter(Boolean).join(" "),
  );
  const [shipContactPhone, setShipContactPhone] = useState(formatPhone(contact?.phone ?? ""));
  const [resaleCertNumber, setResaleCertNumber] = useState("");
  const [taxExemptState, setTaxExemptState] = useState("");

  // Tier 2 (Invoice Me only)
  const [apContactName, setApContactName] = useState("");
  const [apContactEmail, setApContactEmail] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [preferredPayment, setPreferredPayment] = useState("ach");
  const [tradeRef1Company, setTradeRef1Company] = useState("");
  const [tradeRef1Phone, setTradeRef1Phone] = useState("");
  const [tradeRef2Company, setTradeRef2Company] = useState("");
  const [tradeRef2Phone, setTradeRef2Phone] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signerTitle, setSignerTitle] = useState("");

  const totalSteps = isPayNow ? 5 : 12;
  const filledTier1Count = useMemo(() => {
    let n = 0;
    if (legalBusinessName.trim()) n += 1;
    if (ein.trim()) n += 1;
    if (shipContactName.trim()) n += 1;
    if (shipContactPhone.trim()) n += 1;
    // Field 5: Resale cert OR tax-exempt state counts as "answered" (can be blank)
    n += 1;
    return n;
  }, [legalBusinessName, ein, shipContactName, shipContactPhone]);

  const filledTier2Count = useMemo(() => {
    if (isPayNow) return 0;
    let n = 0;
    if (apContactName.trim()) n += 1;
    if (apContactEmail.trim()) n += 1;
    if (billingAddress.trim()) n += 1; // optional field, still counts if filled
    if (preferredPayment) n += 1;
    if (termsAccepted) n += 1;
    if (signerName.trim()) n += 1;
    if (signerTitle.trim()) n += 1;
    return n;
  }, [isPayNow, apContactName, apContactEmail, billingAddress, preferredPayment, termsAccepted, signerName, signerTitle]);

  const filledCount = filledTier1Count + filledTier2Count;
  const progressPct = Math.min(100, Math.round((filledCount / totalSteps) * 100));

  const amountNum = Number(deal.amount) || 0;
  const amountStr = `$${amountNum.toFixed(2)}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("submitting");
    setErrorMsg("");

    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          legalBusinessName: legalBusinessName.trim(),
          ein: ein.trim(),
          shipContactName: shipContactName.trim(),
          shipContactPhone: shipContactPhone.trim(),
          resaleCertNumber: resaleCertNumber.trim() || undefined,
          taxExemptState: taxExemptState || undefined,
          ...(isPayNow
            ? {}
            : {
                apContactName: apContactName.trim(),
                apContactEmail: apContactEmail.trim(),
                billingAddress: billingAddress.trim() || undefined,
                preferredPayment,
                tradeRef1Company: tradeRef1Company.trim() || undefined,
                tradeRef1Phone: tradeRef1Phone.trim() || undefined,
                tradeRef2Company: tradeRef2Company.trim() || undefined,
                tradeRef2Phone: tradeRef2Phone.trim() || undefined,
                termsAccepted,
                signerName: signerName.trim(),
                signerTitle: signerTitle.trim(),
              }),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(
          data?.missing?.length
            ? `Please fill in: ${data.missing.join(", ")}`
            : data?.error || "Submission failed. Please try again.",
        );
        setState("error");
        return;
      }
      setSuccessMsg(data.message || "All set! You're done.");
      setState("success");
    } catch {
      setErrorMsg("Network error. Please check your connection and try again.");
      setState("error");
    }
  };

  if (state === "success") {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-[#0a1e3d] mb-2">You&apos;re all set</h2>
        <p className="text-gray-600 max-w-sm mx-auto mb-4">{successMsg}</p>
        <div className="bg-[#f8f5f0] rounded-lg p-4 text-left">
          <div className="text-xs uppercase tracking-wide text-[#0a1e3d]/60 mb-2">
            What happens next
          </div>
          <ol className="text-sm text-gray-700 space-y-1">
            <li>1. Ben confirms + Drew packs your order</li>
            <li>2. You&apos;ll get a tracking email once it ships</li>
            <li>3. Questions? Reply to your welcome email (goes straight to Ben)</li>
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8">
      {/* Order summary pill */}
      <div className="bg-[#f8f5f0] rounded-lg p-4 mb-6">
        <div className="text-xs uppercase tracking-wide text-[#0a1e3d]/60 mb-1">
          Order summary
        </div>
        <div className="font-semibold text-[#0a1e3d]">{deal.name}</div>
        <div className="text-sm text-gray-600 mt-1">
          Total: <span className="font-semibold text-[#0a1e3d]">{amountStr}</span>
          {" · "}
          Payment: {isPayNow ? "Paid by card ✅" : "Invoice pending"}
        </div>
      </div>

      <h2 className="text-xl font-bold text-[#0a1e3d] mb-1">
        {isPayNow ? "Quick setup — 5 fields" : "Customer setup — 2 minutes"}
      </h2>
      <p className="text-sm text-gray-600 mb-4">
        {isPayNow
          ? "You've already paid — we just need a few details to get this on the truck."
          : "We'll send your invoice as soon as you're done here."}
      </p>

      {/* Progress bar */}
      <div className="mb-6">
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#b22234] transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>{progressPct}% complete</span>
          <span>{filledCount} of {totalSteps}</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Tier 1 — always required */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-[#0a1e3d] uppercase tracking-wide">
            Business Info
          </h3>

          <Field
            label="Legal business name *"
            hint="As it appears on your tax filings"
          >
            <input
              type="text"
              required
              autoComplete="organization"
              value={legalBusinessName}
              onChange={(e) => setLegalBusinessName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
            />
          </Field>

          <Field
            label="EIN or Tax ID *"
            hint="9-digit EIN, or last 4 of SSN if sole proprietor. Required for 1099 reporting on orders $600+."
          >
            <input
              type="text"
              required
              inputMode="numeric"
              autoComplete="off"
              value={ein}
              onChange={(e) => setEin(e.target.value)}
              placeholder="XX-XXXXXXX"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Ship contact name *">
              <input
                type="text"
                required
                autoComplete="name"
                value={shipContactName}
                onChange={(e) => setShipContactName(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
              />
            </Field>
            <Field label="Phone *">
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                value={shipContactPhone}
                onChange={(e) => setShipContactPhone(e.target.value)}
                onBlur={(e) => setShipContactPhone(formatPhone(e.target.value))}
                placeholder="(555) 123-4567"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Resale cert # (optional)" hint="If you have one">
              <input
                type="text"
                autoComplete="off"
                value={resaleCertNumber}
                onChange={(e) => setResaleCertNumber(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
              />
            </Field>
            <Field label="Tax-exempt state (optional)">
              <select
                value={taxExemptState}
                onChange={(e) => setTaxExemptState(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none bg-white"
              >
                <option value="">—</option>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        {/* Tier 2 — Invoice Me only */}
        {!isPayNow && (
          <section className="space-y-4 pt-4 border-t border-gray-100">
            <h3 className="text-sm font-semibold text-[#0a1e3d] uppercase tracking-wide">
              Accounts Payable + Terms
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <Field label="AP contact name *">
                <input
                  type="text"
                  required
                  autoComplete="name"
                  value={apContactName}
                  onChange={(e) => setApContactName(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
                />
              </Field>
              <Field label="AP email *">
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  value={apContactEmail}
                  onChange={(e) => setApContactEmail(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
                />
              </Field>
            </div>

            <Field
              label="Billing address (optional)"
              hint="Only if different from your shipping address"
            >
              <input
                type="text"
                autoComplete="street-address"
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                placeholder="Street, City, State, ZIP"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
              />
            </Field>

            <Field label="Preferred payment method *">
              <div className="grid grid-cols-3 gap-2">
                {(["ach", "check", "cc_via_invoice"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPreferredPayment(m)}
                    className={`p-3 rounded-lg border-2 text-sm font-medium transition-colors ${
                      preferredPayment === m
                        ? "border-[#b22234] bg-red-50 text-[#b22234]"
                        : "border-gray-200 text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    {m === "ach" ? "ACH" : m === "check" ? "Check" : "CC (invoice link)"}
                  </button>
                ))}
              </div>
            </Field>

            <details className="rounded-lg border border-gray-200">
              <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-600 hover:bg-gray-50">
                Trade references (optional — skip if you&apos;d rather not)
              </summary>
              <div className="px-4 pb-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    autoComplete="organization"
                    value={tradeRef1Company}
                    onChange={(e) => setTradeRef1Company(e.target.value)}
                    placeholder="Reference 1 — company"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
                  />
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={tradeRef1Phone}
                    onChange={(e) => setTradeRef1Phone(e.target.value)}
                    onBlur={(e) => setTradeRef1Phone(formatPhone(e.target.value))}
                    placeholder="Phone"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    autoComplete="organization"
                    value={tradeRef2Company}
                    onChange={(e) => setTradeRef2Company(e.target.value)}
                    placeholder="Reference 2 — company"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
                  />
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={tradeRef2Phone}
                    onChange={(e) => setTradeRef2Phone(e.target.value)}
                    onBlur={(e) => setTradeRef2Phone(formatPhone(e.target.value))}
                    placeholder="Phone"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
                  />
                </div>
              </div>
            </details>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Authorized signer *">
                <input
                  type="text"
                  required
                  autoComplete="name"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
                />
              </Field>
              <Field label="Title *">
                <input
                  type="text"
                  required
                  autoComplete="organization-title"
                  value={signerTitle}
                  onChange={(e) => setSignerTitle(e.target.value)}
                  placeholder="e.g. Owner, CFO, Buyer"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
                />
              </Field>
            </div>

            <label className="flex items-start gap-3 p-4 rounded-lg border border-gray-200 hover:border-gray-300 cursor-pointer">
              <input
                type="checkbox"
                required
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="mt-1 w-5 h-5 accent-[#b22234]"
              />
              <div>
                <div className="text-sm font-semibold text-[#0a1e3d]">
                  I agree to Net 10 payment terms *
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Invoice is due 10 days from the date issued. Past due balances may be
                  subject to a 1.5% monthly late fee.
                </div>
              </div>
            </label>
          </section>
        )}

        {state === "error" && errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
            {errorMsg}
          </div>
        )}

        <button
          type="submit"
          disabled={state === "submitting"}
          className="w-full bg-[#b22234] text-white font-semibold py-4 px-6 rounded-lg hover:bg-[#8b1a29] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-base"
        >
          {state === "submitting" ? "Submitting…" : isPayNow ? "Finish & ship my order" : "Submit & send my invoice"}
        </button>

        <p className="text-xs text-gray-400 text-center">
          Your info is stored securely. We only use it to ship your order and keep our books clean.
        </p>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <div className="text-xs text-gray-500 mt-1">{hint}</div>}
    </div>
  );
}

/**
 * Best-effort format a US phone number into (NNN) NNN-NNNN display form.
 * Accepts raw digits, +1-prefixed, or already-formatted. Non-US numbers
 * pass through unchanged.
 */
function formatPhone(raw: string): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  // Strip leading 1 if 11 digits (US country code)
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (d.length === 10) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (d.length === 7) {
    return `${d.slice(0, 3)}-${d.slice(3)}`;
  }
  return raw;
}
