import { createAppRepository } from "./src/services/app-repository.js";
import { createId } from "./src/domain/ids.js";
import { installWindowControls, isTauriRuntime } from "./src/services/platform.js";
import {
  dayResourcesForSpace,
  eventMatchesDayResource,
  eventVisibleInViewSet,
  hiddenPersonIds,
  lensModeForSpace,
  visiblePersonIds,
} from "./src/domain/calendar-view.js";
import { withDemoEventResources } from "./src/data/demo-event-resources.js";

const CITY_BACKGROUND_URL = new URL("./assets/nagi-city-morning.png", import.meta.url).href;

const ui = {
  root: document.documentElement,
  calendarView: document.querySelector("#calendar-view"),
  dateTitle: document.querySelector("#date-title"),
  directoryOverlay: document.querySelector("#directory-overlay"),
  directorySearch: document.querySelector("#directory-search"),
  directoryResults: document.querySelector("#directory-results"),
  resultHeading: document.querySelector("#result-heading"),
  resultCount: document.querySelector("#result-count"),
  peopleFilters: document.querySelector("#people-filters"),
  roomFilters: document.querySelector("#room-filters"),
  eventDrawer: document.querySelector("#event-drawer"),
  detailDrawer: document.querySelector("#detail-drawer"),
  appearancePanel: document.querySelector("#appearance-panel"),
  syncModal: document.querySelector("#sync-modal"),
  toastRegion: document.querySelector("#toast-region"),
  peopleResourceList: document.querySelector("#people-resource-list"),
  roomResourceList: document.querySelector("#room-resource-list"),
  selectionTitle: document.querySelector("#selection-title"),
  selectionSummary: document.querySelector(".selection-summary"),
  lensTitle: document.querySelector("#lens-title"),
};

const appLayout = document.querySelector(".app-layout");
appLayout.setAttribute("inert", "");
const startupControls = [...document.querySelectorAll('#new-display-set, [data-open-directory], #open-appearance, #create-event, #connection-state, #display-set-form button[type="submit"], #close-directory, .draft-button, #event-submit, #background-upload')];
startupControls.forEach((control) => { control.disabled = true; });

const initialToday = new Date();
const initialWeekday = initialToday.getDay();
const initialWeekStart = startOfWorkWeek(initialToday);
const initialSelectedDate = initialWeekday === 0 || initialWeekday === 6 ? initialWeekStart : initialToday;

const state = {
  view: "week",
  activeSpace: "product",
  selectedDay: Math.max(0, Math.min(4, initialWeekday - 1)),
  weekStart: initialWeekStart,
  selectedDate: initialSelectedDate,
  monthDate: new Date(initialToday.getFullYear(), initialToday.getMonth(), 1),
  directoryMode: "people",
  directoryContext: "viewSet",
  directoryFilters: { people: "all", rooms: "available" },
  pendingSelection: { people: new Set(), rooms: new Set() },
  composerSelection: null,
  highlight: null,
  lastFocus: null,
  editingDraft: null,
  detailEventId: null,
};

let appRepository;
let directoryRequestId = 0;
let directorySearchTimer;
let settingsSaveTimer;
let appearanceState = {};
let composerSaveInFlight = false;
const memberVisibilityPending = new Set();

const people = {
  me: { id: "me", name: "加藤 浩", short: "加", department: "事業推進室", role: "プロダクトオーナー", location: "東京本社", mail: "hiro.kato@example.jp", color: "navy", presence: "online" },
  sato: { id: "sato", name: "佐藤 美咲", short: "佐", department: "プロダクト本部 / プロダクト企画", role: "シニアプロダクトマネージャー", location: "東京本社", mail: "misaki.sato@example.jp", color: "blue", presence: "busy" },
  suzuki: { id: "suzuki", name: "鈴木 健太", short: "鈴", department: "デザイン本部 / UXデザイン", role: "UXデザイナー", location: "東京本社", mail: "kenta.suzuki@example.jp", color: "gold", presence: "online" },
  chen: { id: "chen", name: "陳 リン", short: "陳", department: "テクノロジー本部 / 開発1グループ", role: "テックリード", location: "東京本社", mail: "lin.chen@example.jp", color: "green", presence: "away" },
  yamada: { id: "yamada", name: "山田 直樹", short: "山", department: "コーポレート本部 / 人事企画", role: "採用マネージャー", location: "東京本社", mail: "naoki.yamada@example.jp", color: "coral", presence: "online" },
  tanaka: { id: "tanaka", name: "田中 葵", short: "田", department: "コーポレート本部 / タレント採用", role: "採用担当", location: "東京本社", mail: "aoi.tanaka@example.jp", color: "plum", presence: "busy" },
  watanabe: { id: "watanabe", name: "渡辺 翔", short: "渡", department: "営業本部 / エンタープライズ営業", role: "アカウントディレクター", location: "大阪支社", mail: "sho.watanabe@example.jp", color: "navy", presence: "online" },
  ito: { id: "ito", name: "伊藤 さくら", short: "伊", department: "営業本部 / 営業企画", role: "セールスオペレーション", location: "東京本社", mail: "sakura.ito@example.jp", color: "green", presence: "online" },
  kobayashi: { id: "kobayashi", name: "小林 悠真", short: "小", department: "営業本部 / パートナー営業", role: "パートナーマネージャー", location: "名古屋支社", mail: "yuma.kobayashi@example.jp", color: "gold", presence: "away" },
};

const rooms = {
  hikari: { id: "hikari", name: "HIKARI 12F", capacity: 8, location: "東京本社・12階", equipment: "モニター・Teams", status: "15:00から空室" },
  nagisa: { id: "nagisa", name: "NAGISA 8F", capacity: 12, location: "東京本社・8階", equipment: "大型モニター・Teams", status: "終日空室" },
  sora: { id: "sora", name: "SORA 12F", capacity: 6, location: "東京本社・12階", equipment: "モニター", status: "15:30から空室" },
  asahi: { id: "asahi", name: "ASAHI 3F", capacity: 4, location: "大阪支社・3階", equipment: "Teams", status: "13:00から空室" },
  studio: { id: "studio", name: "DESIGN STUDIO", capacity: 16, location: "東京本社・7階", equipment: "ホワイトボード・収録", status: "要承認" },
};

const spaces = {
  product: {
    name: "プロダクト定例", people: ["me", "sato", "suzuki", "chen"], rooms: ["hikari"], lens: "全員と部屋が空く時間", availability: "all",
    slots: [{ day: 0, start: 10.5, duration: .5, label: "30分" }, { day: 1, start: 15, duration: 1, label: "最適", recommended: true }, { day: 3, start: 13, duration: 1, label: "60分" }],
  },
  hiring: {
    name: "採用面談", people: ["me", "yamada", "tanaka"], rooms: ["nagisa", "sora"], lens: "面接官と部屋が空く時間", availability: "all",
    slots: [{ day: 0, start: 14, duration: 1, label: "最適", recommended: true }, { day: 2, start: 11, duration: 1, label: "60分" }, { day: 4, start: 15.5, duration: 1, label: "60分" }],
  },
  sales: {
    name: "営業本部", people: ["me", "watanabe", "ito", "kobayashi", "sato", "suzuki", "chen", "yamada"], rooms: [], lens: "空き密度が最も高い時間", availability: "partial",
    slots: [{ day: 1, start: 11, duration: 1, label: "6 / 8人", recommended: true }, { day: 3, start: 14, duration: 1, label: "5 / 8人" }, { day: 4, start: 16, duration: .5, label: "6 / 8人" }],
  },
};

