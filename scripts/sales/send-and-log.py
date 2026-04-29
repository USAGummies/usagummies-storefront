#!/usr/bin/env python3
"""
send-and-log.py — Canonical send + HubSpot lifecycle for B2B cold outreach.

This is the SINGLE entry point any agent/script must use to send a cold B2B
outreach email. It guarantees the full lifecycle happens atomically:

  1. Validator gate (outreach-validate.mjs) — product-claim, pricing, format,
     Apollo, HubSpot contact-dedup, deal-name dedup. HARD BLOCK on fail.
  2. find_or_create_contact (HubSpot) by email.
  3. find_or_create_deal (HubSpot) by company-name token in pipeline 1907159777.
     Returns the EXISTING master deal if any. Never creates a duplicate.
  4. Associate contact <-> deal.
  5. Send the email via scripts/send-email.sh (himalaya/SMTP) — includes the
     repeat guard and email_send_log.
  6. Create the HubSpot email engagement (type emails) with hs_email_headers
     so it shows in the deal/contact timeline.
  7. Associate engagement <-> deal AND engagement <-> contact.
  8. Print a structured summary so the caller can verify what landed.

Background — 2026-04-29 incident: an inline send batch bypassed step 3 and
created 5 duplicate deals. This helper exists so it cannot recur.

Usage:
  python3 scripts/sales/send-and-log.py \
    --company "Buc-ee's" \
    --email   kevin.mcnabb@buc-ees.com \
    --first   Kevin \
    --last    McNabb \
    --jobtitle "Senior Director of Marketing" \
    --subject "USA Gummies — All American Gummy Bears for Buc-ee's" \
    --body    drafts/buc-ees-kevin.txt

Optional flags:
  --skip-apollo            Pass through to validator (dev only).
  --skip-deal              Pass through to validator (only when target is
                           genuinely a distinct entity from an existing deal).
  --dry-run                Run the full HubSpot + validator path but do NOT
                           send the email or create the engagement.
  --pipeline <id>          Override pipeline (default 1907159777 — B2B Wholesale).
  --stage <id>             Override deal stage when creating a NEW deal
                           (default 3017718461 — Contacted).

Exit codes:
  0  send + log succeeded (or dry-run completed)
  1  validator BLOCK or HubSpot error
  2  config / usage error
  3  email send failed
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = REPO_ROOT / "scripts" / "outreach-validate.mjs"
SEND_EMAIL = REPO_ROOT / "scripts" / "send-email.sh"

DEFAULT_PIPELINE = "1907159777"  # B2B Wholesale
DEFAULT_STAGE = "3017718461"     # Contacted
CLOSED_LOST = "3502659283"
ON_HOLD = "3502659284"


# --------------------------------------------------------------------- HubSpot
def hs_request(method: str, path: str, body: dict | None = None) -> dict:
    tok = os.environ["HUBSPOT_PRIVATE_APP_TOKEN"]
    headers = {
        "Authorization": f"Bearer {tok}",
        "Content-Type": "application/json",
    }
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"https://api.hubapi.com{path}",
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        return {"_error": e.code, "_body": e.read().decode()}


def find_or_create_contact(
    email: str, first: str, last: str, jobtitle: str, company_label: str
) -> tuple[str, bool]:
    """Returns (contact_id, was_existing)."""
    res = hs_request(
        "POST",
        "/crm/v3/objects/contacts/search",
        {
            "filterGroups": [
                {"filters": [{"propertyName": "email", "operator": "EQ", "value": email}]}
            ],
            "properties": ["email", "firstname", "lastname", "jobtitle", "company"],
            "limit": 1,
        },
    )
    if "_error" in res:
        raise RuntimeError(f"HubSpot contact search failed: {res}")
    if res.get("total", 0) > 0:
        return res["results"][0]["id"], True

    create = hs_request(
        "POST",
        "/crm/v3/objects/contacts",
        {
            "properties": {
                "email": email,
                "firstname": first,
                "lastname": last,
                "jobtitle": jobtitle,
                "company": company_label,
            }
        },
    )
    if "_error" in create:
        raise RuntimeError(f"HubSpot contact create failed: {create}")
    return create["id"], False


def find_or_create_deal(
    company: str, dealname_for_new: str, pipeline: str, stage: str
) -> tuple[str, bool]:
    """Returns (deal_id, was_existing). Searches by brand token."""
    token = "".join(ch for ch in company.split()[0] if ch.isalnum() or ch in "'-")
    if len(token) < 3:
        # Fallback — use the whole company name string
        token = company
    res = hs_request(
        "POST",
        "/crm/v3/objects/deals/search",
        {
            "filterGroups": [
                {
                    "filters": [
                        {"propertyName": "dealname", "operator": "CONTAINS_TOKEN", "value": token},
                        {"propertyName": "pipeline", "operator": "EQ", "value": pipeline},
                    ]
                }
            ],
            "properties": ["dealname", "dealstage", "createdate"],
            "sorts": [{"propertyName": "createdate", "direction": "ASCENDING"}],
            "limit": 25,
        },
    )
    if "_error" in res:
        raise RuntimeError(f"HubSpot deal search failed: {res}")
    open_existing = [
        d for d in res.get("results", [])
        if d["properties"].get("dealstage") not in {CLOSED_LOST, ON_HOLD}
    ]
    if open_existing:
        # Master = oldest open deal
        return open_existing[0]["id"], True

    create = hs_request(
        "POST",
        "/crm/v3/objects/deals",
        {
            "properties": {
                "dealname": dealname_for_new,
                "pipeline": pipeline,
                "dealstage": stage,
            }
        },
    )
    if "_error" in create:
        raise RuntimeError(f"HubSpot deal create failed: {create}")
    return create["id"], False


def associate(from_type: str, from_id: str, to_type: str, to_id: str) -> None:
    res = hs_request(
        "PUT",
        f"/crm/v4/objects/{from_type}/{from_id}/associations/default/{to_type}/{to_id}",
    )
    if "_error" in res and res.get("_error") not in (200, 201):
        # 409 / 200 idempotent — only raise on real failure
        if res.get("_error") not in (409,):
            raise RuntimeError(f"HubSpot associate {from_type}/{from_id} -> {to_type}/{to_id} failed: {res}")


def create_email_engagement(
    deal_id: str,
    contact_id: str,
    contact_email: str,
    subject: str,
    body_text: str,
    from_email: str = "ben@usagummies.com",
    from_name: str = "Ben Stutman",
) -> str:
    headers = {
        "from": {"email": from_email, "firstName": from_name.split()[0], "lastName": " ".join(from_name.split()[1:])},
        "to": [{"email": contact_email}],
    }
    ts_ms = int(_dt.datetime.now(_dt.timezone.utc).timestamp() * 1000)
    res = hs_request(
        "POST",
        "/crm/v3/objects/emails",
        {
            "properties": {
                "hs_timestamp": ts_ms,
                "hs_email_direction": "EMAIL",
                "hs_email_status": "SENT",
                "hs_email_subject": subject,
                "hs_email_text": body_text,
                "hs_email_headers": json.dumps(headers),
            }
        },
    )
    if "_error" in res:
        raise RuntimeError(f"HubSpot email engagement create failed: {res}")
    eng_id = res["id"]
    associate("emails", eng_id, "deals", deal_id)
    associate("emails", eng_id, "contacts", contact_id)
    return eng_id


# --------------------------------------------------------------------- Validator
def run_validator(
    email: str,
    body_path: Path,
    company: str,
    skip_apollo: bool,
    skip_deal: bool,
) -> tuple[int, str]:
    cmd = [
        "node",
        str(VALIDATOR),
        f"--email={email}",
        f"--body={body_path}",
        f"--company={company}",
        # Gmail check has no runtime — always skip. Repeat guard inside send-email.sh.
        "--skip-gmail",
    ]
    if skip_apollo:
        cmd.append("--skip-apollo")
    if skip_deal:
        cmd.append("--skip-deal")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    out = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode, out


# --------------------------------------------------------------------- Email send
def send_email(to: str, subject: str, body_path: Path, dry_run: bool) -> tuple[int, str]:
    cmd = [
        "bash",
        str(SEND_EMAIL),
        "--to", to,
        "--subject", subject,
        "--body-file", str(body_path),
    ]
    if dry_run:
        cmd.append("--dry-run")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


# --------------------------------------------------------------------- Main
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--company", required=True, help="Company / brand name (used for deal-name dedup)")
    ap.add_argument("--email", required=True, help="Recipient email")
    ap.add_argument("--first", required=True, help="Recipient first name")
    ap.add_argument("--last", required=True, help="Recipient last name")
    ap.add_argument("--jobtitle", default="", help="Recipient job title")
    ap.add_argument("--subject", required=True, help="Email subject")
    ap.add_argument("--body", required=True, help="Path to plain-text email body")
    ap.add_argument("--dealname", default="", help="Override deal name when creating NEW deal (default: 'Wholesale — <company>')")
    ap.add_argument("--pipeline", default=DEFAULT_PIPELINE)
    ap.add_argument("--stage", default=DEFAULT_STAGE)
    ap.add_argument("--skip-apollo", action="store_true")
    ap.add_argument("--skip-deal", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="Run validator + HubSpot dedup but do NOT send or log engagement")
    args = ap.parse_args()

    body_path = Path(args.body).resolve()
    if not body_path.exists():
        print(f"BODY NOT FOUND: {body_path}", file=sys.stderr)
        return 2

    if "HUBSPOT_PRIVATE_APP_TOKEN" not in os.environ:
        print("HUBSPOT_PRIVATE_APP_TOKEN missing in env. source .env.local first.", file=sys.stderr)
        return 2

    body_text = body_path.read_text()
    new_dealname = args.dealname or f"Wholesale — {args.company}"

    # ------------------------------------------------------------- 1. Validator
    print(f"[1/7] Validator gate: {args.email} / {args.company}", flush=True)
    rc, out = run_validator(args.email, body_path, args.company, args.skip_apollo, args.skip_deal)
    print(out)
    if rc != 0:
        print("VALIDATOR BLOCK — aborting send.", file=sys.stderr)
        return 1

    # ------------------------------------------------------------- 2. Contact
    print(f"[2/7] find_or_create_contact({args.email})", flush=True)
    contact_id, contact_existing = find_or_create_contact(
        args.email, args.first, args.last, args.jobtitle, args.company
    )
    print(f"      contact_id={contact_id}  existing={contact_existing}")

    # ------------------------------------------------------------- 3. Deal
    print(f"[3/7] find_or_create_deal('{args.company}')", flush=True)
    deal_id, deal_existing = find_or_create_deal(
        args.company, new_dealname, args.pipeline, args.stage
    )
    print(f"      deal_id={deal_id}  existing={deal_existing}  new_name='{new_dealname if not deal_existing else '(attached to existing master)'}'")

    # ------------------------------------------------------------- 4. Associate contact <-> deal
    print(f"[4/7] associate(contact {contact_id} <-> deal {deal_id})", flush=True)
    associate("contacts", contact_id, "deals", deal_id)

    if args.dry_run:
        print(f"[DRY RUN] Would now send to {args.email} and log engagement on deal {deal_id}.")
        print(json.dumps({
            "result": "dry_run",
            "contact_id": contact_id,
            "contact_existing": contact_existing,
            "deal_id": deal_id,
            "deal_existing": deal_existing,
        }, indent=2))
        return 0

    # ------------------------------------------------------------- 5. Send email
    print(f"[5/7] send_email({args.email})", flush=True)
    send_rc, send_out = send_email(args.email, args.subject, body_path, dry_run=False)
    print(send_out)
    if send_rc != 0:
        print(f"EMAIL SEND FAILED (rc={send_rc}). Aborting before logging engagement.", file=sys.stderr)
        return 3

    # ------------------------------------------------------------- 6 + 7. Engagement + associate
    print("[6/7] create_email_engagement + associate to deal & contact", flush=True)
    engagement_id = create_email_engagement(
        deal_id, contact_id, args.email, args.subject, body_text
    )
    print(f"      engagement_id={engagement_id}")

    print("[7/7] DONE")
    print(json.dumps({
        "result": "sent",
        "to": args.email,
        "subject": args.subject,
        "company": args.company,
        "contact_id": contact_id,
        "contact_existing": contact_existing,
        "deal_id": deal_id,
        "deal_existing": deal_existing,
        "engagement_id": engagement_id,
    }, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        sys.exit(1)
