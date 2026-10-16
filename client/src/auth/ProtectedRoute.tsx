import { Navigate } from "react-router-dom";
import { useAuth } from "./auth.context.tsx";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { auth } = useAuth();

  if (auth.status === "loading") {
    return <p className="status status--loading">Loading…</p>;
  }

  if (auth.status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }

  return children;
}
