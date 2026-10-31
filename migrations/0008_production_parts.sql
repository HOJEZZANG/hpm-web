-- Existing production uploads belong to part 1; other business records stay unchanged.
ALTER TABLE plan_imports ADD COLUMN production_part TEXT CHECK(production_part IS NULL OR (kind='production' AND production_part IN ('part1','part2')));
UPDATE plan_imports SET production_part='part1' WHERE kind='production' AND production_part IS NULL;
DROP INDEX applied_import_hash;
CREATE UNIQUE INDEX applied_import_hash ON plan_imports(kind,coalesce(production_part,''),sha256) WHERE status='applied';
CREATE INDEX production_latest_part ON plan_imports(production_part,status,applied_at DESC,created_at DESC,id DESC) WHERE kind='production';
-- An older Worker can still upload part 1 during a staged deployment.
CREATE TRIGGER production_part_legacy AFTER INSERT ON plan_imports WHEN NEW.kind='production' AND NEW.production_part IS NULL BEGIN UPDATE plan_imports SET production_part='part1' WHERE id=NEW.id; END;
CREATE TRIGGER production_part_immutable BEFORE UPDATE OF production_part ON plan_imports WHEN OLD.kind='production' AND OLD.production_part IS NOT NULL AND NEW.production_part IS NOT OLD.production_part BEGIN SELECT RAISE(ABORT,'production part immutable'); END;