let events = [
  { id: 1, space: "product", day: 0, start: 9, duration: .5, title: "部門朝会", kind: "mine", owner: "加藤 浩 + 8人", room: "Teams" },
  { id: 2, space: "product", day: 0, start: 11, duration: 1.5, title: "フォーカス時間", kind: "mine", owner: "加藤 浩", room: "非公開" },
  { id: 3, space: "product", day: 0, start: 14, duration: 1, title: "プロダクト定例", kind: "shared", owner: "佐藤 美咲 + 3人", room: "HIKARI 12F" },
  { id: 4, space: "product", day: 0, start: 16.5, duration: .5, title: "1on1 / 鈴木", kind: "gold", owner: "加藤 浩・鈴木 健太", room: "Teams" },
  { id: 5, space: "product", day: 1, start: 9.5, duration: 1, title: "デザインレビュー", kind: "gold", owner: "鈴木 健太 + 4人", room: "DESIGN STUDIO" },
  { id: 6, space: "product", day: 1, start: 11, duration: 1, title: "予定あり", kind: "busy", owner: "詳細は非公開です", room: "—" },
  { id: 7, space: "product", day: 1, start: 13, duration: 1, title: "企画レビュー", kind: "shared", owner: "佐藤 美咲 + 3人", room: "HIKARI 12F" },
  { id: 8, space: "product", day: 1, start: 15.5, duration: 1, title: "顧客ヒアリング", kind: "coral", owner: "加藤 浩 + 2人", room: "Teams" },
  { id: 9, space: "product", day: 2, start: 9, duration: 1, title: "スプリント計画", kind: "shared", owner: "陳 リン + 5人", room: "HIKARI 12F" },
  { id: 10, space: "product", day: 2, start: 12, duration: 1, title: "ランチ", kind: "busy", owner: "詳細は非公開です", room: "—" },
  { id: 11, space: "product", day: 2, start: 14.5, duration: 1.5, title: "開発フォーカス", kind: "mine", owner: "加藤 浩", room: "非公開" },
  { id: 12, space: "product", day: 2, start: 17, duration: .5, title: "リリース確認", kind: "shared", owner: "陳 リン + 3人", room: "Teams" },
  { id: 13, space: "product", day: 3, start: 9.5, duration: 1, title: "事業進捗レビュー", kind: "mine", owner: "加藤 浩 + 6人", room: "NAGISA 8F" },
  { id: 14, space: "product", day: 3, start: 11, duration: 1, title: "予定あり", kind: "busy", owner: "詳細は非公開です", room: "—" },
  { id: 15, space: "product", day: 3, start: 15, duration: .5, title: "週次チェックイン", kind: "shared", owner: "プロダクト定例", room: "Teams" },
  { id: 16, space: "product", day: 4, start: 10, duration: 1, title: "ロードマップ相談", kind: "mine", owner: "加藤 浩・佐藤 美咲", room: "SORA 12F" },
  { id: 17, space: "product", day: 4, start: 13, duration: 1.5, title: "全社共有会", kind: "coral", owner: "全社", room: "オンライン" },
  { id: 18, space: "hiring", day: 0, start: 10, duration: 1, title: "候補者面談 / UX", kind: "coral", owner: "田中 葵 + 2人", room: "NAGISA 8F" },
  { id: 19, space: "hiring", day: 0, start: 13, duration: 1, title: "書類選考会", kind: "shared", owner: "山田 直樹 + 3人", room: "Teams" },
  { id: 20, space: "hiring", day: 1, start: 11, duration: 1.5, title: "最終面接", kind: "coral", owner: "加藤 浩 + 3人", room: "SORA 12F" },
  { id: 21, space: "hiring", day: 2, start: 15, duration: 1, title: "採用定例", kind: "mine", owner: "採用チーム", room: "NAGISA 8F" },
  { id: 22, space: "hiring", day: 3, start: 10.5, duration: 1, title: "カジュアル面談", kind: "shared", owner: "田中 葵 + 1人", room: "Teams" },
  { id: 23, space: "hiring", day: 4, start: 14, duration: 1, title: "面接振り返り", kind: "gold", owner: "山田 直樹 + 2人", room: "SORA 12F" },
  { id: 24, space: "sales", day: 0, start: 9, duration: 1, title: "営業パイプライン", kind: "shared", owner: "営業本部", room: "Teams" },
  { id: 25, space: "sales", day: 0, start: 13, duration: 1, title: "予定あり × 4", kind: "busy", owner: "4人に予定があります", room: "—" },
  { id: 26, space: "sales", day: 1, start: 10, duration: 1.5, title: "顧客提案", kind: "coral", owner: "渡辺 翔 + 4人", room: "Teams" },
  { id: 27, space: "sales", day: 2, start: 14, duration: 1, title: "空き 6 / 8人", kind: "shared", owner: "6人が参加可能", room: "—" },
  { id: 28, space: "sales", day: 3, start: 9.5, duration: 1, title: "本部定例", kind: "mine", owner: "営業本部", room: "NAGISA 8F" },
  { id: 29, space: "sales", day: 4, start: 13, duration: 1.5, title: "予定あり × 6", kind: "busy", owner: "6人に予定があります", room: "—" },
].map(withDemoEventResources);

const weekdays = ["月", "火", "水", "木", "金"];
const baseWeekStart = initialWeekStart;

