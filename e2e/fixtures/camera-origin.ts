const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The SPA origin camera projects use: BASE_URL when it is already local, else localhost on the same port. */
export function cameraBaseURL(): string {
  const base = new URL(process.env.BASE_URL ?? 'http://localhost:5173')
  if (LOCAL_HOSTS.has(base.hostname)) return base.origin
  return `http://localhost:${base.port || '80'}`
}
