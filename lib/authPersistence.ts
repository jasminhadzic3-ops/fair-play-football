const REMEMBER_ME_KEY = "fairPlayRememberMe";
const REMEMBER_ME_TTL_MS = 30 * 60 * 1000;

function getStorage(kind: "local" | "session"): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function readStorageValue(storage: Storage | null, key: string) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorageValue(storage: Storage | null, key: string, value: string) {
  try {
    storage?.setItem(key, value);
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

function removeStorageValue(storage: Storage | null, key: string) {
  try {
    storage?.removeItem(key);
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

function getAuthStorageKey() {
  const configuredUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://bpvbkndywnvfvxxzzaes.supabase.co";

  try {
    return `sb-${new URL(configuredUrl).hostname.split(".")[0]}-auth-token`;
  } catch {
    return "sb-auth-token";
  }
}

export function getRememberMePreference(): boolean | null {
  const sessionStorage = getStorage("session");
  const sessionPreference = readStorageValue(sessionStorage, REMEMBER_ME_KEY);

  if (sessionPreference === "true" || sessionPreference === "false") {
    return sessionPreference === "true";
  }

  const localStorage = getStorage("local");
  const localValue = readStorageValue(localStorage, REMEMBER_ME_KEY);

  if (!localValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(localValue) as { remember?: boolean; expiresAt?: number };

    if (
      typeof parsed.remember !== "boolean" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now()
    ) {
      removeStorageValue(localStorage, REMEMBER_ME_KEY);
      return null;
    }

    return parsed.remember;
  } catch {
    removeStorageValue(localStorage, REMEMBER_ME_KEY);
    return null;
  }
}

export function setRememberMePreference(rememberMe: boolean) {
  const sessionStorage = getStorage("session");
  const localStorage = getStorage("local");

  try {
    writeStorageValue(sessionStorage, REMEMBER_ME_KEY, String(rememberMe));
  } catch {
    // Storage can be unavailable in private browsing; Supabase will surface
    // any resulting authentication error without exposing session tokens.
  }

  try {
    writeStorageValue(
      localStorage,
      REMEMBER_ME_KEY,
      JSON.stringify({ remember: rememberMe, expiresAt: Date.now() + REMEMBER_ME_TTL_MS })
    );
  } catch {
    // The session preference remains available when sessionStorage works.
  }
}

export function clearRememberMePreference() {
  removeStorageValue(getStorage("session"), REMEMBER_ME_KEY);
  removeStorageValue(getStorage("local"), REMEMBER_ME_KEY);
}

export function clearStoredAuthSession() {
  const key = getAuthStorageKey();
  removeStorageValue(getStorage("session"), key);
  removeStorageValue(getStorage("local"), key);
}

export function prepareAuthPersistence(rememberMe: boolean) {
  setRememberMePreference(rememberMe);
  clearStoredAuthSession();
}

export const authStorage = {
  getItem(key: string) {
    const rememberMe = getRememberMePreference();
    const sessionStorage = getStorage("session");
    const localStorage = getStorage("local");

    if (rememberMe === false) {
      return readStorageValue(sessionStorage, key);
    }

    return readStorageValue(localStorage, key) ?? readStorageValue(sessionStorage, key);
  },
  setItem(key: string, value: string) {
    const rememberMe = getRememberMePreference();
    const sessionStorage = getStorage("session");
    const localStorage = getStorage("local");

    if (rememberMe === false) {
      writeStorageValue(sessionStorage, key, value);
      removeStorageValue(localStorage, key);
      return;
    }

    writeStorageValue(localStorage, key, value);
    removeStorageValue(sessionStorage, key);
  },
  removeItem(key: string) {
    removeStorageValue(getStorage("session"), key);
    removeStorageValue(getStorage("local"), key);
  },
};
