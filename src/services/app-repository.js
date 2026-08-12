import { createId, ensureId } from "../domain/ids.js";
import {
  addDaysToDateKey,
  clampLimit,
  hoursToMinutes,
  normalizeDateKey,
  normalizeDuration,
  normalizeResourceIds,
  normalizeSearchText,
  normalizeStart,
  queryTokens,
} from "../domain/normalize.js";
import { createPlatform } from "./platform.js";

const DEFAULT_BASE_WEEK = "2026-08-10";

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function collectionEntries(collection) {
  if (Array.isArray(collection)) return collection.map((value) => [value?.id, value]);
  return Object.entries(collection ?? {});
}

function text(value, fallback = "") {
  const result = String(value ?? fallback).normalize("NFKC").trim();
  return result || fallback;
}

function flattenedText(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return text(value);
  return Object.values(value)
    .flatMap((item) => item && typeof item === "object" ? Object.values(item) : [item])
    .filter((item) => item != null && item !== "")
    .map((item) => text(item))
    .filter(Boolean)
    .join("・");
}

function normalizePerson(value = {}, fallbackId) {
  const id = ensureId(value.id ?? fallbackId, "person");
  const name = text(value.name ?? value.displayName, "名称未設定");
  const person = {
    id,
    name,
    short: text(value.short ?? value.shortName, [...name][0] ?? "・"),
    department: text(value.department),
    role: text(value.role ?? value.jobTitle),
    location: flattenedText(value.location) || text(value.officeLocation),
    mail: text(value.mail ?? value.email ?? value.userPrincipalName),
    color: text(value.color, "navy"),
    presence: text(value.presence, "online"),
  };
  person.searchText = normalizeSearchText([
    name,
    person.short,
    person.department,
    person.role,
    person.location,
    person.mail,
    value.phoneticName,
    value.kana,
    value.searchText,
  ].filter(Boolean).join(" "));
  return person;
}

function normalizeRoom(value = {}, fallbackId) {
  const id = ensureId(value.id ?? fallbackId, "room");
  const equipment = Array.isArray(value.equipment)
    ? value.equipment.map((item) => flattenedText(item)).filter(Boolean).join("・")
    : flattenedText(value.equipment);
  const room = {
    id,
    name: text(value.name ?? value.displayName, "会議室"),
    capacity: Math.max(0, Math.trunc(Number(value.capacity) || 0)),
    location: flattenedText(value.location),
    equipment,
    status: text(value.status, "空き状況未取得"),
    mail: text(value.mail ?? value.email ?? value.emailAddress),
  };
  room.searchText = normalizeSearchText([
    room.name,
    room.location,
    room.equipment,
    room.status,
    room.mail,
    `${room.capacity} ${room.capacity}名`,
    Array.isArray(value.tags) ? value.tags.join(" ") : "",
    value.searchText,
  ].filter(Boolean).join(" "));
  return room;
}

function normalizeViewSet(value = {}, fallbackId) {
  const people = normalizeResourceIds(value.people);
  const hiddenPeople = new Set(normalizeResourceIds(value.hiddenPeople));
  return {
    id: ensureId(value.id ?? fallbackId, "view"),
    name: text(value.name, "新しい表示セット"),
    people,
    hiddenPeople: people.filter((personId) => hiddenPeople.has(personId)),
    rooms: normalizeResourceIds(value.rooms),
    lens: text(value.lens, "共通の空き時間"),
    availability: text(value.availability, "all"),
    slots: Array.isArray(value.slots) ? clone(value.slots) : [],
    accent: text(value.accent, "cobalt"),
  };
}

function resolveDateKey(value, context) {
  const direct = value.dateKey ?? value.eventDate ?? value.date;
  if (direct) return normalizeDateKey(direct);
  if (Number.isInteger(Number(value.day))) {
    return addDaysToDateKey(context.baseWeek, Number(value.day));
  }
  throw new TypeError("Calendar events require dateKey (YYYY-MM-DD)");
}

