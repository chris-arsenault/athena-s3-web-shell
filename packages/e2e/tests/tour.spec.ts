import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * Screenshot tour — walks each major surface of the app under
 * MOCK_AUTH=1 and captures a PNG into docs/screenshots/ for the
 * user guide. Opt-in so it doesn't fire on every `make e2e` run:
 *
 *   SCREENSHOT_TOUR=1 pnpm --filter @athena-shell/e2e run e2e tour
 *
 * Relies on the seeded mock data in packages/web/src/data/mockS3Store.ts
 * and mockAthena.ts. Larger viewport so screenshots fit the full IDE
 * shell without cramping.
 */

const SCREENSHOT_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "docs",
  "screenshots"
);

test.skip(
  !process.env.SCREENSHOT_TOUR,
  "tour captures screenshots on demand — set SCREENSHOT_TOUR=1"
);

test.use({ viewport: { width: 1440, height: 900 } });

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, name),
    fullPage: false,
  });
}

async function resetClientState(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase("athena-shell");
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      })
  );
  await page.evaluate(() => window.localStorage.clear());
}

test("screenshot tour", async ({ page }) => {
  test.setTimeout(120_000);
  await resetClientState(page);

  await test.step("01 workspace root", async () => {
    await page.goto("/workspace");
    await expect(page.locator(".fb-banner")).toBeVisible();
    await expect(page.locator(".fb-row").first()).toBeVisible();
    await shot(page, "01-workspace-root.png");
  });

  await test.step("02 file browser inside sample-data", async () => {
    await page
      .locator(".fb-folder")
      .filter({ hasText: /sample-data\// })
      .click();
    await expect(page.locator(".fb-file").first()).toBeVisible();
    await shot(page, "02-file-browser.png");
  });

  await test.step("03 CSV preview drawer", async () => {
    await page
      .locator(".fb-name-link")
      .filter({ hasText: "region-sales.csv" })
      .click();
    await expect(page.getByTestId("fp-drawer")).toBeVisible();
    await expect(page.getByTestId("fp-body-csv")).toBeVisible();
    await shot(page, "03-file-preview-csv.png");
    // Close drawer before moving on.
    await page.keyboard.press("Escape");
  });

  await test.step("04 CreateTable modal", async () => {
    const csvRow = page
      .locator(".fb-row.fb-file")
      .filter({ hasText: "region-sales.csv" });
    await csvRow.getByRole("button", { name: /table/i }).click();
    const modal = page.getByTestId("ct-modal");
    await expect(modal).toBeVisible();
    await expect(modal.locator(".ct-col-row").first()).toBeVisible();
    await shot(page, "04-create-table.png");
    // Dismiss without creating — leaves the catalog untouched for
    // subsequent steps.
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden({ timeout: 5_000 });
  });

  await test.step("05 SQL editor with catalog", async () => {
    await page.goto("/query");
    await expect(page.locator(".sql-editor")).toBeVisible();
    await page.getByTestId("tree-db-sales").click();
    await expect(page.getByTestId("tree-tbl-sales-orders")).toBeVisible();
    await page.getByTestId("tree-tbl-sales-orders").click();
    await expect(page.locator(".tree-col").first()).toBeVisible();
    // Type a representative query into Monaco.
    await page.locator(".sql-editor").click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Delete");
    await page.keyboard.type(
      "SELECT region, quarter, revenue_usd\nFROM sales.orders\nORDER BY revenue_usd DESC\nLIMIT 50;",
      { delay: 4 }
    );
    await shot(page, "05-sql-editor.png");
  });

  await test.step("06 query results", async () => {
    await page.locator(".qbtn-run").click();
    await expect(
      page.locator(".tok-live").filter({ hasText: /succeeded/i })
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".vt-row").first()).toBeVisible();
    await shot(page, "06-query-results.png");
  });

  await test.step("07 history panel", async () => {
    // Run one more distinct query so history has multiple entries.
    await page.locator(".sql-editor").click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Delete");
    await page.keyboard.type("SELECT COUNT(*) FROM default.events;", { delay: 4 });
    await page.locator(".qbtn-run").click();
    await expect(
      page.locator(".tok-live").filter({ hasText: /succeeded/i })
    ).toBeVisible({ timeout: 10_000 });

    // The journal panel on the right renders history; a second query
    // run guarantees at least two rows are visible.
    await shot(page, "07-history.png");
  });

  await test.step("08 saved queries", async () => {
    // Save the current query to the library.
    await page.getByTestId("qbtn-save").click();
    const modal = page.getByTestId("sq-modal");
    await expect(modal).toBeVisible();
    const name = `top_customers_${Date.now().toString(36)}`;
    await modal.getByTestId("sq-name-input").fill(name);
    await shot(page, "08a-save-query-modal.png");
    await modal.getByTestId("sq-save-btn").click();
    await expect(modal).toBeHidden({ timeout: 5_000 });

    const row = page.getByTestId(`sq-row-${name}`);
    await expect(row).toBeVisible();
    await shot(page, "08-saved-queries.png");
  });

  await test.step("09 scratchpad panel + file tab", async () => {
    // Scratchpad panel sits in the side rail; the seeded files should
    // appear on mount (users/dev/queries/*.sql).
    const panel = page.getByTestId("scratchpad-panel");
    await expect(panel).toBeVisible();
    await shot(page, "09a-scratchpad-panel.png");

    // Open one of the seeded scratchpad files as a tab so the guide
    // shows the editing surface, not just the list.
    const row = page.getByTestId("sp-row-daily-rollup.sql");
    if ((await row.count()) > 0) {
      await row.getByRole("button").first().click();
      await expect(page.locator(".tabstrip-item.is-active")).toContainText(
        "daily-rollup.sql",
        { timeout: 3_000 }
      );
      await shot(page, "09-scratchpad-tab.png");
    }
  });

  await test.step("10 multi-tab view", async () => {
    // Open a browser tab alongside the query tabs to show the mixed
    // tab strip.
    await page.goto("/workspace");
    // Inactive browser tabs live in the DOM under visibility:hidden,
    // so scope the assertion to the active pane.
    await expect(
      page.locator(".query-main:not(.is-hidden) .fb-banner").first()
    ).toBeVisible();
    await shot(page, "10-multi-tab.png");
  });
});
