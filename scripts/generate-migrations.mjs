// Builds lib/migrations.generated.ts from db/migrations/*.sql.
//
// The generated file is committed so serverless builds (which run "next build"
// directly, not "npm run build") always ship the migration set without
// reading the filesystem at runtime. Re-run "npm run db:generate" after
// adding a migration file and commit both the .sql and the generated file.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const migrationsDir = path.join(root, "db", "migrations");
const outPath = path.join(root, "lib", "migrations.generated.ts");

const files = (await readdir(migrationsDir)).filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort();
if (files.length === 0) {
  console.error("No migrations found in db/migrations (expected e.g. 0001_initial_schema.sql).");
  process.exit(1);
}

const migrations = [];
for (const file of files) {
  const sql = (await readFile(path.join(migrationsDir, file), "utf8")).trim();
  migrations.push({ version: file.slice(0, 4), name: file.replace(/\.sql$/, ""), sql });
}

// Escape for a JS template literal.
const escapeSql = (value) => value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

const output = `// Auto-generated from db/migrations/*.sql by scripts/generate-migrations.mjs.
// Do not edit by hand — edit the .sql files and run "npm run db:generate".
export type Migration = { version: string; name: string; sql: string };

export const MIGRATIONS: Migration[] = [
${migrations
  .map((migration) => `  { version: ${JSON.stringify(migration.version)}, name: ${JSON.stringify(migration.name)}, sql: \`${escapeSql(migration.sql)}\` },`)
  .join("\n")}
];
`;

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, output);
console.log(`Wrote ${path.relative(root, outPath)} with ${migrations.length} migration(s): ${migrations.map((m) => m.name).join(", ")}`);
