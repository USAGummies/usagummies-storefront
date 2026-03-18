#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
];

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), ".config", "usa-gummies-mcp");
const DEFAULT_CREDENTIALS_PATH = path.join(DEFAULT_CONFIG_DIR, "google-oauth-client.json");
const DEFAULT_TOKEN_PATH = path.join(DEFAULT_CONFIG_DIR, "gmail-token.json");

function printHelp() {
  console.log(`
Gmail OAuth helper (read + send)

Usage:
  node scripts/gmail.mjs auth [--credentials PATH] [--token PATH] [--force]
  node scripts/gmail.mjs list [--query QUERY] [--max N] [--credentials PATH] [--token PATH]
  node scripts/gmail.mjs send --to EMAIL --subject TEXT (--body TEXT | --body-file PATH)
                             [--cc EMAILS] [--bcc EMAILS] [--credentials PATH] [--token PATH]
                             [--dry-run]

Examples:
  node scripts/gmail.mjs auth --credentials ~/Downloads/client_secret.json
  node scripts/gmail.mjs list --query "in:inbox newer_than:7d" --max 10
  node scripts/gmail.mjs send --to "dad@example.com" --subject "Test" --body "Hello"
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function expandHome(filePath) {
  if (!filePath) return filePath;
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/")) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadOAuthClient(credentialsPath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
  } catch (err) {
    throw new Error(`Could not read OAuth client file at ${credentialsPath}: ${err.message}`);
  }

  const cfg = raw.installed || raw.web;
  if (!cfg?.client_id || !cfg?.client_secret || !cfg?.redirect_uris?.[0]) {
    throw new Error(
      `Invalid OAuth client JSON in ${credentialsPath}. Download the "Desktop app" JSON from Google Cloud.`
    );
  }

  return new google.auth.OAuth2(cfg.client_id, cfg.client_secret, cfg.redirect_uris[0]);
}

function getPaths(args) {
  const credentialsPath = expandHome(
    args.credentials || process.env.GMAIL_OAUTH_CLIENT_PATH || DEFAULT_CREDENTIALS_PATH
  );
  const tokenPath = expandHome(args.token || process.env.GMAIL_TOKEN_PATH || DEFAULT_TOKEN_PATH);
  return { credentialsPath, tokenPath };
}

async function buildGmailClient(args) {
  const { credentialsPath, tokenPath } = getPaths(args);
  const oauth2Client = loadOAuthClient(credentialsPath);

  if (!fs.existsSync(tokenPath)) {
    throw new Error(
      `Token file not found at ${tokenPath}. Run auth first: node scripts/gmail.mjs auth --credentials "${credentialsPath}"`
    );
  }

  const token = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  oauth2Client.setCredentials(token);
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  return { gmail, oauth2Client, credentialsPath, tokenPath };
}

async function runAuth(args) {
  const { credentialsPath, tokenPath } = getPaths(args);
  const oauth2Client = loadOAuthClient(credentialsPath);

  if (fs.existsSync(tokenPath) && !args.force) {
    oauth2Client.setCredentials(JSON.parse(fs.readFileSync(tokenPath, "utf8")));
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: "me" });
    console.log(`Already authorized for ${profile.data.emailAddress}`);
    console.log(`Token path: ${tokenPath}`);
    return;
  }

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  console.log("Open this URL, sign in as ben@usagummies.com, and approve access:");
  console.log(authUrl);

  if (!args["no-open"]) {
    try {
      if (process.platform === "darwin") execSync(`open '${authUrl.replace(/'/g, "'\\''")}'`);
    } catch {
      // Ignore failed auto-open; URL is already printed.
    }
  }

  const rl = readline.createInterface({ input, output });
  const code = (await rl.question("Paste the authorization code: ")).trim();
  rl.close();
  if (!code) throw new Error("No authorization code provided.");

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  ensureParentDir(tokenPath);
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), "utf8");

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  console.log(`Connected as ${profile.data.emailAddress}`);
  console.log(`Saved token to ${tokenPath}`);
}

function headerValue(headers, name) {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

async function runList(args) {
  const { gmail } = await buildGmailClient(args);
  const maxResults = Number.parseInt(args.max || "10", 10);
  const safeMax = Number.isFinite(maxResults) ? Math.min(Math.max(maxResults, 1), 100) : 10;

  const response = await gmail.users.messages.list({
    userId: "me",
    maxResults: safeMax,
    q: args.query || undefined,
  });

  const messages = response.data.messages || [];
  if (!messages.length) {
    console.log("No matching messages.");
    return;
  }

  for (let i = 0; i < messages.length; i += 1) {
    const msg = await gmail.users.messages.get({
      userId: "me",
      id: messages[i].id,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    });
    const headers = msg.data.payload?.headers || [];
    const from = headerValue(headers, "From");
    const subject = headerValue(headers, "Subject");
    const date = headerValue(headers, "Date");
    console.log(`${i + 1}. ${date}`);
    console.log(`   From: ${from}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   Message ID: ${messages[i].id}`);
  }
}

function toBase64Url(inputValue) {
  return Buffer.from(inputValue)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function readBody(args) {
  if (args["body-file"]) {
    const filePath = expandHome(String(args["body-file"]));
    return fs.readFileSync(filePath, "utf8");
  }
  return String(args.body || "");
}

async function runSend(args) {
  const to = args.to;
  const subject = args.subject;
  const body = readBody(args);
  if (!to || !subject || !body) {
    throw new Error('send requires --to, --subject, and either --body or --body-file.');
  }

  const { gmail } = await buildGmailClient(args);
  const lines = [];
  lines.push(`To: ${to}`);
  if (args.cc) lines.push(`Cc: ${args.cc}`);
  if (args.bcc) lines.push(`Bcc: ${args.bcc}`);
  lines.push(`Subject: ${subject}`);
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push("MIME-Version: 1.0");
  lines.push("");
  lines.push(body);

  const raw = toBase64Url(lines.join("\r\n"));

  if (args["dry-run"]) {
    console.log("Dry run only. Encoded message was built successfully.");
    return;
  }

  const sent = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });

  console.log(`Sent. Message ID: ${sent.data.id}`);
  if (sent.data.threadId) console.log(`Thread ID: ${sent.data.threadId}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "auth") {
    await runAuth(args);
    return;
  }

  if (command === "list") {
    await runList(args);
    return;
  }

  if (command === "send") {
    await runSend(args);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
