/**
 * Runs the drizzle migration set against DATABASE_URL. Used by the `migrate`
 * docker-compose service on boot and by `npm run db:migrate` locally.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function main() {
  const connectionString =
    process.env.DATABASE_URL ?? "postgres://pdtc:pdtc@localhost:5432/pdtc";
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);
  const migrationsFolder = path.join(rootDir, "migrations");

  // eslint-disable-next-line no-console
  console.log(`Running migrations from ${migrationsFolder} …`);
  await migrate(db, { migrationsFolder });
  await pool.end();
  // eslint-disable-next-line no-console
  console.log("Migrations complete.");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Migration failed:", err);
  process.exit(1);
});