function addDays(date, amount) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfWorkWeek(date) {
  const weekday = date.getDay();
  const offset = weekday === 0 ? 1 : weekday === 6 ? 2 : 1 - weekday;
  return addDays(date, offset);
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function sameDate(left, right) {
  return dateKey(left) === dateKey(right);
}

function dateForEvent(event) {
  return event.dateKey ? parseDateKey(event.dateKey) : addDays(baseWeekStart, event.day || 0);
}

function eventOccursOn(event, date) {
  return event.status !== "draft" && sameDate(dateForEvent(event), date);
}

function hiddenPeopleForSpace(spaceId = state.activeSpace) {
  return hiddenPersonIds(spaces[spaceId]);
}

function visiblePeopleForSpace(spaceId = state.activeSpace) {
  return visiblePersonIds(spaces[spaceId], people);
}

function eventVisibleInSpace(event, spaceId = state.activeSpace) {
  return eventVisibleInViewSet(event, spaces[spaceId], people, rooms);
}

function weekdayLabel(date) {
  return ["日", "月", "火", "水", "木", "金", "土"][date.getDay()];
}

function fullDateLabel(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日（${weekdayLabel(date)}）`;
}

function icon(name) {
  return `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function avatarColor(value) {
  return ["navy", "blue", "green", "gold", "coral", "plum"].includes(value) ? value : "navy";
}

function presenceClass(value) {
  return ["online", "busy", "away"].includes(value) ? value : "away";
}

function accentClass(value, fallback = "cobalt") {
  return ["cobalt", "coral", "mint"].includes(value) ? value : fallback;
}

function timeLabel(value) {
  const totalMinutes = Math.round(value * 60);
  const hour = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatEventTime(event) {
  return `${timeLabel(event.start)}–${timeLabel(event.start + event.duration)}`;
}

function eventHTML(event) {
  const top = (event.start - 8) * 64;
  const height = Math.max(22, event.duration * 64 - 4);
  const compact = event.duration <= 0.5 ? " compact" : "";
  return `<button class="calendar-event ${["mine", "shared", "busy", "gold", "coral"].includes(event.kind) ? event.kind : "mine"}${compact}" type="button" data-event-id="${escapeHTML(event.id)}" style="top:${top + 2}px;height:${height}px">
    <strong>${escapeHTML(event.title)}</strong><small>${formatEventTime(event)}${event.room && event.room !== "—" ? ` · ${escapeHTML(event.room)}` : ""}</small>
  </button>`;
}

function timeGutterHTML() {
  return `<div class="time-gutter">${Array.from({ length: 12 }, (_, index) => `<span class="time-label" style="top:${index * 64}px">${String(index + 8).padStart(2, "0")}:00</span>`).join("")}</div>`;
}

function weekColumnHTML(day) {
  const columnDate = addDays(state.weekStart, day);
  const dayEvents = events.filter((event) => eventVisibleInSpace(event) && eventOccursOn(event, columnDate));
  const highlight = state.highlight && state.highlight.dateKey === dateKey(columnDate)
    ? `<div class="slot-highlight" style="top:${(state.highlight.start - 8) * 64 + 2}px;height:${state.highlight.duration * 64 - 4}px"></div>`
    : "";
  return `<div class="day-column${sameDate(columnDate, new Date()) ? " today-column" : ""}" data-date="${dateKey(columnDate)}"><div class="business-hours"></div>${highlight}${dayEvents.map(eventHTML).join("")}</div>`;
}

function renderWeek(scrollState = null) {
  const weekDates = weekdays.map((_, index) => addDays(state.weekStart, index));
  const first = weekDates[0];
  const last = weekDates[4];
  ui.dateTitle.textContent = first.getMonth() === last.getMonth()
    ? `${first.getMonth() + 1}月${first.getDate()}日 — ${last.getDate()}日`
    : `${first.getMonth() + 1}月${first.getDate()}日 — ${last.getMonth() + 1}月${last.getDate()}日`;
  ui.dateTitle.nextElementSibling.textContent = `${first.getFullYear()}年・平日5日間`;
  const header = weekDates.map((date) => `<div class="day-heading${sameDate(date, new Date()) ? " today" : ""}"><span class="weekday">${weekdayLabel(date)}</span><span class="date-number">${date.getDate()}</span></div>`).join("");
  ui.calendarView.innerHTML = `<div class="week-view">
    <div class="week-header"><div class="tz-cell">JST</div>${header}</div>
    <div class="calendar-scroll"><div class="timeline-grid">${timeGutterHTML()}${weekdays.map((_, index) => weekColumnHTML(index)).join("")}</div></div>
  </div>`;
  window.requestAnimationFrame(() => {
    const scroll = ui.calendarView.querySelector(".calendar-scroll");
    if (scroll) {
      scroll.scrollTop = scrollState?.top ?? 32;
      scroll.scrollLeft = scrollState?.left ?? 0;
    }
  });
}

function renderDay(scrollState = null) {
  ui.dateTitle.textContent = fullDateLabel(state.selectedDate);
  ui.dateTitle.nextElementSibling.textContent = `${state.selectedDate.getFullYear()}年・リソース比較`;
  const space = spaces[state.activeSpace];
  const resources = dayResourcesForSpace(space, people, rooms);
  if (!resources.length) {
    ui.calendarView.innerHTML = `<div class="calendar-empty-state">
      <span class="calendar-empty-mark">${icon("users")}</span>
      <p>表示中のメンバーがいません</p>
      <small>左のメンバースイッチをオンにすると、予定を比較できます。</small>
    </div>`;
    return;
  }
  const headings = resources.map((resource) => `<div class="resource-heading">${resource.type === "room" ? `<span class="room-icon">${icon("room")}</span>` : `<span class="avatar avatar-${avatarColor(resource.color)}">${escapeHTML(resource.short)}</span>`}<span><strong>${escapeHTML(resource.label)}</strong><small>${escapeHTML(resource.sub)}</small></span></div>`).join("");
  const activeDateEvents = events.filter((event) => eventVisibleInSpace(event) && eventOccursOn(event, state.selectedDate));
  const columns = resources.map((resource) => {
    const sourceEvents = activeDateEvents.filter((event) => eventMatchesDayResource(event, resource, people, rooms));
    const resourceEvents = sourceEvents.map((event) => ({ ...event, dateKey: dateKey(state.selectedDate) }));
    const highlight = state.highlight && state.highlight.dateKey === dateKey(state.selectedDate)
      ? `<div class="slot-highlight" style="top:${(state.highlight.start - 8) * 64 + 2}px;height:${state.highlight.duration * 64 - 4}px"></div>`
      : "";
    return `<div class="day-column" data-date="${dateKey(state.selectedDate)}" data-resource="${escapeHTML(resource.id)}"><div class="business-hours"></div>${highlight}${resourceEvents.map(eventHTML).join("")}</div>`;
  }).join("");
  const columnsStyle = `grid-template-columns:52px repeat(${resources.length},minmax(135px,1fr))`;
  const columnsMinWidth = Math.max(640, 52 + resources.length * 135);
  ui.calendarView.innerHTML = `<div class="day-view"><div class="resource-day-header" style="${columnsStyle};min-width:${columnsMinWidth}px"><div class="tz-cell">JST</div>${headings}</div><div class="calendar-scroll" style="min-width:${columnsMinWidth}px"><div class="timeline-grid" style="${columnsStyle};min-width:${columnsMinWidth}px">${timeGutterHTML()}${columns}</div></div></div>`;
  window.requestAnimationFrame(() => {
    const scroll = ui.calendarView.querySelector(".calendar-scroll");
    const horizontalScroll = ui.calendarView.querySelector(".day-view");
    if (scroll) {
      scroll.scrollTop = scrollState?.top ?? 32;
      scroll.scrollLeft = scrollState?.left ?? 0;
    }
    if (horizontalScroll) horizontalScroll.scrollLeft = scrollState?.horizontalLeft ?? 0;
  });
}

function monthEventData(date) {
  return events.filter((event) => eventVisibleInSpace(event) && eventOccursOn(event, date));
}

function renderMonth() {
  const monthYear = state.monthDate.getFullYear();
  const monthIndex = state.monthDate.getMonth();
  ui.dateTitle.textContent = `${monthYear}年 ${monthIndex + 1}月`;
  ui.dateTitle.nextElementSibling.textContent = "月全体の会議密度";
  const weekdayHeader = ["日", "月", "火", "水", "木", "金", "土"].map((day) => `<span>${day}</span>`).join("");
  const firstOfMonth = new Date(monthYear, monthIndex, 1);
  const startDate = addDays(firstOfMonth, -firstOfMonth.getDay());
  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = addDays(startDate, index);
    const inside = date.getMonth() === monthIndex;
    const day = date.getDate();
    const allDayEvents = inside ? monthEventData(date) : [];
    const dayEvents = allDayEvents.slice(0, 2);
    const density = allDayEvents.length
      ? `<div class="month-density">${allDayEvents.slice(0, 4).map((calendarEvent) => `<i class="${calendarEvent.kind === "busy" ? "busy" : "open"}"></i>`).join("")}</div>`
      : "";
    const eventMarkup = dayEvents.map((event) => `<span class="month-event ${event.kind || "mine"}">${escapeHTML(event.title)}</span>`).join("");
    const more = inside && allDayEvents.length > 2 ? `<small class="more-events">+${allDayEvents.length - 2}件</small>` : "";
    return `<button class="month-day${inside ? "" : " outside"}${sameDate(date, new Date()) ? " today" : ""}" type="button" data-month-date="${dateKey(date)}"><span class="month-number">${day}</span>${eventMarkup}${more}${density}</button>`;
  }).join("");
  ui.calendarView.innerHTML = `<div class="month-view"><div class="month-weekdays">${weekdayHeader}</div><div class="month-grid">${cells}</div></div>`;
}

function captureCalendarScroll() {
  const scroll = ui.calendarView.querySelector(".calendar-scroll");
  const horizontalScroll = ui.calendarView.querySelector(".day-view");
  return {
    top: scroll?.scrollTop || 0,
    left: scroll?.scrollLeft || 0,
    horizontalLeft: horizontalScroll?.scrollLeft || 0,
  };
}

function renderCalendar(scrollState = null) {
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
  if (state.view === "day") renderDay(scrollState);
  else if (state.view === "month") renderMonth();
  else renderWeek(scrollState);
}

function renderResources() {
  const space = spaces[state.activeSpace];
  const visiblePeople = visiblePeopleForSpace();
  const visiblePeopleSet = new Set(visiblePeople);
  const lensMode = lensModeForSpace(space, people);
  renderSpaceList();
  ui.peopleResourceList.innerHTML = space.people.map((id) => {
    const person = people[id];
    if (!person) return "";
    const visible = visiblePeopleSet.has(id);
    const pending = memberVisibilityPending.has(`${state.activeSpace}:${id}`);
    return `<button class="resource-person${visible ? "" : " is-hidden"}${pending ? " is-saving" : ""}" type="button" role="switch" aria-checked="${visible}" aria-disabled="${pending}" aria-label="${escapeHTML(person.name)}のカレンダー表示" title="${escapeHTML(person.name)}をカレンダーで${visible ? "非表示にする" : "表示する"}" data-person="${escapeHTML(id)}" data-member-visibility="${escapeHTML(id)}">
      <span class="avatar-wrap"><span class="avatar avatar-${avatarColor(person.color)}">${escapeHTML(person.short)}</span><i class="presence ${presenceClass(person.presence)}" aria-hidden="true"></i></span>
      <span class="resource-copy"><strong>${escapeHTML(person.name)}</strong><small>${id === "me" ? "自分の予定" : escapeHTML(person.department.split(" / ").at(-1))}</small></span>
      <span class="member-switch" aria-hidden="true"><i></i></span>
    </button>`;
  }).join("");
  ui.roomResourceList.innerHTML = space.rooms.length
    ? space.rooms.map((id) => {
        const room = rooms[id];
        return `<button class="room-row selected" type="button"><span class="room-icon">${icon("room")}</span><span><strong>${escapeHTML(room.name)}</strong><small>${Number(room.capacity)}名・${escapeHTML(room.equipment)}</small></span><i class="presence online"></i></button>`;
      }).join("") + `<button class="add-resource" type="button" data-open-directory="rooms">${icon("plus")} 会議室を追加</button>`
    : `<button class="add-resource" type="button" data-open-directory="rooms">${icon("plus")} 会議室を追加</button>`;
  const tabButtons = document.querySelectorAll("[data-resource-tab]");
  tabButtons[0].querySelector("span").textContent = `${visiblePeople.length}/${space.people.length}`;
  tabButtons[1].querySelector("span").textContent = space.rooms.length;
  ui.selectionTitle.textContent = space.name;
  ui.lensTitle.textContent = lensMode === "current"
    ? space.lens
    : lensMode === "saved"
      ? `${space.people.length}人全員を基準にした候補`
      : "表示するメンバーを選択";
  renderLensSlots();
  document.querySelector(".lens-more").hidden = lensMode !== "current";
  const avatars = visiblePeople.slice(0, 5).map((id) => `<i class="avatar avatar-${avatarColor(people[id].color)}">${escapeHTML(people[id].short)}</i>`).join("");
  const extra = visiblePeople.length > 5 ? `<i class="avatar avatar-navy">+${visiblePeople.length - 5}</i>` : "";
  const roomPill = space.rooms.length ? `<span class="room-pill">${icon("room")} ${escapeHTML(rooms[space.rooms[0]].name)}${space.rooms.length > 1 ? ` +${space.rooms.length - 1}` : ""}</span>` : "";
  ui.selectionSummary.innerHTML = `<span class="stacked-avatars" aria-hidden="true">${avatars}${extra}</span><span><strong id="selection-title">${escapeHTML(space.name)}</strong> · ${visiblePeople.length}/${space.people.length}人を表示中</span>${roomPill}`;
  ui.selectionTitle = document.querySelector("#selection-title");
  renderComposerContext();
}

function renderSpaceList() {
  const accents = ["cobalt", "coral", "mint"];
  document.querySelector("#space-list").innerHTML = Object.entries(spaces).map(([id, space], index) => {
    const roomCopy = space.rooms.length ? `${space.rooms.length}部屋` : "空き状況";
    return `<button class="space-row${id === state.activeSpace ? " active" : ""}" type="button" data-space="${escapeHTML(id)}">
      <span class="space-swatch ${accentClass(space.accent, accents[index % accents.length])}"></span>
      <span class="space-copy"><strong>${escapeHTML(space.name)}</strong><small>${space.people.length}人・${roomCopy}</small></span>
      ${index < 3 ? `<span class="space-key">${index + 1}</span>` : ""}
    </button>`;
  }).join("");
}

function renderLensSlots() {
  const space = spaces[state.activeSpace];
  const lensSlots = document.querySelector("#lens-slots");
  const lensMode = lensModeForSpace(space, people);
  if (lensMode === "empty") {
    lensSlots.innerHTML = `<p class="lens-empty">メンバーをオンにすると候補を表示します</p>`;
    return;
  }
  if (lensMode === "saved") {
    lensSlots.innerHTML = `<p class="lens-empty">${space.people.length}人全員を基準にした保存済み候補です。全員をオンにすると表示します</p>`;
    return;
  }
  lensSlots.innerHTML = space.slots.map((slot) => `<button${slot.recommended ? ' class="recommended"' : ""} type="button" data-slot-day="${slot.day}" data-slot-start="${slot.start}" data-slot-duration="${slot.duration}"><span>${weekdayLabel(addDays(state.weekStart, slot.day))}</span><strong>${timeLabel(slot.start)}–${timeLabel(slot.start + slot.duration)}</strong><small>${escapeHTML(slot.label)}</small></button>`).join("");
}

function renderComposerContext() {
  const space = spaces[state.activeSpace];
  const selectedPeople = state.composerSelection ? [...state.composerSelection.people] : space.people;
  const selectedRooms = state.composerSelection ? [...state.composerSelection.rooms] : space.rooms;
  const attendeeContainer = document.querySelector("#composer-attendees");
  if (!attendeeContainer) return;
  attendeeContainer.innerHTML = selectedPeople.filter((id) => people[id]).map((id) => `<span class="person-chip"><i class="avatar avatar-${avatarColor(people[id].color)}">${escapeHTML(people[id].short)}</i>${escapeHTML(people[id].name)}</span>`).join("");
  const availability = document.querySelector("#composer-availability");
  const partial = space.availability === "partial" || selectedPeople.length > 5;
  availability.classList.toggle("partial", partial);
  availability.innerHTML = `${icon(partial ? "users" : "check")}<span><strong>${partial ? `${Math.max(1, selectedPeople.length - 2)} / ${selectedPeople.length}人が空いています` : "全員が空いています"}</strong><small>${partial ? "未参加の2人を確認してから保存できます" : "勤務時間・予定ありを確認済み"}</small></span>`;
  const roomButton = document.querySelector("#composer-room");
  if (selectedRooms.length) {
    const room = rooms[selectedRooms[0]];
    roomButton.removeAttribute("data-open-directory");
    roomButton.innerHTML = `<span class="room-icon">${icon("room")}</span><span><strong>${escapeHTML(room.name)}</strong><small>${room.capacity}名・${escapeHTML(room.equipment)}</small></span><span class="recommendation-label">最適</span><svg class="end-chevron"><use href="#i-chevron-right"/></svg>`;
  } else {
    roomButton.setAttribute("data-open-directory", "rooms");
    roomButton.innerHTML = `<span class="room-icon">${icon("plus")}</span><span><strong>会議室を選択</strong><small>参加人数と設備から候補を表示</small></span><svg class="end-chevron"><use href="#i-chevron-right"/></svg>`;
  }
}

function switchSpace(spaceId) {
  if (!spaces[spaceId]) return;
  state.activeSpace = spaceId;
  state.highlight = null;
  void appRepository?.saveSetting("activeSpace", spaceId).catch((error) => {
    showToast("選択状態を保存できませんでした", error.message || "もう一度お試しください");
  });
  document.querySelectorAll(".space-row").forEach((row) => row.classList.toggle("active", row.dataset.space === spaceId));
  renderResources();
  renderCalendar();
  showToast("表示セットを切り替えました", `${spaces[spaceId].name} · ${visiblePeopleForSpace(spaceId).length}/${spaces[spaceId].people.length}人を表示`);
}

function renderResourcesPreservingMemberFocus() {
  const focusedToggle = document.activeElement?.closest?.("[data-member-visibility]");
  const focusedPersonId = focusedToggle && ui.peopleResourceList.contains(focusedToggle)
    ? focusedToggle.dataset.memberVisibility
    : null;
  const focusedSpaceId = state.activeSpace;
  renderResources();
  if (!focusedPersonId || state.activeSpace !== focusedSpaceId) return;
  document.querySelector(`[data-member-visibility="${CSS.escape(focusedPersonId)}"]`)?.focus({ preventScroll: true });
}

async function toggleMemberVisibility(personId) {
  const spaceId = state.activeSpace;
  const space = spaces[spaceId];
  const pendingKey = `${spaceId}:${personId}`;
  if (!space?.people.includes(personId) || memberVisibilityPending.has(pendingKey)) return;
  const hiddenPeople = hiddenPeopleForSpace(spaceId);
  const wasHidden = hiddenPeople.has(personId);
  if (wasHidden) hiddenPeople.delete(personId);
  else hiddenPeople.add(personId);
  space.hiddenPeople = space.people.filter((id) => hiddenPeople.has(id));
  memberVisibilityPending.add(pendingKey);
  const calendarScroll = captureCalendarScroll();
  renderResourcesPreservingMemberFocus();
  renderCalendar(calendarScroll);
  try {
    await appRepository.setViewSetPersonVisibility(spaceId, personId, wasHidden);
  } catch (error) {
    const currentHidden = hiddenPeopleForSpace(spaceId);
    if (wasHidden) currentHidden.add(personId);
    else currentHidden.delete(personId);
    space.hiddenPeople = space.people.filter((id) => currentHidden.has(id));
    showToast("表示状態を保存できませんでした", error.message || "もう一度お試しください");
    if (state.activeSpace === spaceId) renderCalendar(captureCalendarScroll());
  } finally {
    memberVisibilityPending.delete(pendingKey);
    if (state.activeSpace === spaceId) renderResourcesPreservingMemberFocus();
  }
}

function openDirectory(mode = "people", context = "viewSet") {
  state.lastFocus = document.activeElement;
  state.directoryMode = mode;
  state.directoryContext = context;
  const space = spaces[state.activeSpace];
  const sourceSelection = context === "composer" && state.composerSelection
    ? state.composerSelection
    : { people: new Set(space.people.filter((id) => id !== "me")), rooms: new Set(space.rooms) };
  state.pendingSelection = {
    people: new Set([...sourceSelection.people].filter((id) => id !== "me")),
    rooms: new Set(sourceSelection.rooms),
  };
  document.querySelector("#app-frame").setAttribute("inert", "");
  ui.directoryOverlay.removeAttribute("inert");
  ui.directoryOverlay.classList.add("open");
  ui.directoryOverlay.setAttribute("aria-hidden", "false");
  ui.directorySearch.value = "";
  setDirectoryMode(mode);
  window.setTimeout(() => ui.directorySearch.focus(), 70);
}

function closeDirectory() {
  ui.directoryOverlay.classList.remove("open");
  ui.directoryOverlay.setAttribute("aria-hidden", "true");
  ui.directoryOverlay.setAttribute("inert", "");
  document.querySelector("#app-frame").removeAttribute("inert");
  if (state.lastFocus?.isConnected) window.setTimeout(() => state.lastFocus.focus(), 0);
}

async function applyDirectorySelection() {
  const space = spaces[state.activeSpace];
  if (state.directoryContext === "composer") {
    state.composerSelection = {
      people: new Set(["me", ...state.pendingSelection.people].filter((id, index, list) => people[id] && list.indexOf(id) === index)),
      rooms: new Set([...state.pendingSelection.rooms].filter((id) => rooms[id])),
    };
    renderComposerContext();
    closeDirectory();
    showToast("予定の参加者を更新しました", `${state.composerSelection.people.size}人・${state.composerSelection.rooms.size}部屋`);
    return;
  }
  const nextPeople = ["me", ...state.pendingSelection.people].filter((id, index, list) => people[id] && list.indexOf(id) === index);
  const nextSpace = {
    ...space,
    people: nextPeople,
    hiddenPeople: (space.hiddenPeople || []).filter((id) => nextPeople.includes(id)),
    rooms: [...state.pendingSelection.rooms].filter((id) => rooms[id]),
  };
  await appRepository?.saveViewSet({ id: state.activeSpace, ...nextSpace });
  spaces[state.activeSpace] = nextSpace;
  renderResources();
  renderCalendar();
  closeDirectory();
  showToast("表示セットを更新しました", `${nextSpace.people.length}人・${nextSpace.rooms.length}部屋`);
}

function setDirectoryMode(mode) {
  state.directoryMode = mode;
  document.querySelectorAll("[data-directory-mode]").forEach((button) => button.classList.toggle("active", button.dataset.directoryMode === mode));
  ui.peopleFilters.classList.toggle("hidden", mode !== "people");
  ui.roomFilters.classList.toggle("hidden", mode !== "rooms");
  ui.directorySearch.placeholder = mode === "people" ? "名前、よみ、メール、所属で検索" : "会議室名、拠点、定員、設備で検索";
  void renderDirectoryResults();
}

function normalized(value) {
  return value.toLocaleLowerCase("ja-JP").normalize("NFKC").replace(/\s+/g, " ").trim();
}

async function renderDirectoryResults() {
  const requestId = ++directoryRequestId;
  const query = normalized(ui.directorySearch.value);
  const activeFilter = state.directoryFilters[state.directoryMode];
  const filterQuery = state.directoryMode === "people"
    ? ({ product: "プロダクト本部", tokyo: "東京" }[activeFilter] || "")
    : ({ available: "空室", tokyo: "東京本社", teams: "teams" }[activeFilter] || "");
  const effectiveQuery = normalized([query, filterQuery].filter(Boolean).join(" "));
  const tokens = effectiveQuery.split(" ").filter(Boolean);
  const startedAt = performance.now();
  let results;
  try {
    if (state.directoryMode === "people" && activeFilter === "recent") {
      results = spaces[state.activeSpace].people
        .filter((id) => id !== "me")
        .map((id) => people[id])
        .filter(Boolean)
        .filter((person) => tokens.every((token) => normalized(`${person.name} ${person.department} ${person.role} ${person.location} ${person.mail}`).includes(token)));
    } else if (appRepository) {
      results = state.directoryMode === "people"
        ? await appRepository.searchPeople(effectiveQuery, { limit: 50 })
        : await appRepository.searchRooms(effectiveQuery, {
            limit: 50,
            minCapacity: activeFilter === "capacity" ? 8 : undefined,
          });
    } else {
      const source = state.directoryMode === "people" ? Object.values(people).filter((person) => person.id !== "me") : Object.values(rooms);
      results = source.filter((item) => {
        const haystack = state.directoryMode === "people"
          ? normalized(`${item.name} ${item.department} ${item.role} ${item.location} ${item.mail}`)
          : normalized(`${item.name} ${item.location} ${item.capacity}名 ${item.equipment} ${item.status}`);
        return tokens.every((token) => haystack.includes(token));
      }).slice(0, 50);
    }
  } catch (error) {
    if (requestId !== directoryRequestId) return;
    ui.resultHeading.textContent = "検索できませんでした";
    ui.resultCount.textContent = "再試行してください";
    ui.directoryResults.innerHTML = `<div class="empty-result"><span>${icon("search")}<strong>ローカル索引を読み込めません</strong><small>${escapeHTML(error.message || "不明なエラー")}</small></span></div>`;
    return;
  }
  if (requestId !== directoryRequestId) return;
  if (state.directoryMode === "people") {
    results = results.filter((person) => person.id !== "me");
    results.forEach((person) => { people[person.id] = person; });
  } else {
    if (activeFilter === "capacity") results = results.filter((room) => room.capacity >= 8);
    results.forEach((room) => { rooms[room.id] = room; });
  }
  const elapsed = Math.max(0.001, (performance.now() - startedAt) / 1000).toFixed(2);
  ui.resultHeading.textContent = query ? `「${ui.directorySearch.value}」の検索結果` : state.directoryMode === "people" ? "おすすめ・最近使った人" : "条件に合う会議室";
  ui.resultCount.textContent = query ? `${results.length}件${results.length === 50 ? "以上" : ""} · ${elapsed}秒` : `${elapsed}秒`;
  if (!results.length) {
    ui.directoryResults.innerHTML = `<div class="empty-result"><span>${icon("search")}<strong>一致する${state.directoryMode === "people" ? "メンバー" : "会議室"}がありません</strong><small>所属や拠点を外すか、別のキーワードを試してください。</small></span></div>`;
    return;
  }
  ui.directoryResults.innerHTML = results.map((item, index) => {
    const selected = state.pendingSelection[state.directoryMode].has(item.id);
    if (state.directoryMode === "people") {
      return `<button class="directory-result${selected ? " selected" : ""}${index === 0 ? " focused" : ""}" type="button" data-directory-id="${escapeHTML(item.id)}">
        <span class="avatar avatar-${avatarColor(item.color)}">${escapeHTML(item.short)}</span>
        <span class="result-person-copy"><strong>${escapeHTML(item.name)}</strong><small>${escapeHTML(item.department)} · ${escapeHTML(item.role)}</small><small>${escapeHTML(item.mail)}</small></span>
        <span class="result-location">${icon("map")}${escapeHTML(item.location)}</span>
        <span class="result-action">${icon(selected ? "check" : "plus")}</span>
      </button>`;
    }
    return `<button class="directory-result${selected ? " selected" : ""}${index === 0 ? " focused" : ""}" type="button" data-directory-id="${escapeHTML(item.id)}">
      <span class="room-icon">${icon("room")}</span>
      <span class="result-person-copy"><strong>${escapeHTML(item.name)}</strong><small>${escapeHTML(item.location)} · ${item.capacity}名 · ${escapeHTML(item.equipment)}</small><small>${escapeHTML(item.status)}</small></span>
      <span class="result-location">${item.capacity >= 8 ? "推奨" : ""}</span>
      <span class="result-action">${icon(selected ? "check" : "plus")}</span>
    </button>`;
  }).join("");
}

function toggleDirectoryItem(id) {
  const selection = state.pendingSelection[state.directoryMode];
  if (selection.has(id)) selection.delete(id);
  else selection.add(id);
  void renderDirectoryResults();
}

function closeDrawers({ restoreFocus = true } = {}) {
  [ui.eventDrawer, ui.detailDrawer].forEach((drawer) => {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    drawer.setAttribute("inert", "");
  });
  state.composerSelection = null;
  state.editingDraft = null;
  if (restoreFocus && state.lastFocus?.isConnected) window.setTimeout(() => state.lastFocus.focus(), 0);
}

function openEventDrawer({ date = state.selectedDate, start = 10, duration = 60, draft = null, template = null } = {}) {
  const trigger = document.activeElement;
  closeDrawers({ restoreFocus: false });
  state.lastFocus = trigger;
  state.editingDraft = draft ? { id: draft.id, transactionId: draft.transactionId } : null;
  const source = draft || template;
  const sourceResourceIds = new Set(source?.resourceIds || []);
  const space = spaces[state.activeSpace];
  const selectedPeople = sourceResourceIds.size
    ? Object.keys(people).filter((id) => sourceResourceIds.has(id))
    : [...space.people];
  if (!selectedPeople.includes("me") && people.me) selectedPeople.unshift("me");
  state.composerSelection = {
    people: new Set(selectedPeople),
    rooms: new Set(sourceResourceIds.size ? Object.keys(rooms).filter((id) => sourceResourceIds.has(id)) : space.rooms),
  };
  state.selectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  document.querySelector("#event-date").value = dateKey(state.selectedDate);
  document.querySelector("#event-time").value = timeLabel(Number(start));
  document.querySelector("#event-duration").value = String(duration);
  document.querySelector("#event-title-input").value = source?.title || "";
  document.querySelector("#event-notes").value = source?.notes || "";
  document.querySelector(".teams-toggle .toggle").classList.toggle("on", source?.teamsMeeting !== false);
  renderComposerContext();
  ui.eventDrawer.removeAttribute("inert");
  ui.eventDrawer.classList.add("open");
  ui.eventDrawer.setAttribute("aria-hidden", "false");
  window.setTimeout(() => document.querySelector("#event-title-input").select(), 180);
}

function openLatestDraft() {
  const draft = [...events].reverse().find((event) => event.space === state.activeSpace && event.status === "draft");
  if (!draft) {
    openEventDrawer();
    return;
  }
  openEventDrawer({ date: parseDateKey(draft.dateKey), start: draft.start, duration: draft.duration * 60, draft });
  showToast("下書きを復元しました", "ローカル保存された内容です");
}

function findEventById(id) {
  return events.find((event) => String(event.id) === String(id)) || null;
}

function openEventDetail(event) {
  if (!event) return;
  const trigger = document.activeElement;
  closeDrawers({ restoreFocus: false });
  state.lastFocus = trigger;
  state.detailEventId = event.id;
  document.querySelector("#detail-title").textContent = event.title;
  const eventDate = dateForEvent(event);
  document.querySelector("#detail-date").textContent = eventDate.getDate();
  document.querySelector("#detail-day").textContent = fullDateLabel(eventDate);
  document.querySelector("#detail-time").textContent = formatEventTime(event);
  document.querySelector("#detail-owner").textContent = event.owner || "共有予定";
  document.querySelector("#detail-room").textContent = event.room || "場所未設定";
  document.querySelector("#detail-online").textContent = event.teamsMeeting || event.room === "Teams" ? "Teams会議（デモ）" : "オンライン会議なし";
  document.querySelector("#detail-note").textContent = event.notes || "メモはありません。";
  const privacy = document.querySelector(".privacy-note");
  const local = ["local", "draft"].includes(event.status);
  privacy.querySelector("strong").textContent = local ? "ローカル予定" : event.kind === "busy" ? "詳細は非公開" : "共有された詳細";
  privacy.querySelector("small").textContent = local ? "この端末だけに保存されています" : "閲覧権限に応じた情報のみ表示しています";
  ui.detailDrawer.removeAttribute("inert");
  ui.detailDrawer.classList.add("open");
  ui.detailDrawer.setAttribute("aria-hidden", "false");
}

function openAppearance() {
  state.lastFocus = document.activeElement;
  ui.appearancePanel.removeAttribute("inert");
  ui.appearancePanel.classList.add("open");
  ui.appearancePanel.setAttribute("aria-hidden", "false");
}

function closeAppearance() {
  ui.appearancePanel.classList.remove("open");
  ui.appearancePanel.setAttribute("aria-hidden", "true");
  ui.appearancePanel.setAttribute("inert", "");
  if (state.lastFocus?.isConnected) window.setTimeout(() => state.lastFocus.focus(), 0);
}

function persistAppearanceSettings(extra = {}) {
  window.clearTimeout(settingsSaveTimer);
  appearanceState = {
    ...appearanceState,
    backgroundVisibility: Number(document.querySelector("#background-range").value),
    panelTransparency: Number(document.querySelector("#panel-range").value),
    readability: document.querySelector("#readability-toggle").classList.contains("on"),
    ...extra,
  };
  settingsSaveTimer = window.setTimeout(() => {
    void appRepository?.saveSetting("appearance", appearanceState).catch((error) => {
      showToast("外観設定を保存できませんでした", error.message || "画像サイズを小さくしてください");
    });
  }, 140);
}

function setBackgroundVisibility(value) {
  const numeric = Number(value);
  document.querySelector("#background-output").textContent = `${numeric}%`;
  const overlay = Math.max(0.08, 0.62 - numeric * 0.009);
  ui.root.style.setProperty("--bg-overlay", overlay.toFixed(2));
  persistAppearanceSettings();
}

function setPanelTransparency(value) {
  const numeric = Number(value);
  document.querySelector("#panel-output").textContent = `${numeric}%`;
  ui.root.style.setProperty("--pane-alpha", (1 - numeric / 100).toFixed(2));
  ui.root.style.setProperty("--calendar-alpha", (0.985 - numeric / 240).toFixed(3));
  persistAppearanceSettings();
}

function applyPreset(name) {
  const presets = { clear: { background: 52, panel: 18 }, mist: { background: 28, panel: 12 }, focus: { background: 4, panel: 2 } };
  const preset = presets[name];
  document.querySelector("#background-range").value = preset.background;
  document.querySelector("#panel-range").value = preset.panel;
  setBackgroundVisibility(preset.background);
  setPanelTransparency(preset.panel);
  document.querySelectorAll("[data-preset]").forEach((button) => button.classList.toggle("active", button.dataset.preset === name));
  persistAppearanceSettings({ preset: name });
}

function openSync() {
  state.lastFocus = document.activeElement;
  document.querySelector("#app-frame").setAttribute("inert", "");
  ui.syncModal.removeAttribute("inert");
  ui.syncModal.classList.add("open");
  ui.syncModal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => document.querySelector("#run-sync").focus(), 40);
}

