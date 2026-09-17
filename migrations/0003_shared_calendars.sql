-- Add shared calendars only. Existing tables and rows are preserved.
CREATE TABLE IF NOT EXISTS as_events (
  id TEXT PRIMARY KEY NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  yard TEXT NOT NULL DEFAULT '',
  hull_no TEXT NOT NULL DEFAULT '',
  as_type TEXT NOT NULL DEFAULT '',
  as_detail TEXT NOT NULL DEFAULT '',
  worker_info TEXT NOT NULL DEFAULT '',
  car_info TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS team_events (
  id TEXT PRIMARY KEY NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  start_time TEXT NOT NULL DEFAULT '',
  end_time TEXT NOT NULL DEFAULT '',
  team_type TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  members TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS as_events_start_date ON as_events(start_date, end_date);
CREATE INDEX IF NOT EXISTS team_events_start_date ON team_events(start_date, start_time);
