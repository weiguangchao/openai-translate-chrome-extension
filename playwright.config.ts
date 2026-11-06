import { defineConfig } from '@playwright/test';

const output = process.env.SUBLINE_E2E_OUTPUT_DIR ?? '.artifacts/e2e';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: `${output}/results`,
  workers: process.env.CI ? 2 : 1,
  fullyParallel: Boolean(process.env.CI),
  grepInvert: process.env.CI ? /@local/ : undefined,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: `${output}/report.json` }],
    ['html', { outputFolder: `${output}/report`, open: 'never' }],
  ],
});
