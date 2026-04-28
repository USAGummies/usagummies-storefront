"use client";

/**
 * Multi-step wholesale onboarding flow client — Phase 35.f.4.
 *
 * Drives `POST /api/wholesale/onboarding/advance` step-by-step
 * through the 11-step state machine in
 * `src/lib/wholesale/onboarding-flow.ts`. URL query `?flowId=X`
 * lets a customer resume after a refresh — the page calls
 * `GET /api/wholesale/onboarding/state` on mount when present.
 *
 * Server-side-only steps (order-captured, ap-email-sent,
 * qbo-customer-staged, crm-updated) are auto-advanced by the
 * client. Client-input steps render a form per step.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  BAGS_PER_UNIT,
  BAG_PRICE_USD,
  TIER_DISPLAY,
  type PricingTier,
} from "@/lib/wholesale/pricing-tiers";
import {
  STORE_TYPES,
  type OnboardingStep,
  type OnboardingState,
} from "@/lib/wholesale/onboarding-flow";

// Server-side steps the client just auto-advances.
const SERVER_STEPS = new Set<OnboardingStep>([
  "order-captured",
  "ap-email-sent",
  "qbo-customer-staged",
  "crm-updated",
]);

const ONLINE_TIERS: PricingTier[] = ["B2", "B3", "B4", "B5"];

interface AdvanceResp {
  ok: boolean;
  flowId?: string;
  currentStep?: OnboardingStep;
  nextStep?: OnboardingStep | null;
  stepsCompleted?: OnboardingStep[];
  sideEffectsDispatched?: { kind: string; ok: boolean; error?: string }[];
  errors?: string[];
}

interface StateResp {
  ok: boolean;
  state?: OnboardingState;
  nextStep?: OnboardingStep | null;
}

async function advance(input: {
  flowId?: string;
  step: OnboardingStep;
  payload?: unknown;
}): Promise<AdvanceResp> {
  const res = await fetch("/api/wholesale/onboarding/advance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await res.json()) as AdvanceResp;
}

async function fetchState(flowId: string): Promise<StateResp> {
  const res = await fetch(
    `/api/wholesale/onboarding/state?flowId=${encodeURIComponent(flowId)}`,
  );
  return (await res.json()) as StateResp;
}

export function OnboardingFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialFlowId = searchParams?.get("flowId") ?? null;

  const [flowId, setFlowId] = useState<string | null>(initialFlowId);
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("info");
  const [stepsCompleted, setStepsCompleted] = useState<OnboardingStep[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<OnboardingState | null>(null);

  // Per-step input local state.
  const [info, setInfo] = useState({
    companyName: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
  });
  const [storeType, setStoreType] = useState("specialty-retail");
  const [orderTier, setOrderTier] = useState<PricingTier>("B2");
  const [orderUnits, setOrderUnits] = useState(1);
  const [paymentPath, setPaymentPath] = useState<
    "credit-card" | "accounts-payable"
  >("accounts-payable");
  const [apEmail, setApEmail] = useState("");
  const [shippingAddr, setShippingAddr] = useState({
    street1: "",
    street2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "US",
  });

  // Resume from URL query if present.
  useEffect(() => {
    if (!initialFlowId) return;
    let alive = true;
    (async () => {
      const r = await fetchState(initialFlowId);
      if (!alive) return;
      if (r.ok && r.state) {
        setState(r.state);
        setCurrentStep(r.state.currentStep);
        setStepsCompleted(r.state.stepsCompleted as OnboardingStep[]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [initialFlowId]);

  // Auto-advance server-side steps.
  useEffect(() => {
    if (!flowId) return;
    if (!SERVER_STEPS.has(currentStep)) return;
    if (busy) return;
    let alive = true;
    (async () => {
      setBusy(true);
      const r = await advance({ flowId, step: currentStep, payload: {} });
      if (!alive) return;
      setBusy(false);
      if (r.ok && r.currentStep) {
        setCurrentStep(r.currentStep);
        setStepsCompleted(r.stepsCompleted ?? []);
      } else {
        setErrors(r.errors ?? ["server step failed"]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [flowId, currentStep, busy]);

  const submit = useCallback(
    async (step: OnboardingStep, payload: unknown) => {
      setErrors([]);
      setBusy(true);
      const r = await advance({ flowId: flowId ?? undefined, step, payload });
      setBusy(false);
      if (!r.ok) {
        setErrors(r.errors ?? ["unknown error"]);
        return;
      }
      if (r.flowId && r.flowId !== flowId) {
        setFlowId(r.flowId);
        // Update URL so refresh resumes.
        const params = new URLSearchParams(
          searchParams?.toString() ?? "",
        );
        params.set("flowId", r.flowId);
        router.replace(`?${params.toString()}`);
      }
      if (r.currentStep) setCurrentStep(r.currentStep);
      if (r.stepsCompleted) setStepsCompleted(r.stepsCompleted);
    },
    [flowId, router, searchParams],
  );

  const subtotal = useMemo(() => {
    return BAG_PRICE_USD[orderTier] * BAGS_PER_UNIT[orderTier] * orderUnits;
  }, [orderTier, orderUnits]);

  const isAPPath = paymentPath === "accounts-payable";
  const isDone = currentStep === "crm-updated" && stepsCompleted.includes("crm-updated");

  return (
    <div className="space-y-6">
      <ProgressBar
        current={currentStep}
        completed={stepsCompleted}
        isAPPath={isAPPath}
      />

      {errors.length > 0 ? (
        <div className="border-2 border-red-500 bg-red-50 p-3 text-sm text-red-900">
          <ul className="list-disc pl-5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {currentStep === "info" ? (
        <Step title="Step 1 — Your business">
          <div className="grid gap-3">
            <Input
              label="Company name"
              value={info.companyName}
              onChange={(v) => setInfo({ ...info, companyName: v })}
            />
            <Input
              label="Contact name"
              value={info.contactName}
              onChange={(v) => setInfo({ ...info, contactName: v })}
            />
            <Input
              label="Email"
              type="email"
              value={info.contactEmail}
              onChange={(v) => setInfo({ ...info, contactEmail: v })}
            />
            <Input
              label="Phone (optional)"
              type="tel"
              value={info.contactPhone}
              onChange={(v) => setInfo({ ...info, contactPhone: v })}
            />
          </div>
          <ContinueBtn
            disabled={busy}
            onClick={() => submit("info", info)}
          />
        </Step>
      ) : null}

      {currentStep === "store-type" ? (
        <Step title="Step 2 — What kind of store?">
          <div className="grid gap-2">
            {STORE_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="storeType"
                  checked={storeType === t}
                  onChange={() => setStoreType(t)}
                />
                <span>{prettyStoreType(t)}</span>
              </label>
            ))}
          </div>
          <ContinueBtn
            disabled={busy}
            onClick={() => submit("store-type", { storeType })}
          />
        </Step>
      ) : null}

      {currentStep === "pricing-shown" ? (
        <Step title="Step 3 — Wholesale pricing (B2-B5)">
          <PricingTable />
          <p className="lp-sans mt-3 text-sm text-[var(--lp-ink)]/70">
            B1 (local case) is internal-only — not orderable online. Custom
            freight quotes apply at 3+ pallets.
          </p>
          <ContinueBtn
            disabled={busy}
            onClick={() => submit("pricing-shown", {})}
          />
        </Step>
      ) : null}

      {currentStep === "order-type" ? (
        <Step title="Step 4 — Order quantity">
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm">
              <span>Tier</span>
              <select
                className="border-2 border-[var(--lp-ink)] bg-white p-2"
                value={orderTier}
                onChange={(e) => setOrderTier(e.target.value as PricingTier)}
              >
                {ONLINE_TIERS.map((t) => (
                  <option key={t} value={t}>
                    {t} — {TIER_DISPLAY[t]} (${BAG_PRICE_USD[t].toFixed(2)}/bag)
                  </option>
                ))}
              </select>
            </label>
            <Input
              label="Unit count"
              type="number"
              value={String(orderUnits)}
              onChange={(v) => setOrderUnits(Math.max(1, Number(v) || 1))}
            />
            <div className="border-l-4 border-[var(--lp-red)] bg-[var(--lp-cream)] p-3 text-sm">
              <div>
                <strong>{BAGS_PER_UNIT[orderTier] * orderUnits}</strong> bags
              </div>
              <div>
                Subtotal:{" "}
                <strong>${subtotal.toFixed(2)}</strong>
              </div>
              {(orderTier === "B4" || orderTier === "B5") && orderUnits >= 3 ? (
                <div className="mt-1 text-xs italic text-[var(--lp-ink)]/70">
                  Custom freight quote at 3+ pallets — we&apos;ll send a tailored
                  quote.
                </div>
              ) : null}
            </div>
          </div>
          <ContinueBtn
            disabled={busy}
            onClick={() =>
              submit("order-type", { tier: orderTier, unitCount: orderUnits })
            }
          />
        </Step>
      ) : null}

      {currentStep === "payment-path" ? (
        <Step title="Step 5 — How are you paying?">
          <div className="grid gap-2">
            <label className="flex items-start gap-2 border-2 border-[var(--lp-ink)] bg-white p-3 text-sm">
              <input
                type="radio"
                name="paymentPath"
                checked={paymentPath === "credit-card"}
                onChange={() => setPaymentPath("credit-card")}
              />
              <span>
                <strong>Credit card</strong> — pay today, ship tomorrow.
              </span>
            </label>
            <label className="flex items-start gap-2 border-2 border-[var(--lp-ink)] bg-white p-3 text-sm">
              <input
                type="radio"
                name="paymentPath"
                checked={paymentPath === "accounts-payable"}
                onChange={() => setPaymentPath("accounts-payable")}
              />
              <span>
                <strong>AP / Net terms</strong> — we&apos;ll send your AP team
                an onboarding packet.
              </span>
            </label>
          </div>
          <ContinueBtn
            disabled={busy}
            onClick={() => submit("payment-path", { paymentPath })}
          />
        </Step>
      ) : null}

      {currentStep === "ap-info" ? (
        <Step title="Step 6 — AP / accounting contact">
          <div className="grid gap-3">
            <Input
              label="AP team email"
              type="email"
              value={apEmail}
              onChange={setApEmail}
            />
            <p className="text-xs text-[var(--lp-ink)]/70">
              We&apos;ll email your AP team an onboarding packet (W-9, payment
              instructions, line-item breakdown). If you handle this yourself,
              put your own email here.
            </p>
          </div>
          <ContinueBtn
            disabled={busy}
            onClick={() => submit("ap-info", { apInfo: { apEmail } })}
          />
        </Step>
      ) : null}

      {currentStep === "shipping-info" ? (
        <Step title="Step 8 — Where are we shipping?">
          <div className="grid gap-3">
            <Input
              label="Street address"
              value={shippingAddr.street1}
              onChange={(v) =>
                setShippingAddr({ ...shippingAddr, street1: v })
              }
            />
            <Input
              label="Suite / unit (optional)"
              value={shippingAddr.street2}
              onChange={(v) =>
                setShippingAddr({ ...shippingAddr, street2: v })
              }
            />
            <div className="grid grid-cols-3 gap-2">
              <Input
                label="City"
                value={shippingAddr.city}
                onChange={(v) =>
                  setShippingAddr({ ...shippingAddr, city: v })
                }
              />
              <Input
                label="State"
                value={shippingAddr.state}
                onChange={(v) =>
                  setShippingAddr({ ...shippingAddr, state: v })
                }
              />
              <Input
                label="ZIP"
                value={shippingAddr.postalCode}
                onChange={(v) =>
                  setShippingAddr({ ...shippingAddr, postalCode: v })
                }
              />
            </div>
            <Input
              label="Country"
              value={shippingAddr.country}
              onChange={(v) =>
                setShippingAddr({ ...shippingAddr, country: v })
              }
            />
          </div>
          <ContinueBtn
            disabled={busy}
            onClick={() =>
              submit("shipping-info", { shippingAddress: shippingAddr })
            }
          />
        </Step>
      ) : null}

      {SERVER_STEPS.has(currentStep) && !isDone ? (
        <Step title={`Working… (${currentStep})`}>
          <p className="text-sm text-[var(--lp-ink)]/70">
            Saving your order, sending notifications, and staging records with
            our finance team. This takes a few seconds.
          </p>
        </Step>
      ) : null}

      {isDone ? (
        <Step title="✓ Onboarding complete">
          <p className="text-sm">
            Your order is captured. Rene (our finance lead) will review the
            customer record + AP packet shortly. You&apos;ll receive a
            confirmation email at the contact address you provided.
          </p>
          {state ? (
            <div className="mt-4 border-l-4 border-[var(--lp-red)] bg-[var(--lp-cream)] p-3 text-xs">
              <div>
                Flow ID: <code>{state.flowId}</code>
              </div>
              {state.hubspotDealId ? (
                <div>
                  HubSpot Deal: <code>{state.hubspotDealId}</code>
                </div>
              ) : null}
            </div>
          ) : null}
        </Step>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small UI helpers — kept inline to keep the surface tractable. Refactor
// out when a second flow surfaces (audit log dashboard, Rene's review
// surface) needs the same building blocks.
// ---------------------------------------------------------------------------

function Step({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="border-2 border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5"
      style={{ boxShadow: "4px 4px 0 var(--lp-red)" }}
    >
      <h3 className="lp-display mb-4 text-lg text-[var(--lp-ink)]">{title}</h3>
      {children}
    </section>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-bold">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-2 border-[var(--lp-ink)] bg-white p-2"
      />
    </label>
  );
}

function ContinueBtn({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="lp-cta lp-cta-dark mt-5 disabled:opacity-50"
    >
      {disabled ? "Working…" : "Continue →"}
    </button>
  );
}

function PricingTable() {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b-2 border-[var(--lp-ink)] text-left">
          <th className="py-2 pr-2">Tier</th>
          <th className="py-2 pr-2">Per bag</th>
          <th className="py-2 pr-2">Bags / unit</th>
          <th className="py-2">Freight</th>
        </tr>
      </thead>
      <tbody>
        {ONLINE_TIERS.map((t) => (
          <tr key={t} className="border-b border-[var(--lp-ink)]/20">
            <td className="py-2 pr-2 font-bold">{t}</td>
            <td className="py-2 pr-2">${BAG_PRICE_USD[t].toFixed(2)}</td>
            <td className="py-2 pr-2">{BAGS_PER_UNIT[t]}</td>
            <td className="py-2">{TIER_DISPLAY[t]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProgressBar({
  current,
  completed,
  isAPPath,
}: {
  current: OnboardingStep;
  completed: OnboardingStep[];
  isAPPath: boolean;
}) {
  const labels: { step: OnboardingStep; label: string; show: boolean }[] = [
    { step: "info", label: "Info", show: true },
    { step: "store-type", label: "Store", show: true },
    { step: "pricing-shown", label: "Pricing", show: true },
    { step: "order-type", label: "Order", show: true },
    { step: "payment-path", label: "Pay", show: true },
    { step: "ap-info", label: "AP", show: isAPPath },
    { step: "shipping-info", label: "Ship", show: true },
    { step: "crm-updated", label: "Done", show: true },
  ];
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {labels
        .filter((l) => l.show)
        .map((l) => {
          const done = completed.includes(l.step);
          const active = current === l.step;
          return (
            <span
              key={l.step}
              className={`border px-2 py-1 ${
                done
                  ? "border-[var(--lp-ink)] bg-[var(--lp-ink)] text-[var(--lp-off-white)]"
                  : active
                    ? "border-[var(--lp-red)] bg-[var(--lp-red)] text-white"
                    : "border-[var(--lp-ink)]/40 text-[var(--lp-ink)]/50"
              }`}
            >
              {l.label}
            </span>
          );
        })}
    </div>
  );
}

function prettyStoreType(t: string): string {
  return t.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
