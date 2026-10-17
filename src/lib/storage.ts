// localStorage that never throws (private mode, quota, blocked storage).
// Only preferences and user-chosen bookmarks are stored — never secrets.

const PREFIX = 'arnav:';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable — preferences simply won't persist */
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** Zustand persist-compatible storage adapter. */
export const safeStorage = {
  getItem: (name: string) => {
    try {
      return localStorage.getItem(PREFIX + name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string) => {
    try {
      localStorage.setItem(PREFIX + name, value);
    } catch {
      /* ignore */
    }
  },
  removeItem: (name: string) => {
    try {
      localStorage.removeItem(PREFIX + name);
    } catch {
      /* ignore */
    }
  },
};
