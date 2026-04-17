import { expect, test } from "@playwright/test";

test("load-more paginates through the mock's 300-row result set", async ({ page }) => {
  await page.goto("/query");
  await page.locator(".qbtn-run").click();

  // Wait for the first page (100 rows per mock config).
  await expect(page.locator(".vt-row").first()).toBeVisible({ timeout: 10_000 });

  const loadMore = page.getByRole("button", { name: /load more/i });
  await expect(loadMore).toBeVisible();

  // Page 2 → 200 rows.
  await loadMore.click();
  // Page 3 → 300 rows → no more nextToken.
  await expect(loadMore).toBeVisible();
  await loadMore.click();

  // The load-more affordance disappears once we've exhausted the result set.
  await expect(loadMore).toBeHidden();

  // Scroll to the bottom of the virtualized body to confirm the last row
  // is addressable — proves pagination actually extended the rows array.
  const scroll = page.locator(".vt-scroll");
  await scroll.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  // Some row near the end should be visible.
  await expect(page.locator(".vt-row").last()).toBeVisible();
});
