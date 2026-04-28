/**
 * /ops/wholesale/flow/[flowId] — Phase 35.f.8
 *
 * Single-flow detail page. Renders an OnboardingState alongside its
 * order-captured snapshot (if any) and audit envelope (if completed),
 * plus the suggested chase-email draft when the flow is stalled.
 *
 * Server component, auth via the existing /ops/* middleware
 * (session-only). Reads three KV envelopes:
 *   - wholesale:flow:<id>             (loadOnboardingState)
 *   - wholesale:order-captured:<id>   (readOrderCapturedSnapshot)
 *   - wholesale:audit:flow-complete:<id> (readAuditEnvelope)
 *
 * Each envelope is shown in its own panel. Missing envelopes
 * render a clear "not yet" state — never a fabricated empty
 * placeholder.
 */
import type { Metadata } from "next";
import Link from "next/link";

import { buildChaseEmail } from "@/lib/wholesale/chase-email";
import {
  ONBOARDING_STEPS,
  nextStep as computeNextStep,
  type OnboardingState,
} from "@/lib/wholesale/onboarding-flow";
import {
  loadOnboardingState,
  readAuditEnvelope,
  readOrderCapturedSnapshot,
  type AuditEnvelope,
  type OrderCapturedSnapshot,
} from "@/lib/wholesale/onboarding-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps {
  params: Promise<{ flowId: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { flowId } = await params;
  return { title: `Flow ${flowId} — wholesale onboarding` };
}

function mostRecentTimestamp(state: OnboardingState): string | undefined {
  const stamps = Object.values(state.timestamps).filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  if (stamps.length === 0) return undefined;
  return stamps.reduce((a, b) => (a > b ? a : b));
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 19).replace("T", " ");
  }
}

