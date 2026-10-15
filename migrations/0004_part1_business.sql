-- Additive only; no seed staff, vehicles, samples or historical-data import.
ALTER TABLE issues ADD COLUMN yard TEXT NOT NULL DEFAULT '';
ALTER TABLE issues ADD COLUMN hull_no TEXT NOT NULL DEFAULT '';
ALTER TABLE issues ADD COLUMN product_no TEXT NOT NULL DEFAULT '';
ALTER TABLE issues ADD COLUMN remark TEXT NOT NULL DEFAULT '';
ALTER TABLE issues ADD COLUMN part TEXT NOT NULL DEFAULT '';
ALTER TABLE issues ADD COLUMN factory TEXT NOT NULL DEFAULT '';

CREATE TABLE weekly_issues (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), day TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX weekly_issues_day ON weekly_issues(day);
CREATE TABLE safety_checks (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), day TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX safety_checks_day ON safety_checks(day);
CREATE TABLE meal_people (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), day TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE vehicles (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), day TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX vehicle_number ON vehicles(json_extract(data,'$.number'));
CREATE TABLE notices (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), day TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE vehicle_bookings (
  id TEXT PRIMARY KEY, vehicle_id TEXT NOT NULL REFERENCES vehicles(id), day TEXT NOT NULL,
  start_time TEXT NOT NULL, end_time TEXT NOT NULL, owner TEXT NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data)), cancelled INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK(start_time < end_time)
);
CREATE INDEX booking_vehicle_day ON vehicle_bookings(vehicle_id,day,cancelled,start_time,end_time);
-- SQLite serializes writes; triggers cover inserts and updates across concurrent requests.
CREATE TRIGGER booking_no_overlap_insert BEFORE INSERT ON vehicle_bookings WHEN NEW.cancelled=0 BEGIN
  SELECT RAISE(ABORT,'BOOKING_CONFLICT') WHERE EXISTS(SELECT 1 FROM vehicle_bookings WHERE vehicle_id=NEW.vehicle_id AND day=NEW.day AND cancelled=0 AND start_time<NEW.end_time AND end_time>NEW.start_time AND id<>NEW.id);
END;
CREATE TRIGGER booking_no_overlap_update BEFORE UPDATE ON vehicle_bookings WHEN NEW.cancelled=0 BEGIN
  SELECT RAISE(ABORT,'BOOKING_CONFLICT') WHERE EXISTS(SELECT 1 FROM vehicle_bookings WHERE vehicle_id=NEW.vehicle_id AND day=NEW.day AND cancelled=0 AND start_time<NEW.end_time AND end_time>NEW.start_time AND id<>NEW.id);
END;
CREATE TABLE meals (
  person_id TEXT NOT NULL REFERENCES meal_people(id), day TEXT NOT NULL,
  breakfast INTEGER NOT NULL DEFAULT 0 CHECK(breakfast IN(0,1)), lunch INTEGER NOT NULL DEFAULT 0 CHECK(lunch IN(0,1)), dinner INTEGER NOT NULL DEFAULT 0 CHECK(dinner IN(0,1)),
  revision INTEGER NOT NULL DEFAULT 1, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(person_id, day)
);
CREATE TABLE business_write_guards (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE meal_menus (id TEXT PRIMARY KEY, week_start TEXT NOT NULL, file_key TEXT UNIQUE NOT NULL, owner TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX meal_menu_week ON meal_menus(week_start,created_at);
CREATE TABLE plan_imports (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN('production','supplies')),
  owner TEXT NOT NULL, filename TEXT NOT NULL, file_key TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL,
  row_count INTEGER NOT NULL, staged_data TEXT NOT NULL CHECK(json_valid(staged_data)),
  status TEXT NOT NULL DEFAULT 'preview' CHECK(status IN('preview','applied')),
  created_at TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE production_rows (id TEXT PRIMARY KEY, import_id TEXT NOT NULL REFERENCES plan_imports(id), row_number INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(import_id,row_number));
CREATE UNIQUE INDEX applied_import_hash ON plan_imports(kind,sha256) WHERE status='applied';
CREATE TABLE supply_items (id TEXT PRIMARY KEY, import_id TEXT NOT NULL REFERENCES plan_imports(id), row_number INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(import_id,row_number));
CREATE TABLE supply_orders (id TEXT PRIMARY KEY, owner TEXT NOT NULL, applicant TEXT NOT NULL, department TEXT NOT NULL, purpose TEXT NOT NULL, lines TEXT NOT NULL CHECK(json_valid(lines)), created_at TEXT NOT NULL);
