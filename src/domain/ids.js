function safePrefix(prefix) {
  const value = String(prefix ?? "id")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return value || "id";
}

export function createId(prefix = "id") {
  const name = safePrefix(prefix);
  const randomUUID = globalThis.crypto?.randomUUID;

  if (typeof randomUUID === "function") {
    return `${name}-${randomUUID.call(globalThis.crypto)}`;
  }

  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 12);
  return `${name}-${timestamp}-${random}`;
}

export function ensureId(value, prefix = "id") {
  const normalized = String(value ?? "").normalize("NFKC").trim();
  return normalized || createId(prefix);
}
