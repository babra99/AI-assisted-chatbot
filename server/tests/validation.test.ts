import { describe, it, expect } from "vitest";
import { isUUID } from "../src/middleware/validate.js";

describe("isUUID", () => {
  it("accepts valid v4 UUID", () => {
    expect(isUUID("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("accepts uppercase UUID", () => {
    expect(isUUID("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
  });

  it("rejects non-UUID string", () => {
    expect(isUUID("not-a-uuid")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isUUID("")).toBe(false);
  });

  it("rejects UUID with wrong length", () => {
    expect(isUUID("550e8400-e29b-41d4-a716-44665544000")).toBe(false); // too short
  });

  it("rejects undefined", () => {
    expect(isUUID(undefined)).toBe(false);
  });

  it("rejects arrays", () => {
    expect(isUUID(["550e8400-e29b-41d4-a716-446655440000"] as unknown as string)).toBe(false);
  });
});
