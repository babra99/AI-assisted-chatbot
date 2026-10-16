import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  interpretAppointmentRequest,
  chatAppointmentAssistant,
  validateExtraction,
} from "../src/ai/ai.service.js";

/** Build a mock Mistral JSON response wrapping the given object. */
function mistralResponse(content: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        choices: [{ message: { content: JSON.stringify(content) } }],
      }),
  };
}

describe("AI Service", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── interpretAppointmentRequest ───────────────────────────────────

  describe("interpretAppointmentRequest", () => {
    it("returns parsed extraction on success", async () => {
      mockFetch.mockResolvedValueOnce(
        mistralResponse({
          service_name: "Haircut",
          appointment_date: "2099-12-15",
          appointment_time: "10:00",
          message: "Got it!",
        }),
      );

      const result = await interpretAppointmentRequest("key", "Book a haircut Dec 15 10am");

      expect("error" in result).toBe(false);
      if (!("error" in result)) {
        expect(result.appointment.service_name).toBe("Haircut");
        expect(result.appointment.appointment_date).toBe("2099-12-15");
        expect(result.appointment.appointment_time).toBe("10:00");
        expect(result.missing_fields).toEqual([]);
      }
    });

    it("reports missing fields when extraction is partial", async () => {
      mockFetch.mockResolvedValueOnce(
        mistralResponse({
          service_name: "Haircut",
          message: "What date and time?",
        }),
      );

      const result = await interpretAppointmentRequest("key", "I want a haircut");

      expect("error" in result).toBe(false);
      if (!("error" in result)) {
        expect(result.appointment.service_name).toBe("Haircut");
        expect(result.missing_fields).toContain("appointment_date");
        expect(result.missing_fields).toContain("appointment_time");
      }
    });

    it("returns error on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network unreachable"));

      const result = await interpretAppointmentRequest("key", "hello");

      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toMatch(/could not reach/i);
      }
    });

    it("returns error on timeout", async () => {
      const err = new DOMException("Signal timed out", "TimeoutError");
      mockFetch.mockRejectedValueOnce(err);

      const result = await interpretAppointmentRequest("key", "hello");

      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toMatch(/timed out/i);
      }
    });

    it("returns error on 401 (auth failure)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const result = await interpretAppointmentRequest("bad-key", "hello");

      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toMatch(/authentication failed/i);
      }
    });

    it("returns error on 429 (rate limited)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
      });

      const result = await interpretAppointmentRequest("key", "hello");

      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toMatch(/rate-limited/i);
      }
    });

    it("returns error on malformed JSON in response body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error("invalid json")),
      });

      const result = await interpretAppointmentRequest("key", "hello");

      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toMatch(/invalid response/i);
      }
    });

    it("returns error when model output is not valid JSON", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: "this is not json" } }],
          }),
      });

      const result = await interpretAppointmentRequest("key", "hello");

      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toMatch(/malformed output/i);
      }
    });

    it("returns error when choices array is empty", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [] }),
      });

      const result = await interpretAppointmentRequest("key", "hello");

      expect("error" in result).toBe(true);
    });

    it("sends correct request to Mistral API", async () => {
      mockFetch.mockResolvedValueOnce(
        mistralResponse({ service_name: "Test", message: "ok" }),
      );

      await interpretAppointmentRequest("my-api-key", "hello");

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.mistral.ai/v1/chat/completions");
      expect(opts.method).toBe("POST");
      expect(opts.headers.Authorization).toBe("Bearer my-api-key");

      const body = JSON.parse(opts.body);
      expect(body.model).toBe("mistral-small-latest");
      expect(body.response_format).toEqual({ type: "json_object" });
      expect(body.messages).toHaveLength(2); // system + user
      expect(body.messages[1].content).toBe("hello");
    });
  });

  // ── chatAppointmentAssistant ──────────────────────────────────────

  describe("chatAppointmentAssistant", () => {
    it("passes conversation history with system prompt", async () => {
      mockFetch.mockResolvedValueOnce(
        mistralResponse({ service_name: "Haircut", message: "ok" }),
      );

      const history = [
        { role: "user" as const, content: "I want a haircut" },
        { role: "assistant" as const, content: "When?" },
        { role: "user" as const, content: "Tomorrow at 3pm" },
      ];

      await chatAppointmentAssistant("key", history);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // system + 3 history messages = 4 total
      expect(body.messages).toHaveLength(4);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[1].content).toBe("I want a haircut");
      expect(body.messages[2].content).toBe("When?");
      expect(body.messages[3].content).toBe("Tomorrow at 3pm");
    });

    it("propagates AI errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network down"));

      const result = await chatAppointmentAssistant("key", [
        { role: "user", content: "hello" },
      ]);

      expect("error" in result).toBe(true);
    });
  });

  // ── validateExtraction (pure function) ────────────────────────────

  describe("validateExtraction", () => {
    it("accepts valid complete extraction", () => {
      const result = validateExtraction({
        service_name: "Haircut",
        appointment_date: "2099-12-15",
        appointment_time: "10:00",
        message: "All good",
      });

      expect(result.appointment.service_name).toBe("Haircut");
      expect(result.missing_fields).toEqual([]);
    });

    it("reports missing fields for partial extraction", () => {
      const result = validateExtraction({
        service_name: "Haircut",
        message: "Need date and time",
      });

      expect(result.missing_fields).toContain("appointment_date");
      expect(result.missing_fields).toContain("appointment_time");
      expect(result.missing_fields).not.toContain("service_name");
    });

    it("rejects invalid date format", () => {
      const result = validateExtraction({
        service_name: "Haircut",
        appointment_date: "15-12-2099",
        appointment_time: "10:00",
      });

      expect(result.missing_fields).toContain("appointment_date");
    });

    it("rejects invalid calendar date (Feb 30)", () => {
      const result = validateExtraction({
        service_name: "Haircut",
        appointment_date: "2099-02-30",
        appointment_time: "10:00",
      });

      expect(result.missing_fields).toContain("appointment_date");
    });

    it("rejects invalid time format", () => {
      const result = validateExtraction({
        service_name: "Haircut",
        appointment_date: "2099-12-15",
        appointment_time: "25:00",
      });

      expect(result.missing_fields).toContain("appointment_time");
    });

    it("handles null input gracefully", () => {
      const result = validateExtraction(null);
      expect(result.missing_fields).toEqual([
        "service_name",
        "appointment_date",
        "appointment_time",
      ]);
    });

    it("handles non-object input", () => {
      const result = validateExtraction("not an object");
      expect(result.missing_fields).toHaveLength(3);
    });

    it("truncates overly long service_name to 255 chars", () => {
      const result = validateExtraction({
        service_name: "X".repeat(300),
        appointment_date: "2099-12-15",
        appointment_time: "10:00",
        message: "ok",
      });

      expect(result.appointment.service_name!.length).toBe(255);
    });

    it("generates message when model provides none", () => {
      const result = validateExtraction({
        service_name: "Haircut",
        appointment_date: "2099-12-15",
        appointment_time: "10:00",
      });

      // Auto-generated confirmation message
      expect(result.message).toContain("Haircut");
      expect(result.message).toContain("2099-12-15");
    });
  });
});
