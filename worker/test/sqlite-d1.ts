// Test-only D1 stand-in backed by node:sqlite, with every migration in migrations/ applied.
// Lets route tests run the real SQL instead of string-matching it.
import { createRequire } from 'node:module'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

type Row = Record<string, unknown>
type SqliteStatement = {
  get(...values: unknown[]): Row | undefined
  all(...values: unknown[]): Row[]
  run(...values: unknown[]): { changes: number | bigint }
}
type SqliteDatabase = { exec(sql: string): void; prepare(sql: string): SqliteStatement }

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')

export function createTestD1(): { db: D1Database; sqlite: SqliteDatabase } {
  // createRequire: vite-node does not resolve the prefix-only `node:sqlite` builtin through import.
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
    DatabaseSync: new (path: string) => SqliteDatabase
  }
  const sqlite = new DatabaseSync(':memory:')
  for (const file of readdirSync(MIGRATIONS).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
  }

  const plain = (row: Row | undefined): Row | null => (row ? { ...row } : null)

  function statement(sql: string, values: unknown[] = []) {
    const stmt = () => sqlite.prepare(sql)
    return {
      bind: (...next: unknown[]) => statement(sql, next),
      async first<T>(column?: string): Promise<T | null> {
        const row = plain(stmt().get(...values))
        if (!row) return null
        return (column ? row[column] : row) as T
      },
      async all<T>() {
        return { results: stmt().all(...values).map((row) => ({ ...row })) as T[], success: true, meta: {} }
      },
      async run() {
        const result = stmt().run(...values)
        return { success: true, results: [], meta: { changes: Number(result.changes) } }
      },
    }
  }

  const db = {
    prepare: (sql: string) => statement(sql),
    async batch(statements: ReturnType<typeof statement>[]) {
      return Promise.all(statements.map((s) => s.all()))
    },
  }
  return { db: db as unknown as D1Database, sqlite }
}
