import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

/**
 * Returns a shared pool when DATABASE_URL is set; otherwise null (API still starts).
 */
export function getPool(): pg.Pool | null {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    pool.on("error", (err) => {
      console.error("Unexpected PostgreSQL pool error:", sanitizeDbError(err.message));
    });
  }

  return pool;
}

export type DatabaseHealthResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "unavailable"; message: string };

/** Runs SELECT 1; does not throw — safe for health endpoints. */
export async function checkDatabaseHealth(): Promise<DatabaseHealthResult> {
  const dbPool = getPool();
  if (!dbPool) {
    return {
      ok: false,
      reason: "not_configured",
      message: "DATABASE_URL is not set",
    };
  }

  try {
    await dbPool.query("SELECT 1");
    return { ok: true };
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Unknown database error";
    return {
      ok: false,
      reason: "unavailable",
      message: sanitizeDbError(raw),
    };
  }
}

/** Redact credentials that might appear in driver error messages. */
export function sanitizeDbError(message: string): string {
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, "[database-url-redacted]")
    .replace(/password=\S+/gi, "password=[redacted]");
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
