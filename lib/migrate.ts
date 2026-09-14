import { MIGRATIONS } from "./migrations.generated";
import { databaseConfigured, describeDatabaseError, getPool } from "./database";

export type DatabaseReadiness = {
  configured: boolean;
  autoMigrations: boolean;
  applied: string[];
  error?: string;
};

let readinessPromise: Promise<DatabaseReadiness> | null = null;

export function autoMigrationsEnabled(): boolean {
  const value = (process.env.DISABLE_AUTO_MIGRATE || "").trim().toLowerCase();
  return !["1", "true", "yes", "on"].includes(value);
}

/** Test hook: clear the memoized readiness state. */
export function resetDatabaseReadiness() {
  readinessPromise = null;
}

export function databaseReadiness(): Promise<DatabaseReadiness> {
  if (!databaseConfigured()) {
    return Promise.resolve({ configured: false, autoMigrations: autoMigrationsEnabled(), applied: [] });
  }
  if (!autoMigrationsEnabled()) {
    // Manual mode: the operator runs migrations with "npm run db:migrate".
    return Promise.resolve({ configured: true, autoMigrations: false, applied: [] });
  }
  if (!readinessPromise) readinessPromise = applyMigrations();
  return readinessPromise;
}

async function applyMigrations(): Promise<DatabaseReadiness> {
  try {
    const pool = getPool();
    await pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
    );
    const appliedResult = await pool.query("SELECT version FROM schema_migrations ORDER BY version");
    const applied = new Set(appliedResult.rows.map((row: { version: string }) => row.version));

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      const statements = splitStatements(migration.sql);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING", [
          migration.version,
          migration.name,
        ]);
        for (const statement of statements) await client.query(statement);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      applied.add(migration.version);
    }

    return { configured: true, autoMigrations: true, applied: MIGRATIONS.map((migration) => migration.version) };
  } catch (error) {
    // Do not memoize failures — the next request retries the migration.
    readinessPromise = null;
    const message = describeDatabaseError(error);
    console.error("Transcripter: automatic database migration failed", error);
    return { configured: true, autoMigrations: true, applied: [], error: message };
  }
}

/**
 * Splits a SQL script into single statements (the database driver executes
 * one statement per call). Mirrors splitStatements in scripts/migrate.mjs —
 * keep the two implementations in sync.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (inLineComment) {
      current += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      current += ch;
      if (ch === "*" && next === "/") {
        current += next;
        i += 1;
        inBlockComment = false;
      }
      continue;
    }
    if (inSingle) {
      current += ch;
      if (ch === "'") {
        if (next === "'") {
          current += next;
          i += 1;
        } else {
          inSingle = false;
        }
      }
      continue;
    }
    if (inDouble) {
      current += ch;
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "-" && next === "-") {
      inLineComment = true;
      current += ch;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      current += ch;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      current += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      current += ch;
      continue;
    }
    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}
