import { Router } from "express";
import { getPool } from "../config/database.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { isUUID } from "../middleware/validate.js";
import { logAiRequest, logAiResult, safeErrorMessage } from "../middleware/logger.js";
import {
  chatAppointmentAssistant,
  type ChatMessage,
  type InterpretResult,
} from "../ai/ai.service.js";

/** Max conversation turns (user+assistant pairs) kept in context. */
const MAX_HISTORY_TURNS = 20;

/** Max length of a single user message. */
const MAX_MESSAGE_LENGTH = 1000;

interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
}

export function createChatRouter(
  jwtSecret: string,
  mistralApiKey: string | undefined,
): Router {
  const router = Router();

  router.use(requireAuth(jwtSecret));

  // Chat message sending is AI-backed — tighter rate limit.
  const chatLimiter = rateLimit({
    name: "chat",
    windowMs: 60_000, // 1 minute
    max: 15,          // 15 requests per minute
  });

  // POST /api/chat — create a new chat session
  router.post("/", async (req, res) => {
    try {
      const pool = getPool();
      if (!pool) {
        res.status(503).json({ error: "Database not available" });
        return;
      }

      const result = await pool.query(
        `INSERT INTO chat_sessions (user_id)
         VALUES ($1)
         RETURNING id, user_id, messages, created_at, updated_at`,
        [req.user!.sub],
      );

      res.status(201).json({ session: result.rows[0] });
    } catch (err) {
      console.error("[chat] create session error:", safeErrorMessage(err));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/chat — list current user's chat sessions
  router.get("/", async (req, res) => {
    try {
      const pool = getPool();
      if (!pool) {
        res.status(503).json({ error: "Database not available" });
        return;
      }

      const result = await pool.query(
        `SELECT id, user_id, created_at, updated_at,
                jsonb_array_length(messages) AS message_count
         FROM chat_sessions
         WHERE user_id = $1
         ORDER BY updated_at DESC`,
        [req.user!.sub],
      );

      res.json({ sessions: result.rows });
    } catch (err) {
      console.error("[chat] list sessions error:", safeErrorMessage(err));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/chat/:sessionId — get a session with full message history
  router.get("/:sessionId", async (req, res) => {
    try {
      if (!isUUID(req.params.sessionId)) {
        res.status(400).json({ error: "Invalid session ID format" });
        return;
      }

      const pool = getPool();
      if (!pool) {
        res.status(503).json({ error: "Database not available" });
        return;
      }

      const result = await pool.query(
        `SELECT id, user_id, messages, created_at, updated_at
         FROM chat_sessions
         WHERE id = $1 AND user_id = $2`,
        [req.params.sessionId, req.user!.sub],
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "Chat session not found" });
        return;
      }

      res.json({ session: result.rows[0] });
    } catch (err) {
      console.error("[chat] get session error:", safeErrorMessage(err));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/chat/:sessionId/messages — send a message and get AI response
  router.post("/:sessionId/messages", chatLimiter, async (req, res) => {
    try {
      if (!isUUID(req.params.sessionId)) {
        res.status(400).json({ error: "Invalid session ID format" });
        return;
      }

      if (!mistralApiKey) {
        res.status(503).json({ error: "AI service not configured" });
        return;
      }

      const { text } = req.body;

      if (typeof text !== "string" || text.trim().length === 0) {
        res.status(400).json({ error: "text is required" });
        return;
      }

      if (text.length > MAX_MESSAGE_LENGTH) {
        res
          .status(400)
          .json({ error: `text must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
        return;
      }

      const pool = getPool();
      if (!pool) {
        res.status(503).json({ error: "Database not available" });
        return;
      }

      const userId = req.user!.sub;

      // Load session (ownership check)
      const sessionResult = await pool.query(
        `SELECT id, messages FROM chat_sessions
         WHERE id = $1 AND user_id = $2`,
        [req.params.sessionId, userId],
      );

      if (sessionResult.rows.length === 0) {
        res.status(404).json({ error: "Chat session not found" });
        return;
      }

      const existingMessages: StoredMessage[] = sessionResult.rows[0].messages;
      const userMessage = text.trim();
      const now = new Date().toISOString();

      // Build conversation history for the AI (role + content only, no timestamps)
      const history: ChatMessage[] = existingMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      history.push({ role: "user", content: userMessage });

      // Trim to last N turns to stay within token limits
      const maxMessages = MAX_HISTORY_TURNS * 2;
      const trimmedHistory =
        history.length > maxMessages
          ? history.slice(history.length - maxMessages)
          : history;

      // Call AI
      logAiRequest("chat", userId, userMessage.length);
      const start = Date.now();
      const aiResult = await chatAppointmentAssistant(
        mistralApiKey,
        trimmedHistory,
      );
      const durationMs = Date.now() - start;

      if ("error" in aiResult) {
        logAiResult("chat", userId, false, durationMs, aiResult.error);
        res.status(502).json({ error: aiResult.error });
        return;
      }

      logAiResult("chat", userId, true, durationMs);

      // Build new messages to append
      const newUserMsg: StoredMessage = {
        role: "user",
        content: userMessage,
        at: now,
      };
      const newAssistantMsg: StoredMessage = {
        role: "assistant",
        content: aiResult.message,
        at: new Date().toISOString(),
      };

      // Append both messages atomically
      await pool.query(
        `UPDATE chat_sessions
         SET messages = messages || $1::jsonb
         WHERE id = $2 AND user_id = $3`,
        [JSON.stringify([newUserMsg, newAssistantMsg]), req.params.sessionId, userId],
      );

      const reply: InterpretResult & { ready: boolean } = {
        ...aiResult,
        ready: aiResult.missing_fields.length === 0,
      };

      res.status(201).json({ reply });
    } catch (err) {
      console.error("[chat] message error:", safeErrorMessage(err));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // DELETE /api/chat/:sessionId — delete a chat session
  router.delete("/:sessionId", async (req, res) => {
    try {
      if (!isUUID(req.params.sessionId)) {
        res.status(400).json({ error: "Invalid session ID format" });
        return;
      }

      const pool = getPool();
      if (!pool) {
        res.status(503).json({ error: "Database not available" });
        return;
      }

      const result = await pool.query(
        `DELETE FROM chat_sessions
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [req.params.sessionId, req.user!.sub],
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "Chat session not found" });
        return;
      }

      res.json({ deleted: true });
    } catch (err) {
      console.error("[chat] delete session error:", safeErrorMessage(err));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
