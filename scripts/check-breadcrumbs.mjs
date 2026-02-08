#!/usr/bin/env node

const args = process.argv.slice(2);

function getArg(flag) {
  const direct = args.find((arg) => arg.startsWith(`${flag}=`));
  if (direct) return direct.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  if (idx !== -1) return args[idx + 1];
  return undefined;
}

function normalizeBaseUrl(raw) {
  if (!raw) return raw;
  return raw.replace(/\/$/, "");
}

function fail(message) {
  console.error(`\n[breadcrumb-check] ${message}`);
  process.exit(1);
}

function tryParseJson(raw, context) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse JSON-LD ${context}: ${error.message}`);
  }
}

function normalizeJsonLd(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (payload["@graph"] && Array.isArray(payload["@graph"])) return payload["@graph"];
  return [payload];
}

function isBreadcrumbList(node) {
  if (!node || typeof node !== "object") return false;
  const type = node["@type"];
  if (Array.isArray(type)) return type.includes("BreadcrumbList");
  return type === "BreadcrumbList";
}

function extractJsonLd(html) {
  const scripts = [];
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html))) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    scripts.push(raw);
  }
  return scripts;
}

function toAbsolute(baseUrl, path) {
  return new URL(path, baseUrl).toString();
}

function assertBreadcrumb(route, html, baseUrl) {
  const jsonLdScripts = extractJsonLd(html);
  if (!jsonLdScripts.length) {
    fail(`${route.name}: no JSON-LD scripts found at ${route.url}`);
  }

  const nodes = [];
  for (const raw of jsonLdScripts) {
    try {
      const parsed = tryParseJson(raw, `for ${route.name}`);
      nodes.push(...normalizeJsonLd(parsed));
    } catch (error) {
      fail(`${route.name}: ${error.message}`);
    }
  }

  const breadcrumb = nodes.find(isBreadcrumbList);
  if (!breadcrumb) {
    fail(`${route.name}: BreadcrumbList JSON-LD not found at ${route.url}`);
  }

  if (breadcrumb["@type"] !== "BreadcrumbList" && !(Array.isArray(breadcrumb["@type"]) && breadcrumb["@type"].includes("BreadcrumbList"))) {
    fail(`${route.name}: BreadcrumbList @type mismatch: ${JSON.stringify(breadcrumb["@type"])}`);
  }

  const items = breadcrumb.itemListElement;
  if (!Array.isArray(items)) {
    fail(`${route.name}: itemListElement is missing or not an array`);
  }

  if (items.length !== route.crumbs.length) {
    fail(
      `${route.name}: expected ${route.crumbs.length} breadcrumb items but found ${items.length}`
    );
  }

  for (let i = 0; i < route.crumbs.length; i += 1) {
    const expected = route.crumbs[i];
    const item = items[i];
    const position = item?.position;
    const name = item?.name;
    const url = item?.item;

    if (position !== i + 1) {
      fail(`${route.name}: item ${i + 1} position expected ${i + 1} but found ${position}`);
    }
    if (name !== expected.name) {
      fail(`${route.name}: item ${i + 1} name expected "${expected.name}" but found "${name}"`);
    }

    const expectedUrl = toAbsolute(baseUrl, expected.path);
    if (url !== expectedUrl) {
      fail(`${route.name}: item ${i + 1} URL expected ${expectedUrl} but found ${url}`);
    }

    try {
      const parsedUrl = new URL(url);
      if (!parsedUrl.protocol.startsWith("http")) {
        fail(`${route.name}: item ${i + 1} URL is not absolute: ${url}`);
      }
    } catch {
      fail(`${route.name}: item ${i + 1} URL is not a valid absolute URL: ${url}`);
    }
  }

  console.log(`[breadcrumb-check] ${route.name}: OK (${route.url})`);
}

async function main() {
  const baseUrl = normalizeBaseUrl(
    getArg("--base-url") ||
      process.env.BASE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "http://localhost:4000"
  );

  if (!baseUrl) fail("BASE_URL is required");

  const blogPath = getArg("--blog-path") || process.env.BLOG_PATH || "/america-250/gifts";
  const blogParentPath =
    getArg("--blog-parent-path") || process.env.BLOG_PARENT_PATH || "/america-250";
  const blogParentLabel =
    getArg("--blog-parent-label") || process.env.BLOG_PARENT_LABEL || "America 250";
  const blogTitle = getArg("--blog-title") || process.env.BLOG_TITLE || "Gifts";

  const pdpPath = getArg("--pdp-path") || process.env.PDP_PATH;
  const pdpTitle = getArg("--pdp-title") || process.env.PDP_TITLE;
  const pdpParentPath = getArg("--pdp-parent-path") || process.env.PDP_PARENT_PATH || "/shop";
  const pdpParentLabel = getArg("--pdp-parent-label") || process.env.PDP_PARENT_LABEL || "Shop";

  if (pdpPath && !pdpTitle) {
    fail("PDP_PATH provided without PDP_TITLE. Provide --pdp-title or PDP_TITLE.");
  }

  const routes = [
    {
      name: "home",
      path: "/",
      url: toAbsolute(baseUrl, "/"),
      crumbs: [{ name: "Home", path: "/" }],
    },
    {
      name: "shop",
      path: "/shop",
      url: toAbsolute(baseUrl, "/shop"),
      crumbs: [
        { name: "Home", path: "/" },
        { name: "Shop", path: "/shop" },
      ],
    },
    {
      name: "blog",
      path: blogPath,
      url: toAbsolute(baseUrl, blogPath),
      crumbs: [
        { name: "Home", path: "/" },
        { name: blogParentLabel, path: blogParentPath },
        { name: blogTitle, path: blogPath },
      ],
    },
  ];

  if (pdpPath && pdpTitle) {
    routes.push({
      name: "pdp",
      path: pdpPath,
      url: toAbsolute(baseUrl, pdpPath),
      crumbs: [
        { name: "Home", path: "/" },
        { name: pdpParentLabel, path: pdpParentPath },
        { name: pdpTitle, path: pdpPath },
      ],
    });
  } else {
    console.log("[breadcrumb-check] PDP route not configured; skipping PDP assertion.");
  }

  for (const route of routes) {
    const res = await fetch(route.url, { redirect: "follow" });
    if (!res.ok) {
      fail(`${route.name}: request failed ${res.status} ${res.statusText} (${route.url})`);
    }
    const html = await res.text();
    assertBreadcrumb(route, html, baseUrl);
  }
}

main().catch((error) => {
  fail(error?.message || "Unknown error");
});
