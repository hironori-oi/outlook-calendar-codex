PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  department TEXT NOT NULL,
  role TEXT NOT NULL,
  location TEXT NOT NULL,
  mail TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'navy',
  presence TEXT NOT NULL DEFAULT 'online',
  search_text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'directory',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_people_department ON people(department);
CREATE INDEX IF NOT EXISTS idx_people_location ON people(location);
CREATE INDEX IF NOT EXISTS idx_people_source ON people(source);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  location TEXT NOT NULL,
  equipment TEXT NOT NULL,
  status TEXT NOT NULL,
  mail TEXT NOT NULL DEFAULT '',
  search_text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'directory',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rooms_location ON rooms(location);

CREATE TABLE IF NOT EXISTS view_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lens TEXT NOT NULL,
  availability TEXT NOT NULL,
  accent TEXT NOT NULL,
  slots_json TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS view_set_people (
  view_set_id TEXT NOT NULL REFERENCES view_sets(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (view_set_id, person_id)
);

CREATE TABLE IF NOT EXISTS view_set_rooms (
  view_set_id TEXT NOT NULL REFERENCES view_sets(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (view_set_id, room_id)
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  view_set_id TEXT NOT NULL REFERENCES view_sets(id) ON DELETE CASCADE,
  event_date TEXT NOT NULL,
  start_minutes INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  owner TEXT NOT NULL,
  room TEXT NOT NULL,
  resource_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'local',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_view_date ON calendar_events(view_set_id, event_date);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  item_count INTEGER NOT NULL DEFAULT 0,
  last_attempt TEXT,
  last_success TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  details_json TEXT NOT NULL DEFAULT '{}',
  error TEXT
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  added_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  disabled_count INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

WITH digits(d) AS (
  VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)
), sequence(n) AS (
  SELECT a.d + b.d * 10 + c.d * 100 + d.d * 1000 + e.d * 10000 + 1
  FROM digits a
  CROSS JOIN digits b
  CROSS JOIN digits c
  CROSS JOIN digits d
  CROSS JOIN digits e
  WHERE a.d + b.d * 10 + c.d * 100 + d.d * 1000 + e.d * 10000 < 30000
)
INSERT OR IGNORE INTO people (
  id, display_name, short_name, department, role, location, mail,
  color, presence, search_text, source
)
SELECT
  printf('demo-%05d', n),
  CASE n % 10
    WHEN 0 THEN '佐藤' WHEN 1 THEN '鈴木' WHEN 2 THEN '高橋'
    WHEN 3 THEN '田中' WHEN 4 THEN '伊藤' WHEN 5 THEN '渡辺'
    WHEN 6 THEN '山本' WHEN 7 THEN '中村' WHEN 8 THEN '小林'
    ELSE '加藤' END || ' 社員' || printf('%05d', n),
  CASE n % 10
    WHEN 0 THEN '佐' WHEN 1 THEN '鈴' WHEN 2 THEN '高'
    WHEN 3 THEN '田' WHEN 4 THEN '伊' WHEN 5 THEN '渡'
    WHEN 6 THEN '山' WHEN 7 THEN '中' WHEN 8 THEN '小'
    ELSE '加' END,
  CASE n % 8
    WHEN 0 THEN 'テクノロジー本部 / 開発1グループ'
    WHEN 1 THEN 'テクノロジー本部 / 開発2グループ'
    WHEN 2 THEN 'プロダクト本部 / プロダクト企画'
    WHEN 3 THEN '営業本部 / エンタープライズ営業'
    WHEN 4 THEN 'コーポレート本部 / 人事企画'
    WHEN 5 THEN 'デザイン本部 / UXデザイン'
    WHEN 6 THEN 'カスタマー本部 / サクセス'
    ELSE '事業推進室' END,
  CASE n % 6
    WHEN 0 THEN 'マネージャー' WHEN 1 THEN 'シニアスペシャリスト'
    WHEN 2 THEN 'プロダクトマネージャー' WHEN 3 THEN 'エンジニア'
    WHEN 4 THEN 'デザイナー' ELSE 'メンバー' END,
  CASE n % 5
    WHEN 0 THEN '東京本社' WHEN 1 THEN '大阪支社' WHEN 2 THEN '名古屋支社'
    WHEN 3 THEN '福岡支社' ELSE 'リモート' END,
  printf('employee%05d@example.jp', n),
  CASE n % 6
    WHEN 0 THEN 'blue' WHEN 1 THEN 'green' WHEN 2 THEN 'gold'
    WHEN 3 THEN 'coral' WHEN 4 THEN 'plum' ELSE 'navy' END,
  CASE n % 7 WHEN 0 THEN 'away' WHEN 1 THEN 'busy' ELSE 'online' END,
  lower(
    CASE n % 10
      WHEN 0 THEN '佐藤' WHEN 1 THEN '鈴木' WHEN 2 THEN '高橋'
      WHEN 3 THEN '田中' WHEN 4 THEN '伊藤' WHEN 5 THEN '渡辺'
      WHEN 6 THEN '山本' WHEN 7 THEN '中村' WHEN 8 THEN '小林'
      ELSE '加藤' END || ' 社員' || printf('%05d', n) || ' ' ||
    CASE n % 8
      WHEN 0 THEN 'テクノロジー本部 開発1グループ 開発'
      WHEN 1 THEN 'テクノロジー本部 開発2グループ 開発'
      WHEN 2 THEN 'プロダクト本部 プロダクト企画'
      WHEN 3 THEN '営業本部 エンタープライズ営業'
      WHEN 4 THEN 'コーポレート本部 人事企画'
      WHEN 5 THEN 'デザイン本部 UXデザイン'
      WHEN 6 THEN 'カスタマー本部 サクセス'
      ELSE '事業推進室' END || ' ' ||
    printf('employee%05d@example.jp', n)
  ),
  'synthetic'
FROM sequence;

INSERT OR IGNORE INTO sync_state (
  key, item_count, last_attempt, last_success, status, details_json
) VALUES (
  'directory', 30000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'ready',
  '{"added":30000,"updated":0,"disabled":0,"source":"demo"}'
);

UPDATE sync_state
SET item_count = (SELECT COUNT(*) FROM people)
WHERE key = 'directory';
