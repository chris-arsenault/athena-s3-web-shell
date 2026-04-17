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

test("user's workspace_<username> DB is auto-expanded in the catalog on mount", async ({
  page,
}) => {
  await registerTableFromSalesCsv(page);
  await page.getByTestId("nav-link-query").click();

  // The tree-tbl-* testid only appears when the parent db is expanded.
  // If auto-expand works, the newly-created sales_2025 table should be
  // addressable right away — no extra click on tree-db-workspace_dev_user.
  await expect(
    page.getByTestId("tree-tbl-workspace_dev_user-sales_2025")
  ).toBeVisible({ timeout: 10_000 });
});

test("double-click on a table runs SELECT * FROM table LIMIT 10 into the active tab", async ({
  page,
}) => {
  await registerTableFromSalesCsv(page);
  await page.getByTestId("nav-link-query").click();

  const tableRow = page.getByTestId("tree-tbl-workspace_dev_user-sales_2025");
  await expect(tableRow).toBeVisible({ timeout: 10_000 });

  // Double-click the row — should run the peek SELECT without touching
  // the editor.
  await tableRow.dblclick();

  // A queue row appears for the peek; we show the "run queue" panel
  // once there's any in-flight / completed item. Actually the panel
  // hides for single-statement runs, so assert the status-chip shows
  // a completed state instead.
  await expect(
    page.locator(".tok-live").filter({ hasText: /succeeded/i })
  ).toBeVisible({ timeout: 8_000 });

  // Results table rendered at least one row.
  await expect(page.locator(".vt-row").first()).toBeVisible();
});

test("a small ▶ peek button on each table row runs the same SELECT * LIMIT 10", async ({
  page,
}) => {
  await registerTableFromSalesCsv(page);
  await page.getByTestId("nav-link-query").click();

  // Button-click fires the same peek — tests the explicit affordance
  // (for users who don't discover the double-click).
  await expect(
    page.getByTestId("tree-tbl-workspace_dev_user-sales_2025")
  ).toBeVisible({ timeout: 10_000 });
  const peekBtn = page.getByTestId(
    "tree-peek-workspace_dev_user-sales_2025"
  );
  // The button is hidden until hover, so use force click.
  await peekBtn.click({ force: true });
  await expect(
    page.locator(".tok-live").filter({ hasText: /succeeded/i })
  ).toBeVisible({ timeout: 8_000 });
});

test("CreateTable copies the source file into a per-table subdir under <prefix>/datasets/", async ({
  page,
}) => {
  await registerTableFromSalesCsv(page);

  // Verify the copied CSV exists at <prefix>/datasets/<table>/.
  // Navigate from the workspace root; don't page.goto (would reset
  // the mock S3 state that holds the copy).
  await page.getByTestId("nav-link-workspace").click();
  await page.locator(".crumb-root").click();
  await page
    .locator(".fb-folder")
    .filter({ hasText: /datasets\// })
    .click();
  await expect(
    page.locator(".fb-folder").filter({ hasText: /sales_2025\// })
  ).toBeVisible();
  await page
    .locator(".fb-folder")
    .filter({ hasText: /sales_2025\// })
    .click();
  await expect(
    page.locator(".fb-row.fb-file").filter({ hasText: "sales-2025.csv" })
  ).toBeVisible();
});
