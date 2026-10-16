import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { API_BASE_URL } from "./api/api.client.ts";
import { useAuth } from "./auth/auth.context.tsx";
import ProtectedRoute from "./auth/ProtectedRoute.tsx";
import LoginPage from "./auth/LoginPage.tsx";
import RegisterPage from "./auth/RegisterPage.tsx";
import ChatPage from "./chat/ChatPage.tsx";
import "./App.css";

type HealthState =
  | { kind: "loading" }
  | { kind: "ok"; payload: HealthResponse }
  | { kind: "error"; message: string };

type HealthResponse = {
  status: string;
  service: string;
  timestamp: string;
};

function Dashboard() {
  const { auth, logout } = useAuth();
  const [health, setHealth] = useState<HealthState>({ kind: "loading" });

  const userName = auth.status === "authenticated" ? auth.user.name : "";

  const checkHealth = useCallback(async (signal?: AbortSignal) => {
    setHealth({ kind: "loading" });
    const url = `${API_BASE_URL}/api/health`;

    try {
      const response = await fetch(url, { signal });

      if (!response.ok) {
        setHealth({
          kind: "error",
          message: `Backend returned ${response.status} ${response.statusText}`,
        });
        return;
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        setHealth({
          kind: "error",
          message: "Backend response was not valid JSON",
        });
        return;
      }

      if (
        typeof data !== "object" ||
        data === null ||
        !("status" in data) ||
        typeof (data as HealthResponse).status !== "string"
      ) {
        setHealth({
          kind: "error",
          message: "Backend health payload was unexpected",
        });
        return;
      }

      setHealth({ kind: "ok", payload: data as HealthResponse });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const message =
        err instanceof TypeError
          ? `Cannot reach backend at ${url}. Is the server running?`
          : err instanceof Error
            ? err.message
            : "Unknown error while checking backend health";
      setHealth({ kind: "error", message });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void checkHealth(controller.signal);
    return () => controller.abort();
  }, [checkHealth]);

  return (
    <main className="app">
      <header className="app__header">
        <h1>Appointment Booking</h1>
        <p className="app__subtitle">
          Welcome, {userName}
        </p>
        <div className="app__actions">
          <Link to="/chat" className="app__chat-link">Book an appointment</Link>
          <button type="button" className="app__logout" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <section className="card" aria-live="polite">
        <h2>Backend status</h2>
        {health.kind === "loading" && <p className="status status--loading">Checking…</p>}
        {health.kind === "ok" && (
          <>
            <p className="status status--ok">Available</p>
            <dl className="details">
              <div>
                <dt>Service</dt>
                <dd>{health.payload.service}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{health.payload.status}</dd>
              </div>
              <div>
                <dt>Timestamp</dt>
                <dd>{health.payload.timestamp}</dd>
              </div>
              <div>
                <dt>API base URL</dt>
                <dd>{API_BASE_URL}</dd>
              </div>
            </dl>
          </>
        )}
        {health.kind === "error" && (
          <>
            <p className="status status--error">Unavailable</p>
            <p className="error-message" role="alert">
              {health.message}
            </p>
          </>
        )}
        <button type="button" className="retry" onClick={() => void checkHealth()}>
          Retry
        </button>
      </section>
    </main>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/chat"
        element={
          <ProtectedRoute>
            <ChatPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
