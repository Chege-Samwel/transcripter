// Applies pending migrations from db/migrations/*.sql to DATABASE_URL.
//
//   DATABASE_URL=postgres://user:password@host/db npm run db:migrate
//
// Each migration runs inside a transaction and is recorded in the
// schema_migrations table. Migrations must be idempotent; re-running this
// command on an up-to-date database is a no-op. The same migrations are
// applied automatically by the app on first use (lib/migrate.ts), so this
// command is optional — it is useful for inspecting or pre-provisioning a
// fresh Neon database before deployment.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is not set. Export it and re-run, e.g.:");
  console.error("  DATABASE_URL=postgres://user:password@host/db npm run db:migrate");
  process.exit(1);
}

// Splits a SQL script into single statements. Mirrors splitStatements in
// lib/migrate.ts (keep the two in sync). Handles line/block comments and
// single/double quoted strings.
function splitStatements(sql) {
  const statements = [];
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

function sslConfig(connectionString) {
  try {
    const parsed = new URL(connectionString);
    const sslmode = parsed.searchParams.get("sslmode");
    if (sslmode === "disable") return false;
    if (sslmode === "require" || sslmode === "verify-ca" || sslmode === "verify-full") return { rejectUnauthorized: false };
    if (/(^|\.)neon\.(tech|aws)$/i.test(parsed.hostname)) return { rejectUnauthorized: false };
  } catch {
    /* fall through to no SSL */
  }
  return false;
}

const migrationsDir = path.join(process.cwd(), "db", "migrations");
const files = (await readdir(migrationsDir)).filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort();
if (files.length === 0) {
  console.error(`No migrations found in ${path.relative(process.cwd(), migrationsDir)}.`);
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: sslConfig(url), max: 1, connectionTimeoutMillis: 10_000 });
pool.on("error", (error) => console.error("Idle pool error:", error.message));

let appliedCount = 0;
try {
  const client = await pool.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
    );
    const appliedResult = await client.query("SELECT version FROM schema_migrations");
    const applied = new Set(appliedResult.rows.map((row) => row.version));

    for (const file of files) {
      const version = file.slice(0, 4);
      const name = file.replace(/\.sql$/, "");
      if (applied.has(version)) {
        console.log(`= ${file} (already applied)`);
        continue;
      }
      const statements = splitStatements(await readFile(path.join(migrationsDir, file), "utf8"));
      await client.query("BEGIN");
      try {
        await client.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING", [
          version,
          name,
        ]);
        for (const statement of statements) await client.query(statement);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      }
      applied.add(version);
      appliedCount += 1;
      console.log(`+ ${file} (applied)`);
    }

    const total = applied.size;
    console.log(appliedCount > 0 ? `\nApplied ${appliedCount} migration(s). ${total}/${files.length} total.` : `\nDatabase is already up to date. ${total}/${files.length} migrations applied.`);
  } finally {
    client.release();
  }
} catch (error) {
  console.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
