import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/query");
  await expect(page.locator(".sql-editor")).toBeVisible();
  await page.locator(".qbtn-run").click();
  await expect(page.locator(".tok-live").filter({ hasText: /succeeded/i })).toBeVisible({
    timeout: 8_000,
  });
  // Result rows have rendered.
  await expect(page.locator(".vt-row").first()).toBeVisible();
});

test("column filter popover filters rows + chip appears", async ({ page }) => {
  // Before filter: at least a few Widget-prefixed rows exist.
  const widgetRowsBefore = await page.locator(".vt-row").filter({ hasText: "Widget" }).count();
  expect(widgetRowsBefore).toBeGreaterThan(0);

  // Open the filter popover for the `name` column.
  await page.getByTestId("vt-filter-name").click();
  const popover = page.getByTestId("cfp-name");
  await expect(popover).toBeVisible();

  // Type a substring search.
  await popover.getByTestId("cfp-search-name").fill("Widget");

  // Chip appears in the toolbar.
  const chips = page.getByTestId("filter-chips");
  await expect(chips).toBeVisible({ timeout: 2_000 });

  // Close popover (click outside).
  await page.locator(".results-meta").click();
  await expect(popover).toBeHidden();

  // Only Widget rows remain.
  const visibleRows = page.locator(".vt-row");
  const sampleCount = Math.min(await visibleRows.count(), 5);
  for (let i = 0; i < sampleCount; i++) {
    await expect(visibleRows.nth(i)).toContainText("Widget");
  }

  // Clear-all removes the chip.
  await page.getByTestId("filter-clear-all").click();
  await expect(chips).toBeHidden();
});

test("group-by panel: drop name → group, drop amount → aggregate, switch op", async ({
  page,
}) => {
  // Open the group-by panel.
  await page.getByTestId("groupby-toggle").click();
  const panel = page.getByTestId("groupby-panel");
  await expect(panel).toBeVisible();

  // Playwright's dragTo doesn't reliably populate dataTransfer for HTML5
  // DnD. Dispatch the `drop` event directly with the column name — the
  // same event the app's onDrop handler reads from.
  await dispatchColumnDrop(page, "gbp-zone-group", "name");
  await expect(page.getByTestId("gbp-chip-group-name")).toBeVisible();

  await dispatchColumnDrop(page, "gbp-zone-agg", "amount");
  const aggChip = page.getByTestId("gbp-chip-agg-amount");
  await expect(aggChip).toBeVisible();

  // Switch the aggregation op — default is SUM (first numeric op).
  await aggChip.locator("select").selectOption("AVG");

  // The grouped result has one row per distinct (name, amount) combo.
  // The ROWS stat reflects the aggregated total. First fetched page is
  // 100 unique (name, amount) rows, so we expect 100 after grouping by
  // name (still 100 — names are unique per row in the mock data).
  const rowStat = page.locator(".stat").filter({ hasText: /ROWS/i });
  await expect(rowStat.locator(".stat-value")).not.toHaveText(/^0/);
  // The output has an `avg_amount` column header.
  await expect(
    page.locator(".vt-th-name", { hasText: /^avg_amount$/ })
  ).toBeVisible();
});

async function dispatchColumnDrop(
  page: import("@playwright/test").Page,
  zoneTestId: string,
  column: string
): Promise<void> {
  await page.evaluate(
    ({ zoneTestId, column }) => {
      const zone = document.querySelector(`[data-testid="${zoneTestId}"]`);
      if (!zone) throw new Error(`zone ${zoneTestId} not found`);
      const dt = new DataTransfer();
      dt.setData("text/column", column);
      const drop = new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      });
      zone.dispatchEvent(drop);
    },
    { zoneTestId, column }
  );
}
