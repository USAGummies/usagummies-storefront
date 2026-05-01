"use client";

/**
 * Sample Queue — desk-friendly form for /api/ops/sample/queue.
 *
 * Why this page exists:
 *   The /api/ops/sample/queue endpoint accepts a lean shape so an
 *   operator at their desk can drop a sample bag without adapting
 *   webhook-style OrderIntent. This page is the missing UI.
 *
 *   Ben at his desk talks to a buyer at a show, gets the address,
 *   pastes it into this form, hits "Queue sample." Backend opens the
 *   Class B `shipment.create` approval in #ops-approvals; Ben taps
 *   Approve in Slack and the label fires.
 *
 * Whale detection (Buc-ee's, KeHE, McLane, Eastern National, Xanterra,
 * Delaware North, Aramark, Compass, Sodexo) is computed server-side
 * and surfaces back in the response.
 */
import { useCallback, useMemo, useState } from "react";

import {
  NAVY,
  GOLD,
  RED,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as DIM,
} from "@/app/ops/tokens";

interface QueueResponse {
  ok: boolean;
  posted?: boolean;
  postedTo?: string | null;
  approvalId?: string | null;
  proposalTs?: string | null;
  priority?: "whale" | "standard";
  sourceId?: string;
  refuse?: boolean;
  refuseReason?: string;
  classification?: {
    origin: string;
    originReason: string;
    carrierCode: string;
    serviceCode: string;
    packagingType: string;
    cartons: number;
    warnings: string[];
  };
  proposal?: { renderedMarkdown?: string };
  degraded?: string[];
  error?: string;
}

const ROLES = ["", "buyer", "broker", "distributor", "media", "other"] as const;
type Role = (typeof ROLES)[number];

const GREEN = "#16a34a";

