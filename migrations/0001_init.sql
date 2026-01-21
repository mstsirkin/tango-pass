PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lots (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id),
  purchased_at DATETIME NOT NULL,
  validity_months INTEGER NOT NULL CHECK (validity_months IN (1, 3)),
  expires_at DATETIME NOT NULL,
  credits_total INTEGER NOT NULL,
  credits_remaining INTEGER NOT NULL,
  CHECK (credits_total >= 0),
  CHECK (credits_remaining >= 0)
);

CREATE INDEX IF NOT EXISTS idx_lots_student_expires
  ON lots(student_id, expires_at, purchased_at);

CREATE TABLE IF NOT EXISTS lesson_events (
  id INTEGER PRIMARY KEY,
  starts_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lesson_events_starts
  ON lesson_events(starts_at);

CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id),
  lesson_id INTEGER NOT NULL REFERENCES lesson_events(id),
  consumed_lot_id INTEGER NOT NULL REFERENCES lots(id),
  registered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_registrations_lesson
  ON registrations(lesson_id);

CREATE TABLE IF NOT EXISTS ledger_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  ts DATETIME NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('PURCHASE', 'REGISTER', 'EXPIRE', 'ADJUST', 'EXTEND', 'OLDEST')),
  delta_credits INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  ref_lot_id INTEGER REFERENCES lots(id),
  ref_lesson_id INTEGER REFERENCES lesson_events(id)
);

CREATE INDEX IF NOT EXISTS idx_ledger_events_student
  ON ledger_events(student_id, id);

CREATE TRIGGER IF NOT EXISTS ledger_events_no_update
  BEFORE UPDATE ON ledger_events
BEGIN
  SELECT RAISE(ABORT, 'ledger_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS ledger_events_no_delete
  BEFORE DELETE ON ledger_events
BEGIN
  SELECT RAISE(ABORT, 'ledger_events is append-only');
END;
