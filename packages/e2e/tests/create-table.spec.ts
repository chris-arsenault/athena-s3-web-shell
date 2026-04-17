import { expect, test } from "@playwright/test";

test("register-table flow: inferred schema → create → appears in /query schema tree", async ({
  page,
}) => {
  await page.goto("/workspace");
  await expect(page.locator(".fb-banner")).toBeVisible();

  // Enter the seeded sample-data/ folder.
  await page
    .getByRole("button", { name: /sample-data\/ open/i })
    .click()
    .catch(async () => {
      // Fallback: the button includes "open →" hint text.
      await page
        .locator(".fb-folder")
        .filter({ hasText: /sample-data\// })
        .click();
    });
  await expect(page.locator(".fb-file").first()).toBeVisible();

  // Click the ⊞ table affordance for sales-2025.csv.
  const csvRow = page
    .locator(".fb-row.fb-file")
    .filter({ hasText: "sales-2025.csv" });
  await csvRow.getByRole("button", { name: /table/i }).click();

  // Modal appears with inferred columns.
  const modal = page.getByTestId("ct-modal");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("register table");
  await expect(modal).toContainText("sales-2025.csv");

  // Schema section lists at least the header columns.
  await expect(modal.locator(".ct-col-row").first()).toBeVisible();
  const columnCount = await modal.locator(".ct-col-row").count();
  expect(columnCount).toBeGreaterThanOrEqual(3);

  // Click Create.
  await modal.getByRole("button", { name: /create table/i }).click();

  // Modal closes on success.
  await expect(modal).toBeHidden({ timeout: 15_000 });

  // Navigate to /query and confirm workspace_dev_user is in the tree.
  await page.getByTestId("nav-link-query").click();
  await expect(page).toHaveURL(/\/query$/);

  const userDb = page.getByTestId("tree-db-workspace_dev_user");
  await expect(userDb).toBeVisible({ timeout: 10_000 });
  await userDb.click();

  // The created table (name sluggified from "sales-2025.csv" → "sales_2025")
  // should be listed under it.
  await expect(
    page.getByTestId("tree-tbl-workspace_dev_user-sales_2025")
  ).toBeVisible();
});
