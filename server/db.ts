import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/models/schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://pdtc:pdtc@localhost:5432/pdtc";

export const pool = new Pool({ connectionString });

// camelCase model fields -> snake_case SQL columns (matches drizzle.config.ts).
export const db = drizzle({ client: pool, schema, casing: "snake_case" });

export type Db = typeof db;
