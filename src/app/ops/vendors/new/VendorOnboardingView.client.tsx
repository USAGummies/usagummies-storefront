"use client";

import { useState, type FormEvent } from "react";

import {
  GOLD,
  NAVY,
  RED,
  SURFACE_BORDER as BORDER,
  SURFACE_CARD as CARD,
  SURFACE_TEXT_DIM as DIM,
} from "@/app/ops/tokens";

type FormState = {
  name: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  website: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  terms: string;
  termsId: string;
  taxClass: string;
  taxIdentifier: string;
  accountNumber: string;
  w9DriveUrl: string;
  coiDriveUrl: string;
  notes: string;
};

type Result =
  | { ok: true; approvalId: string; proposalTs: string | null; dedupeKey: string }
  | { ok: false; error: string };

const initial: FormState = {
  name: "",
  companyName: "",
  contactName: "",
  email: "",
  phone: "",
  website: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  terms: "",
  termsId: "",
  taxClass: "",
  taxIdentifier: "",
  accountNumber: "",
  w9DriveUrl: "",
  coiDriveUrl: "",
  notes: "",
};

function textInput(label: string, key: keyof FormState, state: FormState, setState: (next: FormState) => void, opts: { required?: boolean; type?: string; placeholder?: string } = {}) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: DIM, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}{opts.required ? " *" : ""}
      </span>
      <input
        required={opts.required}
        type={opts.type || "text"}
        value={state[key]}
        placeholder={opts.placeholder}
        onChange={(event) => setState({ ...state, [key]: event.target.value })}
        style={{
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          background: "#fff",
          color: NAVY,
          padding: "10px 12px",
          fontSize: 14,
          fontFamily: "inherit",
        }}
      />
    </label>
  );
}

export function VendorOnboardingView() {
  const [form, setForm] = useState<FormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/ops/vendors/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          companyName: form.companyName,
          contactName: form.contactName,
          email: form.email,
          phone: form.phone,
          website: form.website,
          addressLine1: form.addressLine1,
          addressLine2: form.addressLine2,
          city: form.city,
          state: form.state,
          postalCode: form.postalCode,
          terms: form.terms,
          termsId: form.termsId,
          taxClass: form.taxClass,
          taxIdentifier: form.taxIdentifier,
          accountNumber: form.accountNumber,
          w9DriveUrl: form.w9DriveUrl,
          coiDriveUrl: form.coiDriveUrl,
          notes: form.notes,
          originator: "ops-vendors-new",
        }),
      });
      const data = (await res.json()) as Result;
      if (!res.ok || !data.ok) {
        throw new Error(!data.ok ? data.error : `HTTP ${res.status}`);
      }
      setResult(data);
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1180, margin: "0 auto", color: NAVY }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Vendor Onboarding</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: DIM }}>
          Create a Rene-approved vendor master. Submission opens a Slack approval; QBO is not written until approval.
        </p>
      </div>

      {result ? (
        <div
          style={{
            border: `1px solid ${result.ok ? "#15803d55" : `${RED}55`}`,
            background: result.ok ? "#15803d10" : `${RED}10`,
            borderRadius: 12,
            padding: 14,
            marginBottom: 18,
            color: result.ok ? "#15803d" : RED,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {result.ok
            ? `Approval opened: ${result.approvalId}. Rene can approve in #ops-approvals.`
            : result.error}
        </div>
      ) : null}

      <form
        onSubmit={(event) => void submit(event)}
        style={{
          display: "grid",
          gap: 18,
          border: `1px solid ${BORDER}`,
          borderRadius: 16,
          background: CARD,
          padding: 18,
        }}
      >
        <section style={{ display: "grid", gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>Vendor identity</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
            {textInput("Vendor display name", "name", form, setForm, { required: true, placeholder: "Snow Leopard Ventures LLC" })}
            {textInput("Company legal name", "companyName", form, setForm)}
            {textInput("Contact name", "contactName", form, setForm)}
            {textInput("Email", "email", form, setForm, { type: "email" })}
            {textInput("Phone", "phone", form, setForm)}
            {textInput("Website", "website", form, setForm)}
          </div>
        </section>

        <section style={{ display: "grid", gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>Address</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
            {textInput("Address line 1", "addressLine1", form, setForm)}
            {textInput("Address line 2", "addressLine2", form, setForm)}
            {textInput("City", "city", form, setForm)}
            {textInput("State", "state", form, setForm)}
            {textInput("ZIP", "postalCode", form, setForm)}
          </div>
        </section>

        <section style={{ display: "grid", gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>Finance doctrine fields</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
            {textInput("Payment terms", "terms", form, setForm, { placeholder: "Net 10 / Due on Receipt" })}
            {textInput("QBO terms ID", "termsId", form, setForm)}
            {textInput("Tax class", "taxClass", form, setForm)}
            {textInput("Tax identifier", "taxIdentifier", form, setForm)}
            {textInput("Vendor account #", "accountNumber", form, setForm)}
          </div>
          <div style={{ fontSize: 12, color: DIM }}>
            Tax identifier is masked in Slack approval preview but stored only to execute the approved QBO vendor write.
          </div>
        </section>

        <section style={{ display: "grid", gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>Documents</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
            {textInput("W-9 Drive URL", "w9DriveUrl", form, setForm)}
            {textInput("COI Drive URL", "coiDriveUrl", form, setForm)}
          </div>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: DIM, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Notes
            </span>
            <textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              rows={4}
              style={{
                border: `1px solid ${BORDER}`,
                borderRadius: 10,
                background: "#fff",
                color: NAVY,
                padding: "10px 12px",
                fontSize: 14,
                fontFamily: "inherit",
                resize: "vertical",
              }}
            />
          </label>
        </section>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontSize: 12, color: DIM }}>
            Opens Class B approval: <strong>vendor.master.create</strong>. Approver: Rene.
          </div>
          <button
            type="submit"
            disabled={submitting || !form.name.trim()}
            style={{
              border: "none",
              borderRadius: 12,
              background: submitting ? "#9ca3af" : GOLD,
              color: NAVY,
              padding: "11px 18px",
              fontSize: 14,
              fontWeight: 900,
              cursor: submitting ? "default" : "pointer",
            }}
          >
            {submitting ? "Opening approval..." : "Open Rene approval"}
          </button>
        </div>
      </form>
    </div>
  );
}
