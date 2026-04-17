import { expect, test } from "@playwright/test";

async function freshPage(page: import("@playwright/test").Page) {
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
  await page.goto("/query");
  await expect(page.getByTestId("scratchpad-panel")).toBeVisible();
}

test("create + open scratchpad file, edit, Cmd+S saves, dirty marker clears", async ({
  page,
}) => {
  await freshPage(page);

  // Create a new scratchpad file — inline input at the top of the panel.
  const unique = `e2e-${Date.now().toString(36)}.sql`;
  await page.getByTestId("sp-new-input").fill(unique);
  await page.getByTestId("sp-new-btn").click();

  // The panel lists the new file; click it explicitly to open as a tab
  // (the auto-open after create is async and racy to assert against).
  const row = page.getByTestId(`sp-row-${unique}`);
  await expect(row).toBeVisible();
  await row.getByRole("button").first().click();
  await expect(page.locator(".tabstrip-item.is-active")).toContainText(unique, {
    timeout: 3_000,
  });

  // Editor is empty (we just created the file). Type some SQL.
  const editor = page.locator(".query-main:not(.is-hidden) .sql-editor").first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type("SELECT 'scratchpad-sentinel' AS marker", { delay: 5 });

  // Dirty marker appears on the active tab.
  const active = page.locator(".tabstrip-item.is-active");
  await expect(active.locator(".tabstrip-dirty")).toBeVisible();

  // Cmd+S saves back to S3 — dirty marker clears.
  await page.keyboard.press("ControlOrMeta+S");
  await expect(active.locator(".tabstrip-dirty")).toHaveCount(0, { timeout: 2_000 });
});

test("save-file button in the toolbar is visible for scratchpad tabs and clears dirty marker on click", async ({
  page,
}) => {
  await freshPage(page);
  const unique = `btn-${Date.now().toString(36)}.sql`;
  await page.getByTestId("sp-new-input").fill(unique);
  await page.getByTestId("sp-new-btn").click();
  const row = page.getByTestId(`sp-row-${unique}`);
  await expect(row).toBeVisible();
  await row.getByRole("button").first().click();
  await expect(page.locator(".tabstrip-item.is-active")).toContainText(unique);

  // Save-file button is now visible in the toolbar.
  const saveFileBtn = page.getByTestId("qbtn-save-file");
  await expect(saveFileBtn).toBeVisible();

  // Type, then click the button (not Cmd+S — we want a direct click path
  // so the user never has to guess a keyboard shortcut).
  const editor = page.locator(".query-main:not(.is-hidden) .sql-editor").first();
  await editor.click();
  await page.keyboard.type("SELECT 42 AS answer", { delay: 5 });
  const active = page.locator(".tabstrip-item.is-active");
  await expect(active.locator(".tabstrip-dirty")).toBeVisible();

  await saveFileBtn.click();
  await expect(active.locator(".tabstrip-dirty")).toHaveCount(0, { timeout: 2_000 });
});

test("non-scratchpad tabs don't show the save-file button", async ({ page }) => {
  await freshPage(page);
  // Default untitled tab has no source — button should not render.
  await expect(page.getByTestId("qbtn-save-file")).toHaveCount(0);
});

test("toolbar has distinct 'run statement' + 'run all' buttons with shortcut hints", async ({
  page,
}) => {
  await freshPage(page);
  const runStatement = page.getByTestId("qbtn-run-statement");
  const runAll = page.getByTestId("qbtn-run-all");
  await expect(runStatement).toBeVisible();
  await expect(runAll).toBeVisible();
  await expect(runStatement).toContainText("⌘ ↵");
  await expect(runAll).toContainText("⌘ ⇧ ↵");
});

test("rename renames the file; delete removes it", async ({ page }) => {
  await freshPage(page);
  const initial = `rm-${Date.now().toString(36)}.sql`;
  await page.getByTestId("sp-new-input").fill(initial);
  await page.getByTestId("sp-new-btn").click();
  await expect(page.getByTestId(`sp-row-${initial}`)).toBeVisible();

  // Rename via the pencil button.
  await page.getByTestId(`sp-rename-btn-${initial}`).click();
  const renamed = `renamed-${Date.now().toString(36)}.sql`;
  await page.getByTestId(`sp-rename-${initial}`).fill(renamed);
  await page.getByTestId(`sp-rename-${initial}`).press("Enter");
  await expect(page.getByTestId(`sp-row-${renamed}`)).toBeVisible();

  // Delete — accept the confirm.
  page.once("dialog", (d) => d.accept());
  await page.getByTestId(`sp-del-${renamed}`).click();
  await expect(page.getByTestId(`sp-row-${renamed}`)).toHaveCount(0);
});
