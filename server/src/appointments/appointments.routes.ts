import { Router } from "express";
import { getPool } from "../config/database.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { isUUID } from "../middleware/validate.js";
import { safeErrorMessage } from "../middleware/logger.js";

const VALID_STATUSES = ["pending", "confirmed", "cancelled"] as const;
const MAX_SERVICE_NAME_LENGTH = 255;

/** HH:MM or HH:MM:SS, 24-hour */
const TIME_REGEX = /^\d{2}:\d{2}(:\d{2})?$/;

/** YYYY-MM-DD */
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Columns returned for every appointment response.
 * DATE and TIME are cast to text so pg doesn't convert them to JS Date objects
 * (which would shift dates across timezone boundaries).
 */
const RETURNING_COLS =
  "id, user_id, service_name, appointment_date::text AS appointment_date, appointment_time::text AS appointment_time, status, created_at, updated_at";

function isValidDate(value: string): boolean {
  if (!DATE_REGEX.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function isValidTime(value: string): boolean {
  if (!TIME_REGEX.test(value)) return false;
  const [h, m, s] = value.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59 && (s === undefined || (s >= 0 && s <= 59));
}

function isPast(date: string, time: string): boolean {
  const now = new Date();
  const appointment = new Date(`${date}T${time}`);
  return appointment < now;
}

export function createAppointmentsRouter(jwtSecret: string): Router {
  const router = Router();

  // All routes require authentication
  router.use(requireAuth(jwtSecret));

  // POST /api/appointments — create
  router.post("/", async (req, res) => {
    try {
      const { service_name, appointment_date, appointment_time } = req.body;

      if (!service_name || !appointment_date || !appointment_time) {
        res.status(400).json({
          error: "service_name, appointment_date, and appointment_time are required",
        });
        return;
      }

      if (typeof service_name !== "string" || service_name.trim().length === 0) {
        res.status(400).json({ error: "service_name must be a non-empty string" });
        return;
      }

      if (service_name.trim().length > MAX_SERVICE_NAME_LENGTH) {
        res.status(400).json({ error: `service_name must be ${MAX_SERVICE_NAME_LENGTH} characters or fewer` });
        return;
      }

      if (typeof appointment_date !== "string" || !isValidDate(appointment_date)) {
        res.status(400).json({ error: "appointment_date must be a valid date (YYYY-MM-DD)" });
        return;
      }

      if (typeof appointment_time !== "string" || !isValidTime(appointment_time)) {
        res.status(400).json({ error: "appointment_time must be a valid time (HH:MM)" });
        return;
      }

      if (isPast(appointment_date, appointment_time)) {
        res.status(400).json({ error: "Cannot book an appointment in the past" });
        return;
      }

      const pool = getPool();
      if (!pool) {
        res.status(503).json({ error: "Database not available" });
        return;
      }

      const userId = req.user!.sub;

      // Prevent duplicate booking at the same date+time for this user
      const duplicate = await pool.query(
        `SELECT id FROM appointments
         WHERE user_id = $1 AND appointment_date = $2 AND appointment_time = $3
           AND status != 'cancelled'`,
        [userId, appointment_date, appointment_time],
      );
      if (duplicate.rows.length > 0) {
        res.status(409).json({ error: "You already have an appointment at this date and time" });
        return;
      }

      const result = await pool.query(
        `INSERT INTO appointments (user_id, service_name, appointment_date, appointment_time)
         VALUES ($1, $2, $3, $4)
         RETURNING ${RETURNING_COLS}`,
        [userId, service_name.trim(), appointment_date, appointment_time],
      );

      res.status(201).json({ appointment: result.rows[0] });
    } catch (err) {
      console.error("[appointments] create error:", safeErrorMessage(err));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/appointments — list current user's appointments
  router.get("/", async (req, res) => {
    try {
      const pool = getPool();
      if (!pool) {
        res.status(503).json({ error: "Database not available" });
        return;
      }

      const userId = req.user!.sub;
      const { status } = req.query;

      let query = `SELECT ${RETURNING_COLS} FROM appointments WHERE user_id = $1`;
      const params: unknown[] = [userId];

      if (typeof status === "string" && VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
        query += " AND status = $2";
        params.push(status);
      }

      query += " ORDER BY appointment_date ASC, appointment_time ASC";

      const result = await pool.query(query, params);
      res.json({ appointments: result.rows });
    } catch (err) {
      console.error("[appointments] list error:", safeErrorMessage(err));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/appointments/:id — single appointment detail
  router.get("/:id", async (req, res) => {
    try {
      if (!isUUID(req.params.id)) {
        res.status(400).json({ error: "Invalid appointment ID format" });
        return;
      }

      const pool = getPool();
      if (!pool) {
        res.status(503).json({ error: "Database not available" });
        return;
      }

      const result = await pool.query(
        `SELECT ${RETURNING_COLS} FROM appointments WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.user!.sub],
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "Appointment not found" });
        return;
      }

      res.json({ appointment: result.rows[0] });
    } catch (err) {
      console.error("[appointments] get error:", safeErrorMessage(err));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // PATCH /api/appointments/:id — update appointment details
  router.patch("/:id", async (req, res) => {
    try {
      if (!isUUID(req.params.id)) {
        res.status(400).json({ error: "Invalid appointment ID format" });
        return;
      }

      const pool = getPool();
      if (!pool) {
        res.status(503).json({ error: "Database not available" });
        return;
      }

      // Fetch current appointment (scoped to user), with date/time as text
      const current = await pool.query(
        `SELECT id, status, appointment_date::text AS appointment_date, appointment_time::text AS appointment_time
         FROM appointments WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.user!.sub],
      );

      if (current.rows.length === 0) {
        res.status(404).json({ error: "Appointment not found" });
        return;
      }

      if (current.rows[0].status === "cancelled") {
        res.status(400).json({ error: "Cannot update a cancelled appointment" });
        return;
      }

      const { service_name, appointment_date, appointment_time, status } = req.body;

      // Build SET clauses dynamically from provided fields
      const setClauses: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (service_name !== undefined) {
        if (typeof service_name !== "string" || service_name.trim().length === 0) {
          res.status(400).json({ error: "service_name must be a non-empty string" });
          return;
        }
        if (service_name.trim().length > MAX_SERVICE_NAME_LENGTH) {
          res.status(400).json({ error: `service_name must be ${MAX_SERVICE_NAME_LENGTH} characters or fewer` });
          return;
        }
        setClauses.push(`service_name = $${paramIndex++}`);
        values.push(service_name.trim());
      }

      if (appointment_date !== undefined) {
        if (typeof appointment_date !== "string" || !isValidDate(appointment_date)) {
          res.status(400).json({ error: "appointment_date must be a valid date (YYYY-MM-DD)" });
          return;
        }
        setClauses.push(`appointment_date = $${paramIndex++}`);
        values.push(appointment_date);
      }

      if (appointment_time !== undefined) {
        if (typeof appointment_time !== "string" || !isValidTime(appointment_time)) {
          res.status(400).json({ error: "appointment_time must be a valid time (HH:MM)" });
          return;
        }
        setClauses.push(`appointment_time = $${paramIndex++}`);
        values.push(appointment_time);
      }

      if (status !== undefined) {
        if (!VALID_STATUSES.includes(status)) {
          res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
          return;
        }
        setClauses.push(`status = $${paramIndex++}`);
        values.push(status);
      }

      if (setClauses.length === 0) {
        res.status(400).json({ error: "No valid fields to update" });
        return;
      }

      // If date or time is being changed, check the resulting combination isn't in the past
      if (appointment_date !== undefined || appointment_time !== undefined) {
        const checkDate = appointment_date ?? current.rows[0].appointment_date;
        const checkTime = appointment_time ?? current.rows[0].appointment_time;

        if (isPast(checkDate, checkTime)) {
          res.status(400).json({ error: "Cannot reschedule to a past date/time" });
          return;
        }

        // Check for duplicate at new date+time (excluding this appointment)
        const duplicate = await pool.query(
          `SELECT id FROM appointments
           WHERE user_id = $1 AND appointment_date = $2 AND appointment_time = $3
             AND status != 'cancelled' AND id != $4`,
          [req.user!.sub, checkDate, checkTime, req.params.id],
        );
        if (duplicate.rows.length > 0) {
          res.status(409).json({ error: "You already have an appointment at this date and time" });
          return;
        }
      }

      values.push(req.params.id, req.user!.sub);
      const idParam = paramIndex++;
      const userParam = paramIndex++;

      const result = await pool.query(
        `UPDATE appointments SET ${setClauses.join(", ")}
         WHERE id = $${idParam} AND user_id = $${userParam}
         RETURNING ${RETURNING_COLS}`,
        values,
      );

      res.json({ appointment: result.rows[0] });
    } catch (err) {
      console.error("[appointments] update error:", safeErrorMessage(err));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // PATCH /api/appointments/:id/cancel — cancel an appointment
  router.patch("/:id/cancel", async (req, res) => {
    try {
      if (!isUUID(req.params.id)) {
        res.status(400).json({ error: "Invalid appointment ID format" });
        return;
      }

      const pool = getPool();
      if (!pool) {
        res.status(503).json({ error: "Database not available" });
        return;
      }

      const current = await pool.query(
        "SELECT id, status FROM appointments WHERE id = $1 AND user_id = $2",
        [req.params.id, req.user!.sub],
      );

      if (current.rows.length === 0) {
        res.status(404).json({ error: "Appointment not found" });
        return;
      }

      if (current.rows[0].status === "cancelled") {
        res.status(400).json({ error: "Appointment is already cancelled" });
        return;
      }

      const result = await pool.query(
        `UPDATE appointments SET status = 'cancelled'
         WHERE id = $1 AND user_id = $2
         RETURNING ${RETURNING_COLS}`,
        [req.params.id, req.user!.sub],
      );

      res.json({ appointment: result.rows[0] });
    } catch (err) {
      console.error("[appointments] cancel error:", safeErrorMessage(err));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
