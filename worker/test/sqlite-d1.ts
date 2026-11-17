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
    const allSync = <T>() => ({ results: stmt().all(...values).map((row) => ({ ...row })) as T[], success: true, meta: {} })
    const runSync = () => {
      const result = stmt().run(...values)
      return { success: true, results: [], meta: { changes: Number(result.changes) } }
    }
    return {
      sql,
      bind: (...next: unknown[]) => statement(sql, next),
      async first<T>(column?: string): Promise<T | null> {
        const row = plain(stmt().get(...values))
        if (!row) return null
        return (column ? row[column] : row) as T
      },
      async all<T>() {
        return allSync<T>()
      },
      async run() {
        return runSync()
      },
      // Batch-only: one synchronous step inside the batch transaction.
      step: () => (/^\s*(SELECT|WITH)\b|\bRETURNING\b/i.test(sql) ? allSync() : runSync()),
    }
  }

  const db = {
    prepare: (sql: string) => statement(sql),
    // Like D1: one transaction, rolled back whole if any statement fails; every result has rows
    // (for reads) and meta.changes (for writes).
    async batch(statements: ReturnType<typeof statement>[]) {
      sqlite.exec('BEGIN')
      try {
        const results = statements.map((s) => s.step())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }
  return { db: db as unknown as D1Database, sqlite }
}
