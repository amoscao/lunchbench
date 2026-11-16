// getUserMedia needs a secure context. E2E serves the SPA from http://frontend:5173, which is not
// one, and Chromium ignores --unsafely-treat-insecure-origin-as-secure without its own user data dir.
// http://localhost is always secure, so camera projects load the SPA through a plain TCP forward
// from localhost to the frontend container. Nothing about the app changes.
import { createConnection, createServer, type Server } from 'node:net'
import { cameraBaseURL } from './camera-origin'

export default async function globalSetup(): Promise<(() => Promise<void>) | void> {
  const target = new URL(process.env.BASE_URL ?? 'http://localhost:5173')
  const local = new URL(cameraBaseURL())
  if (target.host === local.host) return

  const server: Server = createServer((client) => {
    const upstream = createConnection(Number(target.port || 80), target.hostname)
    client.pipe(upstream).pipe(client)
    client.on('error', () => upstream.destroy())
    upstream.on('error', () => client.destroy())
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(Number(local.port), '127.0.0.1', resolve)
  })
  return () => new Promise<void>((resolve) => server.close(() => resolve()))
}