function closeSync() {
  ui.syncModal.classList.remove("open");
  ui.syncModal.setAttribute("aria-hidden", "true");
  ui.syncModal.setAttribute("inert", "");
  document.querySelector("#app-frame").removeAttribute("inert");
  if (state.lastFocus?.isConnected) window.setTimeout(() => state.lastFocus.focus(), 0);
}

function openDisplaySetModal() {
  state.lastFocus = document.activeElement;
  const source = spaces[state.activeSpace];
  const modal = document.querySelector("#display-set-modal");
  document.querySelector("#display-set-name").value = `${source.name} コピー`;
  document.querySelector("#new-set-source-name").textContent = source.name;
  document.querySelector("#new-set-avatars").innerHTML = source.people.slice(0, 5).map((id) => `<i class="avatar avatar-${avatarColor(people[id].color)}">${escapeHTML(people[id].short)}</i>`).join("");
  document.querySelector("#app-frame").setAttribute("inert", "");
  modal.removeAttribute("inert");
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => document.querySelector("#display-set-name").select(), 80);
}

function closeDisplaySetModal() {
  const modal = document.querySelector("#display-set-modal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  modal.setAttribute("inert", "");
  document.querySelector("#app-frame").removeAttribute("inert");
  if (state.lastFocus?.isConnected) window.setTimeout(() => state.lastFocus.focus(), 0);
}

async function createDisplaySet(name) {
  const sourceId = state.activeSpace;
  const source = spaces[sourceId];
  const id = createId("set");
  const nextSpace = {
    name,
    people: [...source.people],
    hiddenPeople: [...(source.hiddenPeople || [])],
    rooms: [...source.rooms],
    lens: source.lens,
    availability: source.availability,
    slots: source.slots.map((slot) => ({ ...slot })),
    accent: "cobalt",
  };
  await appRepository?.saveViewSet({ id, ...nextSpace });
  spaces[id] = nextSpace;
  state.activeSpace = id;
  void appRepository?.saveSetting("activeSpace", id).catch((error) => {
    showToast("選択状態を保存できませんでした", error.message || "表示セット自体は保存済みです");
  });
  closeDisplaySetModal();
  renderResources();
  renderCalendar();
  showToast("表示セットを作成しました", name);
}

function formatSyncTime(value) {
  if (!value) return "未実行";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(parsed);
}

function renderSyncState(sync = {}) {
  const count = Number(sync.count ?? sync.itemCount ?? 0);
  const formattedCount = new Intl.NumberFormat("ja-JP").format(count);
  document.querySelectorAll("[data-directory-count]").forEach((node) => {
    node.textContent = `${formattedCount}${node.dataset.countSuffix || ""}`;
  });
  const updated = formatSyncTime(sync.lastSuccess);
  document.querySelectorAll("[data-directory-updated]").forEach((node) => {
    node.textContent = node.closest(".directory-status") ? `最終更新　${updated}` : updated;
  });
  document.querySelector("#sync-health").textContent = sync.status === "error" ? "要確認" : "正常";
  document.querySelector("#sync-index-status").textContent = sync.status === "running" ? "更新中" : "準備完了";
  document.querySelector("#sync-source").textContent = sync.source === "graph" ? "Microsoft Entra ID" : "ローカルデモデータ";
  document.querySelector("#sync-added").textContent = `+${sync.added ?? 0} 追加`;
  document.querySelector("#sync-updated").textContent = `${sync.updated ?? 0} 更新`;
  document.querySelector("#sync-disabled").textContent = `${sync.disabled ?? 0} 無効`;
}

async function runSync() {
  const modalCard = ui.syncModal.querySelector("section");
  const button = document.querySelector("#run-sync");
  if (button.disabled) return;
  button.disabled = true;
  button.innerHTML = `${icon("refresh")}差分を取得中…`;
  modalCard.classList.add("sync-progress");
  try {
    const sync = await appRepository.runDirectorySync();
    renderSyncState(sync);
    closeSync();
    showToast("ローカル名簿を更新しました", `検索対象 ${new Intl.NumberFormat("ja-JP").format(sync.count ?? 0)}件`);
  } catch (error) {
    showToast("名簿を更新できませんでした", error.message || "直前のデータを維持しています");
  } finally {
    button.disabled = false;
    button.innerHTML = `${icon("refresh")}今すぐ更新`;
    modalCard.classList.remove("sync-progress");
  }
}

function showToast(title, detail = "") {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `${icon("check")}<span><strong>${escapeHTML(title)}</strong>${detail ? `<small>${escapeHTML(detail)}</small>` : ""}</span>`;
  ui.toastRegion.appendChild(toast);
  window.setTimeout(() => toast.classList.add("leaving"), 2800);
  window.setTimeout(() => toast.remove(), 3020);
}

function selectLensSlot(button) {
  const day = Number(button.dataset.slotDay);
  const start = Number(button.dataset.slotStart);
  const duration = Number(button.dataset.slotDuration || 1);
  const slotDate = addDays(state.weekStart, day);
  state.view = "week";
  state.highlight = { dateKey: dateKey(slotDate), start, duration };
  renderCalendar();
  window.setTimeout(() => openEventDrawer({ date: slotDate, start, duration: state.highlight.duration * 60 }), 240);
}

document.addEventListener("click", (event) => {
  const target = event.target;
  const viewButton = target.closest("[data-view]");
  if (viewButton) {
    const nextView = viewButton.dataset.view;
    if (nextView === "month") {
      const reference = state.view === "week" ? state.weekStart : state.selectedDate;
      state.monthDate = new Date(reference.getFullYear(), reference.getMonth(), 1);
    } else if (nextView === "week") {
      const reference = state.view === "month" ? state.monthDate : state.selectedDate;
      const weekday = reference.getDay();
      state.weekStart = startOfWorkWeek(reference);
    } else if (nextView === "day" && state.view === "week") {
      state.selectedDate = addDays(state.weekStart, state.selectedDay);
    }
    state.view = nextView;
    state.highlight = null;
    renderCalendar();
    return;
  }

  const dateStep = target.closest("[data-date-step]");
  if (dateStep) {
    const direction = Number(dateStep.dataset.dateStep);
    state.highlight = null;
    if (state.view === "week") state.weekStart = addDays(state.weekStart, direction * 7);
    else if (state.view === "day") state.selectedDate = addDays(state.selectedDate, direction);
    else state.monthDate = new Date(state.monthDate.getFullYear(), state.monthDate.getMonth() + direction, 1);
    renderCalendar();
    renderLensSlots();
    return;
  }

  const directoryTrigger = target.closest("[data-open-directory]");
  if (directoryTrigger) {
    openDirectory(directoryTrigger.dataset.openDirectory, directoryTrigger.closest("#event-drawer") ? "composer" : "viewSet");
    return;
  }

  const directoryMode = target.closest("[data-directory-mode]");
  if (directoryMode) {
    setDirectoryMode(directoryMode.dataset.directoryMode);
    return;
  }

  const directoryFilter = target.closest("[data-directory-filter]");
  if (directoryFilter) {
    state.directoryFilters[state.directoryMode] = directoryFilter.dataset.directoryFilter;
    directoryFilter.parentElement.querySelectorAll("[data-directory-filter]").forEach((button) => {
      button.classList.toggle("active", button === directoryFilter);
    });
    void renderDirectoryResults();
    return;
  }

  const directoryItem = target.closest("[data-directory-id]");
  if (directoryItem) {
    toggleDirectoryItem(directoryItem.dataset.directoryId);
    return;
  }

  const memberVisibility = target.closest("[data-member-visibility]");
  if (memberVisibility) {
    if (memberVisibility.getAttribute("aria-disabled") !== "true") {
      void toggleMemberVisibility(memberVisibility.dataset.memberVisibility);
    }
    return;
  }

  const resourceTab = target.closest("[data-resource-tab]");
  if (resourceTab) {
    const tab = resourceTab.dataset.resourceTab;
    document.querySelectorAll("[data-resource-tab]").forEach((button) => {
      const active = button.dataset.resourceTab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    ui.peopleResourceList.classList.toggle("hidden", tab !== "people");
    ui.roomResourceList.classList.toggle("hidden", tab !== "rooms");
    return;
  }

  const spaceRow = target.closest(".space-row");
  if (spaceRow) {
    switchSpace(spaceRow.dataset.space);
    return;
  }

  const lensSlot = target.closest("[data-slot-day]");
  if (lensSlot) {
    selectLensSlot(lensSlot);
    return;
  }

  const calendarEvent = target.closest("[data-event-id]");
  if (calendarEvent) {
    openEventDetail(findEventById(calendarEvent.dataset.eventId));
    return;
  }

  const monthDay = target.closest("[data-month-date]");
  if (monthDay) {
    state.selectedDate = parseDateKey(monthDay.dataset.monthDate);
    state.selectedDay = Math.max(0, Math.min(4, state.selectedDate.getDay() - 1));
    const weekday = state.selectedDate.getDay();
    state.weekStart = startOfWorkWeek(state.selectedDate);
    state.view = "day";
    renderCalendar();
    renderLensSlots();
    return;
  }

  const column = target.closest(".day-column");
  if (column && target === column) {
    const rect = column.getBoundingClientRect();
    const relativeY = target === column ? event.clientY - rect.top : 0;
    const start = Math.max(8, Math.min(18, Math.round((8 + relativeY / 64) * 2) / 2));
    openEventDrawer({ date: parseDateKey(column.dataset.date), start, duration: 60 });
    return;
  }

  const bgOption = target.closest("[data-background]");
  if (bgOption) {
    document.querySelectorAll(".bg-option").forEach((button) => button.classList.remove("active"));
    bgOption.classList.add("active");
    const layer = document.querySelector("#background-layer");
    const preview = document.querySelector(".appearance-preview");
    if (bgOption.dataset.background === "city") {
      layer.style.backgroundImage = `url("${CITY_BACKGROUND_URL}")`;
      preview.style.backgroundImage = `url("${CITY_BACKGROUND_URL}")`;
    } else if (bgOption.dataset.background === "mist") {
      layer.style.backgroundImage = "linear-gradient(145deg,#82969d,#d8e1e4 52%,#8ba3a5)";
      preview.style.backgroundImage = layer.style.backgroundImage;
    } else {
      layer.style.backgroundImage = "linear-gradient(145deg,#31445f,#9c6f6c 55%,#d6a56f)";
      preview.style.backgroundImage = layer.style.backgroundImage;
    }
    persistAppearanceSettings({ background: { type: "preset", value: bgOption.dataset.background } });
    void appRepository?.saveSetting("backgroundImage", null).catch((error) => {
      showToast("背景設定を整理できませんでした", error.message || "もう一度お試しください");
    });
    return;
  }

  const preset = target.closest("[data-preset]");
  if (preset) {
    applyPreset(preset.dataset.preset);
    return;
  }
});

document.querySelectorAll(".drawer-close").forEach((button) => button.addEventListener("click", closeDrawers));
document.querySelector("#detail-edit").addEventListener("click", () => {
  const source = findEventById(state.detailEventId);
  if (!source) return;
  openEventDrawer({
    date: dateForEvent(source),
    start: source.start,
    duration: source.duration * 60,
    template: source,
  });
});
document.querySelector("#create-event").addEventListener("click", openLatestDraft);
document.querySelector("#today-button").addEventListener("click", () => {
  const today = new Date();
  state.selectedDate = today.getDay() === 0 || today.getDay() === 6 ? startOfWorkWeek(today) : today;
  state.monthDate = new Date(today.getFullYear(), today.getMonth(), 1);
  state.weekStart = startOfWorkWeek(today);
  state.highlight = null;
  renderCalendar();
  renderLensSlots();
});
document.querySelector("#open-appearance").addEventListener("click", openAppearance);
document.querySelector("#close-appearance").addEventListener("click", closeAppearance);
document.querySelector("#new-display-set").addEventListener("click", openDisplaySetModal);
document.querySelector("#close-display-set").addEventListener("click", closeDisplaySetModal);
document.querySelector("#cancel-display-set").addEventListener("click", closeDisplaySetModal);
document.querySelector("#display-set-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  if (submit.disabled) return;
  const name = document.querySelector("#display-set-name").value.trim();
  if (!name) {
    document.querySelector("#display-set-name").focus();
    return;
  }
  submit.disabled = true;
  try {
    await createDisplaySet(name);
  } catch (error) {
    showToast("表示セットを保存できませんでした", error.message || "もう一度お試しください");
  } finally {
    submit.disabled = false;
  }
});
document.querySelector("#open-sync").addEventListener("click", openSync);
document.querySelector("#sidebar-sync").addEventListener("click", openSync);
document.querySelector("#connection-state").addEventListener("click", openSync);
document.querySelector("#close-sync").addEventListener("click", closeSync);
document.querySelector("#run-sync").addEventListener("click", runSync);
document.querySelector("#sync-settings").addEventListener("click", () => {
  showToast("更新設定", "MVPでは安全な手動更新のみ有効です");
});
document.querySelector("#close-directory").addEventListener("click", () => {
  void applyDirectorySelection().catch((error) => showToast("表示セットを保存できませんでした", error.message));
});

ui.directoryOverlay.addEventListener("click", (event) => {
  if (event.target === ui.directoryOverlay) closeDirectory();
});

ui.syncModal.addEventListener("click", (event) => {
  if (event.target === ui.syncModal) closeSync();
});

document.querySelector("#display-set-modal").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeDisplaySetModal();
});

