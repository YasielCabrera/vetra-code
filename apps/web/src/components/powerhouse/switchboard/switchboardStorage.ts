const SWITCHBOARD_STORAGE_PREFIX = "vetra:switchboard:v1:";

interface EnumerableStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface GraphiqlStorage {
  readonly length: number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

const surfacePrefix = (surfaceId: string) =>
  `${SWITCHBOARD_STORAGE_PREFIX}${encodeURIComponent(surfaceId)}:`;

const instancePrefix = (surfaceId: string, panelProjectKey: string) =>
  `${surfacePrefix(surfaceId)}${encodeURIComponent(panelProjectKey)}:`;

function browserStorage(): EnumerableStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function keysWithPrefix(storage: EnumerableStorage, prefix: string): ReadonlyArray<string> {
  const keys: Array<string> = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

function memoryStorage(): GraphiqlStorage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
}

/**
 * GraphiQL uses fixed local-storage names. Prefix them by panel and project so
 * two Switchboards never share operation tabs or layout preferences.
 */
export function createSwitchboardStorage(
  surfaceId: string,
  panelProjectKey: string,
  storage: EnumerableStorage | null = browserStorage(),
): GraphiqlStorage {
  if (storage === null) return memoryStorage();
  const prefix = instancePrefix(surfaceId, panelProjectKey);
  return {
    get length() {
      return keysWithPrefix(storage, prefix).length;
    },
    getItem: (key) => storage.getItem(`${prefix}${key}`),
    setItem: (key, value) => storage.setItem(`${prefix}${key}`, value),
    removeItem: (key) => storage.removeItem(`${prefix}${key}`),
    clear: () => {
      for (const key of keysWithPrefix(storage, prefix)) storage.removeItem(key);
    },
  };
}

/** Closing a repeatable surface makes its persisted GraphiQL state unreachable. */
export function clearSwitchboardPanelStorage(
  surfaceId: string,
  storage: EnumerableStorage | null = browserStorage(),
): void {
  if (storage === null) return;
  for (const key of keysWithPrefix(storage, surfacePrefix(surfaceId))) {
    storage.removeItem(key);
  }
}
