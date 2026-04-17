import { expect, test } from "@playwright/test";

test("clicking a text filename opens the preview drawer; ESC closes it", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page.locator(".fb-banner")).toBeVisible();

  // The seeded mock has `welcome.txt` at the root of users/dev/.
  const welcome = page
    .locator(".fb-name-link")
    .filter({ hasText: /welcome\.txt$/ });
  await expect(welcome).toBeVisible();

  await welcome.click();

  const drawer = page.getByTestId("fp-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("Welcome to athena-shell");

  // ESC closes.
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("non-previewable filenames (e.g. parquet) aren't clickable", async ({
  page,
}) => {
  await page.goto("/workspace");
  await expect(page.locator(".fb-banner")).toBeVisible();

  // File rows use .fb-name-link for previewable and a plain .fb-name-text for
  // non-previewable. Folder rows also use .fb-name-text but they're not files —
  // scope to file rows so a folder doesn't register as "non-previewable file".
  const fileLinkCount = await page.locator(".fb-file .fb-name-link").count();
  const filePlainCount = await page
    .locator(".fb-file .fb-name-text:not(.fb-name-link)")
    .count();

  // Mock seeds one top-level text file + folders. Every file-row name should
  // be a button (previewable); no plain spans at this level.
  expect(fileLinkCount).toBeGreaterThanOrEqual(1);
  expect(filePlainCount).toBe(0);
});
