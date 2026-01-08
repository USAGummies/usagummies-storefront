import dns from "node:dns/promises";
import https from "node:https";
import fs from "node:fs";

// Minimal .env loader (no external deps)
if (fs.existsSync(".env.local")) {
  const raw = fs.readFileSync(".env.local", "utf8");
  for (const line of raw.split("\n")) {
    if (!line || line.trim().startsWith("#")) continue;
    const m = line.match(/^\s*([^=]+?)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, v] = m;
    const cleaned = v.replace(/^\"|\"$/g, "").replace(/^'|'$/g, "");
    process.env[k.trim()] = cleaned;
  }
}

function sanitizeHost(raw) {
  if (!raw) return undefined;
  let host = raw.trim().replace(/^['"]|['"]$/g, "");
  try {
    const u = new URL(host);
    host = u.hostname;
  } catch {
    // not a full URL; continue
  }
  host = host.replace(/^https?:\/\//, "");
  host = host.split("/")[0];
  return host || undefined;
}

let hostSource = "domain";
let host =
  sanitizeHost(process.env.SHOPIFY_STORE_DOMAIN) ||
  sanitizeHost(process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN) ||
  sanitizeHost(process.env.SHOPIFY_DOMAIN) ||
  sanitizeHost(process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN);

const endpointHost = sanitizeHost(process.env.SHOPIFY_STOREFRONT_API_ENDPOINT);
if (endpointHost) {
  host = endpointHost;
  hostSource = "endpoint";
}

if (!host) {
  console.error("No Shopify host found in env (endpoint or domain).");
  process.exit(1);
}

// Runtime diagnostics
console.log({
  node: process.version,
  execPath: process.execPath,
  platform: `${process.platform}-${process.arch}`,
  cwd: process.cwd(),
  shell: process.env.SHELL || "[not set]",
  ci: Boolean(process.env.CI),
  host,
  source: hostSource,
  dnsServers: dns.getServers(),
});

let dnsOK = false;
let dnsInfo = {};
try {
  const res = await dns.lookup(host);
  dnsOK = true;
  dnsInfo = { address: res.address, family: res.family };
} catch (e) {
  console.log({ host, source: hostSource, dnsOK: false, code: e.code, message: e.message });
  process.exit(2);
}

let httpsOK = false;
let httpsInfo = {};
await new Promise((resolve) => {
  const req = https.request(
    { method: "HEAD", host, path: "/", timeout: 8000 },
    (r) => {
      httpsOK = true;
      httpsInfo = { status: r.statusCode };
      resolve();
    }
  );
  req.on("timeout", () => {
    httpsInfo = { code: "TIMEOUT" };
    req.destroy();
    resolve();
  });
  req.on("error", (e) => {
    httpsInfo = { code: e.code, message: e.message };
    resolve();
  });
  req.end();
});

console.log({ host, source: hostSource, dnsOK, ...dnsInfo, httpsOK, ...httpsInfo });
