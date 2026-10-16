import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../src/config/database.js", () => ({
  getPool: vi.fn(),
  sanitizeDbError: (msg: string) => msg,
}));

vi.mock("../src/middleware/rate-limit.js", () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../src/ai/ai.service.js", () => ({
  chatAppointmentAssistant: vi.fn(),
}));

import express from "express";
import supertest from "supertest";
import jwt from "jsonwebtoken";
import { getPool } from "../src/config/database.js";
import { chatAppointmentAssistant } from "../src/ai/ai.service.js";
import { createChatRouter } from "../src/chat/chat.routes.js";

const SECRET = "test-jwt-secret-long-enough-for-testing";
const MISTRAL_KEY = "test-mistral-key";
const USER_ID = "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb";
const SESSION_ID = "eeeeeeee-1111-2222-3333-eeeeeeeeeeee";
const mockGetPool = vi.mocked(getPool);
const mockChat = vi.mocked(chatAppointmentAssistant);

function app(mistralKey: string | undefined = MISTRAL_KEY) {
  const a = express();
  a.use(express.json());
  a.use("/api/chat", createChatRouter(SECRET, mistralKey));
  return a;
}

const tok = jwt.sign({ sub: USER_ID, email: "user@test.com" }, SECRET, {
  expiresIn: "1h",
});
const auth = () => ({ Authorization: `Bearer ${tok}` });

