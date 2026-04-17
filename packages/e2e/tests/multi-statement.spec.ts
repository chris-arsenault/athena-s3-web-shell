import { expect, test } from "@playwright/test";

const MULTI_SQL = "SELECT 1 AS a;\nSELECT 2 AS b;\nSELECT 3 AS c";

async function typeMultiStatement(page: import("@playwright/test").Page) {
  await page.goto("/query");
  await expect(page.locator(".sql-editor")).toBeVisible();
  await page.locator(".sql-editor").click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.keyboard.type(MULTI_SQL, { delay: 5 });
}

test("Cmd+Shift+Enter runs all statements; queue panel shows each row transitioning to succeeded", async ({
  page,
}) => {
  await typeMultiStatement(page);

  // Cmd+Shift+Enter = run all
  await page.keyboard.press("ControlOrMeta+Shift+Enter");

  const queue = page.getByTestId("run-queue");
  await expect(queue).toBeVisible();
  await expect(queue.locator(".rq-row")).toHaveCount(3);

  // Wait for all three to reach succeeded state. Each mock execution
  // takes ~1.2s so 3 sequential runs need ~4-5s upper bound.
  for (let i = 1; i <= 3; i++) {
    await expect(page.getByTestId(`rq-row-${i}`)).toHaveClass(/state-succeeded/, {
      timeout: 15_000,
    });
  }

  // Clicking row 2 selects it + updates the results pane (smoke: at least
  // one row renders).
  await page.getByTestId("rq-row-2").click();
  await expect(page.locator(".vt-row").first()).toBeVisible();
});

test("Execute button with single statement keeps the queue panel hidden (common-case UX preserved)", async ({
  page,
}) => {
  await page.goto("/query");
  await expect(page.locator(".sql-editor")).toBeVisible();

  // Default SQL is one statement. Click run.
  await page.locator(".qbtn-run").click();
  await expect(page.locator(".tok-live").filter({ hasText: /succeeded/i })).toBeVisible({
    timeout: 8_000,
  });

  // Queue panel should not appear for a single-item queue.
  await expect(page.getByTestId("run-queue")).toHaveCount(0);
});

test("stop-on-failure toggle switches state", async ({ page }) => {
  await page.goto("/query");
  const toggle = page.getByTestId("qbar-stop-on-fail").locator("input");
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
});
