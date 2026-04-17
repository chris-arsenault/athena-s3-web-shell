import { goToQuery, goToWorkspace } from "./helpers";
import { expect, test } from "@playwright/test";

test("navigates between workspace and query via the nav links", async ({ page }) => {
  await page.goto("/workspace");

  // Workspace first.
  await expect(page.locator(".fb-banner")).toBeVisible();

  // Click Query nav → URL + QueryView surfaces swap in.
  await goToQuery(page);
  await expect(page).toHaveURL(/\/query$/);
  // The active SQL pane's run button is the only visible one (inactive
  // tabs live in the DOM but under visibility:hidden).
  await expect(page.locator(".query-main:not(.is-hidden) .qbtn-run").first()).toBeVisible();
  await expect(page.locator(".catalog")).toBeVisible();

  // And back to Workspace.
  await goToWorkspace(page);
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.locator(".fb-banner")).toBeVisible();
});
