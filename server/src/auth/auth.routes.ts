import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { getPool } from "../config/database.js";
import { requireAuth } from "./auth.middleware.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { logAuthEvent, safeErrorMessage } from "../middleware/logger.js";

const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = "7d";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 255;
/**
 * bcrypt silently truncates passwords beyond 72 bytes.
 * Cap at 72 characters to avoid misleading security expectations.
 */
const MAX_PASSWORD_LENGTH = 72;

function signToken(
  jwtSecret: string,
  payload: { sub: string; email: string },
): string {
  return jwt.sign(payload, jwtSecret, { expiresIn: TOKEN_EXPIRY });
}

export function createAuthRouter(jwtSecret: string): Router {
  const router = Router();

  // Stricter rate limit on auth endpoints to mitigate brute-force.
  const authLimiter = rateLimit({
    name: "auth",
    windowMs: 15 * 60_000, // 15 minutes
    max: 20,               // 20 attempts per window
  });

  // POST /api/auth/register
  router.post("/register", authLimiter, async (req, res) => {
    try {
      const { name, email, password } = req.body;

      if (!name || !email || !password) {
        res.status(400).json({ error: "name, email, and password are required" });
        return;
      }

      if (typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "name must be a non-empty string" });
        return;
      }

      if (name.trim().length > MAX_NAME_LENGTH) {
        res.status(400).json({ error: `name must be ${MAX_NAME_LENGTH} characters or fewer` });
        return;
      }

      if (typeof email !== "string" || !EMAIL_REGEX.test(email)) {
        res.status(400).json({ error: "Invalid email format" });
        return;
      }

      if (typeof password !== "string" || password.length < 8) {
        res
          .status(400)
          .json({ error: "Password must be at least 8 characters" });
        return;
      }

      if (password.length > MAX_PASSWORD_LENGTH) {
        res
          .status(400)
          .json({ error: `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer` });
        return;
      }

      const pool = getPool();
      if (!pool) {
        res.status(503).json({ error: "Database not available" });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();

      const existing = await pool.query(
        "SELECT id FROM users WHERE email = $1",
        [normalizedEmail],
      );
      if (existing.rows.length > 0) {
        res.status(409).json({ error: "Email already registered" });
        return;
      }

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

      const result = await pool.query(
        `INSERT INTO users (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, name, email`,
        [name.trim(), normalizedEmail, passwordHash],
      );

      const user = result.rows[0];
      const token = signToken(jwtSecret, { sub: user.id, email: user.email });

      logAuthEvent("register", normalizedEmail);

      res.status(201).json({ token, user });
    } catch (err) {
      console.error("[auth] register error:", safeErrorMessage(err));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/auth/login
  router.post("/login", authLimiter, async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({ error: "email and password are required" });
        return;
      }

      const pool = getPool();
      if (!pool) {
        res.status(503).json({ error: "Database not available" });
        return;
      }

      const normalizedEmail =
        typeof email === "string" ? email.toLowerCase().trim() : "";

      const result = await pool.query(
        "SELECT id, name, email, password_hash FROM users WHERE email = $1",
        [normalizedEmail],
      );

      if (result.rows.length === 0) {
        logAuthEvent("login_failed", normalizedEmail);
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const user = result.rows[0];
      const valid = await bcrypt.compare(String(password), user.password_hash);

      if (!valid) {
        logAuthEvent("login_failed", normalizedEmail);
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const token = signToken(jwtSecret, { sub: user.id, email: user.email });

      logAuthEvent("login_success", normalizedEmail);

      res.status(200).json({
        token,
        user: { id: user.id, name: user.name, email: user.email },
      });
    } catch (err) {
      console.error("[auth] login error:", safeErrorMessage(err));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/auth/me
  router.get("/me", requireAuth(jwtSecret), async (req, res) => {
    try {
      const pool = getPool();
      if (!pool) {
        res.status(503).json({ error: "Database not available" });
        return;
      }

      const result = await pool.query(
        "SELECT id, name, email FROM users WHERE id = $1",
        [req.user!.sub],
      );

      if (result.rows.length === 0) {
        res.status(401).json({ error: "User not found" });
        return;
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error("[auth] me error:", safeErrorMessage(err));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
