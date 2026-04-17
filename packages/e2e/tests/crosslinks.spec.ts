import { expect, test } from "@playwright/test";

async function freshPage(page: import("@playwright/test").Page, path: string) {
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
  await page.goto(path);
}

async function registerTableFromSalesCsv(page: import("@playwright/test").Page) {
  await freshPage(page, "/workspace");
  await page
    .locator(".fb-folder")
    .filter({ hasText: /sample-data\// })
    .click();
  const csvRow = page
    .locator(".fb-row.fb-file")
    .filter({ hasText: "sales-2025.csv" });
  await csvRow.getByRole("button", { name: /table/i }).click();
  const modal = page.getByTestId("ct-modal");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: /create table/i }).click();
  await expect(modal).toBeHidden({ timeout: 15_000 });
}

test("schema → workspace: table with LOCATION inside user prefix shows ⇡ link", async ({
  page,
}) => {
  await registerTableFromSalesCsv(page);

  await page.getByTestId("nav-link-query").click();
  await expect(page).toHaveURL(/\/query$/);

  // Expand workspace_dev_user and find the newly-created sales_2025 table.
  const userDb = page.getByTestId("tree-db-workspace_dev_user");
  await expect(userDb).toBeVisible({ timeout: 10_000 });
  await userDb.click();

  // The crosslink appears on the table row.
  const link = page.getByTestId(
    "tree-link-workspace-workspace_dev_user-sales_2025"
  );
  await expect(link).toBeAttached();

  await link.click();
  // Lands on /workspace with the backing prefix.
  await expect(page).toHaveURL(/\/workspace.*sample-data/);
});

test("workspace → query: ⌕ opens a NEW tab so an in-flight draft isn't clobbered", async ({
  page,
}) => {
  await registerTableFromSalesCsv(page);

  // Hop to /query and seed the active tab with an in-flight marker.
  await page.getByTestId("nav-link-query").click();
  const activeEditor = () =>
    page.locator(".query-main:not(.is-hidden) .sql-editor").first();
  const activeLines = () =>
    page.locator(".query-main:not(.is-hidden) .view-lines").first();
  await activeEditor().click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.keyboard.type("SELECT 'WIP_DRAFT' AS x", { delay: 5 });
  await expect(activeLines()).toContainText("WIP_DRAFT");
  // Flush the 500ms debounced tab save before navigating away so the
  // WIP_DRAFT content survives the QueryView unmount/remount cycle.
  await page.waitForTimeout(800);
  const tabCountBefore = await page.locator(".tabstrip-item").count();

  // Back to workspace, click ⌕ on the CSV.
  await page.getByTestId("nav-link-workspace").click();
  const queryLink = page.getByTestId(
    "fb-link-query-users/dev/sample-data/sales-2025.csv"
  );
  await expect(queryLink).toBeVisible({ timeout: 5_000 });
  await queryLink.click();
  await expect(page).toHaveURL(/\/query/);

  // A NEW tab was opened (count +1), carrying the prefilled SELECT.
  await expect(page.locator(".tabstrip-item")).toHaveCount(tabCountBefore + 1, {
    timeout: 5_000,
  });
  await expect(activeLines()).toContainText("workspace_dev_user.sales_2025", {
    timeout: 5_000,
  });

  // The prior tab's in-flight draft must still be there — swap back.
  const tabs = page.locator(".tabstrip-item");
  await tabs.nth(0).getByTestId(/^tab-pick-/).click();
  await expect(activeLines()).toContainText("WIP_DRAFT");
  await expect(activeLines()).not.toContainText("workspace_dev_user.sales_2025");
});
