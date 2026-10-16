/**
 * Simple in-memory sliding-window rate limiter.
 * No external dependencies — suitable for a single-process server.
 *
 * Limits are per-IP.  In production behind a reverse proxy,
 * ensure `trust proxy` is set so `req.ip` reflects the real client.
 */

import type { Request, Response, NextFunction } from "express";

interface Window {
  count: number;
  resetAt: number;
}

const stores = new Map<string, Map<string, Window>>();

// Purge expired entries every 60 s to prevent unbounded memory growth.
setInterval(() => {
  const now = Date.now();
  for (const store of stores.values()) {
    for (const [key, win] of store) {
      if (win.resetAt <= now) store.delete(key);
    }
  }
}, 60_000).unref();

export function rateLimit(opts: {
  /** Unique name for this limiter (each gets its own counter store). */
  name: string;
  /** Window duration in milliseconds. */
  windowMs: number;
  /** Maximum requests per window. */
  max: number;
}) {
  const { name, windowMs, max } = opts;

  if (!stores.has(name)) stores.set(name, new Map());
  const store = stores.get(name)!;

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    let win = store.get(key);

    if (!win || win.resetAt <= now) {
      win = { count: 0, resetAt: now + windowMs };
      store.set(key, win);
    }

    win.count++;

    // Always set informational headers.
    res.setHeader("RateLimit-Limit", max);
    res.setHeader("RateLimit-Remaining", Math.max(0, max - win.count));
    res.setHeader("RateLimit-Reset", Math.ceil(win.resetAt / 1000));

    if (win.count > max) {
      const retryAfter = Math.ceil((win.resetAt - now) / 1000);
      res.setHeader("Retry-After", retryAfter);
      res.status(429).json({ error: "Too many requests — please try again later" });
      return;
    }

    next();
  };
}
