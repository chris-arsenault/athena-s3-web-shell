import { expect, test } from "@playwright/test";

test("load-more pulls the full result set via S3-direct fetch in one click", async ({
  page,
}) => {
  await page.goto("/query");
  await page.locator(".qbtn-run").click();

  // Wait for the first page (100 rows per mock GetQueryResults config).
  await expect(page.locator(".vt-row").first()).toBeVisible({ timeout: 10_000 });

  const loadMore = page.getByRole("button", { name: /load more/i });
  await expect(loadMore).toBeVisible();

  // Single click: bypass GetQueryResults pagination, pull all 300 rows
  // direct from S3 in one shot.
  await loadMore.click();
  await expect(loadMore).toBeHidden({ timeout: 5_000 });

  // Scroll to the bottom of the virtualized body to confirm the last
  // row is addressable — proves the direct fetch actually delivered
  // the full result set, not just the first page.
  const scroll = page.locator(".vt-scroll");
  await scroll.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(page.locator(".vt-row").last()).toBeVisible();

  // The ROWS stat animates up to 300 after the direct fetch.
  const rowStat = page.locator(".stat").filter({ hasText: /ROWS/i });
  await expect(rowStat.locator(".stat-value")).toContainText("300", {
    timeout: 2_000,
  });
});
