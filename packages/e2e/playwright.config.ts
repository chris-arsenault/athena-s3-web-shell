import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for athena-shell Tier-1 E2E tests.
 *
 * Runs against `MOCK_AUTH=1 pnpm dev` — the SPA on :5173 proxies /api
 * to the Express proxy on :8080, both started by the root `pnpm dev`
 * script in parallel. No AWS SDK, no real data.
 *
 * Chromium-only: this is an internal tool behind an ALB, not a public
 * site — we don't need a cross-browser matrix.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // Mock state (mockS3Store, mockAthena) is an in-memory singleton
  // shared across test execution. Serial runs avoid cross-test state
  // leaks without needing per-test fixtures to reset.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Starts web (:5173) + shared watcher + proxy (:8080) in parallel
    // via `pnpm -r --parallel run dev`. Playwright waits for :5173
    // to respond before the first test runs.
    command: "pnpm dev",
    cwd: "../..",
    url: "http://localhost:5173",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      MOCK_AUTH: "1",
    },
  },
});
