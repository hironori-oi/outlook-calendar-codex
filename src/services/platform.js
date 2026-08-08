const DEFAULT_STORAGE_KEY = "nagi.repository.v1";
const fallbackStorage = createMemoryStorage();

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function isTauriRuntime(scope = globalThis) {
  return Boolean(
    scope?.__TAURI_INTERNALS__ ||
    scope?.__TAURI__ ||
    scope?.window?.__TAURI_INTERNALS__ ||
    scope?.window?.__TAURI__
  );
}

export async function installWindowControls(root = globalThis.document) {
  const controls = [...(root?.querySelectorAll?.("[data-window-action]") ?? [])];
  if (!controls.length) return () => {};

  if (!isTauriRuntime()) {
    controls.forEach((control) => {
      control.disabled = true;
      control.title = control.title || "デスクトップ版で利用できます";
    });
    return () => {};
  }

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const currentWindow = getCurrentWindow();
  const listeners = [];
  const actions = {
    minimize: () => currentWindow.minimize(),
    "toggle-maximize": () => currentWindow.toggleMaximize(),
    close: () => currentWindow.close(),
  };

  controls.forEach((control) => {
    const handler = async (event) => {
      event.preventDefault();
      const action = actions[control.dataset.windowAction];
      if (action) await action();
    };
    control.addEventListener("click", handler);
    listeners.push(() => control.removeEventListener("click", handler));
  });

  return () => listeners.forEach((remove) => remove());
}

export function createMemoryStorage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.has(String(key)) ? values.get(String(key)) : null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(String(key));
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
  };
}

function browserStorage() {
  try {
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch {
    // Sandboxed webviews can deny localStorage; the in-memory adapter still keeps the demo usable.
  }
  return fallbackStorage;
}

export function createBrowserPlatform({
  storage = browserStorage(),
  storageKey = DEFAULT_STORAGE_KEY,
} = {}) {
  let writeQueue = Promise.resolve();

  function read(fallbackFactory = () => ({})) {
    const raw = storage.getItem(storageKey);
    if (!raw) return fallbackFactory();
    try {
      return JSON.parse(raw);
    } catch {
      return fallbackFactory();
    }
  }

  function write(value) {
    storage.setItem(storageKey, JSON.stringify(value));
    return clone(value);
  }

  return {
    kind: "browser",
    read,
    write,
    async update(updater, fallbackFactory) {
      const operation = writeQueue.then(async () => {
        const current = read(fallbackFactory);
        const next = await updater(clone(current));
        return write(next ?? current);
      });
      writeQueue = operation.catch(() => undefined);
      return operation;
    },
  };
}

export function createSqlitePlatform(database) {
  return {
    kind: "sqlite",
    database,
    execute(sql, bindValues = []) {
      return database.execute(sql, bindValues);
    },
    select(sql, bindValues = []) {
      return database.select(sql, bindValues);
    },
  };
}

export async function createPlatform(options = {}) {
  if (options.platform) return options.platform;
  if (options.forceBrowser || !isTauriRuntime()) {
    return createBrowserPlatform(options);
  }

  const plugin = await import("@tauri-apps/plugin-sql");
  const Database = plugin.default ?? plugin.Database;
  const database = await Database.load(options.databaseUrl ?? "sqlite:nagi.db");
  return createSqlitePlatform(database);
}
