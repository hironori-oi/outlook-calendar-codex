import test from "node:test";
import assert from "node:assert/strict";

import { normalizeSearchText, queryTokens } from "../src/domain/normalize.js";
import { createAppRepository } from "../src/services/app-repository.js";
import { createBrowserPlatform, createMemoryStorage } from "../src/services/platform.js";

function fixture() {
  return {
    baseWeekStart: "2026-08-10",
    people: {
      sato: {
        name: "佐藤　美咲",
        short: "佐",
        department: "テクノロジー本部 / 開発1グループ",
        role: "エンジニア",
        location: "東京本社",
        mail: "misaki.sato@example.jp",
        color: "blue",
        presence: "online",
      },
      suzuki: {
        name: "鈴木 健太",
        short: "鈴",
        department: "デザイン本部 / UXデザイン",
        role: "デザイナー",
        location: "東京本社",
        mail: "kenta.suzuki@example.jp",
        color: "gold",
        presence: "busy",
      },
    },
    rooms: {
      hikari: {
        name: "ＨＩＫＡＲＩ 12F",
        capacity: 8,
        location: "東京本社・12階",
        equipment: "モニター・Teams",
        status: "空室",
        mail: "hikari@example.jp",
      },
    },
    spaces: {
      product: {
        name: "プロダクト定例",
        people: ["sato", "suzuki"],
        rooms: ["hikari"],
        lens: "全員と部屋が空く時間",
        availability: "all",
        slots: [],
        accent: "cobalt",
      },
    },
    events: [{
      id: "fixture-event",
      space: "product",
      day: 1,
      start: "09:30",
      duration: 60,
      title: "企画レビュー",
      kind: "shared",
      owner: "佐藤 美咲",
      room: "HIKARI 12F",
      resourceIds: ["sato", "hikari", "sato"],
    }],
    settings: { appearance: { preset: "mist" } },
  };
}

function repository(seed = fixture()) {
  const storage = createMemoryStorage();
  const platform = createBrowserPlatform({ storage, storageKey: "test-nagi" });
  return { storage, platform, repo: createAppRepository(seed, { platform }) };
}

test("normalizes NFKC and whitespace into deterministic AND tokens", () => {
  assert.equal(normalizeSearchText("  ＨＩＫＡＲＩ　カレンダー  "), "hikari カレンダー");
  assert.deepEqual(queryTokens(" 開発　佐藤 開発 "), ["開発", "佐藤"]);
});

test("initialize upserts fixtures and loadSnapshot preserves the app.js field shape", async () => {
  const { repo } = repository();
  await repo.initialize();
  const snapshot = await repo.loadSnapshot();

  assert.ok(Array.isArray(snapshot.people));
  assert.ok(Array.isArray(snapshot.rooms));
  assert.equal(snapshot.people.find((person) => person.id === "sato").name, "佐藤 美咲");
  assert.deepEqual(snapshot.spaces.product.people, ["sato", "suzuki"]);
  assert.deepEqual(snapshot.spaces.product.hiddenPeople, []);
  assert.equal(snapshot.events[0].space, "product");
  assert.equal(snapshot.events[0].dateKey, "2026-08-11");
  assert.equal(snapshot.events[0].start, 9.5);
  assert.equal(snapshot.events[0].duration, 1);
  assert.deepEqual(snapshot.events[0].resourceIds, ["sato", "hikari"]);
  assert.equal(snapshot.events[0].status, "demo");
  assert.equal(snapshot.sync.count, 2);
});

test("searchPeople uses normalized whitespace tokens with AND semantics and caps results at 50", async () => {
  const manyPeople = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [
    `developer-${index}`,
    {
      name: index === 0 ? "佐藤 美咲" : `開発 社員${String(index).padStart(2, "0")}`,
      department: "テクノロジー本部 開発グループ",
      mail: `developer${index}@example.jp`,
    },
  ]));
  const seed = fixture();
  seed.people = manyPeople;
  seed.spaces.product.people = ["developer-0"];
  seed.events = [];
  const { repo } = repository(seed);

  const exact = await repo.searchPeople("  開発　佐藤  ", { limit: 50 });
  assert.deepEqual(exact.map((person) => person.id), ["developer-0"]);

  const capped = await repo.searchPeople("開発", { limit: 500 });
  assert.equal(capped.length, 50);
});

test("searchRooms applies NFKC normalization", async () => {
  const { repo } = repository();
  const rooms = await repo.searchRooms("hikari 東京", { limit: 10 });
  assert.deepEqual(rooms.map((room) => room.id), ["hikari"]);
});

