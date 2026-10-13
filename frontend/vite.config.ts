/// <reference types="vitest" />
import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    // Non-UTC zone so tests catch timestamps parsed as local time.
    env: { TZ: 'America/New_York' },
  },
  build: {
    outDir: 'dist',
  },
  server: {
    allowedHosts: ['frontend', 'localhost', '127.0.0.1'],
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