ui.directorySearch.addEventListener("input", () => {
  window.clearTimeout(directorySearchTimer);
  directorySearchTimer = window.setTimeout(() => void renderDirectoryResults(), 120);
});

function moveDirectoryFocus(direction) {
  const rows = [...ui.directoryResults.querySelectorAll(".directory-result")];
  if (!rows.length) return;
  const current = rows.indexOf(document.activeElement);
  const next = current < 0 ? (direction > 0 ? 0 : rows.length - 1) : (current + direction + rows.length) % rows.length;
  rows.forEach((row, index) => row.classList.toggle("focused", index === next));
  rows[next].focus();
  rows[next].scrollIntoView({ block: "nearest" });
}

ui.directorySearch.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveDirectoryFocus(event.key === "ArrowDown" ? 1 : -1);
  }
});

ui.directoryResults.addEventListener("keydown", (event) => {
  const row = event.target.closest(".directory-result");
  if (!row) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveDirectoryFocus(event.key === "ArrowDown" ? 1 : -1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    state.pendingSelection[state.directoryMode].add(row.dataset.directoryId);
    void applyDirectorySelection().catch((error) => showToast("表示セットを保存できませんでした", error.message));
  }
});

document.querySelector("#background-range").addEventListener("input", (event) => setBackgroundVisibility(event.target.value));
document.querySelector("#panel-range").addEventListener("input", (event) => setPanelTransparency(event.target.value));

