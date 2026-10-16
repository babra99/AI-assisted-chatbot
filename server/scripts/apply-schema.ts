/**
 * Applies db/schema.sql using DATABASE_URL from server/.env (or environment).
 * Run from repo root: npm run db:init
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(serverRoot, "..");

dotenv.config({ path: path.join(serverRoot, ".env") });

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("DATABASE_URL is not set. Copy server/.env.example to server/.env and configure it.");
  process.exit(1);
}

const schemaPath = path.join(repoRoot, "db", "schema.sql");
const sql = fs.readFileSync(schemaPath, "utf8");

const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 10_000 });

try {
  await pool.query(sql);
  console.log("Schema applied successfully from db/schema.sql");
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Failed to apply schema:", message.replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, "[redacted]"));
  process.exit(1);
} finally {
  await pool.end();
}
