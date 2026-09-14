import { Pool } from "pg";

let pool: Pool | null = null;

export function databaseUrl() {
  return process.env.DATABASE_URL?.trim() || "";
}

export function databaseConfigured() {
  return Boolean(databaseUrl());
}

function sslConfig(connectionString: string): false | { rejectUnauthorized: boolean } {
  try {
    const parsed = new URL(connectionString);
    const sslmode = parsed.searchParams.get("sslmode");
    if (sslmode === "disable") return false;
    if (sslmode === "require" || sslmode === "verify-ca" || sslmode === "verify-full") return { rejectUnauthorized: false };
    // Neon connection strings normally carry ?sslmode=require; if one does
    // not, still negotiate TLS for known Neon hosts (self-signed cluster
    // certs, so do not verify against the system CA bundle).
    if (/(^|\.)neon\.(tech|aws)$/i.test(parsed.hostname)) return { rejectUnauthorized: false };
  } catch {
    /* malformed URLs surface as connection errors below */
  }
  return false;
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl(),
      ssl: sslConfig(databaseUrl()),
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    // An unhandled error on an idle client would otherwise crash the process.
    pool.on("error", (error) => {
      console.error("Transcripter: idle database client error", error);
    });
  }
  return pool;
}

export function describeDatabaseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cleaned = message.split("\n")[0].trim();
  return cleaned.length > 300 ? `${cleaned.slice(0, 300)}…` : cleaned || "Unknown database error.";
}