export default async function FlowDetailPage({ params }: PageProps) {
  const { flowId } = await params;
  const decodedFlowId = decodeURIComponent(flowId);

  let state: OnboardingState | null = null;
  let captured: OrderCapturedSnapshot | null = null;
  let audit: AuditEnvelope | null = null;
  let loadError: string | null = null;

  try {
    [state, captured, audit] = await Promise.all([
      loadOnboardingState(decodedFlowId),
      readOrderCapturedSnapshot(decodedFlowId),
      readAuditEnvelope(decodedFlowId),
    ]);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-[1100px] p-6">
        <Link href="/ops/wholesale/onboarding" className="text-blue-700 underline">
          ← Back to in-flight flows
        </Link>
        <div className="mt-4 border-2 border-red-500 bg-red-50 p-3 text-sm text-red-900">
          KV read failed: {loadError}
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="mx-auto max-w-[1100px] p-6">
        <Link href="/ops/wholesale/onboarding" className="text-blue-700 underline">
          ← Back to in-flight flows
        </Link>
        <h1 className="mt-4 text-2xl font-bold">
          Flow not found: <code>{decodedFlowId}</code>
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          The flow record may have expired (30-day TTL) or never existed. If
          you have an audit envelope for this id, the flow was completed and
          the live state was reaped.
        </p>
        {audit ? (
          <AuditPanel audit={audit} />
        ) : null}
      </div>
    );
  }

  const lastTimestamp = mostRecentTimestamp(state);
  const next = computeNextStep(state);
  const isCompleted = next === null;
  const hoursSinceLastTouch = lastTimestamp
    ? (Date.now() - new Date(lastTimestamp).getTime()) / 3_600_000
    : 0;
  const isStalled = !isCompleted && hoursSinceLastTouch > 24;

  const resumeUrl = `https://www.usagummies.com/wholesale/order?flowId=${encodeURIComponent(state.flowId)}`;
  const chase = isStalled
    ? buildChaseEmail(state, { hoursSinceLastTouch, resumeUrl })
    : null;

  const totalSubtotal = state.orderLines.reduce(
    (acc, l) => acc + l.subtotalUsd,
    0,
  );

  return (
    <div className="mx-auto max-w-[1100px] p-6">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <Link
            href="/ops/wholesale/onboarding"
            className="text-sm text-blue-700 underline"
          >
            ← In-flight flows
          </Link>
          <h1 className="mt-1 text-2xl font-bold">
            Flow <code className="text-xl">{state.flowId}</code>
          </h1>
        </div>
        <div className="text-right text-sm">
          <StatusBadge isCompleted={isCompleted} isStalled={isStalled} />
          <div className="mt-1 text-xs text-gray-500">
            {lastTimestamp
              ? `Last touch: ${formatDate(lastTimestamp)} (${hoursSinceLastTouch.toFixed(1)}h ago)`
              : "No timestamp recorded"}
          </div>
        </div>
      </header>

      {/* Progress bar */}
      <Panel title="Progress">
        <ol className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
          {ONBOARDING_STEPS.map((step) => {
            const done = state!.stepsCompleted.includes(step);
            const active = state!.currentStep === step;
            return (
              <li
                key={step}
                className={`flex items-center gap-2 border px-2 py-1 ${
                  done
                    ? "border-green-700 bg-green-50 text-green-900"
                    : active
                      ? "border-red-700 bg-red-50 text-red-900"
                      : "border-gray-200 text-gray-500"
                }`}
              >
                <span className="font-mono text-xs">{done ? "✓" : active ? "•" : "·"}</span>
                <span className="font-mono text-xs">{step}</span>
                <span className="ml-auto text-xs">
                  {state!.timestamps[step] ? formatDate(state!.timestamps[step]) : ""}
                </span>
              </li>
            );
          })}
        </ol>
      </Panel>

      {/* Prospect */}
      <Panel title="Prospect">
        {state.prospect ? (
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <DefRow label="Company" value={state.prospect.companyName} />
            <DefRow label="Contact" value={state.prospect.contactName} />
            <DefRow label="Email" value={state.prospect.contactEmail} />
            <DefRow label="Phone" value={state.prospect.contactPhone} />
            <DefRow label="Store type" value={state.storeType} />
            <DefRow label="Payment path" value={state.paymentPath} />
          </dl>
        ) : (
          <p className="text-sm text-gray-500">Prospect not yet captured.</p>
        )}
      </Panel>

      {/* Order */}
      <Panel title={`Order — ${state.orderLines.length} line${state.orderLines.length === 1 ? "" : "s"}`}>
        {state.orderLines.length === 0 ? (
          <p className="text-sm text-gray-500">No order lines captured yet.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-gray-900 bg-gray-50 text-left">
                <th className="p-2">Tier</th>
                <th className="p-2">Units</th>
                <th className="p-2">Bags</th>
                <th className="p-2">$/bag</th>
                <th className="p-2">Subtotal</th>
                <th className="p-2">Freight</th>
              </tr>
            </thead>
            <tbody>
              {state.orderLines.map((l, idx) => (
                <tr key={idx} className="border-b border-gray-200">
                  <td className="p-2 font-bold">{l.tier}</td>
                  <td className="p-2">{l.unitCount}</td>
                  <td className="p-2">{l.bags}</td>
                  <td className="p-2 font-mono">${l.bagPriceUsd.toFixed(2)}</td>
                  <td className="p-2 font-mono">${l.subtotalUsd.toFixed(2)}</td>
                  <td className="p-2 text-xs">
                    {l.customFreightRequired ? (
                      <span className="text-red-700">custom (3+ pallets)</span>
                    ) : (
                      l.freightMode
                    )}
                  </td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-bold">
                <td className="p-2" colSpan={4}>
                  Total
                </td>
                <td className="p-2 font-mono">
                  ${(Math.round(totalSubtotal * 100) / 100).toFixed(2)}
                </td>
                <td className="p-2"></td>
              </tr>
            </tbody>
          </table>
        )}
      </Panel>

      {/* Shipping */}
      {state.shippingAddress ? (
        <Panel title="Shipping address">
          <p className="text-sm">
            {state.shippingAddress.street1}
            {state.shippingAddress.street2 ? `, ${state.shippingAddress.street2}` : ""}
            <br />
            {state.shippingAddress.city}, {state.shippingAddress.state}{" "}
            {state.shippingAddress.postalCode}
            <br />
            {state.shippingAddress.country}
          </p>
        </Panel>
      ) : null}

      {/* AP info */}
      {state.apInfo ? (
        <Panel title="AP info">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            {state.apInfo.apEmail ? (
              <DefRow label="AP team email" value={state.apInfo.apEmail} />
            ) : null}
            {state.apInfo.apContactName ? (
              <DefRow label="AP contact" value={state.apInfo.apContactName} />
            ) : null}
            {state.apInfo.taxId ? (
              <DefRow label="Tax ID" value={state.apInfo.taxId} />
            ) : null}
            {state.apInfo.legalEntityType ? (
              <DefRow label="Entity type" value={state.apInfo.legalEntityType} />
            ) : null}
          </dl>
        </Panel>
      ) : null}

      {/* External ids */}
      {state.hubspotDealId || state.qboCustomerApprovalId ? (
        <Panel title="External system links">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            {state.hubspotDealId ? (
              <DefRow label="HubSpot deal" value={state.hubspotDealId} />
            ) : null}
            {state.qboCustomerApprovalId ? (
              <DefRow
                label="QBO customer approval"
                value={state.qboCustomerApprovalId}
              />
            ) : null}
          </dl>
        </Panel>
      ) : null}

      {/* Chase email (only when stalled) */}
      {chase ? (
        <Panel title="Suggested chase email">
          <div className="text-xs uppercase tracking-wide text-gray-500">
            To
          </div>
          <p className="mb-3 text-sm font-mono">{chase.to}</p>
          <div className="text-xs uppercase tracking-wide text-gray-500">
            Subject
          </div>
          <p className="mb-3 text-sm font-bold">{chase.subject}</p>
          <div className="text-xs uppercase tracking-wide text-gray-500">
            Body
          </div>
          <pre className="whitespace-pre-wrap border border-gray-300 bg-white p-3 text-sm">
            {chase.plainText}
          </pre>
          <p className="mt-2 text-xs text-gray-500">
            Programmatic fetch:{" "}
            <code>
              GET /api/ops/wholesale/chase-email?flowId={state.flowId}
            </code>
          </p>
        </Panel>
      ) : null}

      {/* Order-captured snapshot */}
      {captured ? (
        <Panel title="Order-captured snapshot">
          <div className="text-xs text-gray-500">
            Captured at {formatDate(captured.capturedAt)}
          </div>
          <p className="mt-1 text-sm">
            {captured.orderLines.length} line item
            {captured.orderLines.length === 1 ? "" : "s"} captured at the
            &ldquo;intent acknowledged&rdquo; boundary. The customer is on
            the hook for this order.
          </p>
        </Panel>
      ) : null}

      {/* Audit envelope (only when completed) */}
      {audit ? <AuditPanel audit={audit} /> : null}

      {/* Resume link */}
      <Panel title="Customer view">
        <p className="text-sm">
          Open as the customer would see it (resumes via flowId):
        </p>
        <Link
          href={`/wholesale/order?flowId=${encodeURIComponent(state.flowId)}`}
          className="mt-2 inline-block text-blue-700 underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          /wholesale/order?flowId={state.flowId} ↗
        </Link>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4 border-2 border-gray-900 bg-white p-4">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-900">
        {title}
      </h2>
      {children}
    </section>
  );
}

function DefRow({ label, value }: { label: string; value: string | undefined }) {
  return (
    <>
      <dt className="text-xs uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className="text-sm">{value ?? <em className="text-gray-400">—</em>}</dd>
    </>
  );
}

function StatusBadge({
  isCompleted,
  isStalled,
}: {
  isCompleted: boolean;
  isStalled: boolean;
}) {
  if (isCompleted) {
    return (
      <span className="border-2 border-green-700 bg-green-50 px-2 py-1 text-xs font-bold text-green-900">
        ✓ Completed
      </span>
    );
  }
  if (isStalled) {
    return (
      <span className="border-2 border-red-700 bg-red-50 px-2 py-1 text-xs font-bold text-red-900">
        ⚠ Stalled
      </span>
    );
  }
  return (
    <span className="border-2 border-gray-700 bg-gray-50 px-2 py-1 text-xs font-bold text-gray-900">
      In flight
    </span>
  );
}

function AuditPanel({ audit }: { audit: AuditEnvelope }) {
  return (
    <Panel title="Audit envelope (completed)">
      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        <DefRow label="Completed at" value={formatDate(audit.completedAt)} />
        <DefRow label="Payment path" value={audit.paymentPath} />
        <DefRow
          label="Order line count"
          value={String(audit.orderLineCount)}
        />
        {audit.totalSubtotalUsd !== undefined ? (
          <DefRow
            label="Total subtotal"
            value={`$${audit.totalSubtotalUsd.toFixed(2)}`}
          />
        ) : null}
        <DefRow label="HubSpot deal" value={audit.hubspotDealId} />
        <DefRow
          label="QBO customer approval"
          value={audit.qboCustomerApprovalId}
        />
      </dl>
      <p className="mt-3 text-xs text-gray-500">
        Audit envelopes have a 365-day TTL. They&rsquo;re written when a
        flow reaches `crm-updated` and used by the monthly-close window
        query.
      </p>
    </Panel>
  );
}
