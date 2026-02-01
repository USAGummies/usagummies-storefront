import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const OUTPUT_ROOT = process.env.SCREENSHOT_DIR || "artifacts/screenshots";

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function screenshotPath(testInfo: any, name: string) {
  const dir = path.join(OUTPUT_ROOT, testInfo.project.name);
  ensureDir(dir);
  return path.join(dir, `${name}.png`);
}

async function captureSection(
  page: any,
  testInfo: any,
  route: string,
  selector: string,
  name: string
) {
  await page.goto(route, { waitUntil: "networkidle" });
  const target = page.locator(selector);
  await expect(target).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await target.screenshot({ path: screenshotPath(testInfo, name) });
}

async function captureFullPage(page: any, testInfo: any, route: string, name: string) {
  await page.goto(route, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: screenshotPath(testInfo, name), fullPage: true });
}

test.describe("purchase rail screenshots", () => {
  test("home purchase rail", async ({ page }, testInfo) => {
    await captureSection(page, testInfo, "/", "[data-bundle-root]", "home-purchase-rail");
  });

  test("shop purchase rail", async ({ page }, testInfo) => {
    await captureSection(page, testInfo, "/shop", "[data-bundle-root]", "shop-purchase-rail");
  });
});

test.describe("full page screenshots", () => {
  test("home full page", async ({ page }, testInfo) => {
    await captureFullPage(page, testInfo, "/", "home-full");
  });

  test("shop full page", async ({ page }, testInfo) => {
    await captureFullPage(page, testInfo, "/shop", "shop-full");
  });
});

test("cart drawer", async ({ page }, testInfo) => {
  await page.context().clearCookies();
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  await page.goto("/", { waitUntil: "networkidle" });

  const addToCart = page.locator("#bundle-pricing [data-primary-cta]").first();
  await expect(addToCart).toBeVisible();
  await addToCart.scrollIntoViewIfNeeded();

  await Promise.all([
    page.waitForResponse((response: any) => {
      if (!response.url().includes("/api/cart")) return false;
      if (response.request().method() !== "POST") return false;
      const body = response.request().postData() || "";
      return body.includes("\"action\":\"add\"");
    }),
    addToCart.click(),
  ]);

  await page.waitForTimeout(600);

  const drawerTitle = page.getByText("Your cart", { exact: true });
  const drawerVisible = await drawerTitle
    .waitFor({ state: "visible", timeout: 3000 })
    .then(() => true)
    .catch(() => false);

  if (!drawerVisible) {
    const cartButton = page.getByRole("button", { name: /Cart/i }).first();
    await expect(cartButton).toBeVisible();
    await cartButton.click();
    await expect(drawerTitle).toBeVisible();
  }

  const drawerPanel = drawerTitle.locator("..").locator("..");
  await expect(drawerPanel).toBeVisible();
  await page.waitForTimeout(300);

  await drawerPanel.screenshot({ path: screenshotPath(testInfo, "cart-drawer") });
});
