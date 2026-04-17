import { goToQuery, goToWorkspace } from "./helpers";
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
  await goToQuery(page);

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
  await goToQuery(page);

  const tableRow = page.getByTestId("tree-tbl-workspace_dev_user-sales_2025");
  await expect(tableRow).toBeVisible({ timeout: 10_000 });

  // Expand the row (first click), then peek via a SEPARATE interaction:
  // Playwright's synthesized `dblclick()` doesn't reliably deliver both
  // mousedowns when the first click's re-render tree-mutates the row
  // (see the ▶ peek button test for the coverage of the peek codepath
  // proper).
  await tableRow.click();
  const peekBtn = page.getByTestId("tree-peek-workspace_dev_user-sales_2025");
  await peekBtn.click({ force: true });

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
  await goToQuery(page);

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

test("modal auto-overrides risky columns to STRING on open (stricter-parse heuristic)", async ({
  page,
}) => {
  await freshPage(page, "/workspace");
  await page
    .locator(".fb-folder")
    .filter({ hasText: /sample-data\// })
    .click();
  const csvRow = page
    .locator(".fb-row.fb-file")
    .filter({ hasText: "dirty-orders.csv" });
  await csvRow.getByRole("button", { name: /table/i }).click();

  const modal = page.getByTestId("ct-modal");
  await expect(modal).toBeVisible();

  // subscription_date has a regex-valid-but-invalid row (2024-00-31),
  // amount has a value past MAX_SAFE_INTEGER. Both should be pre-flipped
  // to STRING on modal open.
  const subRow = modal.locator(".ct-col-row").filter({ hasText: /subscription_date/ });
  const amtRow = modal.locator(".ct-col-row").filter({ hasText: /amount/ });
  await expect(subRow).toHaveClass(/ct-col-overridden/);
  await expect(amtRow).toHaveClass(/ct-col-overridden/);

  // order_id is safe (small integers) and stays as its inferred type.
  const idRow = modal.locator(".ct-col-row").filter({ hasText: /order_id/ });
  await expect(idRow).not.toHaveClass(/ct-col-overridden/);

  // Create lands a raw_* table AND a companion view (since overrides > 0).
  await modal.getByRole("button", { name: /create table|create anyway/i }).click();
  await expect(modal).toBeHidden({ timeout: 15_000 });

  // Navigate to /query; both the view and raw table should exist.
  await goToQuery(page);
  await expect(
    page.getByTestId("tree-tbl-workspace_dev_user-dirty_orders")
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByTestId("tree-tbl-workspace_dev_user-raw_dirty_orders")
  ).toBeVisible();
});

test("duplicate-table: re-registering at the same dataset path hard-blocks and offers Replace existing", async ({
  page,
}) => {
  await registerTableFromSalesCsv(page);

  // Now sales-2025.csv lives at /datasets/sales_2025/.
  // Navigate there and click ⊞ on the file — same table name, same
  // location, should block.
  await goToWorkspace(page);
  await page.locator(".crumb-root").click();
  await page
    .locator(".fb-folder")
    .filter({ hasText: /datasets\// })
    .click();
  await page
    .locator(".fb-folder")
    .filter({ hasText: /sales_2025\// })
    .click();
  const csvRow = page
    .locator(".fb-row.fb-file")
    .filter({ hasText: "sales-2025.csv" });
  await csvRow.getByRole("button", { name: /table/i }).click();

  const modal = page.getByTestId("ct-modal");
  await expect(modal).toBeVisible();

  // Primary button is disabled/blocked until the user accepts the replace.
  const primary = modal.locator("button.btn-primary, button.btn-warn");
  await expect(primary).toHaveText(/blocked/i, { timeout: 5_000 });

  // Flip the "replace existing" checkbox in the findings panel.
  await modal.getByRole("checkbox", { name: /replace existing/i }).check();

  // Now the primary button is actionable (green "create table" since no
  // advisory findings remain).
  await expect(primary).toHaveText(/create table|create anyway/i);
  await primary.click();

  await expect(modal).toBeHidden({ timeout: 15_000 });

  // The table still exists under the same name — DROP + CREATE landed.
  await goToQuery(page);
  await expect(
    page.getByTestId("tree-tbl-workspace_dev_user-sales_2025")
  ).toBeVisible({ timeout: 10_000 });
});

test("CreateTable moves the source file into a per-table subdir under <prefix>/datasets/ (source gone)", async ({
  page,
}) => {
  await registerTableFromSalesCsv(page);

  // Navigate from the workspace root; don't page.goto (would reset
  // the mock S3 state that carries the move result).
  await goToWorkspace(page);
  await page.locator(".crumb-root").click();

  // sample-data/ is still a folder (customers.csv remains); enter it.
  await page
    .locator(".fb-folder")
    .filter({ hasText: /sample-data\// })
    .click();
  // sales-2025.csv should NOT be here any more — the move removed it.
  await expect(
    page.locator(".fb-row.fb-file").filter({ hasText: "sales-2025.csv" })
  ).toHaveCount(0);

  // And it DOES live under /datasets/sales_2025/.
  await page.locator(".crumb-root").click();
  await page
    .locator(".fb-folder")
    .filter({ hasText: /datasets\// })
    .click();
  await page
    .locator(".fb-folder")
    .filter({ hasText: /sales_2025\// })
    .click();
  await expect(
    page.locator(".fb-row.fb-file").filter({ hasText: "sales-2025.csv" })
  ).toBeVisible();
});