function normalizeEvent(value = {}, context = {}) {
  const space = text(value.space ?? value.viewSetId ?? context.defaultSpace);
  if (!space) throw new TypeError("Calendar events require a space/viewSetId");
  return {
    id: ensureId(value.id, "event"),
    space,
    dateKey: resolveDateKey(value, context),
    start: normalizeStart(value.start, value.startMinutes),
    duration: normalizeDuration(value.duration, value.durationMinutes),
    title: text(value.title, "新しい予定"),
    kind: text(value.kind, "mine"),
    owner: text(value.owner),
    room: text(value.room),
    resourceIds: normalizeResourceIds(value.resourceIds),
    status: text(value.status, context.defaultStatus ?? "local"),
    notes: text(value.notes),
    teamsMeeting: Boolean(value.teamsMeeting),
    transactionId: value.transactionId ? text(value.transactionId) : "",
  };
}

function publicPerson(person) {
  const { searchText: _searchText, ...result } = person;
  return result;
}

function publicRoom(room) {
  const { searchText: _searchText, ...result } = room;
  return result;
}

function defaultSync(count = 0) {
  return {
    count,
    lastSuccess: null,
    status: "ready",
    added: 0,
    updated: 0,
    disabled: 0,
    source: "demo",
  };
}

function emptyBrowserState() {
  return {
    version: 1,
    people: {},
    rooms: {},
    spaces: {},
    events: {},
    settings: {},
    sync: defaultSync(),
    syncRuns: [],
  };
}

function prepareSeed(seed = {}) {
  const settings = { ...(seed.settings ?? {}) };
  const baseWeek = normalizeDateKey(
    seed.baseWeekStart ?? settings.baseWeekStart ?? settings.calendarBaseDate ?? DEFAULT_BASE_WEEK,
  );
  const people = collectionEntries(seed.people).map(([id, value]) => normalizePerson(value, id));
  const rooms = collectionEntries(seed.rooms).map(([id, value]) => normalizeRoom(value, id));
  const spaces = collectionEntries(seed.spaces).map(([id, value]) => normalizeViewSet(value, id));
  const defaultSpace = spaces[0]?.id;
  const events = (seed.events ?? []).map((event) => normalizeEvent(event, {
    baseWeek,
    defaultSpace,
    defaultStatus: "demo",
  }));
  return { people, rooms, spaces, events, settings, baseWeek };
}

function normalizeBrowserState(state) {
  const normalized = { ...emptyBrowserState(), ...(state ?? {}) };
  normalized.people = normalized.people ?? {};
  normalized.rooms = normalized.rooms ?? {};
  normalized.spaces = normalized.spaces ?? {};
  normalized.events = normalized.events ?? {};
  normalized.settings = normalized.settings ?? {};
  normalized.syncRuns = Array.isArray(normalized.syncRuns) ? normalized.syncRuns : [];
  normalized.sync = { ...defaultSync(Object.keys(normalized.people).length), ...(normalized.sync ?? {}) };
  return normalized;
}

async function initializeBrowser(platform, fixtures) {
  await platform.update((stored) => {
    const state = normalizeBrowserState(stored);
    fixtures.people.forEach((person) => { state.people[person.id] = person; });
    fixtures.rooms.forEach((room) => { state.rooms[room.id] = room; });
    fixtures.spaces.forEach((space) => {
      if (!(space.id in state.spaces)) state.spaces[space.id] = space;
    });
    fixtures.events.forEach((event) => { state.events[event.id] = event; });
    Object.entries(fixtures.settings).forEach(([key, value]) => {
      if (!(key in state.settings)) state.settings[key] = clone(value);
    });
    state.sync.count = Object.keys(state.people).length;
    if (!state.sync.lastSuccess) state.sync.lastSuccess = new Date().toISOString();
    return state;
  }, emptyBrowserState);
}

async function upsertSqlitePerson(platform, person) {
  await platform.execute(
    `INSERT INTO people (
      id, display_name, short_name, department, role, location, mail,
      color, presence, search_text, source, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fixture', CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      short_name = excluded.short_name,
      department = excluded.department,
      role = excluded.role,
      location = excluded.location,
      mail = excluded.mail,
      color = excluded.color,
      presence = excluded.presence,
      search_text = excluded.search_text,
      updated_at = CURRENT_TIMESTAMP`,
    [
      person.id,
      person.name,
      person.short,
      person.department,
      person.role,
      person.location,
      person.mail,
      person.color,
      person.presence,
      person.searchText,
    ],
  );
}

