import { defineConfig } from '@playwright/test'

// Kept outside the normal suites: only the screenshot command updates docs.
export default defineConfig({
  testDir: '.',
  testMatch: 'capture.spec.mjs',
  outputDir: '../results/screenshots',
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  reporter: 'list',
})
