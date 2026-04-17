import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/workspace");
  await expect(page.locator(".fb-banner")).toBeVisible();
});

async function openPreview(
  page: import("@playwright/test").Page,
  filename: string
) {
  const link = page.locator(".fb-name-link").filter({ hasText: filename });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByTestId("fp-drawer")).toBeVisible();
}

test("CSV preview renders a table with headers + raw toggle", async ({ page }) => {
  // The csv seeds live one level deep.
  await page
    .locator(".fb-folder")
    .filter({ hasText: /sample-data\// })
    .click();
  await openPreview(page, "sales-2025.csv");
  await expect(page.getByTestId("fp-body-csv")).toBeVisible();

  // Parsed view: VirtualTable header cells show the CSV column names.
  const headerCells = page.locator(".vt-th-name");
  await expect(headerCells.nth(0)).toHaveText("id");
  await expect(headerCells.nth(1)).toHaveText("date");
  await expect(headerCells.nth(2)).toHaveText("amount");

  // Toggle raw — first line of the CSV renders as a text line.
  await page.getByTestId("fp-raw-toggle").getByRole("button", { name: "raw" }).click();
  await expect(page.locator(".fp-line").first()).toContainText("id,date,amount");
});

test("JSON preview renders a tree with toggleable raw", async ({ page }) => {
  await openPreview(page, "config.json");
  await expect(page.getByTestId("fp-body-json")).toBeVisible();
  await expect(page.getByTestId("fp-json-tree")).toBeVisible();

  // The "name" key should appear somewhere in the tree.
  await expect(page.locator(".fp-tree-key").filter({ hasText: "name" })).toBeVisible();

  // Switch to raw and verify the literal JSON text shows up.
  await page.getByTestId("fp-raw-toggle").getByRole("button", { name: "raw" }).click();
  await expect(page.locator(".fp-line").first()).toContainText('"athena-shell"');
});

test("JSONL preview parses as a table with key-union columns", async ({ page }) => {
  await openPreview(page, "events.jsonl");
  await expect(page.getByTestId("fp-body-jsonl")).toBeVisible();

  const headerCells = page.locator(".vt-th-name");
  await expect(headerCells.nth(0)).toHaveText("id");
  await expect(headerCells.nth(1)).toHaveText("level");
  await expect(headerCells.nth(2)).toHaveText("msg");
});

test("Image preview renders the <img> element", async ({ page }) => {
  await openPreview(page, "pixel.png");
  await expect(page.getByTestId("fp-body-image")).toBeVisible();
  await expect(page.getByTestId("fp-image")).toBeVisible();
});

test("Parquet preview dispatches and surfaces metadata or parse error", async ({
  page,
}) => {
  await openPreview(page, "not-really.parquet");
  await expect(page.getByTestId("fp-body-parquet")).toBeVisible();
  // The mock seeds a bogus parquet, so hyparquet surfaces an error —
  // the preview should render the error panel rather than crash.
  await expect(page.locator(".fp-status-error")).toBeVisible({ timeout: 5_000 });
});
