import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import { KNOWN_BARCODE, UNKNOWN_BARCODE, writeBarcodeClip } from './fixtures/barcode-video'

const baseURL = process.env.BASE_URL ?? 'http://localhost:5173'

// Barcode scan tests use Chromium's fake camera fed from a generated Y4M clip, one clip per project
// (the clip is fixed when the browser launches). The real decoder runs on the fake frames.
const clipDir = join(tmpdir(), 'lunchbench-e2e-camera')

function cameraProject(name: string, clip: string, testMatch: RegExp) {
  return {
    name,
    testMatch,
    use: {
      ...devices['Pixel 5'],
      permissions: ['camera'],
      launchOptions: {
        args: [
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
          `--use-file-for-fake-video-capture=${clip}`,
          // E2E serves the SPA from http://frontend:5173. getUserMedia needs a secure context.
          `--unsafely-treat-insecure-origin-as-secure=${new URL(baseURL).origin}`,
        ],
      },
    },
  }
}

export default defineConfig({
  testDir: './tests',
  outputDir: '/tmp/pw-test-results',
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /barcode-scan-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    cameraProject('camera-blank', writeBarcodeClip(clipDir, 'blank', null), /barcode-scan-camera\.spec\.ts/),
    cameraProject('camera-known', writeBarcodeClip(clipDir, 'known', KNOWN_BARCODE), /barcode-scan-known\.spec\.ts/),
    cameraProject('camera-unknown', writeBarcodeClip(clipDir, 'unknown', UNKNOWN_BARCODE), /barcode-scan-unknown\.spec\.ts/),
  ],
})
