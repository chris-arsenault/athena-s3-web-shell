import { expect, test } from "@playwright/test";

test("schema tree lists databases, expands tables, drills into columns", async ({ page }) => {
  await page.goto("/query");
  await expect(page.locator(".catalog")).toBeVisible();

  // Mock seeds "default" and "sales".
  const defaultDb = page.getByTestId("tree-db-default");
  await expect(defaultDb).toBeVisible();
  await expect(page.getByTestId("tree-db-sales")).toBeVisible();

  // Expand the default DB.
  await defaultDb.click();
  await expect(page.getByTestId("tree-tbl-default-events")).toBeVisible();
  await expect(page.getByTestId("tree-tbl-default-users")).toBeVisible();

  // Expand the events table — columns render under a `.tree-col` list.
  await page.getByTestId("tree-tbl-default-events").click();
  await expect(page.locator(".tree-col").first()).toBeVisible();
  const columnCount = await page.locator(".tree-col").count();
  expect(columnCount).toBeGreaterThanOrEqual(4);
});
