/**
 * Safe structured logger — never logs passwords, tokens, API keys,
 * or other sensitive values.
 *
 * Writes to stdout/stderr using JSON for structured log consumers
 * where practical, plain strings for human-readable messages.
 */

import { sanitizeDbError } from "../config/database.js";

// ── Public API ──────────────────────────────────────────────

export function logAuthEvent(
  event: "register" | "login_success" | "login_failed",
  email: string,
): void {
  const safe = maskEmail(email);
  console.log(`[auth] ${event} email=${safe}`);
}

export function logAiRequest(
  endpoint: string,
  userId: string,
  textLength: number,
): void {
  console.log(
    `[ai] request endpoint=${endpoint} user=${userId} chars=${textLength}`,
  );
}

export function logAiResult(
  endpoint: string,
  userId: string,
  ok: boolean,
  durationMs: number,
  errorHint?: string,
): void {
  const status = ok ? "ok" : "error";
  const extra = errorHint ? ` hint=${errorHint}` : "";
  console.log(
    `[ai] result endpoint=${endpoint} user=${userId} status=${status} ms=${durationMs}${extra}`,
  );
}

/**
 * Sanitise an error before logging.
 * - Redacts database connection strings
 * - Strips stack traces in production
 * - Never returns the raw error object
 */
export function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return sanitizeDbError(err.message);
  }
  if (typeof err === "string") {
    return sanitizeDbError(err);
  }
  return "Unknown error";
}

// ── Internal helpers ────────────────────────────────────────

/** Mask the local part of an email, preserving domain for debugging. */
function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return "**" + domain;
  return local[0] + "*".repeat(local.length - 2) + local[local.length - 1] + domain;
}