test("searchRooms applies minimum capacity before the result limit", async () => {
  const seed = fixture();
  seed.rooms = Object.fromEntries([
    ...Array.from({ length: 60 }, (_, index) => [
      `small-${index}`,
      { name: `小会議室 ${String(index).padStart(2, "0")}`, capacity: 4, location: "東京本社", equipment: "モニター", status: "空室" },
    ]),
    ["large", { name: "大会議室", capacity: 12, location: "東京本社", equipment: "Teams", status: "空室" }],
  ]);
  seed.spaces.product.rooms = ["large"];
  const { repo } = repository(seed);

  const rooms = await repo.searchRooms("", { limit: 50, minCapacity: 8 });

  assert.deepEqual(rooms.map((room) => room.id), ["large"]);
});

test("SQLite snapshots load only people referenced by a display set or event while retaining the directory count", async () => {
  const selects = [];
  const platform = {
    kind: "sqlite",
    async execute() {
      return { rowsAffected: 1 };
    },
    async select(sql, params = []) {
      selects.push({ sql, params });
      if (sql.includes("FROM view_set_people")) {
        return [{ viewSetId: "product", personId: "selected-person", isVisible: 0 }];
      }
      if (sql.includes("FROM view_set_rooms")) return [];
      if (sql.includes("FROM view_sets")) {
        return [{
          id: "product",
          name: "プロダクト定例",
          lens: "共通の空き時間",
          availability: "all",
          accent: "cobalt",
          slots: "[]",
        }];
      }
      if (sql.includes("FROM calendar_events")) {
        return [{
          id: "event-with-external-attendee",
          space: "product",
          dateKey: "2026-08-12",
          startMinutes: 600,
          durationMinutes: 60,
          title: "横断レビュー",
          kind: "local",
          owner: "自分",
          room: "",
          resourceIds: '["selected-person","event-only-person","room-id"]',
          status: "local",
          notes: "",
          isTeams: 0,
          transactionId: "transaction-1",
        }];
      }
      if (sql.includes("FROM app_settings")) return [];
      if (sql.includes("FROM sync_state")) {
        return [{
          count: 30000,
          lastSuccess: "2026-08-09T00:00:00.000Z",
          status: "ready",
          details: '{"source":"demo","added":0,"updated":0,"disabled":0}',
        }];
      }
      if (sql.includes("COUNT(*) AS count FROM people")) return [{ count: 30000 }];
      if (sql.includes("FROM people WHERE id IN")) {
        assert.deepEqual(params, ["selected-person", "event-only-person", "room-id"]);
        return [
          {
            id: "selected-person",
            name: "選択済み 社員",
            short: "選",
            department: "開発本部",
            role: "エンジニア",
            location: "東京本社",
            mail: "selected@example.jp",
            color: "blue",
            presence: "online",
          },
          {
            id: "event-only-person",
            name: "予定のみ 社員",
            short: "予",
            department: "営業本部",
            role: "営業",
            location: "大阪支社",
            mail: "event-only@example.jp",
            color: "mint",
            presence: "away",
          },
        ];
      }
      if (sql.includes("FROM rooms")) return [];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const repo = createAppRepository({}, { platform });
  const snapshot = await repo.loadSnapshot();

  assert.deepEqual(snapshot.people.map((person) => person.id), ["selected-person", "event-only-person"]);
  assert.deepEqual(snapshot.spaces.product.hiddenPeople, ["selected-person"]);
  assert.equal(snapshot.sync.count, 30000);
  assert.equal(
    selects.some(({ sql }) => /FROM people\s+ORDER BY display_name/.test(sql)),
    false,
  );
});

test("saved view sets, normalized events, and settings survive a repository restart", async () => {
  const { storage, platform, repo } = repository();
  await repo.saveViewSet({
    id: "product",
    name: "変更済みプロダクト",
    people: ["sato"],
    rooms: ["hikari"],
  });
  await repo.saveViewSet({
    id: "custom",
    name: "自分の表示",
    people: ["sato"],
    rooms: ["hikari"],
  });
  await repo.setViewSetPersonVisibility("custom", "sato", false);
  const savedEvent = await repo.saveEvent({
    space: "custom",
    dateKey: "2026-08-12",
    startMinutes: 615,
    durationMinutes: 45,
    title: "ローカル下書き",
    resourceIds: ["sato", "sato", "hikari"],
    notes: "再起動後も残すメモ",
    teamsMeeting: true,
    transactionId: "transaction-test-1",
  });
  await repo.saveSetting("appearance", { preset: "focus", panel: 2 });

  assert.equal(savedEvent.start, 10.25);
  assert.equal(savedEvent.duration, 0.75);
  assert.equal(savedEvent.status, "local");
  assert.deepEqual(savedEvent.resourceIds, ["sato", "hikari"]);
  assert.equal(savedEvent.notes, "再起動後も残すメモ");
  assert.equal(savedEvent.teamsMeeting, true);
  assert.equal(savedEvent.transactionId, "transaction-test-1");

  const restartedPlatform = createBrowserPlatform({ storage, storageKey: "test-nagi" });
  const restarted = createAppRepository(fixture(), { platform: restartedPlatform });
  const snapshot = await restarted.loadSnapshot();
  assert.equal(snapshot.spaces.product.name, "変更済みプロダクト");
  assert.deepEqual(snapshot.spaces.product.people, ["sato"]);
  assert.equal(snapshot.spaces.custom.name, "自分の表示");
  assert.deepEqual(snapshot.spaces.custom.hiddenPeople, ["sato"]);
  const restoredEvent = snapshot.events.find((event) => event.id === savedEvent.id);
  assert.equal(restoredEvent.title, "ローカル下書き");
  assert.equal(restoredEvent.notes, "再起動後も残すメモ");
  assert.equal(restoredEvent.teamsMeeting, true);
  assert.equal(restoredEvent.transactionId, "transaction-test-1");
  assert.deepEqual(snapshot.settings.appearance, { preset: "focus", panel: 2 });

  await restarted.setViewSetPersonVisibility("custom", "sato", true);
  const visibleAgain = await restarted.loadSnapshot();
  assert.deepEqual(visibleAgain.spaces.custom.hiddenPeople, []);

  // Keep the original adapter referenced so this test also covers serialized cross-instance state.
  assert.equal(platform.kind, "browser");
});

test("SQLite member visibility updates only the requested display-set membership", async () => {
  const executions = [];
  const platform = {
    kind: "sqlite",
    async execute(sql, params = []) {
      executions.push({ sql, params });
      return { rowsAffected: 1 };
    },
    async select(sql) {
      if (sql.includes("COUNT(*) AS count FROM people")) return [{ count: 0 }];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const repo = createAppRepository({}, { platform });

  const result = await repo.setViewSetPersonVisibility("product", "sato", false);

  const update = executions.find(({ sql }) => sql.includes("UPDATE view_set_people"));
  assert.deepEqual(update.params, [0, "product", "sato"]);
  assert.deepEqual(result, { viewSetId: "product", personId: "sato", visible: false });
});

test("SQLite view-set saves delegate the complete replacement to one atomic platform call", async () => {
  const savedPayloads = [];
  const executions = [];
  const platform = {
    kind: "sqlite",
    async execute(sql, params = []) {
      executions.push({ sql, params });
      return { rowsAffected: 1 };
    },
    async select(sql) {
      if (sql.includes("COUNT(*) AS count FROM people")) return [{ count: 0 }];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async saveViewSetAtomic(payload) {
      savedPayloads.push(payload);
    },
  };
  const repo = createAppRepository({}, { platform });

  await repo.saveViewSet({
    id: "product",
    name: "プロダクト定例",
    people: ["sato", "suzuki"],
    hiddenPeople: ["suzuki"],
    rooms: ["hikari"],
    lens: "全員と部屋が空く時間",
    availability: "all",
    slots: [{ start: "10:00", end: "10:30" }],
    accent: "cobalt",
  });

  assert.deepEqual(savedPayloads, [{
    id: "product",
    name: "プロダクト定例",
    lens: "全員と部屋が空く時間",
    availability: "all",
    accent: "cobalt",
    slotsJson: '[{"start":"10:00","end":"10:30"}]',
    people: [
      { id: "sato", visible: true },
      { id: "suzuki", visible: false },
    ],
    rooms: ["hikari"],
  }]);
  assert.equal(
    executions.some(({ sql }) => /(?:DELETE FROM|INSERT INTO) view_set_(?:people|rooms)/.test(sql)),
    false,
  );
});

test("SQLite view-set save failures never fall back to destructive sequential writes", async () => {
  const executions = [];
  const platform = {
    kind: "sqlite",
    async execute(sql, params = []) {
      executions.push({ sql, params });
      return { rowsAffected: 1 };
    },
    async select(sql) {
      if (sql.includes("COUNT(*) AS count FROM people")) return [{ count: 0 }];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async saveViewSetAtomic() {
      throw new Error("simulated transaction failure");
    },
  };
  const repo = createAppRepository({}, { platform });

  await assert.rejects(
    repo.saveViewSet({ id: "product", name: "変更失敗", people: ["sato"], rooms: [] }),
    /simulated transaction failure/,
  );
  assert.equal(
    executions.some(({ sql }) => /(?:DELETE FROM|INSERT INTO) view_set_(?:people|rooms)/.test(sql)),
    false,
  );
});

test("demo directory sync updates metadata without mutating the directory snapshot", async () => {
  const { repo } = repository();
  const before = await repo.loadSnapshot();
  const result = await repo.runDirectorySync();
  const after = await repo.loadSnapshot();

  assert.deepEqual(after.people, before.people);
  assert.deepEqual(after.rooms, before.rooms);
  assert.equal(result.status, "ready");
  assert.equal(after.sync.count, before.people.length);
  assert.equal(after.sync.source, "demo");
  assert.ok(after.sync.lastSuccess);
});