document.querySelector("#background-upload").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const supportedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  const maxBytes = isTauriRuntime() ? 2 * 1024 * 1024 : 1024 * 1024;
  if (!supportedTypes.has(file.type)) {
    showToast("背景画像を読み込めません", "PNG・JPEG・WebPから選択してください");
    event.target.value = "";
    return;
  }
  if (file.size > maxBytes) {
    showToast("背景画像を読み込めません", `${isTauriRuntime() ? "2MB" : "1MB"}以下の画像を選択してください`);
    event.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    const dataUrl = String(reader.result);
    document.querySelector("#background-layer").style.backgroundImage = `url("${dataUrl}")`;
    document.querySelector(".appearance-preview").style.backgroundImage = `url("${dataUrl}")`;
    document.querySelectorAll(".bg-option").forEach((button) => button.classList.remove("active"));
    event.target.closest(".bg-option").classList.add("active");
    if (!appRepository) {
      showToast("背景画像はまだ保存できません", "アプリの準備完了後にもう一度お試しください");
      return;
    }
    void appRepository.saveSetting("backgroundImage", { dataUrl, name: file.name, mimeType: file.type })
      .then(() => {
        persistAppearanceSettings({ background: { type: "upload", name: file.name } });
        showToast("背景画像を変更しました", `${file.name} · ローカル保存`);
      })
      .catch((error) => showToast("背景画像を保存できませんでした", error.message || "画像サイズを小さくしてください"));
  });
  reader.addEventListener("error", () => showToast("背景画像を読み込めません", file.name));
  reader.readAsDataURL(file);
});

