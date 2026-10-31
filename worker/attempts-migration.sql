CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, mission INTEGER NOT NULL, world TEXT NOT NULL, mode TEXT NOT NULL, code TEXT NOT NULL, output TEXT NOT NULL, success INTEGER NOT NULL, evidence TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS attempts_user_time ON attempts(user_id, created_at DESC);