async function upsertSqliteRoom(platform, room) {
  await platform.execute(
    `INSERT INTO rooms (
      id, name, capacity, location, equipment, status, mail, search_text, source, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'fixture', CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      capacity = excluded.capacity,
      location = excluded.location,
      equipment = excluded.equipment,
      status = excluded.status,
      mail = excluded.mail,
      search_text = excluded.search_text,
      updated_at = CURRENT_TIMESTAMP`,
    [room.id, room.name, room.capacity, room.location, room.equipment, room.status, room.mail, room.searchText],
  );
}

async function upsertSqliteViewSet(platform, viewSet) {
  const hiddenPeople = new Set(viewSet.hiddenPeople);
  await platform.saveViewSetAtomic({
    id: viewSet.id,
    name: viewSet.name,
    lens: viewSet.lens,
    availability: viewSet.availability,
    accent: viewSet.accent,
    slotsJson: JSON.stringify(viewSet.slots),
    people: viewSet.people.map((id) => ({ id, visible: !hiddenPeople.has(id) })),
    rooms: viewSet.rooms,
  });
}

async function upsertSqliteEvent(platform, event) {
  await platform.execute(
    `INSERT INTO calendar_events (
      id, view_set_id, event_date, start_minutes, duration_minutes, title,
      kind, owner, room, resource_ids_json, status, notes, is_teams,
      transaction_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      view_set_id = excluded.view_set_id,
      event_date = excluded.event_date,
      start_minutes = excluded.start_minutes,
      duration_minutes = excluded.duration_minutes,
      title = excluded.title,
      kind = excluded.kind,
      owner = excluded.owner,
      room = excluded.room,
      resource_ids_json = excluded.resource_ids_json,
      status = excluded.status,
      notes = excluded.notes,
      is_teams = excluded.is_teams,
      transaction_id = excluded.transaction_id,
      updated_at = CURRENT_TIMESTAMP`,
    [
      event.id,
      event.space,
      event.dateKey,
      hoursToMinutes(event.start),
      hoursToMinutes(event.duration),
      event.title,
      event.kind,
      event.owner,
      event.room,
      JSON.stringify(event.resourceIds),
      event.status,
      event.notes,
      event.teamsMeeting ? 1 : 0,
      event.transactionId || null,
    ],
  );
}

async function initializeSqlite(platform, fixtures) {
  for (const person of fixtures.people) await upsertSqlitePerson(platform, person);
  for (const room of fixtures.rooms) await upsertSqliteRoom(platform, room);
  for (const viewSet of fixtures.spaces) {
    const existing = await platform.select("SELECT 1 AS present FROM view_sets WHERE id = ? LIMIT 1", [viewSet.id]);
    if (!existing.length) await upsertSqliteViewSet(platform, viewSet);
  }
  for (const event of fixtures.events) await upsertSqliteEvent(platform, event);
  for (const [key, value] of Object.entries(fixtures.settings)) {
    await platform.execute(
      `INSERT OR IGNORE INTO app_settings (key, value_json, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)`,
      [key, JSON.stringify(value ?? null)],
    );
  }

  const countRows = await platform.select("SELECT COUNT(*) AS count FROM people", []);
  const count = Number(countRows[0]?.count ?? 0);
  const now = new Date().toISOString();
  await platform.execute(
    `INSERT INTO sync_state (
      key, item_count, last_attempt, last_success, status, details_json, error
    ) VALUES ('directory', ?, ?, ?, 'ready', ?, NULL)
    ON CONFLICT(key) DO UPDATE SET item_count = excluded.item_count`,
    [count, now, now, JSON.stringify({ added: count, updated: 0, disabled: 0, source: "demo" })],
  );
}

function parseJson(value, fallback) {
  if (value == null || value === "") return clone(fallback);
  try {
    return JSON.parse(value);
  } catch {
    return clone(fallback);
  }
}

function sqlitePerson(row) {
  return {
    id: String(row.id),
    name: row.name,
    short: row.short,
    department: row.department,
    role: row.role,
    location: row.location,
    mail: row.mail,
    color: row.color,
    presence: row.presence,
  };
}

function sqliteRoom(row) {
  return {
    id: String(row.id),
    name: row.name,
    capacity: Number(row.capacity),
    location: row.location,
    equipment: row.equipment,
    status: row.status,
    mail: row.mail,
  };
}

