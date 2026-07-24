import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./shared/models/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://pdtc:pdtc@localhost:5432/pdtc",
  },
  strict: true,
  verbose: true,
});
