CREATE TYPE user_role AS ENUM ('owner', 'guardian', 'family');

CREATE TABLE users (
  id            uuid PRIMARY KEY,
  username      text NOT NULL,
  password_hash text NOT NULL,
  display_name  text NOT NULL,
  role          user_role NOT NULL,
  email         text,
  locale        text NOT NULL DEFAULT 'ko',
  created_at    timestamptz NOT NULL DEFAULT now(),
  disabled_at   timestamptz
);
CREATE UNIQUE INDEX users_username_lower_idx ON users (lower(username));

CREATE TABLE sessions (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

CREATE TABLE invites (
  id         uuid PRIMARY KEY,
  token_hash bytea NOT NULL UNIQUE,
  role       user_role NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_by    uuid REFERENCES users(id),
  used_at    timestamptz,
  revoked_at timestamptz
);

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
