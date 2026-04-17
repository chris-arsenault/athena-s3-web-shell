import { expect, test } from "@playwright/test";

import { goToWorkspace } from "./helpers";

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

async function runDefault(page: import("@playwright/test").Page) {
  await expect(
    page.locator(".query-main:not(.is-hidden) .sql-editor")
  ).toBeVisible();
  await page.locator(".qbtn-run").click();
  await expect(page.locator(".tok-live").filter({ hasText: /succeeded/i })).toBeVisible({
    timeout: 8_000,
  });
}

test("save-to-workspace: button disabled until a query succeeds", async ({ page }) => {
  await freshPage(page, "/query");
  // Before running: no results meta yet, so no button.
  await expect(page.getByTestId("results-save-workspace")).toHaveCount(0);
  await runDefault(page);
  await expect(page.getByTestId("results-save-workspace")).toBeEnabled();
});

test("save-to-workspace: modal writes a CSV + SQL sidecar visible in workspace", async ({
  page,
}) => {
  await freshPage(page, "/query");
  await runDefault(page);

  await page.getByTestId("results-save-workspace").click();
  const modal = page.getByTestId("sr-modal");
  await expect(modal).toBeVisible();

  // Filename prefilled from the first line of SQL (sluggified).
  const filename = modal.getByTestId("sr-filename");
  await filename.fill("e2e-result.csv");

  await modal.getByTestId("sr-save").click();

  // Toast appears and modal closes.
  await expect(page.getByTestId("results-save-toast")).toBeVisible();
  await expect(modal).toBeHidden();

  // Navigate to the workspace and verify the file is there.
  await goToWorkspace(page);
  await page
    .locator(".fb-folder")
    .filter({ hasText: /results\// })
    .click();
  await expect(
    page.locator(".fb-file").filter({ hasText: "e2e-result.csv" })
  ).toBeVisible();
  await expect(
    page.locator(".fb-file").filter({ hasText: "e2e-result.sql" })
  ).toBeVisible();
});

test("save-to-workspace: overwrite prompt on duplicate name", async ({ page }) => {
  await freshPage(page, "/query");
  await runDefault(page);

  const saveBtn = page.getByTestId("results-save-workspace");
  await saveBtn.click();
  let modal = page.getByTestId("sr-modal");
  await expect(modal).toBeVisible();
  await modal.getByTestId("sr-filename").fill("dup-result.csv");
  await modal.getByTestId("sr-save").click();
  await expect(page.getByTestId("results-save-toast")).toBeVisible();

  // Save again with the same name — should prompt.
  await saveBtn.click();
  modal = page.getByTestId("sr-modal");
  await modal.getByTestId("sr-filename").fill("dup-result.csv");
  await modal.getByTestId("sr-save").click();
  await expect(page.getByTestId("sr-overwrite")).toBeVisible();

  // Confirm overwrite — modal closes and we get another toast.
  await page.getByTestId("sr-overwrite-confirm").click();
  await expect(page.getByTestId("results-save-toast")).toBeVisible();
});
