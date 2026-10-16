/**
 * Mistral AI service for interpreting natural-language appointment requests.
 *
 * Responsibilities:
 *   - Call Mistral chat-completions API
 *   - Extract structured fields (service_name, appointment_date, appointment_time)
 *   - Validate model output against the appointment schema
 *   - Handle API errors, timeouts, and malformed responses
 *
 * This module never touches the database.  The caller decides whether
 * to create an appointment from the returned data.
 */

const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_MODEL = "mistral-small-latest";
const REQUEST_TIMEOUT_MS = 15_000;

// ── Types ────────────────────────────────────────────────────────────

export interface AppointmentExtraction {
  service_name?: string;
  appointment_date?: string; // YYYY-MM-DD
  appointment_time?: string; // HH:MM
}

export interface InterpretResult {
  appointment: AppointmentExtraction;
  message: string;
  missing_fields: string[];
}

export interface InterpretError {
  error: string;
}

export type InterpretOutcome = InterpretResult | InterpretError;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ── Validation helpers ───────────────────────────────────────────────

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^\d{2}:\d{2}$/;

function isValidDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_REGEX.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function isValidTime(v: unknown): v is string {
  if (typeof v !== "string" || !TIME_REGEX.test(v)) return false;
  const [h, m] = v.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

// ── Prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(today: string): string {
  return `You are an appointment booking assistant. Extract appointment details from the user's message and return ONLY a JSON object with these fields:

- "service_name": string — the service requested (e.g. "Haircut", "Dental Checkup", "Massage"). Use a short, capitalised label.
- "appointment_date": string — the date in YYYY-MM-DD format. Resolve relative dates (e.g. "tomorrow", "next Monday") using today's date: ${today}.
- "appointment_time": string — the time in HH:MM 24-hour format. Resolve "3 PM" to "15:00", etc.
- "message": string — a brief one-sentence confirmation of what you understood, or a follow-up question if any field is unclear.

Carry forward details from earlier messages in the conversation. If the user provided a service earlier, keep it. If they now add a date or time, include all known fields.
Omit a field (do not include it) if it has not been mentioned anywhere in the conversation. Never guess or fabricate values.
Return ONLY valid JSON. No markdown fences, no extra text.`;
}

// ── Validate & sanitise model output ─────────────────────────────────

export function validateExtraction(raw: unknown): InterpretResult {
  if (typeof raw !== "object" || raw === null) {
    return {
      appointment: {},
      message: "I couldn't understand that. Could you describe the appointment you'd like to book?",
      missing_fields: ["service_name", "appointment_date", "appointment_time"],
    };
  }

  const obj = raw as Record<string, unknown>;
  const appointment: AppointmentExtraction = {};
  const missing: string[] = [];

  // service_name
  if (typeof obj.service_name === "string" && obj.service_name.trim().length > 0) {
    appointment.service_name = obj.service_name.trim().slice(0, 255);
  } else {
    missing.push("service_name");
  }

  // appointment_date
  if (isValidDate(obj.appointment_date)) {
    appointment.appointment_date = obj.appointment_date;
  } else {
    missing.push("appointment_date");
  }

  // appointment_time
  if (isValidTime(obj.appointment_time)) {
    appointment.appointment_time = obj.appointment_time;
  } else {
    missing.push("appointment_time");
  }

  // message — use model's message if it provided one, otherwise generate one
  let message: string;
  if (typeof obj.message === "string" && obj.message.trim().length > 0) {
    message = obj.message.trim().slice(0, 500);
  } else if (missing.length === 0) {
    message = `Got it — ${appointment.service_name} on ${appointment.appointment_date} at ${appointment.appointment_time}.`;
  } else {
    message = `I still need: ${missing.join(", ")}. Could you provide ${missing.length === 1 ? "that" : "those"}?`;
  }

  return { appointment, message, missing_fields: missing };
}

// ── Shared Mistral API call ──────────────────────────────────────────

async function callMistral(
  apiKey: string,
  messages: { role: string; content: string }[],
): Promise<InterpretOutcome> {
  const body = JSON.stringify({
    model: MISTRAL_MODEL,
    messages,
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens: 256,
  });

  let response: Response;
  try {
    response = await fetch(MISTRAL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return { error: "AI service timed out — please try again" };
    }
    return { error: "Could not reach AI service" };
  }

  if (!response.ok) {
    const status = response.status;
    if (status === 401) return { error: "AI service authentication failed" };
    if (status === 429) return { error: "AI service rate-limited — please wait and retry" };
    return { error: `AI service returned status ${status}` };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { error: "AI service returned invalid response" };
  }

  // Extract the assistant's message content from the Mistral response
  const content = (json as Record<string, unknown> & {
    choices?: { message?: { content?: string } }[];
  })?.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    return { error: "AI service returned an empty response" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { error: "AI service returned malformed output" };
  }

  return validateExtraction(parsed);
}

// ── Single-shot interpretation ───────────────────────────────────────

export async function interpretAppointmentRequest(
  apiKey: string,
  text: string,
): Promise<InterpretOutcome> {
  const today = new Date().toISOString().slice(0, 10);

  return callMistral(apiKey, [
    { role: "system", content: buildSystemPrompt(today) },
    { role: "user", content: text },
  ]);
}

// ── Multi-turn chat ──────────────────────────────────────────────────

export async function chatAppointmentAssistant(
  apiKey: string,
  history: ChatMessage[],
): Promise<InterpretOutcome> {
  const today = new Date().toISOString().slice(0, 10);

  return callMistral(apiKey, [
    { role: "system", content: buildSystemPrompt(today) },
    ...history,
  ]);
}
