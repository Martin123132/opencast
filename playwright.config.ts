import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const e2ePort = 5181
const apiPort = 4178
const artifactsRoot = process.env.OPENCAST_E2E_ARTIFACTS ?? 'D:\\open-source\\.temp\\opencast-e2e'
const dataRoot = process.env.OPENCAST_E2E_DATA_ROOT ?? 'D:\\open-source\\opencast-e2e-data'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  outputDir: path.join(artifactsRoot, 'test-results'),
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(artifactsRoot, 'playwright-report') }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${e2ePort}`,
    channel: 'msedge',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'edge-desktop',
      use: { ...devices['Desktop Edge'] },
    },
  ],
  webServer: {
    command: 'npm.cmd run dev:e2e',
    url: `http://127.0.0.1:${e2ePort}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      OPENCAST_PORT: String(apiPort),
      OPENCAST_DATA_ROOT: dataRoot,
      OPENCAST_API_TARGET: `http://127.0.0.1:${apiPort}`,
      TEMP: process.env.TEMP ?? 'D:\\open-source\\.temp',
      TMP: process.env.TMP ?? 'D:\\open-source\\.temp',
      npm_config_cache: process.env.npm_config_cache ?? 'D:\\open-source\\.cache\\npm',
    },
  },
})