const PEOPLE_SELECT = `SELECT
  id,
  display_name AS name,
  short_name AS short,
  department,
  role,
  location,
  mail,
  color,
  presence
FROM people`;

const ROOM_SELECT = `SELECT
  id,
  name,
  capacity,
  location,
  equipment,
  status,
  mail
FROM rooms`;

function syncFromSqliteRow(row, countFallback = 0) {
  if (!row) return defaultSync(countFallback);
  const details = parseJson(row.details, {});
  return {
    count: Number(row.count ?? countFallback),
    lastSuccess: row.lastSuccess ?? null,
    status: row.status ?? "ready",
    added: Number(details.added ?? 0),
    updated: Number(details.updated ?? 0),
    disabled: Number(details.disabled ?? 0),
    source: details.source ?? "demo",
  };
}

async function selectSqlitePeopleByIds(platform, ids) {
  const uniqueIds = [...new Set(ids.map(String).filter(Boolean))];
  if (!uniqueIds.length) return [];

  const rows = [];
  for (let offset = 0; offset < uniqueIds.length; offset += 400) {
    const chunk = uniqueIds.slice(offset, offset + 400);
    const placeholders = chunk.map(() => "?").join(", ");
    rows.push(...await platform.select(
      `${PEOPLE_SELECT} WHERE id IN (${placeholders}) ORDER BY display_name, id`,
      chunk,
    ));
  }
  return rows;
}

async function loadSqliteSnapshot(platform, fixtures) {
  const [roomRows, setRows, setPeopleRows, setRoomRows, eventRows, settingRows, syncRows, countRows] = await Promise.all([
    platform.select(`${ROOM_SELECT} ORDER BY name, id`, []),
    platform.select(`SELECT id, name, lens, availability, accent, slots_json AS slots
      FROM view_sets ORDER BY position, name`, []),
    platform.select("SELECT view_set_id AS viewSetId, person_id AS personId, is_visible AS isVisible FROM view_set_people ORDER BY position", []),
    platform.select("SELECT view_set_id AS viewSetId, room_id AS roomId FROM view_set_rooms ORDER BY position", []),
    platform.select(`SELECT
      id, view_set_id AS space, event_date AS dateKey,
      start_minutes AS startMinutes, duration_minutes AS durationMinutes,
      title, kind, owner, room, resource_ids_json AS resourceIds, status
      , notes, is_teams AS isTeams, transaction_id AS transactionId
      FROM calendar_events ORDER BY event_date, start_minutes, id`, []),
    platform.select("SELECT key, value_json AS value FROM app_settings ORDER BY key", []),
    platform.select(`SELECT item_count AS count, last_success AS lastSuccess,
      status, details_json AS details FROM sync_state WHERE key = ?`, ["directory"]),
    platform.select("SELECT COUNT(*) AS count FROM people", []),
  ]);

  const visiblePeopleIds = [
    ...fixtures.people.map((person) => person.id),
    ...setPeopleRows.map((row) => row.personId),
    ...eventRows.flatMap((row) => normalizeResourceIds(parseJson(row.resourceIds, []))),
  ];
  const peopleRows = await selectSqlitePeopleByIds(platform, visiblePeopleIds);

  const spaces = {};
  for (const row of setRows) {
    spaces[row.id] = {
      name: row.name,
      people: [],
      hiddenPeople: [],
      rooms: [],
      lens: row.lens,
      availability: row.availability,
      slots: parseJson(row.slots, []),
      accent: row.accent,
    };
  }
  for (const row of setPeopleRows) {
    if (!spaces[row.viewSetId]) continue;
    const personId = String(row.personId);
    spaces[row.viewSetId].people.push(personId);
    if (Number(row.isVisible) === 0) spaces[row.viewSetId].hiddenPeople.push(personId);
  }
  for (const row of setRoomRows) {
    if (spaces[row.viewSetId]) spaces[row.viewSetId].rooms.push(String(row.roomId));
  }

  const settings = Object.fromEntries(settingRows.map((row) => [row.key, parseJson(row.value, null)]));
  const events = eventRows.map((row) => ({
    id: String(row.id),
    space: String(row.space),
    dateKey: row.dateKey,
    start: Number(row.startMinutes) / 60,
    duration: Number(row.durationMinutes) / 60,
    title: row.title,
    kind: row.kind,
    owner: row.owner,
    room: row.room,
    resourceIds: normalizeResourceIds(parseJson(row.resourceIds, [])),
    status: row.status,
    notes: row.notes ?? "",
    teamsMeeting: Boolean(row.isTeams),
    transactionId: row.transactionId ?? "",
  }));

  return {
    people: peopleRows.map(sqlitePerson),
    rooms: roomRows.map(sqliteRoom),
    spaces,
    events,
    settings,
    sync: syncFromSqliteRow(syncRows[0], Number(countRows[0]?.count ?? 0)),
  };
}

