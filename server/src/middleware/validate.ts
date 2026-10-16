/**
 * Shared validation helpers used across routes.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUUID(value: string | string[] | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