describe("Chat API", () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = vi.fn();
    mockGetPool.mockReturnValue({ query: mockQuery } as never);
  });

  // ── POST /api/chat (create session) ───────────────────────────────

  describe("POST /api/chat", () => {
    it("201 — creates a chat session", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: SESSION_ID,
            user_id: USER_ID,
            messages: [],
            created_at: "2025-01-01",
            updated_at: "2025-01-01",
          },
        ],
      });

      const res = await supertest(app())
        .post("/api/chat")
        .set(auth());

      expect(res.status).toBe(201);
      expect(res.body.session.id).toBe(SESSION_ID);
      // Verify query uses the authenticated user's ID
      expect(mockQuery.mock.calls[0][1][0]).toBe(USER_ID);
    });

    it("401 — requires authentication", async () => {
      const res = await supertest(app()).post("/api/chat");
      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/chat (list sessions) ─────────────────────────────────

  describe("GET /api/chat", () => {
    it("200 — lists user sessions", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: SESSION_ID, message_count: 4 }],
      });

      const res = await supertest(app()).get("/api/chat").set(auth());
      expect(res.status).toBe(200);
      expect(res.body.sessions).toHaveLength(1);
    });
  });

  // ── GET /api/chat/:sessionId ──────────────────────────────────────

  describe("GET /api/chat/:sessionId", () => {
    it("200 — returns session with messages", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: SESSION_ID, user_id: USER_ID, messages: [] }],
      });

      const res = await supertest(app())
        .get(`/api/chat/${SESSION_ID}`)
        .set(auth());
      expect(res.status).toBe(200);
      expect(res.body.session.id).toBe(SESSION_ID);
    });

    it("400 — invalid UUID format", async () => {
      const res = await supertest(app())
        .get("/api/chat/not-a-uuid")
        .set(auth());
      expect(res.status).toBe(400);
    });

    it("404 — session not found or wrong user", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await supertest(app())
        .get(`/api/chat/${SESSION_ID}`)
        .set(auth());
      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/chat/:sessionId/messages ────────────────────────────

  describe("POST /api/chat/:sessionId/messages", () => {
    const aiSuccess = {
      appointment: {
        service_name: "Haircut",
        appointment_date: "2099-12-15",
        appointment_time: "10:00",
      },
      message: "Got it — Haircut on 2099-12-15 at 10:00.",
      missing_fields: [] as string[],
    };

    it("201 — sends message and gets AI response", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: SESSION_ID, messages: [] }],
        })
        .mockResolvedValueOnce({ rows: [] }); // update

      mockChat.mockResolvedValueOnce(aiSuccess);

      const res = await supertest(app())
        .post(`/api/chat/${SESSION_ID}/messages`)
        .set(auth())
        .send({ text: "Book a haircut for Dec 15 at 10am" });

      expect(res.status).toBe(201);
      expect(res.body.reply.appointment.service_name).toBe("Haircut");
      expect(res.body.reply.ready).toBe(true);
    });

    it("201 — passes full conversation history to AI (multi-turn context)", async () => {
      const existingMessages = [
        { role: "user", content: "I want a haircut", at: "2025-01-01T00:00:00Z" },
        { role: "assistant", content: "When?", at: "2025-01-01T00:00:01Z" },
      ];

      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: SESSION_ID, messages: existingMessages }],
        })
        .mockResolvedValueOnce({ rows: [] }); // update

      mockChat.mockResolvedValueOnce(aiSuccess);

      await supertest(app())
        .post(`/api/chat/${SESSION_ID}/messages`)
        .set(auth())
        .send({ text: "Tomorrow at 10am" })
        .expect(201);

      // Verify the AI received the full history (existing + new message)
      expect(mockChat).toHaveBeenCalledWith(MISTRAL_KEY, [
        { role: "user", content: "I want a haircut" },
        { role: "assistant", content: "When?" },
        { role: "user", content: "Tomorrow at 10am" },
      ]);
    });

    it("400 — invalid session UUID", async () => {
      const res = await supertest(app())
        .post("/api/chat/bad-id/messages")
        .set(auth())
        .send({ text: "hello" });
      expect(res.status).toBe(400);
    });

    it("400 — empty text", async () => {
      const res = await supertest(app())
        .post(`/api/chat/${SESSION_ID}/messages`)
        .set(auth())
        .send({ text: "" });
      expect(res.status).toBe(400);
    });

    it("400 — text too long (>1000 chars)", async () => {
      const res = await supertest(app())
        .post(`/api/chat/${SESSION_ID}/messages`)
        .set(auth())
        .send({ text: "x".repeat(1001) });
      expect(res.status).toBe(400);
    });

    it("404 — session not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await supertest(app())
        .post(`/api/chat/${SESSION_ID}/messages`)
        .set(auth())
        .send({ text: "hello" });
      expect(res.status).toBe(404);
    });

    it("502 — AI service failure is forwarded", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: SESSION_ID, messages: [] }],
      });

      mockChat.mockResolvedValueOnce({
        error: "AI service timed out — please try again",
      });

      const res = await supertest(app())
        .post(`/api/chat/${SESSION_ID}/messages`)
        .set(auth())
        .send({ text: "hello" });
      expect(res.status).toBe(502);
      expect(res.body.error).toMatch(/timed out/);
    });

    it("503 — AI not configured (no API key)", async () => {
      // Build app inline — passing `undefined` to the helper triggers the
      // default-parameter in JS, so we call createChatRouter directly.
      const noAiApp = express();
      noAiApp.use(express.json());
      noAiApp.use("/api/chat", createChatRouter(SECRET, undefined));

      const res = await supertest(noAiApp)
        .post(`/api/chat/${SESSION_ID}/messages`)
        .set(auth())
        .send({ text: "hello" });

      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/not configured/i);
    });

    it("stores both user and assistant messages after success", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: SESSION_ID, messages: [] }] })
        .mockResolvedValueOnce({ rows: [] });

      mockChat.mockResolvedValueOnce(aiSuccess);

      await supertest(app())
        .post(`/api/chat/${SESSION_ID}/messages`)
        .set(auth())
        .send({ text: "Book a haircut" })
        .expect(201);

      // Verify the UPDATE appended both user + assistant messages
      const updateCall = mockQuery.mock.calls[1];
      const appended = JSON.parse(updateCall[1][0] as string);
      expect(appended).toHaveLength(2);
      expect(appended[0].role).toBe("user");
      expect(appended[0].content).toBe("Book a haircut");
      expect(appended[1].role).toBe("assistant");
      expect(appended[1].content).toBe(aiSuccess.message);
    });
  });

  // ── DELETE /api/chat/:sessionId ───────────────────────────────────

  describe("DELETE /api/chat/:sessionId", () => {
    it("200 — deletes session", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: SESSION_ID }] });

      const res = await supertest(app())
        .delete(`/api/chat/${SESSION_ID}`)
        .set(auth());
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(true);
    });

    it("400 — invalid UUID", async () => {
      const res = await supertest(app())
        .delete("/api/chat/bad-id")
        .set(auth());
      expect(res.status).toBe(400);
    });

    it("404 — session not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await supertest(app())
        .delete(`/api/chat/${SESSION_ID}`)
        .set(auth());
      expect(res.status).toBe(404);
    });
  });
});
