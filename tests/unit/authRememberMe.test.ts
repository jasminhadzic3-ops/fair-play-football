import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  authStorage,
  clearRememberMePreference,
  prepareAuthPersistence,
  setRememberMePreference,
} from "@/lib/authPersistence";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function installStorage() {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const runtime = globalThis as unknown as Record<string, unknown>;
  runtime.window = {
    localStorage,
    sessionStorage,
  };

  return { localStorage, sessionStorage };
}

function read(filePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

describe("remember me persistence", () => {
  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).window;
  });

  it("defaults the auth controls to checked and labels them accessibly", () => {
    expect(read("components/home/HomeClient.tsx")).toContain("useState(true)");
    expect(read("components/games/GameDetails.tsx")).toContain("const [rememberMe, setRememberMe] = useState(true)");
    expect(read("components/home/HomeClient.tsx")).toContain("<span>Remember me</span>");
    expect(read("components/games/GameDetails.tsx")).toContain("<span>Remember me</span>");
  });

  it("stores remembered sessions persistently and unchecked sessions in session storage", () => {
    const { localStorage, sessionStorage } = installStorage();
    const key = "sb-test-auth-token";

    setRememberMePreference(true);
    authStorage.setItem(key, "remembered-session");
    expect(localStorage.getItem(key)).toBe("remembered-session");
    expect(sessionStorage.getItem(key)).toBeNull();

    prepareAuthPersistence(false);
    authStorage.setItem(key, "session-only-session");
    expect(sessionStorage.getItem(key)).toBe("session-only-session");
    expect(localStorage.getItem(key)).toBeNull();
    expect(authStorage.getItem(key)).toBe("session-only-session");
  });

  it("clears the remember preference and both storage locations on sign out", () => {
    const { localStorage, sessionStorage } = installStorage();
    const key = "sb-test-auth-token";

    prepareAuthPersistence(true);
    authStorage.setItem(key, "session");
    sessionStorage.setItem(key, "other-session");
    authStorage.removeItem(key);
    clearRememberMePreference();

    expect(localStorage.getItem(key)).toBeNull();
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem("fairPlayRememberMe")).toBeNull();
    expect(sessionStorage.getItem("fairPlayRememberMe")).toBeNull();
  });

  it("clears the persistence preference from both sign-out paths", () => {
    const homeSource = read("components/home/HomeClient.tsx");
    const gameSource = read("components/games/GameDetails.tsx");

    expect(homeSource).toContain("await supabase.auth.signOut();\n    clearRememberMePreference();");
    expect(gameSource).toContain("clearRememberMePreference();\n    setShowPaymentModal(false);");
  });

  it("prepares all email and Google auth entry points without changing referral flow", () => {
    const homeSource = read("components/home/HomeClient.tsx");
    const gameSource = read("components/games/GameDetails.tsx");

    expect(homeSource.match(/prepareAuthPersistence\(navbarRememberMe\)/g)).toHaveLength(3);
    expect(gameSource.match(/prepareAuthPersistence\(rememberMe\)/g)).toHaveLength(3);
    expect(homeSource).toContain("createReferralSignupIntent(navbarReferralCode)");
    expect(gameSource).toContain("createReferralSignupIntent(referralCode)");
  });
});
