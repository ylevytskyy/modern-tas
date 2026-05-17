import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,                       // spec §4 — zero flake budget
  workers: 1,                       // S-1 talks to a singleton compose stack
  reporter: process.env.CI ? [['html'], ['list']] : 'list',
  timeout: process.env.CI ? 75_000 : 120_000,  // CI: tight budget; host-dev: SIPp retransmit ~30s + workflow 30s
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