export function SampleQueueView() {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [street1, setStreet1] = useState("");
  const [street2, setStreet2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>("");
  const [quantity, setQuantity] = useState<number>(6);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<QueueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const formValid = useMemo(
    () =>
      name.trim().length > 0 &&
      street1.trim().length > 0 &&
      city.trim().length > 0 &&
      state.trim().length === 2 &&
      postalCode.trim().length > 0 &&
      quantity > 0 &&
      quantity <= 36,
    [name, street1, city, state, postalCode, quantity],
  );

  const submit = useCallback(
    async (postFlag: boolean) => {
      setSubmitting(true);
      setError(null);
      setResult(null);
      try {
        const body = {
          recipient: {
            name: name.trim(),
            company: company.trim() || undefined,
            street1: street1.trim(),
            street2: street2.trim() || undefined,
            city: city.trim(),
            state: state.trim().toUpperCase(),
            postalCode: postalCode.trim(),
            phone: phone.trim() || undefined,
          },
          role: role || undefined,
          quantity,
          note: note.trim() || undefined,
          post: postFlag,
        };
        const res = await fetch("/api/ops/sample/queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        const json = (text ? JSON.parse(text) : {}) as QueueResponse;
        if (!res.ok) {
          setError(json.error || `HTTP ${res.status}`);
          setResult(json);
          return;
        }
        setResult(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    },
    [name, company, street1, street2, city, state, postalCode, phone, role, quantity, note],
  );

  const reset = () => {
    setName("");
    setCompany("");
    setStreet1("");
    setStreet2("");
    setCity("");
    setState("");
    setPostalCode("");
    setPhone("");
    setRole("");
    setQuantity(6);
    setNote("");
    setResult(null);
    setError(null);
  };

  return (
    <div style={{ padding: 24, maxWidth: 880, margin: "0 auto", color: NAVY }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>
          📦 Sample Queue
        </h1>
        <div style={{ fontSize: 13, color: DIM, marginTop: 4 }}>
          Drop a sample. Opens a Class B <code style={code}>shipment.create</code>{" "}
          approval in <strong>#ops-approvals</strong>. Approve in Slack to fire
          the label. Whale accounts (Buc-ee&apos;s, KeHE, McLane, Eastern
          National, Xanterra, Delaware North, Aramark, Compass, Sodexo) are
          flagged automatically.
        </div>
      </div>

      <div
        style={{
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          background: CARD,
          padding: 18,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Recipient name *">
            <Input value={name} onChange={setName} placeholder="Greg Kroetch" />
          </Field>
          <Field label="Company">
            <Input
              value={company}
              onChange={setCompany}
              placeholder="Powers Confections"
            />
          </Field>
          <Field label="Street 1 *" full>
            <Input
              value={street1}
              onChange={setStreet1}
              placeholder="1115 N Hayford Rd"
            />
          </Field>
          <Field label="Street 2 (apt/suite)" full>
            <Input value={street2} onChange={setStreet2} placeholder="Suite 200" />
          </Field>
          <Field label="City *">
            <Input value={city} onChange={setCity} placeholder="Spokane" />
          </Field>
          <Field label="State *">
            <Input
              value={state}
              onChange={(v) => setState(v.toUpperCase().slice(0, 2))}
              placeholder="WA"
              maxLength={2}
            />
          </Field>
          <Field label="ZIP *">
            <Input
              value={postalCode}
              onChange={setPostalCode}
              placeholder="99224"
            />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={setPhone} placeholder="+1-555-555-5555" />
          </Field>
          <Field label="Role">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              style={inputStyle}
            >
              <option value="">— select —</option>
              {ROLES.filter((r) => r).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity (bags) *">
            <Input
              type="number"
              value={String(quantity)}
              onChange={(v) => setQuantity(Math.max(1, Math.min(36, Number(v) || 1)))}
              placeholder="6"
            />
          </Field>
          <Field label="Note (free-form)" full>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Met at Reunion 2026 — buyer for premium candy line"
              rows={3}
              style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
            />
          </Field>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <button
            onClick={() => void submit(true)}
            disabled={!formValid || submitting}
            style={{
              ...buttonPrimary,
              opacity: !formValid || submitting ? 0.5 : 1,
              cursor: !formValid || submitting ? "default" : "pointer",
            }}
          >
            {submitting ? "Queuing…" : "🚀 Queue sample (open approval)"}
          </button>
          <button
            onClick={() => void submit(false)}
            disabled={!formValid || submitting}
            style={{
              ...buttonSecondary,
              opacity: !formValid || submitting ? 0.5 : 1,
              cursor: !formValid || submitting ? "default" : "pointer",
            }}
            title="Run classifier without opening a Slack approval — preview only"
          >
            👁 Preview only
          </button>
          <button onClick={reset} disabled={submitting} style={buttonGhost}>
            Reset
          </button>
        </div>
        {!formValid && (name || street1 || city) && (
          <div style={{ marginTop: 10, fontSize: 11, color: DIM }}>
            Fill the 5 starred fields. State must be a 2-letter US code.
            Quantity must be 1–36.
          </div>
        )}
      </div>

      {error && (
        <div
          style={{
            border: `1px solid ${RED}55`,
            background: `${RED}0d`,
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 16,
            fontSize: 13,
            color: RED,
          }}
        >
          ❌ {error}
        </div>
      )}

      {result && result.refuse && (
        <div
          style={{
            border: `1px solid ${RED}55`,
            background: `${RED}10`,
            borderRadius: 10,
            padding: 14,
            marginBottom: 16,
            color: RED,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
            🚫 Dispatch refused
          </div>
          <div style={{ fontSize: 12 }}>{result.refuseReason}</div>
        </div>
      )}

      {result && !result.refuse && result.ok && (
        <div
          style={{
            border: `1px solid ${GREEN}55`,
            background: `${GREEN}10`,
            borderRadius: 10,
            padding: 14,
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14, color: GREEN, marginBottom: 8 }}>
            {result.posted ? "✅ Approval opened" : "👁 Preview"}
            {result.priority === "whale" && (
              <span
                style={{
                  marginLeft: 10,
                  background: `${GOLD}20`,
                  border: `1px solid ${GOLD}55`,
                  color: NAVY,
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                🐳 Whale
              </span>
            )}
          </div>
          <ResultRow label="Source ID" value={result.sourceId} mono />
          {result.posted && (
            <>
              <ResultRow label="Posted to" value={result.postedTo ?? "—"} />
              <ResultRow label="Approval ID" value={result.approvalId ?? "—"} mono />
            </>
          )}
          {result.classification && (
            <>
              <ResultRow
                label="Origin"
                value={`${result.classification.origin} — ${result.classification.originReason}`}
              />
              <ResultRow
                label="Carrier / service"
                value={`${result.classification.carrierCode} / ${result.classification.serviceCode}`}
                mono
              />
              <ResultRow
                label="Packaging"
                value={`${result.classification.cartons}× ${result.classification.packagingType}`}
              />
              {result.classification.warnings.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 11, color: NAVY }}>
                  ⚠️ {result.classification.warnings.join("; ")}
                </div>
              )}
            </>
          )}
          {result.degraded && result.degraded.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: NAVY }}>
              Degraded: {result.degraded.join(" · ")}
            </div>
          )}
          {result.proposal?.renderedMarkdown && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, color: DIM }}>
                Proposal preview
              </summary>
              <pre
                style={{
                  marginTop: 8,
                  padding: 10,
                  background: "rgba(27,42,74,0.04)",
                  borderRadius: 8,
                  fontSize: 11,
                  whiteSpace: "pre-wrap",
                  overflow: "auto",
                  maxHeight: 320,
                }}
              >
                {result.proposal.renderedMarkdown}
              </pre>
            </details>
          )}
        </div>
      )}

      <div
        style={{
          padding: "10px 14px",
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          fontSize: 11,
          color: DIM,
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontWeight: 600, color: NAVY, marginBottom: 4 }}>
          How this flows
        </div>
        Form → <code style={code}>POST /api/ops/sample/queue</code> →{" "}
        <code style={code}>classifyDispatch()</code> picks origin / carrier /
        packaging → <code style={code}>requestApproval()</code> opens a Class B{" "}
        <code style={code}>shipment.create</code> in #ops-approvals → Ben taps
        Approve → ShipStation buys the label. No label is bought before the
        Slack tap; rollback is dropping the pending approval.
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
  color: NAVY,
  background: "white",
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const buttonPrimary: React.CSSProperties = {
  border: `1px solid ${NAVY}`,
  borderRadius: 8,
  background: NAVY,
  color: "white",
  padding: "10px 18px",
  fontSize: 13,
  fontWeight: 700,
};

const buttonSecondary: React.CSSProperties = {
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  background: "white",
  color: NAVY,
  padding: "10px 18px",
  fontSize: 13,
  fontWeight: 600,
};

const buttonGhost: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: DIM,
  padding: "10px 12px",
  fontSize: 12,
  cursor: "pointer",
};

const code: React.CSSProperties = {
  fontFamily: "ui-monospace, Menlo, monospace",
  background: "rgba(27,42,74,0.04)",
  padding: "1px 5px",
  borderRadius: 4,
  fontSize: 11,
};

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div style={{ gridColumn: full ? "span 2" : undefined }}>
      <label style={{ fontSize: 11, color: DIM, fontWeight: 600 }}>{label}</label>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  maxLength,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  maxLength?: number;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type}
      maxLength={maxLength}
      style={inputStyle}
    />
  );
}

function ResultRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | undefined;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 12,
        padding: "3px 0",
        borderBottom: `1px dashed ${BORDER}`,
        fontSize: 12,
      }}
    >
      <span style={{ color: DIM }}>{label}</span>
      <span
        style={{
          color: NAVY,
          fontFamily: mono ? "ui-monospace, Menlo, monospace" : "inherit",
          textAlign: "right",
        }}
      >
        {value || "—"}
      </span>
    </div>
  );
}
