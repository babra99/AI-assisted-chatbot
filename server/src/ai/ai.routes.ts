import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { logAiRequest, logAiResult } from "../middleware/logger.js";
import {
  interpretAppointmentRequest,
  type InterpretResult,
} from "./ai.service.js";

export function createAiRouter(
  jwtSecret: string,
  mistralApiKey: string | undefined,
): Router {
  const router = Router();

  router.use(requireAuth(jwtSecret));

  // AI calls are expensive — tighter rate limit.
  const aiLimiter = rateLimit({
    name: "ai",
    windowMs: 60_000, // 1 minute
    max: 10,          // 10 requests per minute
  });

  // POST /api/ai/interpret — parse natural language into appointment fields
  router.post("/interpret", aiLimiter, async (req, res) => {
    if (!mistralApiKey) {
      res.status(503).json({ error: "AI service not configured" });
      return;
    }

    const { text } = req.body;

    if (typeof text !== "string" || text.trim().length === 0) {
      res.status(400).json({ error: "text is required" });
      return;
    }

    if (text.length > 1000) {
      res.status(400).json({ error: "text must be 1000 characters or fewer" });
      return;
    }

    const userId = req.user!.sub;
    logAiRequest("interpret", userId, text.trim().length);

    const start = Date.now();
    const result = await interpretAppointmentRequest(mistralApiKey, text.trim());
    const durationMs = Date.now() - start;

    if ("error" in result) {
      logAiResult("interpret", userId, false, durationMs, result.error);
      res.status(502).json({ error: result.error });
      return;
    }

    logAiResult("interpret", userId, true, durationMs);
    res.json(result satisfies InterpretResult);
  });

  return router;
}
