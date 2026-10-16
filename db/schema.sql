-- AI-assisted appointment booking — PostgreSQL schema
-- Safe to run on a fresh database. Uses IF NOT EXISTS for idempotent local setup.
-- Requires PostgreSQL 13+ (gen_random_uuid()).

-- ---------------------------------------------------------------------------
-- users: authentication and profile (password stored as hash only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_email_unique UNIQUE (email)
);

COMMENT ON TABLE users IS 'Registered accounts; email is the natural login identifier.';
COMMENT ON COLUMN users.password_hash IS 'bcrypt (or compatible) hash — never store plaintext passwords.';

-- ---------------------------------------------------------------------------
-- appointments: bookings owned by a user
-- ON DELETE CASCADE: removing a user removes their appointments (assessment scope).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  service_name VARCHAR(255) NOT NULL,
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT appointments_status_check CHECK (
    status IN ('pending', 'confirmed', 'cancelled')
  )
);

COMMENT ON TABLE appointments IS 'Scheduled services; status drives workflow (pending → confirmed/cancelled).';
COMMENT ON COLUMN appointments.appointment_date IS 'Local calendar date for the booking (timezone rules belong in app layer).';

CREATE INDEX IF NOT EXISTS idx_appointments_user_id
  ON appointments (user_id);

CREATE INDEX IF NOT EXISTS idx_appointments_user_date
  ON appointments (user_id, appointment_date);

-- ---------------------------------------------------------------------------
-- chat_sessions: one conversation thread per user (JSONB message array)
-- Messages shape is enforced in application code; JSONB allows flexible turns
-- (role, content, timestamps) without a separate messages table for the prototype.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE chat_sessions IS 'Conversation history for AI-assisted booking; messages updated in place.';
COMMENT ON COLUMN chat_sessions.messages IS 'Array of message objects, e.g. [{ "role": "user", "content": "...", "at": "..." }].';

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id
  ON chat_sessions (user_id);

-- Optional GIN index if querying inside JSONB later (commented to keep prototype minimal):
-- CREATE INDEX IF NOT EXISTS idx_chat_sessions_messages_gin ON chat_sessions USING GIN (messages);

-- ---------------------------------------------------------------------------
-- updated_at maintenance for mutable tables
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointments_set_updated_at ON appointments;
CREATE TRIGGER appointments_set_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS chat_sessions_set_updated_at ON chat_sessions;
CREATE TRIGGER chat_sessions_set_updated_at
  BEFORE UPDATE ON chat_sessions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
