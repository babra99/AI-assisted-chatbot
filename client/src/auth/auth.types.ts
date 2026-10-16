export type User = {
  id: string;
  name: string;
  email: string;
};

export type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; user: User };

export type FormState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string };

export type LoginResponse = {
  token: string;
  user: User;
};

export type RegisterResponse = {
  token: string;
  user: User;
};

export type MeResponse = User;
