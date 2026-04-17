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

test("typing in two tabs and switching between them preserves each tab's SQL", async ({
  page,
}) => {
  await freshPage(page, "/query");

  // Seed tab A with a distinctive sentinel.
  const activeEditor = () =>
    page.locator(".query-main:not(.is-hidden) .sql-editor").first();
  const activeLines = () =>
    page.locator(".query-main:not(.is-hidden) .view-lines").first();

  await expect(activeEditor()).toBeVisible();
  await activeEditor().click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.keyboard.type("SELECT 'AAA_MARKER' AS a", { delay: 5 });
  await expect(activeLines()).toContainText("AAA_MARKER");

  // Open a second tab and write a different sentinel into it.
  await page.getByTestId("tab-new").click();
  await expect(page.locator(".tabstrip-item")).toHaveCount(2);
  await expect(activeEditor()).toBeVisible({ timeout: 10_000 });
  await activeEditor().click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.keyboard.type("SELECT 'BBB_MARKER' AS b", { delay: 5 });
  await expect(activeLines()).toContainText("BBB_MARKER");

  // Switch back to tab A — its AAA_MARKER must still be there, BBB
  // must NOT have bled into A.
  const tabs = page.locator(".tabstrip-item");
  await tabs.first().getByTestId(/^tab-pick-/).click();
  await expect(activeLines()).toContainText("AAA_MARKER");
  await expect(activeLines()).not.toContainText("BBB_MARKER");

  // Switch to tab B — the reverse assertion.
  await tabs.nth(1).getByTestId(/^tab-pick-/).click();
  await expect(activeLines()).toContainText("BBB_MARKER");
  await expect(activeLines()).not.toContainText("AAA_MARKER");

  // One more round trip to verify the preservation is stable across
  // repeated swaps — guards against the stale-signal / re-fire bug
  // where a second visit to a tab would clobber its content.
  await tabs.first().getByTestId(/^tab-pick-/).click();
  await expect(activeLines()).toContainText("AAA_MARKER");
  await tabs.nth(1).getByTestId(/^tab-pick-/).click();
  await expect(activeLines()).toContainText("BBB_MARKER");
});

test("picking a saved query hits the active tab and does NOT re-fire on tab switch", async ({
  page,
}) => {
  await freshPage(page, "/query");

  const activeEditor = () =>
    page.locator(".query-main:not(.is-hidden) .sql-editor").first();
  const activeLines = () =>
    page.locator(".query-main:not(.is-hidden) .view-lines").first();
  const tabs = page.locator(".tabstrip-item");

  // Tab A: type a marker, save it as a named query, then EDIT the
  // buffer to a different marker. This is the crucial part: tab A's
  // current content (`A_EDITED`) is distinct from the saved query's
  // content (`SAVED_Q`). If the stale-signal bug recurs, switching
  // back to A after picking the saved query on B would clobber
  // `A_EDITED` with `SAVED_Q`.
  await activeEditor().click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.keyboard.type("SELECT 'SAVED_Q' AS x", { delay: 5 });
  await page.getByTestId("qbtn-save").click();
  const unique = `sq_${Date.now().toString(36)}`;
  await page.getByTestId("sq-name-input").fill(unique);
  await page.getByTestId("sq-save-btn").click();
  await expect(page.getByTestId(`sq-row-${unique}`)).toBeVisible();

  // Distinguish A's current content from the saved query.
  await activeEditor().click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.keyboard.type("SELECT 'A_EDITED' AS x", { delay: 5 });

  // Open tab B.
  await page.getByTestId("tab-new").click();
  await expect(activeLines()).not.toContainText("A_EDITED");
  await expect(activeLines()).not.toContainText("SAVED_Q");

  // Pick the saved query — active (B) should take SAVED_Q.
  await page.getByTestId(`sq-row-${unique}`).getByRole("button").first().click();
  await expect(activeLines()).toContainText("SAVED_Q", { timeout: 3_000 });

  // Switch BACK to tab A. If the signal didn't leak, A still has
  // A_EDITED. If it did leak (old bug), A would now show SAVED_Q.
  await tabs.first().getByTestId(/^tab-pick-/).click();
  await expect(activeLines()).toContainText("A_EDITED");
  await expect(activeLines()).not.toContainText("SAVED_Q");
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
