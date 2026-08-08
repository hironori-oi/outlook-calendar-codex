export function normalizeSearchText(value) {
  return String(value ?? "").normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function queryTokens(query, { maxTokens = 12 } = {}) {
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
  return [...new Set(tokens)].slice(0, Math.max(1, maxTokens));
}

export function normalizeDateKey(value) {
  const raw = String(value ?? "").normalize("NFKC").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) throw new TypeError(`Invalid dateKey: ${raw || "(empty)"}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new TypeError(`Invalid dateKey: ${raw}`);
  }
  return raw;
}

export function addDaysToDateKey(dateKey, days) {
  const normalized = normalizeDateKey(dateKey);
  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function clockMinutes(value, kind) {
  if (typeof value === "string" && /^\d{1,2}:\d{2}$/.test(value.trim())) {
    const [hours, minutes] = value.trim().split(":").map(Number);
    if (minutes > 59) throw new TypeError(`Invalid ${kind}: ${value}`);
    return hours * 60 + minutes;
  }

  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`Invalid ${kind}: ${value}`);
  return number > 24 ? Math.round(number) : Math.round(number * 60);
}

export function normalizeStart(value, explicitMinutes) {
  const minutes = explicitMinutes == null
    ? clockMinutes(value, "start")
    : Math.round(Number(explicitMinutes));
  if (!Number.isFinite(minutes) || minutes < 0 || minutes >= 24 * 60) {
    throw new TypeError(`Invalid start: ${value}`);
  }
  return minutes / 60;
}

export function normalizeDuration(value, explicitMinutes) {
  const minutes = explicitMinutes == null
    ? clockMinutes(value, "duration")
    : Math.round(Number(explicitMinutes));
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
    throw new TypeError(`Invalid duration: ${value}`);
  }
  return minutes / 60;
}

export function hoursToMinutes(value) {
  return Math.round(Number(value) * 60);
}

export function normalizeResourceIds(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map((item) => String(item).normalize("NFKC").trim()).filter(Boolean))];
}

export function clampLimit(value, fallback = 50) {
  const numeric = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback;
  return Math.max(1, Math.min(50, numeric));
}
