import { expect, test } from "@playwright/test";

test("runs the default SELECT and renders result rows", async ({ page }) => {
  await page.goto("/query");

  // Editor renders the default stub query after Monaco lazy-loads.
  await expect(page.locator(".sql-editor")).toBeVisible();

  // Click RUN.
  await page.locator(".qbtn-run").click();

  // Status transitions to SUCCEEDED (mock simulates QUEUED→RUNNING→SUCCEEDED
  // over ~1.2s). Results meta bar shows the row count stat.
  await expect(page.locator(".tok-live").filter({ hasText: /succeeded/i })).toBeVisible({
    timeout: 8_000,
  });

  // At least one virtualized result row rendered.
  await expect(page.locator(".vt-row").first()).toBeVisible();

  // Row-count stat shows something > 0 after the count-up animation settles.
  const rowStat = page.locator(".stat").filter({ hasText: /ROWS/i });
  await expect(rowStat).toBeVisible();
});
