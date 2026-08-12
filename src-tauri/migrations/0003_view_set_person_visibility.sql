ALTER TABLE view_set_people
ADD COLUMN is_visible INTEGER NOT NULL DEFAULT 1
CHECK (is_visible IN (0, 1));
