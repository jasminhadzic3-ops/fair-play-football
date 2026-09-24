import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const getAuthenticatedUserMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sumupPayments", () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
}));
vi.mock("@/lib/supabaseAdmin", () => ({
  assertSupabaseAdminConfigured: vi.fn(),
  supabaseAdmin: { rpc: rpcMock },
}));

import { POST as consumePOST } from "@/app/api/referrals/google-intent/consume/route";
import { POST as cookiePOST } from "@/app/api/referrals/google-intent/route";

const root = resolve(__dirname, "../..");

describe("Google referral intent routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets only a valid opaque intent cookie", async () => {
    const invalid = await cookiePOST(
      new Request("http://localhost/api/referrals/google-intent", {
        method: "POST",
        body: JSON.stringify({ intent_id: "not-a-uuid" }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(invalid.status).toBe(400);

    const valid = await cookiePOST(
      new Request("http://localhost/api/referrals/google-intent", {
        method: "POST",
        body: JSON.stringify({ intent_id: "11111111-1111-4111-8111-111111111111" }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(valid.status).toBe(204);
    expect(valid.headers.get("set-cookie")).toContain("HttpOnly");
    expect(valid.headers.get("set-cookie")).toContain("Max-Age=900");
  });

  it("rejects unauthenticated consumption and never calls the RPC", async () => {
    getAuthenticatedUserMock.mockResolvedValue(null);
    const response = await consumePOST(
      new Request("http://localhost/api/referrals/google-intent/consume", {
        method: "POST",
        headers: { cookie: "fair_play_google_referral_intent=11111111-1111-4111-8111-111111111111" },
      })
    );
    expect(response.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("uses the verified bearer user and clears the cookie after a successful RPC call", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "new-google-user" });
    rpcMock.mockResolvedValue({ data: true, error: null });
    const response = await consumePOST(
      new Request("http://localhost/api/referrals/google-intent/consume", {
        method: "POST",
        headers: {
          authorization: "Bearer verified-token",
          cookie: "fair_play_google_referral_intent=11111111-1111-4111-8111-111111111111",
        },
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: true });
    expect(rpcMock).toHaveBeenCalledWith("consume_google_referral_signup_intent", {
      p_intent_id: "11111111-1111-4111-8111-111111111111",
      p_referred_user_id: "new-google-user",
    });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("clears the cookie for a definitive processed=false response", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "existing-google-user" });
    rpcMock.mockResolvedValue({ data: false, error: null });

    const response = await consumePOST(
      new Request("http://localhost/api/referrals/google-intent/consume", {
        method: "POST",
        headers: {
          authorization: "Bearer verified-token",
          cookie: "fair_play_google_referral_intent=11111111-1111-4111-8111-111111111111",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: false });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("rejects malformed cookies without calling the RPC and clears them", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "new-google-user" });

    const response = await consumePOST(
      new Request("http://localhost/api/referrals/google-intent/consume", {
        method: "POST",
        headers: {
          authorization: "Bearer verified-token",
          cookie: "fair_play_google_referral_intent=forged-value",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: false });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("preserves a valid cookie when the RPC fails transiently", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "new-google-user" });
    rpcMock.mockResolvedValue({ data: null, error: new Error("temporary database failure") });

    const response = await consumePOST(
      new Request("http://localhost/api/referrals/google-intent/consume", {
        method: "POST",
        headers: {
          authorization: "Bearer verified-token",
          cookie: "fair_play_google_referral_intent=11111111-1111-4111-8111-111111111111",
        },
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to complete the referral sign-up." });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("keeps a missing cookie as a safe no-op", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "new-google-user" });

    const response = await consumePOST(
      new Request("http://localhost/api/referrals/google-intent/consume", {
        method: "POST",
        headers: { authorization: "Bearer verified-token" },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: false });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("sets and clears only a short-lived HttpOnly SameSite cookie", () => {
    const source = readFileSync(resolve(root, "app/api/referrals/google-intent/route.ts"), "utf8");
    expect(source).toContain('export async function POST');
    expect(source).toContain('export async function DELETE');
    expect(source).toContain("Max-Age=900");
    expect(source).toContain("HttpOnly");
    expect(source).toContain("SameSite=Lax");
    expect(source).toContain("uuidPattern");
    expect(source).not.toContain("referrer_user_id");
  });

  it("requires the existing bearer-authenticated user before consuming", () => {
    const source = readFileSync(resolve(root, "app/api/referrals/google-intent/consume/route.ts"), "utf8");
    expect(source).toContain('getAuthenticatedUser(request.headers.get("authorization"))');
    expect(source).toContain('status: 401');
    expect(source).toContain('"consume_google_referral_signup_intent"');
    expect(source).toContain('p_referred_user_id: user.id');
    expect(source).toContain('Set-Cookie');
    expect(source).toContain('"Unable to complete the referral sign-up."');
  });
});
