#!/usr/bin/env node
/**
 * One-time script: create 3 Gmail drafts for Monday morning emails.
 * Uses existing OAuth credentials from ~/.config/usa-gummies-mcp/
 */
import { google } from "googleapis";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CONFIG_DIR = path.join(os.homedir(), ".config", "usa-gummies-mcp");
const creds = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, "google-oauth-client.json"), "utf8"));
const token = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, "gmail-token.json"), "utf8"));

// Token file may be in "authorized_user" format (from gcloud) or raw token format
const cfg = creds.installed || creds.web;
const oauth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, cfg.redirect_uris[0]);

// If token has "type: authorized_user", use its client_id/secret + refresh_token
if (token.type === "authorized_user") {
  oauth2.setCredentials({ refresh_token: token.refresh_token });
} else {
  oauth2.setCredentials(token);
}
const gmail = google.gmail({ version: "v1", auth: oauth2 });

function toBase64Url(str) {
  return Buffer.from(str).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

const drafts = [
  {
    name: "Bill Thurner — Billing Address + Freight",
    threadId: "19c79be1704a3aa8",
    to: "BillT@albaneseconfectionery.com",
    subject: "Re: USA Gummies — PO & Shipping Details",
    body: `Hi Bill,

Thanks for getting this moving. Here's our billing address:

USA Gummies
1309 Coffeen Avenue STE 1200
Sheridan, WY 82801

Before we lock in the PO, I'm going to get a couple of freight quotes on our end as well — just want to compare options for the 14-pallet shipment to Spokane. I'll circle back early this week once I have those in hand.

Appreciate it,
Ben Stutman
USA Gummies`
  },
  {
    name: "Greg Kroetch — Shelf Life + Film Seal + Belmark",
    threadId: "19c90215996c6726",
    to: "gregk@powers-inc.com",
    subject: "Re: USA Gummies Production — Quick Questions",
    body: `Hi Greg,

A few quick items as we get closer to production:

1. Shelf life — can you confirm we're looking at 18 months on the finished product?

2. Film seal testing — how did the compatibility testing go with the Belmark film? Any issues with the seal integrity on your equipment?

3. Belmark invoice — we're ready to pay the Belmark invoice for the film order. Can you send over the details or confirm the amount so we can get that processed?

Thanks,
Ben Stutman
USA Gummies`
  },
  {
    name: "Brent Overman — UPCs at All Levels",
    threadId: "19ab89cf8fbec82f",
    to: "brento@inderbitzin.com",
    subject: "Re: USA Gummies — UPC Barcodes",
    body: `Hey Brent,

Good talking to you on the phone. Here are the UPCs you need:

Item level (single bag): 199284715530
Case level (36-count): 199284624702
Master carton level: 199284373242

Let me know if you need anything else to get us set up in the system.

Best,
Ben Stutman
USA Gummies`
  }
];

for (const d of drafts) {
  const lines = [
    `To: ${d.to}`,
    `Subject: ${d.subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "MIME-Version: 1.0",
    "",
    d.body
  ];
  const raw = toBase64Url(lines.join("\r\n"));

  try {
    const res = await gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: { raw, threadId: d.threadId }
      }
    });
    console.log(`✓ ${d.name} — Draft ID: ${res.data.id}`);
  } catch (err) {
    console.error(`✗ ${d.name} — ${err.message}`);
    if (err.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
  }
}

console.log("\nDone! Check Gmail drafts folder.");
