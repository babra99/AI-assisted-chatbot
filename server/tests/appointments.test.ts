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
import { getPool } from "../src/config/database.js";
import { createAppointmentsRouter } from "../src/appointments/appointments.routes.js";

const SECRET = "test-jwt-secret-long-enough-for-testing";
const USER_ID = "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb";
const OTHER_USER_ID = "cccccccc-4444-5555-6666-dddddddddddd";
const APPT_ID = "11111111-aaaa-bbbb-cccc-222222222222";
const mockGetPool = vi.mocked(getPool);

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/appointments", createAppointmentsRouter(SECRET));
  return a;
}

function token(sub = USER_ID, email = "user@test.com") {
  return jwt.sign({ sub, email }, SECRET, { expiresIn: "1h" });
}

const auth = () => ({ Authorization: `Bearer ${token()}` });

/** A future date that won't expire during test runs. */
const FUTURE_DATE = "2099-12-15";
const FUTURE_TIME = "10:00";

describe("Appointments API", () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = vi.fn();
    mockGetPool.mockReturnValue({ query: mockQuery } as never);
  });

  // ── POST /api/appointments (create) ───────────────────────────────

  describe("POST /api/appointments", () => {
    it("201 — creates appointment (fallback booking without AI)", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // duplicate check
        .mockResolvedValueOnce({
          rows: [
            {
              id: APPT_ID,
              user_id: USER_ID,
              service_name: "Haircut",
              appointment_date: FUTURE_DATE,
              appointment_time: FUTURE_TIME,
              status: "pending",
            },
          ],
        });

      const res = await supertest(app())
        .post("/api/appointments")
        .set(auth())
        .send({
          service_name: "Haircut",
          appointment_date: FUTURE_DATE,
          appointment_time: FUTURE_TIME,
        });

      expect(res.status).toBe(201);
      expect(res.body.appointment.service_name).toBe("Haircut");
      expect(res.body.appointment.status).toBe("pending");
    });

    it("400 — missing required fields", async () => {
      const res = await supertest(app())
        .post("/api/appointments")
        .set(auth())
        .send({ service_name: "Haircut" });
      expect(res.status).toBe(400);
    });

    it("400 — empty service_name", async () => {
      const res = await supertest(app())
        .post("/api/appointments")
        .set(auth())
        .send({
          service_name: "  ",
          appointment_date: FUTURE_DATE,
          appointment_time: FUTURE_TIME,
        });
      expect(res.status).toBe(400);
    });

    it("400 — service_name too long (>255 chars)", async () => {
      const res = await supertest(app())
        .post("/api/appointments")
        .set(auth())
        .send({
          service_name: "X".repeat(256),
          appointment_date: FUTURE_DATE,
          appointment_time: FUTURE_TIME,
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/255/);
    });

    it("400 — invalid date format", async () => {
      const res = await supertest(app())
        .post("/api/appointments")
        .set(auth())
        .send({
          service_name: "Haircut",
          appointment_date: "15-12-2099",
          appointment_time: FUTURE_TIME,
        });
      expect(res.status).toBe(400);
    });

    it("400 — invalid calendar date (Feb 30)", async () => {
      const res = await supertest(app())
        .post("/api/appointments")
        .set(auth())
        .send({
          service_name: "Haircut",
          appointment_date: "2099-02-30",
          appointment_time: FUTURE_TIME,
        });
      expect(res.status).toBe(400);
    });

    it("400 — invalid time format", async () => {
      const res = await supertest(app())
        .post("/api/appointments")
        .set(auth())
        .send({
          service_name: "Haircut",
          appointment_date: FUTURE_DATE,
          appointment_time: "25:00",
        });
      expect(res.status).toBe(400);
    });

    it("400 — appointment in the past", async () => {
      const res = await supertest(app())
        .post("/api/appointments")
        .set(auth())
        .send({
          service_name: "Haircut",
          appointment_date: "2020-01-01",
          appointment_time: "10:00",
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/past/i);
    });

    it("401 — no auth token", async () => {
      const res = await supertest(app())
        .post("/api/appointments")
        .send({
          service_name: "Haircut",
          appointment_date: FUTURE_DATE,
          appointment_time: FUTURE_TIME,
        });
      expect(res.status).toBe(401);
    });

    it("409 — duplicate booking same date+time", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: "existing" }] });

      const res = await supertest(app())
        .post("/api/appointments")
        .set(auth())
        .send({
          service_name: "Haircut",
          appointment_date: FUTURE_DATE,
          appointment_time: FUTURE_TIME,
        });
      expect(res.status).toBe(409);
    });
  });

  // ── GET /api/appointments (list) ──────────────────────────────────

  describe("GET /api/appointments", () => {
    it("200 — lists user appointments", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: APPT_ID, service_name: "Haircut", status: "pending" },
        ],
      });

      const res = await supertest(app())
        .get("/api/appointments")
        .set(auth());

      expect(res.status).toBe(200);
      expect(res.body.appointments).toHaveLength(1);
      // Verify query scopes to user_id
      expect(mockQuery.mock.calls[0][1][0]).toBe(USER_ID);
    });

    it("200 — filters by status query param", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await supertest(app())
        .get("/api/appointments?status=confirmed")
        .set(auth())
        .expect(200);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("status = $2");
    });

    it("200 — ignores invalid status values (no filter applied)", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await supertest(app())
        .get("/api/appointments?status=hacked")
        .set(auth())
        .expect(200);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).not.toContain("status = $2");
    });
  });

  // ── GET /api/appointments/:id ─────────────────────────────────────

  describe("GET /api/appointments/:id", () => {
    it("200 — returns appointment owned by user", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: APPT_ID, user_id: USER_ID, service_name: "Haircut" }],
      });

      const res = await supertest(app())
        .get(`/api/appointments/${APPT_ID}`)
        .set(auth());
      expect(res.status).toBe(200);
      expect(res.body.appointment.id).toBe(APPT_ID);
    });

    it("400 — invalid UUID format", async () => {
      const res = await supertest(app())
        .get("/api/appointments/not-a-uuid")
        .set(auth());
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/ID format/i);
    });

    it("404 — appointment not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await supertest(app())
        .get(`/api/appointments/${APPT_ID}`)
        .set(auth());
      expect(res.status).toBe(404);
    });

    it("404 — cannot access another user's appointment (ownership)", async () => {
      // The query includes user_id, so another user's appointment returns 0 rows
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const otherToken = jwt.sign(
        { sub: OTHER_USER_ID, email: "other@test.com" },
        SECRET,
        { expiresIn: "1h" },
      );
      const res = await supertest(app())
        .get(`/api/appointments/${APPT_ID}`)
        .set("Authorization", `Bearer ${otherToken}`);
      expect(res.status).toBe(404);
    });
  });

  // ── PATCH /api/appointments/:id ───────────────────────────────────

  describe("PATCH /api/appointments/:id", () => {
    it("200 — updates service_name", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: APPT_ID,
              status: "pending",
              appointment_date: FUTURE_DATE,
              appointment_time: FUTURE_TIME,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: APPT_ID,
              service_name: "Massage",
              status: "pending",
            },
          ],
        });

      const res = await supertest(app())
        .patch(`/api/appointments/${APPT_ID}`)
        .set(auth())
        .send({ service_name: "Massage" });

      expect(res.status).toBe(200);
      expect(res.body.appointment.service_name).toBe("Massage");
    });

    it("400 — invalid UUID", async () => {
      const res = await supertest(app())
        .patch("/api/appointments/bad-id")
        .set(auth())
        .send({ service_name: "X" });
      expect(res.status).toBe(400);
    });

    it("400 — no valid fields to update", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: APPT_ID, status: "pending", appointment_date: FUTURE_DATE, appointment_time: FUTURE_TIME }],
      });

      const res = await supertest(app())
        .patch(`/api/appointments/${APPT_ID}`)
        .set(auth())
        .send({});
      expect(res.status).toBe(400);
    });

    it("400 — cannot update cancelled appointment", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: APPT_ID, status: "cancelled" }],
      });

      const res = await supertest(app())
        .patch(`/api/appointments/${APPT_ID}`)
        .set(auth())
        .send({ service_name: "Massage" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cancelled/);
    });

    it("400 — service_name too long in update", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: APPT_ID, status: "pending", appointment_date: FUTURE_DATE, appointment_time: FUTURE_TIME }],
      });

      const res = await supertest(app())
        .patch(`/api/appointments/${APPT_ID}`)
        .set(auth())
        .send({ service_name: "Y".repeat(256) });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/255/);
    });

    it("404 — not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await supertest(app())
        .patch(`/api/appointments/${APPT_ID}`)
        .set(auth())
        .send({ service_name: "X" });
      expect(res.status).toBe(404);
    });
  });

  // ── PATCH /api/appointments/:id/cancel ────────────────────────────

  describe("PATCH /api/appointments/:id/cancel", () => {
    it("200 — cancels appointment", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: APPT_ID, status: "pending" }] })
        .mockResolvedValueOnce({
          rows: [{ id: APPT_ID, status: "cancelled" }],
        });

      const res = await supertest(app())
        .patch(`/api/appointments/${APPT_ID}/cancel`)
        .set(auth());
      expect(res.status).toBe(200);
      expect(res.body.appointment.status).toBe("cancelled");
    });

    it("400 — invalid UUID", async () => {
      const res = await supertest(app())
        .patch("/api/appointments/bad-id/cancel")
        .set(auth());
      expect(res.status).toBe(400);
    });

    it("400 — already cancelled", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: APPT_ID, status: "cancelled" }],
      });

      const res = await supertest(app())
        .patch(`/api/appointments/${APPT_ID}/cancel`)
        .set(auth());
      expect(res.status).toBe(400);
    });

    it("404 — not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await supertest(app())
        .patch(`/api/appointments/${APPT_ID}/cancel`)
        .set(auth());
      expect(res.status).toBe(404);
    });
  });
});
