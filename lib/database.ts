import { readFileSync } from "node:fs";
import { Pool } from "pg";

let pool: Pool | null = null;

export function databaseUrl() {
  return process.env.DATABASE_URL?.trim() || "";
}

export function databaseConfigured() {
  return Boolean(databaseUrl());
}

function sslConfig(connectionString: string): false | { rejectUnauthorized: boolean; ca?: string; cert?: string; key?: string } {
  try {
    const parsed = new URL(connectionString);
    const sslmode = parsed.searchParams.get("sslmode")?.toLowerCase();
    if (sslmode === "disable") return false;
    // pg-connection-string (current major) parses `sslmode` in the URL into an
    // empty TLS object — system-CA verification, its documented "aliases for
    // verify-full" behavior — and logs a deprecation warning on every parse;
    // pg v9 will flip these modes to weaker libpq semantics. We hand pg an
    // explicit `ssl` option instead (see pgConnectionStringUrl below) and keep
    // today's effective behavior: URL sslmode => verify against the system CA
    // bundle, except an explicit `no-verify`.
    if (sslmode) {
      const ssl: { rejectUnauthorized: boolean; ca?: string; cert?: string; key?: string } = {
        rejectUnauthorized: sslmode !== "no-verify",
      };
      // Preserve the certificate files pg-connection-string would otherwise
      // load from the URL (custom CA / client certificates).
      const fileParams = [
        ["sslrootcert", "ca"],
        ["sslcert", "cert"],
        ["sslkey", "key"],
      ] as const;
      for (const [param, prop] of fileParams) {
        const file = parsed.searchParams.get(param);
        if (file) {
          try {
            ssl[prop] = readFileSync(file, "utf8");
          } catch {
            /* a missing file surfaces as a TLS handshake error */
          }
        }
      }
      return ssl;
    }
    // Neon connection strings may omit sslmode entirely; still negotiate TLS
    // for known Neon hosts (self-signed cluster certs, so do not verify
    // against the system CA bundle).
    if (/(^|\.)neon\.(tech|aws)$/i.test(parsed.hostname)) return { rejectUnauthorized: false };
  } catch {
    /* malformed URLs surface as connection errors below */
  }
  return false;
}

/**
 * Removes `sslmode` from the connection string given to pg. The TLS decision
 * is made above via the explicit `ssl` option; leaving `sslmode` in the URL
 * would let pg-connection-string override that option (it replaces it with an
 * empty object) and emit a deprecation warning on every connection.
 */
function pgConnectionStringUrl(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.searchParams.has("sslmode")) {
      url.searchParams.delete("sslmode");
      return url.toString();
    }
  } catch {
    /* keep the original; malformed URLs surface as connection errors */
  }
  return connectionString;
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: pgConnectionStringUrl(databaseUrl()),
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
