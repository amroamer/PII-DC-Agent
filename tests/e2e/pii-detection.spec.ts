import { test, expect } from "@playwright/test";
import * as fs from "node:fs";

// 10 big, PII-relevant tables (~1,013 columns total, under the 5,000/run cap).
const TABLES = [
  "USERS",
  "ACL_CAR_REG",
  "SUBMIT_BORDER_CROSS_PERMITS",
  "MF_IMPORTERS",
  "PPM_CRBA8_ADCAFINANCIAL",
  "ACL_MF_IMPORTERS",
  "CUST_BILL_HDRS",
  "MF_AGENTS",
  "MF_AGENT_EMPS",
  "DELEGATIONS",
];

test("run PII detection on 10 big tables via the UI", async ({ page }) => {
  // 1) Log in through the real login form.
  await page.goto("/pdtc/");
  await page.fill("#username", "admin");
  await page.fill("#password", "admin123");
  await page.locator('button[type="submit"]').click();
  await expect(page.locator("#password")).toHaveCount(0); // login form gone -> authed

  // 2) Go to the PII Detection page.
  await page.goto("/pdtc/detection");
  const openWizard = page.getByRole("button", { name: "Run detection" });
  await expect(openWizard).toBeVisible();

  // 3) Open the run wizard.
  await openWizard.click();

  // 4) Scope -> "Filter / pick tables".
  await page.getByRole("button", { name: /Filter \/ pick tables/i }).click();

  // 5) Open the Asset (tables) multi-select and pick each table via search.
  await page.getByRole("button", { name: /^Asset/ }).click();
  const search = page.getByPlaceholder("Search…");
  for (const t of TABLES) {
    await search.fill(t);
    await page.getByRole("button", { name: new RegExp("^" + t + "\\b") }).first().click();
  }
  await page.keyboard.press("Escape");

  // 6) Run is enabled only once the live scope count resolves (> 0, under the cap).
  const runBtn = page.getByRole("button", { name: "Run", exact: true });
  await expect(runBtn).toBeEnabled();
  fs.mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/01-scope.png", fullPage: true });

  // 7) Start the run; capture the run id from the POST response.
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/engine-runs") && r.request().method() === "POST"),
    runBtn.click(),
  ]);
  const run = await resp.json();
  console.log("RUN_ID=" + run.id);
  expect(run.id).toBeTruthy();

  // 8) Confirm the wizard advanced to the running step.
  await expect(page.getByText(/Cancel run|إلغاء التشغيل/)).toBeVisible();
  await page.screenshot({ path: "test-results/02-running.png", fullPage: true });
});
