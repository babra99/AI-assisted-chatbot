import dotenv from "dotenv";

dotenv.config();

export type Env = {
  NODE_ENV: string;
  PORT: number;
  CLIENT_ORIGIN: string;
  JWT_SECRET: string;
  MISTRAL_API_KEY: string | undefined;
};

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return port;
}

export function loadEnv(): Env {
  const NODE_ENV = process.env.NODE_ENV ?? "development";
  const PORT = parsePort(process.env.PORT, 3001);
  const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";

  const JWT_SECRET = process.env.JWT_SECRET?.trim();
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is required — set it in server/.env");
  }

  if (NODE_ENV === "production" && JWT_SECRET.length < 32) {
    console.warn(
      "[security] JWT_SECRET is shorter than 32 characters — use a long random string in production",
    );
  }

  const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY?.trim() || undefined;

  return { NODE_ENV, PORT, CLIENT_ORIGIN, JWT_SECRET, MISTRAL_API_KEY };
}
