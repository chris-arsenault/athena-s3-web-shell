import { expect, test } from "@playwright/test";

test("navigates between workspace and query via the nav links", async ({ page }) => {
  await page.goto("/workspace");

  // Workspace first.
  await expect(page.locator(".fb-banner")).toBeVisible();

  // Click Query nav → URL + QueryView surfaces swap in.
  await page.getByTestId("nav-link-query").click();
  await expect(page).toHaveURL(/\/query$/);
  await expect(page.locator(".qbtn-run")).toBeVisible();
  await expect(page.locator(".catalog")).toBeVisible();

  // And back to Workspace.
  await page.getByTestId("nav-link-workspace").click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.locator(".fb-banner")).toBeVisible();
});
