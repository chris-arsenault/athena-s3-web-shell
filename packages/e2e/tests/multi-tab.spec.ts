import { expect, test } from "@playwright/test";

async function freshPage(page: import("@playwright/test").Page, path: string) {
  // Navigate to the app once so we have a same-origin document, then
  // nuke IndexedDB before the app has a chance to persist anything
  // from the prior test, then visit the target path.
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

test("opens a default tab, supports new/close, and close-last opens a fresh tab", async ({
  page,
}) => {
  await freshPage(page, "/query");
  const strip = page.getByTestId("tabstrip");
  await expect(strip).toBeVisible();

  // Exactly one tab on load.
  await expect(strip.locator(".tabstrip-item")).toHaveCount(1);

  // Open a second tab.
  await page.getByTestId("tab-new").click();
  await expect(strip.locator(".tabstrip-item")).toHaveCount(2);

  // Both tabs visible; second is the active one.
  const secondId = await strip
    .locator(".tabstrip-item.is-active")
    .getAttribute("data-testid");
  expect(secondId).toBeTruthy();

  // Close the active second tab — we drop back to the first.
  await strip
    .locator(".tabstrip-item.is-active")
    .getByRole("button", { name: /close/i })
    .click();
  await expect(strip.locator(".tabstrip-item")).toHaveCount(1);

  // Close the final remaining tab — a fresh one should auto-spawn.
  await strip
    .locator(".tabstrip-item.is-active")
    .getByRole("button", { name: /close/i })
    .click();
  await expect(strip.locator(".tabstrip-item")).toHaveCount(1);
});

test("rename persists the tab name across reload", async ({ page }) => {
  await freshPage(page, "/query");
  const item = page.locator(".tabstrip-item.is-active");
  await item.getByTestId(/^tab-pick-/).dblclick();
  const rename = item.locator(".tabstrip-rename");
  await expect(rename).toBeVisible();
  await rename.fill("daily-kpis");
  await rename.press("Enter");
  await expect(item).toContainText("daily-kpis");

  // Debounced save takes ~500ms to flush.
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.locator(".tabstrip-item.is-active")).toContainText("daily-kpis", {
    timeout: 5_000,
  });
});

test("edited SQL persists across reload", async ({ page }) => {
  await freshPage(page, "/query");
  // With multi-tab, multiple tabpanes exist — scope editor lookups to
  // the visible (non-hidden) one.
  const activeEditor = page
    .locator(".query-main:not(.is-hidden) .sql-editor")
    .first();
  await expect(activeEditor).toBeVisible();

  await activeEditor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.keyboard.type("SELECT 'TAB_PERSIST_SENTINEL' AS marker", { delay: 5 });

  // Give the debounced save ~1s to flush.
  await page.waitForTimeout(1200);

  await page.reload();
  const reloadedEditor = page
    .locator(".query-main:not(.is-hidden) .sql-editor")
    .first();
  await expect(reloadedEditor).toBeVisible();
  await expect(reloadedEditor.locator(".view-lines")).toContainText(
    "TAB_PERSIST_SENTINEL",
    { timeout: 5_000 }
  );
});