function loadBrowserSnapshot(platform) {
  const state = normalizeBrowserState(platform.read(emptyBrowserState));
  const spaces = {};
  Object.entries(state.spaces).forEach(([id, viewSet]) => {
    const { id: _id, ...publicViewSet } = normalizeViewSet(viewSet, id);
    spaces[id] = clone(publicViewSet);
  });
  return {
    people: Object.values(state.people).map(publicPerson).sort((a, b) => a.name.localeCompare(b.name, "ja")),
    rooms: Object.values(state.rooms).map(publicRoom).sort((a, b) => a.name.localeCompare(b.name, "ja")),
    spaces,
    events: Object.values(state.events).map(clone).sort((a, b) =>
      a.dateKey.localeCompare(b.dateKey) || a.start - b.start || a.id.localeCompare(b.id)),
    settings: clone(state.settings),
    sync: clone(state.sync),
  };
}

function candidateRank(searchText, primaryText, normalizedQuery) {
  const primary = normalizeSearchText(primaryText);
  if (primary === normalizedQuery) return 0;
  if (primary.startsWith(normalizedQuery)) return 1;
  if (searchText.startsWith(normalizedQuery)) return 2;
  return 3;
}

async function searchSqlite(platform, kind, query, options) {
  const tokens = queryTokens(query);
  const limit = clampLimit(options?.limit);
  const normalizedQuery = normalizeSearchText(query);
  const baseSelect = kind === "people" ? PEOPLE_SELECT : ROOM_SELECT;
  const orderColumn = kind === "people" ? "display_name" : "name";
  const conditions = tokens.map(() => "instr(search_text, ?) > 0");
  const params = [...tokens];
  const minCapacity = Number(options?.minCapacity);
  if (kind === "rooms" && Number.isFinite(minCapacity) && minCapacity > 0) {
    conditions.push("capacity >= ?");
    params.push(Math.floor(minCapacity));
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const ranking = tokens.length
    ? `CASE WHEN search_text = ? THEN 0 WHEN instr(search_text, ?) = 1 THEN 1 ELSE 2 END,`
    : "";
  if (tokens.length) params.push(normalizedQuery, normalizedQuery);
  params.push(limit);
  const rows = await platform.select(
    `${baseSelect} ${where} ORDER BY ${ranking} ${orderColumn} COLLATE NOCASE, id LIMIT ?`,
    params,
  );
  return rows.map(kind === "people" ? sqlitePerson : sqliteRoom);
}

function searchBrowser(platform, kind, query, options) {
  const state = normalizeBrowserState(platform.read(emptyBrowserState));
  const tokens = queryTokens(query);
  const normalizedQuery = normalizeSearchText(query);
  const values = Object.values(kind === "people" ? state.people : state.rooms);
  const primary = kind === "people" ? "name" : "name";
  const limit = clampLimit(options?.limit);
  const minCapacity = Number(options?.minCapacity);
  return values
    .filter((value) => tokens.every((token) => value.searchText.includes(token)))
    .filter((value) => kind !== "rooms" || !Number.isFinite(minCapacity) || minCapacity <= 0 || value.capacity >= minCapacity)
    .sort((left, right) =>
      candidateRank(left.searchText, left[primary], normalizedQuery) - candidateRank(right.searchText, right[primary], normalizedQuery) ||
      left[primary].localeCompare(right[primary], "ja"))
    .slice(0, limit)
    .map(kind === "people" ? publicPerson : publicRoom);
}

async function saveBrowserViewSet(platform, viewSet) {
  await platform.update((stored) => {
    const state = normalizeBrowserState(stored);
    state.spaces[viewSet.id] = clone(viewSet);
    return state;
  }, emptyBrowserState);
  return clone(viewSet);
}

async function setBrowserViewSetPersonVisibility(platform, viewSetId, personId, visible) {
  await platform.update((stored) => {
    const state = normalizeBrowserState(stored);
    const viewSet = normalizeViewSet(state.spaces[viewSetId], viewSetId);
    if (!(viewSetId in state.spaces)) throw new TypeError(`Unknown display set: ${viewSetId}`);
    if (!viewSet.people.includes(personId)) throw new TypeError(`Unknown display-set member: ${personId}`);
    const hiddenPeople = new Set(viewSet.hiddenPeople);
    if (visible) hiddenPeople.delete(personId);
    else hiddenPeople.add(personId);
    viewSet.hiddenPeople = viewSet.people.filter((id) => hiddenPeople.has(id));
    state.spaces[viewSetId] = viewSet;
    return state;
  }, emptyBrowserState);
  return { viewSetId, personId, visible };
}

async function saveBrowserEvent(platform, event) {
  await platform.update((stored) => {
    const state = normalizeBrowserState(stored);
    if (!state.spaces[event.space]) throw new TypeError(`Unknown display set: ${event.space}`);
    state.events[event.id] = clone(event);
    return state;
  }, emptyBrowserState);
  return clone(event);
}

async function runBrowserSync(platform) {
  const startedAt = new Date().toISOString();
  const runId = createId("sync");
  await platform.update((stored) => {
    const state = normalizeBrowserState(stored);
    state.sync.status = "running";
    state.syncRuns.push({ id: runId, startedAt, completedAt: null, status: "running" });
    return state;
  }, emptyBrowserState);

  const completedAt = new Date().toISOString();
  const state = await platform.update((stored) => {
    const next = normalizeBrowserState(stored);
    const run = next.syncRuns.find((item) => item.id === runId);
    if (run) Object.assign(run, { completedAt, status: "success", added: 0, updated: 0, disabled: 0 });
    next.sync = {
      count: Object.keys(next.people).length,
      lastSuccess: completedAt,
      status: "ready",
      added: 0,
      updated: 0,
      disabled: 0,
      source: "demo",
    };
    return next;
  }, emptyBrowserState);
  return clone(state.sync);
}

async function runSqliteSync(platform) {
  const runId = Math.floor(Date.now() * 1000 + Math.random() * 1000);
  const startedAt = new Date().toISOString();
  await platform.execute(
    `INSERT INTO sync_runs (id, started_at, status, added_count, updated_count, disabled_count)
     VALUES (?, ?, 'running', 0, 0, 0)`,
    [runId, startedAt],
  );
  await platform.execute(
    `UPDATE sync_state SET last_attempt = ?, status = 'running', error = NULL WHERE key = ?`,
    [startedAt, "directory"],
  );

  try {
    const countRows = await platform.select("SELECT COUNT(*) AS count FROM people", []);
    const count = Number(countRows[0]?.count ?? 0);
    const completedAt = new Date().toISOString();
    const details = { added: 0, updated: 0, disabled: 0, source: "demo" };
    await platform.execute(
      `UPDATE sync_runs SET completed_at = ?, status = 'success' WHERE id = ?`,
      [completedAt, runId],
    );
    await platform.execute(
      `INSERT INTO sync_state (
        key, item_count, last_attempt, last_success, status, details_json, error
      ) VALUES ('directory', ?, ?, ?, 'ready', ?, NULL)
      ON CONFLICT(key) DO UPDATE SET
        item_count = excluded.item_count,
        last_attempt = excluded.last_attempt,
        last_success = excluded.last_success,
        status = excluded.status,
        details_json = excluded.details_json,
        error = NULL`,
      [count, startedAt, completedAt, JSON.stringify(details)],
    );
    return { count, lastSuccess: completedAt, status: "ready", ...details };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    await platform.execute(
      `UPDATE sync_runs SET completed_at = ?, status = 'failed', error = ? WHERE id = ?`,
      [completedAt, message, runId],
    ).catch(() => undefined);
    await platform.execute(
      `UPDATE sync_state SET last_attempt = ?, status = 'error', error = ? WHERE key = ?`,
      [startedAt, message, "directory"],
    ).catch(() => undefined);
    throw error;
  }
}

export function createAppRepository(seed = {}, options = {}) {
  const fixtures = prepareSeed(seed);
  let platformPromise;
  let initializePromise;

  function platform() {
    platformPromise ??= Promise.resolve(options.platform ?? createPlatform(options.platformOptions));
    return platformPromise;
  }

  function initialize() {
    initializePromise ??= platform()
      .then((adapter) => adapter.kind === "sqlite"
        ? initializeSqlite(adapter, fixtures)
        : initializeBrowser(adapter, fixtures))
      .catch((error) => {
        initializePromise = undefined;
        throw error;
      });
    return initializePromise;
  }

  async function ready() {
    await initialize();
    return platform();
  }

  return {
    initialize,

    async loadSnapshot() {
      const adapter = await ready();
      return adapter.kind === "sqlite"
        ? loadSqliteSnapshot(adapter, fixtures)
        : loadBrowserSnapshot(adapter);
    },

    async searchPeople(query, options = {}) {
      const adapter = await ready();
      return adapter.kind === "sqlite"
        ? searchSqlite(adapter, "people", query, options)
        : searchBrowser(adapter, "people", query, options);
    },

    async searchRooms(query, options = {}) {
      const adapter = await ready();
      return adapter.kind === "sqlite"
        ? searchSqlite(adapter, "rooms", query, options)
        : searchBrowser(adapter, "rooms", query, options);
    },

    async saveViewSet(value) {
      const adapter = await ready();
      const viewSet = normalizeViewSet(value, value?.id);
      if (adapter.kind === "sqlite") {
        await upsertSqliteViewSet(adapter, viewSet);
        return clone(viewSet);
      }
      return saveBrowserViewSet(adapter, viewSet);
    },

    async setViewSetPersonVisibility(viewSetId, personId, visible) {
      const normalizedViewSetId = text(viewSetId);
      const normalizedPersonId = text(personId);
      if (!normalizedViewSetId || !normalizedPersonId) throw new TypeError("Display set and person IDs are required");
      const adapter = await ready();
      if (adapter.kind === "sqlite") {
        const result = await adapter.execute(
          `UPDATE view_set_people
           SET is_visible = ?
           WHERE view_set_id = ? AND person_id = ?`,
          [visible ? 1 : 0, normalizedViewSetId, normalizedPersonId],
        );
        if (Number(result?.rowsAffected ?? 0) < 1) {
          throw new TypeError(`Unknown display-set member: ${normalizedPersonId}`);
        }
        return { viewSetId: normalizedViewSetId, personId: normalizedPersonId, visible: Boolean(visible) };
      }
      return setBrowserViewSetPersonVisibility(adapter, normalizedViewSetId, normalizedPersonId, Boolean(visible));
    },

    async saveEvent(value) {
      const adapter = await ready();
      const event = normalizeEvent(value, {
        baseWeek: fixtures.baseWeek,
        defaultSpace: fixtures.spaces[0]?.id,
        defaultStatus: "local",
      });
      if (adapter.kind === "sqlite") {
        await upsertSqliteEvent(adapter, event);
        return clone(event);
      }
      return saveBrowserEvent(adapter, event);
    },

    async saveSetting(key, value) {
      const adapter = await ready();
      const normalizedKey = text(key);
      if (!normalizedKey) throw new TypeError("Setting key is required");
      if (adapter.kind === "sqlite") {
        await adapter.execute(
          `INSERT INTO app_settings (key, value_json, updated_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET
             value_json = excluded.value_json,
             updated_at = CURRENT_TIMESTAMP`,
          [normalizedKey, JSON.stringify(value ?? null)],
        );
      } else {
        await adapter.update((stored) => {
          const state = normalizeBrowserState(stored);
          state.settings[normalizedKey] = clone(value ?? null);
          return state;
        }, emptyBrowserState);
      }
      return clone(value ?? null);
    },

    async runDirectorySync() {
      const adapter = await ready();
      return adapter.kind === "sqlite"
        ? runSqliteSync(adapter)
        : runBrowserSync(adapter);
    },
  };
}
