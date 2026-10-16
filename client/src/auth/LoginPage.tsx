import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import type { FormState } from "./auth.types.ts";
import { useAuth } from "./auth.context.tsx";
import "./auth-form.css";

export default function LoginPage() {
  const { auth, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [form, setForm] = useState<FormState>({ status: "idle" });

  if (auth.status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  const submitting = form.status === "submitting";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setForm({ status: "submitting" });

    const error = await login(email, password);
    if (error) {
      setForm({ status: "error", message: error });
    }
  }

  return (
    <form className="auth-form" onSubmit={(e) => void handleSubmit(e)}>
      <h2>Sign in</h2>

      {form.status === "error" && (
        <p className="auth-form__error" role="alert">{form.message}</p>
      )}

      <div className="auth-form__field">
        <label className="auth-form__label" htmlFor="login-email">Email</label>
        <input
          id="login-email"
          className="auth-form__input"
          type="email"
          autoComplete="email"
          required
          disabled={submitting}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="auth-form__field">
        <label className="auth-form__label" htmlFor="login-password">Password</label>
        <input
          id="login-password"
          className="auth-form__input"
          type="password"
          autoComplete="current-password"
          required
          disabled={submitting}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <button className="auth-form__submit" type="submit" disabled={submitting}>
        {submitting ? "Signing in…" : "Sign in"}
      </button>

      <p className="auth-form__link">
        Don&apos;t have an account? <Link to="/register">Create one</Link>
      </p>
    </form>
  );
}
