import { expect, test } from "@playwright/test";

test("boots on / and redirects into the workspace with the console chrome", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/workspace$/);

  // AppShell chrome: brand wordmark, module nav, status bar.
  await expect(page.locator(".brand-word")).toBeVisible();
  await expect(page.getByTestId("nav-link-workspace")).toBeVisible();
  await expect(page.getByTestId("nav-link-query")).toBeVisible();
  await expect(page.locator(".statusbar")).toBeVisible();

  // Status bar mentions the mock identity bucket.
  await expect(page.locator(".statusbar")).toContainText("BKT");
  await expect(page.locator(".statusbar")).toContainText("athena-shell-dev");
});
