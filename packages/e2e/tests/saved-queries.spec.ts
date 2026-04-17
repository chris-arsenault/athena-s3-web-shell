import { expect, test } from "@playwright/test";

test("save-query flow: library empty → save → appears → delete", async ({
  page,
}) => {
  await page.goto("/query");

  const panel = page.getByTestId("saved-queries-panel");
  await expect(panel).toBeVisible();

  // Library starts empty (unique per test-run name avoids leaked state
  // from a reused dev server).
  const uniq = `daily_${Date.now().toString(36)}`;

  // Wait for the editor so the Save button's `canSave` guard becomes true.
  await expect(page.locator(".sql-editor")).toBeVisible();

  await page.getByTestId("qbtn-save").click();

  const modal = page.getByTestId("sq-modal");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("save query");
  await expect(modal).toContainText(/names are immutable/i);

  await modal.getByTestId("sq-name-input").fill(uniq);

  await modal.getByTestId("sq-save-btn").click();
  await expect(modal).toBeHidden({ timeout: 5_000 });

  // Entry appears in the library.
  const row = page.getByTestId(`sq-row-${uniq}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(uniq);

  // Accept the confirm() dialog the panel raises on delete.
  page.once("dialog", (d) => d.accept());
  await page.getByTestId(`sq-del-${uniq}`).click();
  await expect(row).toBeHidden();
});

test("save button is disabled when the editor is empty", async ({ page }) => {
  await page.goto("/query");
  await expect(page.locator(".sql-editor")).toBeVisible();

  // Clear the Monaco editor: focus + select-all + delete.
  await page.locator(".sql-editor").click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");

  await expect(page.getByTestId("qbtn-save")).toBeDisabled();
});
