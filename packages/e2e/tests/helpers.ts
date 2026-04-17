import type { Page } from "@playwright/test";

/**
 * Focus a SQL tab (or spawn one if none exist). Replaces the former
 * `nav-link-query` rail button — the rail is gone; SQL tabs live in
 * the tab strip.
 */
export async function goToQuery(page: Page): Promise<void> {
  const sqlTab = page.locator('[data-tab-kind="sql"] .tabstrip-pick').first();
  if ((await sqlTab.count()) > 0) {
    await sqlTab.click();
  } else {
    await page.getByTestId("tab-new").click();
  }
}

/**
 * Focus an existing browser tab if there is one; otherwise open a new
 * browser tab at the workspace root via the sidebar ▶ affordance.
 * Replaces the former `nav-link-workspace` rail button.
 */
export async function goToWorkspace(page: Page): Promise<void> {
  const existingBrowser = page.locator('[data-tab-kind="browser"] .tabstrip-pick').first();
  if ((await existingBrowser.count()) > 0) {
    await existingBrowser.click();
    return;
  }
  await page.getByTestId("nav-link-workspace").click();
}
