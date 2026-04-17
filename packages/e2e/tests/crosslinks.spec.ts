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

test("workspace → query: file backing a known table shows ⌕ query link", async ({
  page,
}) => {
  // After registerTableFromSalesCsv we're still on /workspace/sample-data/
  // — the file row should now show the ⌕ link because the sales_2025
  // table's LOCATION covers this file. Don't do a full-page reload here:
  // the mock's in-memory table registration wouldn't survive it.
  await registerTableFromSalesCsv(page);

  const queryLink = page.getByTestId(
    "fb-link-query-users/dev/sample-data/sales-2025.csv"
  );
  await expect(queryLink).toBeVisible({ timeout: 5_000 });

  await queryLink.click();
  await expect(page).toHaveURL(/\/query/);

  // The active tab's editor got prefilled with SELECT * FROM ... LIMIT 100.
  await expect(
    page.locator(".query-main:not(.is-hidden) .view-lines")
  ).toContainText("workspace_dev_user.sales_2025", { timeout: 5_000 });
});
