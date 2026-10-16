import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../src/config/database.js", () => ({
  getPool: vi.fn(),
  sanitizeDbError: (msg: string) => msg,
}));

vi.mock("../src/middleware/rate-limit.js", () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import express from "express";
import supertest from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { getPool } from "../src/config/database.js";
import { createAuthRouter } from "../src/auth/auth.routes.js";

const SECRET = "test-jwt-secret-long-enough-for-testing";
const mockGetPool = vi.mocked(getPool);

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/auth", createAuthRouter(SECRET));
  return a;
}

function token(sub: string, email: string) {
  return jwt.sign({ sub, email }, SECRET, { expiresIn: "1h" });
}

describe("Auth API", () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = vi.fn();
    mockGetPool.mockReturnValue({ query: mockQuery } as never);
  });

  // ── POST /api/auth/register ───────────────────────────────────────

  describe("POST /api/auth/register", () => {
    it("201 — creates user and returns token", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // no existing user
        .mockResolvedValueOnce({
          rows: [{ id: "u1", name: "Alice", email: "alice@test.com" }],
        });

      const res = await supertest(app())
        .post("/api/auth/register")
        .send({ name: "Alice", email: "alice@test.com", password: "securePass1" });

      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.user).toMatchObject({ id: "u1", name: "Alice" });

      // Verify the INSERT used a bcrypt hash (param 3)
      const insertCall = mockQuery.mock.calls[1];
      const hash = insertCall[1][2] as string;
      expect(hash.startsWith("$2")).toBe(true);
    });

    it("400 — missing name", async () => {
      const res = await supertest(app())
        .post("/api/auth/register")
        .send({ email: "a@b.com", password: "12345678" });
      expect(res.status).toBe(400);
    });

    it("400 — missing email", async () => {
      const res = await supertest(app())
        .post("/api/auth/register")
        .send({ name: "A", password: "12345678" });
      expect(res.status).toBe(400);
    });

    it("400 — missing password", async () => {
      const res = await supertest(app())
        .post("/api/auth/register")
        .send({ name: "A", email: "a@b.com" });
      expect(res.status).toBe(400);
    });

    it("400 — invalid email format", async () => {
      const res = await supertest(app())
        .post("/api/auth/register")
        .send({ name: "A", email: "not-an-email", password: "12345678" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/email/i);
    });

    it("400 — password too short (<8 chars)", async () => {
      const res = await supertest(app())
        .post("/api/auth/register")
        .send({ name: "A", email: "a@b.com", password: "short" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/8 characters/);
    });

    it("400 — password too long (>72 chars, bcrypt limit)", async () => {
      const res = await supertest(app())
        .post("/api/auth/register")
        .send({ name: "A", email: "a@b.com", password: "x".repeat(73) });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/72/);
    });

    it("400 — name too long (>255 chars)", async () => {
      const res = await supertest(app())
        .post("/api/auth/register")
        .send({ name: "A".repeat(256), email: "a@b.com", password: "12345678" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/255/);
    });

    it("409 — duplicate email", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: "existing" }] });

      const res = await supertest(app())
        .post("/api/auth/register")
        .send({ name: "A", email: "dup@test.com", password: "12345678" });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already registered/i);
    });

    it("503 — database unavailable", async () => {
      mockGetPool.mockReturnValue(null);

      const res = await supertest(app())
        .post("/api/auth/register")
        .send({ name: "A", email: "a@b.com", password: "12345678" });
      expect(res.status).toBe(503);
    });
  });

  // ── POST /api/auth/login ──────────────────────────────────────────

  describe("POST /api/auth/login", () => {
    const passwordHash = bcrypt.hashSync("correctPassword1", 10);

    it("200 — returns token for valid credentials", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "u1",
            name: "Alice",
            email: "alice@test.com",
            password_hash: passwordHash,
          },
        ],
      });

      const res = await supertest(app())
        .post("/api/auth/login")
        .send({ email: "alice@test.com", password: "correctPassword1" });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user).toMatchObject({ id: "u1", name: "Alice" });
      expect(res.body.user.password_hash).toBeUndefined();
    });

    it("400 — missing email", async () => {
      const res = await supertest(app())
        .post("/api/auth/login")
        .send({ password: "12345678" });
      expect(res.status).toBe(400);
    });

    it("400 — missing password", async () => {
      const res = await supertest(app())
        .post("/api/auth/login")
        .send({ email: "a@b.com" });
      expect(res.status).toBe(400);
    });

    it("401 — unknown email", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await supertest(app())
        .post("/api/auth/login")
        .send({ email: "nobody@test.com", password: "12345678" });
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid email or password/i);
    });

    it("401 — wrong password", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "u1",
            name: "Alice",
            email: "alice@test.com",
            password_hash: passwordHash,
          },
        ],
      });

      const res = await supertest(app())
        .post("/api/auth/login")
        .send({ email: "alice@test.com", password: "wrongPassword" });
      expect(res.status).toBe(401);
    });

    it("503 — database unavailable", async () => {
      mockGetPool.mockReturnValue(null);

      const res = await supertest(app())
        .post("/api/auth/login")
        .send({ email: "a@b.com", password: "12345678" });
      expect(res.status).toBe(503);
    });
  });

  // ── GET /api/auth/me ──────────────────────────────────────────────

  describe("GET /api/auth/me", () => {
    it("200 — returns user for valid token", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "u1", name: "Alice", email: "alice@test.com" }],
      });

      const res = await supertest(app())
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token("u1", "alice@test.com")}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: "u1", name: "Alice" });
    });

    it("401 — no token", async () => {
      const res = await supertest(app()).get("/api/auth/me");
      expect(res.status).toBe(401);
    });

    it("401 — malformed header", async () => {
      const res = await supertest(app())
        .get("/api/auth/me")
        .set("Authorization", "NotBearer abc");
      expect(res.status).toBe(401);
    });

    it("401 — invalid token", async () => {
      const res = await supertest(app())
        .get("/api/auth/me")
        .set("Authorization", "Bearer invalidtoken");
      expect(res.status).toBe(401);
    });

    it("401 — token signed with wrong secret", async () => {
      const bad = jwt.sign({ sub: "u1", email: "a@b.com" }, "wrong-secret");
      const res = await supertest(app())
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${bad}`);
      expect(res.status).toBe(401);
    });

    it("401 — user not found in database", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await supertest(app())
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token("deleted-user", "x@test.com")}`);
      expect(res.status).toBe(401);
    });
  });
});
