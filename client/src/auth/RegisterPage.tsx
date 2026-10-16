import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import type { FormState } from "./auth.types.ts";
import { useAuth } from "./auth.context.tsx";
import "./auth-form.css";

export default function RegisterPage() {
  const { auth, register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [form, setForm] = useState<FormState>({ status: "idle" });

  if (auth.status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  const submitting = form.status === "submitting";

  function validate(): string | null {
    if (!name.trim()) return "Name is required";
    if (password.length < 8) return "Password must be at least 8 characters";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const validationError = validate();
    if (validationError) {
      setForm({ status: "error", message: validationError });
      return;
    }

    setForm({ status: "submitting" });

    const error = await register(name.trim(), email, password);
    if (error) {
      setForm({ status: "error", message: error });
    }
  }

  return (
    <form className="auth-form" onSubmit={(e) => void handleSubmit(e)}>
      <h2>Create account</h2>

      {form.status === "error" && (
        <p className="auth-form__error" role="alert">{form.message}</p>
      )}

      <div className="auth-form__field">
        <label className="auth-form__label" htmlFor="register-name">Name</label>
        <input
          id="register-name"
          className="auth-form__input"
          type="text"
          autoComplete="name"
          required
          disabled={submitting}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="auth-form__field">
        <label className="auth-form__label" htmlFor="register-email">Email</label>
        <input
          id="register-email"
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
        <label className="auth-form__label" htmlFor="register-password">Password</label>
        <input
          id="register-password"
          className="auth-form__input"
          type="password"
          autoComplete="new-password"
          required
          disabled={submitting}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <button className="auth-form__submit" type="submit" disabled={submitting}>
        {submitting ? "Creating account…" : "Create account"}
      </button>

      <p className="auth-form__link">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </form>
  );
}
