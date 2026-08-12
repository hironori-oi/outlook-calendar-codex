use serde::Deserialize;
use sqlx::{Sqlite, SqlitePool, Transaction};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool, Migration, MigrationKind};

const DATABASE_URL: &str = "sqlite:nagi.db";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ViewSetPersonInput {
    id: String,
    visible: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveViewSetInput {
    id: String,
    name: String,
    lens: String,
    availability: String,
    accent: String,
    slots_json: String,
    people: Vec<ViewSetPersonInput>,
    rooms: Vec<String>,
}

async fn write_view_set(
    transaction: &mut Transaction<'_, Sqlite>,
    view_set: &SaveViewSetInput,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO view_sets (
          id, name, lens, availability, accent, slots_json, position, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          lens = excluded.lens,
          availability = excluded.availability,
          accent = excluded.accent,
          slots_json = excluded.slots_json,
          updated_at = CURRENT_TIMESTAMP"#,
    )
    .bind(&view_set.id)
    .bind(&view_set.name)
    .bind(&view_set.lens)
    .bind(&view_set.availability)
    .bind(&view_set.accent)
    .bind(&view_set.slots_json)
    .execute(&mut **transaction)
    .await?;

    sqlx::query("DELETE FROM view_set_people WHERE view_set_id = ?")
        .bind(&view_set.id)
        .execute(&mut **transaction)
        .await?;
    sqlx::query("DELETE FROM view_set_rooms WHERE view_set_id = ?")
        .bind(&view_set.id)
        .execute(&mut **transaction)
        .await?;

    for (position, person) in view_set.people.iter().enumerate() {
        sqlx::query(
            "INSERT INTO view_set_people (view_set_id, person_id, position, is_visible) VALUES (?, ?, ?, ?)",
        )
        .bind(&view_set.id)
        .bind(&person.id)
        .bind(position as i64)
        .bind(if person.visible { 1_i64 } else { 0_i64 })
        .execute(&mut **transaction)
        .await?;
    }

    for (position, room_id) in view_set.rooms.iter().enumerate() {
        sqlx::query("INSERT INTO view_set_rooms (view_set_id, room_id, position) VALUES (?, ?, ?)")
            .bind(&view_set.id)
            .bind(room_id)
            .bind(position as i64)
            .execute(&mut **transaction)
            .await?;
    }

    Ok(())
}

async fn save_view_set_in_transaction(
    pool: &SqlitePool,
    view_set: &SaveViewSetInput,
) -> Result<(), sqlx::Error> {
    let mut transaction = pool.begin().await?;
    match write_view_set(&mut transaction, view_set).await {
        Ok(()) => transaction.commit().await,
        Err(error) => {
            transaction.rollback().await?;
            Err(error)
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
async fn save_view_set_atomic(
    db_instances: State<'_, DbInstances>,
    view_set: SaveViewSetInput,
) -> Result<(), String> {
    let instances = db_instances.0.read().await;
    let database = instances
        .get(DATABASE_URL)
        .ok_or_else(|| format!("Database not loaded: {DATABASE_URL}"))?;
    let DbPool::Sqlite(pool) = database;

    save_view_set_in_transaction(pool, &view_set)
        .await
        .map_err(|error| format!("Failed to save display set: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_nagi_local_database",
            sql: include_str!("../migrations/0001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_event_draft_fields",
            sql: include_str!("../migrations/0002_event_draft_fields.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add_view_set_person_visibility",
            sql: include_str!("../migrations/0003_view_set_person_visibility.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DATABASE_URL, migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![save_view_set_atomic])
        .run(tauri::generate_context!())
        .expect("failed to run NAGI Calendar");
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[test]
    fn failed_membership_write_rolls_back_the_whole_view_set() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("create test database");
            sqlx::query("PRAGMA foreign_keys = ON")
                .execute(&pool)
                .await
                .expect("enable foreign keys");
            for statement in [
                "CREATE TABLE people (id TEXT PRIMARY KEY)",
                "CREATE TABLE rooms (id TEXT PRIMARY KEY)",
                "CREATE TABLE view_sets (id TEXT PRIMARY KEY, name TEXT NOT NULL, lens TEXT NOT NULL, availability TEXT NOT NULL, accent TEXT NOT NULL, slots_json TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
                "CREATE TABLE view_set_people (view_set_id TEXT NOT NULL REFERENCES view_sets(id) ON DELETE CASCADE, person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE, position INTEGER NOT NULL DEFAULT 0, is_visible INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (view_set_id, person_id))",
                "CREATE TABLE view_set_rooms (view_set_id TEXT NOT NULL REFERENCES view_sets(id) ON DELETE CASCADE, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (view_set_id, room_id))",
                "INSERT INTO people (id) VALUES ('old-person'), ('new-person')",
                "INSERT INTO rooms (id) VALUES ('old-room')",
                "INSERT INTO view_sets (id, name, lens, availability, accent, slots_json) VALUES ('product', 'Old name', 'old lens', 'all', 'cobalt', '[]')",
                "INSERT INTO view_set_people (view_set_id, person_id, position, is_visible) VALUES ('product', 'old-person', 0, 1)",
                "INSERT INTO view_set_rooms (view_set_id, room_id, position) VALUES ('product', 'old-room', 0)",
            ] {
                sqlx::query(statement)
                    .execute(&pool)
                    .await
                    .expect("prepare test database");
            }

            let result = save_view_set_in_transaction(
                &pool,
                &SaveViewSetInput {
                    id: "product".into(),
                    name: "New name".into(),
                    lens: "new lens".into(),
                    availability: "all".into(),
                    accent: "mint".into(),
                    slots_json: "[]".into(),
                    people: vec![
                        ViewSetPersonInput {
                            id: "new-person".into(),
                            visible: false,
                        },
                        ViewSetPersonInput {
                            id: "missing-person".into(),
                            visible: true,
                        },
                    ],
                    rooms: vec![],
                },
            )
            .await;

            assert!(result.is_err(), "invalid membership must fail");
            let name: String =
                sqlx::query_scalar("SELECT name FROM view_sets WHERE id = 'product'")
                    .fetch_one(&pool)
                    .await
                    .expect("load preserved display set");
            let people: Vec<String> = sqlx::query_scalar(
                "SELECT person_id FROM view_set_people WHERE view_set_id = 'product' ORDER BY position",
            )
            .fetch_all(&pool)
            .await
            .expect("load preserved people");
            let rooms: Vec<String> = sqlx::query_scalar(
                "SELECT room_id FROM view_set_rooms WHERE view_set_id = 'product' ORDER BY position",
            )
            .fetch_all(&pool)
            .await
            .expect("load preserved rooms");

            assert_eq!(name, "Old name");
            assert_eq!(people, vec!["old-person"]);
            assert_eq!(rooms, vec!["old-room"]);
        });
    }

    #[test]
    fn successful_view_set_write_commits_members_rooms_and_visibility() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("create test database");
            sqlx::query("PRAGMA foreign_keys = ON")
                .execute(&pool)
                .await
                .expect("enable foreign keys");
            for statement in [
                "CREATE TABLE people (id TEXT PRIMARY KEY)",
                "CREATE TABLE rooms (id TEXT PRIMARY KEY)",
                "CREATE TABLE view_sets (id TEXT PRIMARY KEY, name TEXT NOT NULL, lens TEXT NOT NULL, availability TEXT NOT NULL, accent TEXT NOT NULL, slots_json TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
                "CREATE TABLE view_set_people (view_set_id TEXT NOT NULL REFERENCES view_sets(id) ON DELETE CASCADE, person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE, position INTEGER NOT NULL DEFAULT 0, is_visible INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (view_set_id, person_id))",
                "CREATE TABLE view_set_rooms (view_set_id TEXT NOT NULL REFERENCES view_sets(id) ON DELETE CASCADE, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (view_set_id, room_id))",
                "INSERT INTO people (id) VALUES ('person-a'), ('person-b')",
                "INSERT INTO rooms (id) VALUES ('room-a'), ('room-b')",
            ] {
                sqlx::query(statement)
                    .execute(&pool)
                    .await
                    .expect("prepare test database");
            }

            save_view_set_in_transaction(
                &pool,
                &SaveViewSetInput {
                    id: "custom".into(),
                    name: "Custom set".into(),
                    lens: "shared availability".into(),
                    availability: "all".into(),
                    accent: "cobalt".into(),
                    slots_json: "[]".into(),
                    people: vec![
                        ViewSetPersonInput {
                            id: "person-a".into(),
                            visible: true,
                        },
                        ViewSetPersonInput {
                            id: "person-b".into(),
                            visible: false,
                        },
                    ],
                    rooms: vec!["room-b".into(), "room-a".into()],
                },
            )
            .await
            .expect("commit display set");

            let people: Vec<(String, i64, i64)> = sqlx::query_as(
                "SELECT person_id, position, is_visible FROM view_set_people WHERE view_set_id = 'custom' ORDER BY position",
            )
            .fetch_all(&pool)
            .await
            .expect("load committed people");
            let rooms: Vec<(String, i64)> = sqlx::query_as(
                "SELECT room_id, position FROM view_set_rooms WHERE view_set_id = 'custom' ORDER BY position",
            )
            .fetch_all(&pool)
            .await
            .expect("load committed rooms");

            assert_eq!(
                people,
                vec![("person-a".into(), 0, 1), ("person-b".into(), 1, 0),]
            );
            assert_eq!(rooms, vec![("room-b".into(), 0), ("room-a".into(), 1)]);
        });
    }
}