document.querySelector("#readability-toggle").addEventListener("click", (event) => {
  event.currentTarget.classList.toggle("on");
  persistAppearanceSettings();
  showToast("自動可読性補正", event.currentTarget.classList.contains("on") ? "オンにしました" : "オフにしました");
});

document.querySelector(".teams-toggle").addEventListener("click", (event) => {
  event.currentTarget.querySelector(".toggle").classList.toggle("on");
});

function eventFromComposer(status) {
  const title = document.querySelector("#event-title-input").value.trim() || "新しい予定";
  const dateValue = document.querySelector("#event-date").value;
  const [hour, minute] = document.querySelector("#event-time").value.split(":").map(Number);
  const start = hour + minute / 60;
  const duration = Number(document.querySelector("#event-duration").value) / 60;
  const space = spaces[state.activeSpace];
  const attendeeIds = state.composerSelection ? [...state.composerSelection.people] : [...space.people];
  const roomIds = state.composerSelection ? [...state.composerSelection.rooms] : [...space.rooms];
  const teamsMeeting = document.querySelector(".teams-toggle .toggle").classList.contains("on");
  return {
    id: state.editingDraft?.id || createId("event"),
    transactionId: state.editingDraft?.transactionId || createId("transaction"),
    space: state.activeSpace,
    dateKey: dateValue,
    start,
    duration,
    title,
    kind: "mine",
    owner: `${people[attendeeIds[0]].name}${attendeeIds.length > 1 ? ` + ${attendeeIds.length - 1}人` : ""}`,
    room: roomIds.length ? rooms[roomIds[0]].name : teamsMeeting ? "Teams" : "場所未設定",
    resourceIds: [...attendeeIds, ...roomIds],
    status,
    notes: document.querySelector("#event-notes").value.trim(),
    teamsMeeting,
  };
}

