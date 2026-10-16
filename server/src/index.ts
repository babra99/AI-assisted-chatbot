import cors from "cors";
import express from "express";
import { createAiRouter } from "./ai/ai.routes.js";
import { createAppointmentsRouter } from "./appointments/appointments.routes.js";
import { createAuthRouter } from "./auth/auth.routes.js";
import { createChatRouter } from "./chat/chat.routes.js";
import { checkDatabaseHealth } from "./config/database.js";
import { loadEnv } from "./config/env.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { safeErrorMessage } from "./middleware/logger.js";

const env = loadEnv();

const app = express();

// --- Global middleware ---

app.use(
  cors({
    origin: env.CLIENT_ORIGIN,
    credentials: true,
  }),
);

// Limit request body size to prevent oversized payload attacks.
app.use(express.json({ limit: "100kb" }));

// Broad rate limit: 200 requests per minute per IP across all endpoints.
app.use(
  rateLimit({ name: "global", windowMs: 60_000, max: 200 }),
);

// --- Routes ---

app.use("/api/auth", createAuthRouter(env.JWT_SECRET));
app.use("/api/appointments", createAppointmentsRouter(env.JWT_SECRET));
app.use("/api/ai", createAiRouter(env.JWT_SECRET, env.MISTRAL_API_KEY));
app.use("/api/chat", createChatRouter(env.JWT_SECRET, env.MISTRAL_API_KEY));

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "appointment-booking-api",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/health/db", async (_req, res) => {
  const dbHealth = await checkDatabaseHealth();
  if (dbHealth.ok) {
    res.json({
      status: "ok",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  res.status(503).json({
    status: "unavailable",
    database: dbHealth.reason,
    message: dbHealth.message,
    timestamp: new Date().toISOString(),
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler — sanitise before logging; never expose internals.
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[error] unhandled:", safeErrorMessage(err));
    res.status(500).json({ error: "Internal server error" });
  },
);

app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});
