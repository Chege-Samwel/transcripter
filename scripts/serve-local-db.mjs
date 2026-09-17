// Runs a local PostgreSQL for development without Docker or a system
// install (uses the embedded-postgres dev dependency).
//
//   npm run db:serve          # port 54329, database "transcripter", user "editor"
//   DB_PORT=5440 npm run db:serve
//
// The data directory lives under node_modules/.cache, so it is disposable.
// Then point the app at it with:
//   DATABASE_URL=postgres://editor:editor@127.0.0.1:54329/transcripter
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const port = Number(process.env.DB_PORT || 54329);
const user = "editor";
const password = "editor";
const database = "transcripter";
const dataDir = path.join(process.cwd(), "node_modules", ".cache", "transcripter-pg");

await rm(dataDir, { recursive: true, force: true });
await mkdir(dataDir, { recursive: true });

const postgres = new EmbeddedPostgres({
  databaseDir: dataDir,
  user,
  password,
  port,
  persistent: true,
});

let running = false;
try {
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase(database);
  running = true;
  console.log(`Local Postgres ready on 127.0.0.1:${port}`);
  console.log(`  DATABASE_URL=postgres://${user}:${password}@127.0.0.1:${port}/${database}`);
  console.log("The app applies migrations automatically on first use (or: npm run db:migrate).");
} catch (error) {
  console.error(`Could not start local Postgres: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const shutdown = async () => {
  if (running) {
    running = false;
    await postgres.stop().catch(() => {});
  }
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