async function saveComposerEvent(status) {
  const calendarEvent = eventFromComposer(status);
  if (calendarEvent.start < 8 || calendarEvent.start + calendarEvent.duration > 20) {
    throw new RangeError("表示可能な08:00〜20:00の範囲で指定してください");
  }
  await appRepository.saveEvent(calendarEvent);
  const existingIndex = events.findIndex((event) => String(event.id) === String(calendarEvent.id));
  if (existingIndex >= 0) events[existingIndex] = calendarEvent;
  else events.push(calendarEvent);
  state.editingDraft = null;
  if (status === "draft") {
    closeDrawers();
    showToast("下書きをローカル保存しました", "Microsoft 365には送信していません");
    return;
  }
  const eventDate = parseDateKey(calendarEvent.dateKey);
  state.highlight = { dateKey: calendarEvent.dateKey, start: calendarEvent.start, duration: calendarEvent.duration };
  const weekday = eventDate.getDay();
  state.selectedDate = eventDate;
  if (weekday >= 1 && weekday <= 5) {
    state.weekStart = addDays(eventDate, 1 - weekday);
    state.view = "week";
  } else {
    state.view = "day";
  }
  closeDrawers();
  renderCalendar();
  showToast("予定をローカル保存しました", `${timeLabel(calendarEvent.start)} · ${calendarEvent.title}`);
}

async function requestComposerSave(status) {
  if (composerSaveInFlight) return;
  composerSaveInFlight = true;
  const draftButton = document.querySelector(".draft-button");
  const submitButton = document.querySelector("#event-submit");
  draftButton.disabled = true;
  submitButton.disabled = true;
  try {
    await saveComposerEvent(status);
  } catch (error) {
    showToast(status === "draft" ? "下書きを保存できませんでした" : "予定を保存できませんでした", error.message || "もう一度お試しください");
  } finally {
    composerSaveInFlight = false;
    draftButton.disabled = false;
    submitButton.disabled = false;
  }
}

document.querySelector(".draft-button").addEventListener("click", () => {
  void requestComposerSave("draft");
});

document.querySelector("#event-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void requestComposerSave("local");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    const modal = [...document.querySelectorAll(".command-overlay.open, .sync-modal.open")].at(-1);
    if (modal) {
      const focusable = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((element) => !element.closest("[inert]") && element.offsetParent !== null);
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    }
  }
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
  if (event.key === "Escape") {
    if (ui.directoryOverlay.classList.contains("open")) closeDirectory();
    else if (document.querySelector("#display-set-modal").classList.contains("open")) closeDisplaySetModal();
    else if (ui.syncModal.classList.contains("open")) closeSync();
    else if (ui.appearancePanel.classList.contains("open")) closeAppearance();
    else if (ui.eventDrawer.classList.contains("open") || ui.detailDrawer.classList.contains("open")) closeDrawers();
    return;
  }
  const surfaceOpen = document.querySelector(".command-overlay.open, .sync-modal.open, .side-drawer.open, .appearance-panel.open");
  if (surfaceOpen) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openDirectory("people");
    return;
  }
  if (!typing && event.key.toLowerCase() === "n") {
    event.preventDefault();
    openLatestDraft();
    return;
  }
  if (!typing && ["1", "2", "3"].includes(event.key)) {
    const space = Object.keys(spaces)[Number(event.key) - 1];
    switchSpace(space);
  }
});

function replaceRecord(target, values) {
  Object.keys(target).forEach((key) => delete target[key]);
  if (Array.isArray(values)) {
    values.forEach((value) => { target[value.id] = value; });
  } else {
    Object.assign(target, values || {});
  }
}

function safeBackgroundDataUrl(value) {
  return typeof value === "string"
    && value.length <= 2_800_000
    && /^data:image\/(?:png|jpeg|webp);base64,/i.test(value);
}

function applySavedAppearance(appearance = {}, backgroundImage = null) {
  appearanceState = { ...appearance };
  const backgroundVisibility = Number(appearance.backgroundVisibility ?? 28);
  const panelTransparency = Number(appearance.panelTransparency ?? 12);
  document.querySelector("#background-range").value = backgroundVisibility;
  document.querySelector("#panel-range").value = panelTransparency;
  document.querySelector("#readability-toggle").classList.toggle("on", appearance.readability !== false);
  setBackgroundVisibility(backgroundVisibility);
  setPanelTransparency(panelTransparency);

  const savedBackground = appearance.background;
  if (!savedBackground) return;
  const layer = document.querySelector("#background-layer");
  const preview = document.querySelector(".appearance-preview");
  document.querySelectorAll(".bg-option").forEach((button) => button.classList.remove("active"));
  const uploadedDataUrl = backgroundImage?.dataUrl || savedBackground.dataUrl;
  if (savedBackground.type === "upload" && safeBackgroundDataUrl(uploadedDataUrl)) {
    layer.style.backgroundImage = `url("${uploadedDataUrl}")`;
    preview.style.backgroundImage = layer.style.backgroundImage;
    document.querySelector(".bg-option.upload").classList.add("active");
    return;
  }
  const choice = document.querySelector(`[data-background="${CSS.escape(savedBackground.value || "city")}"]`);
  choice?.classList.add("active");
  if (savedBackground.value === "mist") layer.style.backgroundImage = "linear-gradient(145deg,#82969d,#d8e1e4 52%,#8ba3a5)";
  else if (savedBackground.value === "dusk") layer.style.backgroundImage = "linear-gradient(145deg,#31445f,#9c6f6c 55%,#d6a56f)";
  else layer.style.backgroundImage = `url("${CITY_BACKGROUND_URL}")`;
  preview.style.backgroundImage = layer.style.backgroundImage;
}

function hydrateSnapshot(snapshot) {
  replaceRecord(people, snapshot.people);
  replaceRecord(rooms, snapshot.rooms);
  replaceRecord(spaces, snapshot.spaces);
  events = Array.isArray(snapshot.events) ? snapshot.events : [];
  const requestedSpace = snapshot.settings?.activeSpace;
  state.activeSpace = spaces[requestedSpace] ? requestedSpace : (spaces.product ? "product" : Object.keys(spaces)[0]);
  applySavedAppearance(snapshot.settings?.appearance, snapshot.settings?.backgroundImage);
  renderSyncState(snapshot.sync);
}

function renderRuntimeMode(usingFallback = false) {
  const desktop = isTauriRuntime() && !usingFallback;
  document.querySelector("#runtime-badge").textContent = desktop ? "DESKTOP MVP" : "BROWSER DEMO";
  document.querySelector("#connection-label").textContent = desktop
    ? "ローカルデモ / Graph未接続"
    : "ブラウザプレビュー / サンプルデータ";
  document.querySelector("#connection-state").classList.toggle("demo", true);
  document.querySelector(".teams-toggle small").textContent = "Graph接続後に参加リンクを追加";
  const freshness = document.querySelector(".workspace-freshness");
  if (freshness) freshness.innerHTML = `<span><i></i>${desktop ? "SQLite" : "ブラウザ保存"}から予定を取得</span><span>外部送信なし・デモモード</span>`;
}

async function bootstrap() {
  const seed = {
    baseWeekStart: dateKey(baseWeekStart),
    people,
    rooms,
    spaces,
    events,
    settings: {
      activeSpace: state.activeSpace,
      appearance: { backgroundVisibility: 28, panelTransparency: 12, readability: true, background: { type: "preset", value: "city" } },
    },
  };
  let usingFallback = false;
  try {
    appRepository = createAppRepository(seed);
    await appRepository.initialize();
  } catch (error) {
    usingFallback = true;
    appRepository = createAppRepository(seed, { platformOptions: { forceBrowser: true } });
    await appRepository.initialize();
    window.setTimeout(() => showToast("SQLiteを開けませんでした", `${error.message || "不明なエラー"} · ブラウザ保存で続行`), 0);
  }
  const snapshot = await appRepository.loadSnapshot();
  hydrateSnapshot(snapshot);
  await installWindowControls();
  renderRuntimeMode(usingFallback);
  renderResources();
  renderCalendar();
  void renderDirectoryResults();
  document.querySelector("#run-sync").disabled = false;
  startupControls.forEach((control) => { control.disabled = false; });
  appLayout.removeAttribute("inert");
  document.body.dataset.ready = "true";
}

void bootstrap().catch((error) => {
  document.querySelector("#runtime-badge").textContent = "START ERROR";
  document.querySelector("#connection-label").textContent = "ローカルデータを開始できません";
  showToast("アプリを開始できませんでした", error.message || "再起動してください");
});
