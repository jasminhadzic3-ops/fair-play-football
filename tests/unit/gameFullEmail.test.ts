import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFromMock = vi.hoisted(() => vi.fn());
const sendResendEmailMock = vi.hoisted(() => vi.fn());
const sendEmailWithDeliveryTrackingMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: supabaseFromMock } }));
vi.mock("@/lib/email/resend", () => ({ sendResendEmail: sendResendEmailMock }));
vi.mock("@/lib/email/deliveryTracking", () => ({ sendEmailWithDeliveryTracking: sendEmailWithDeliveryTrackingMock }));

import { sendGameFullEmails } from "@/lib/email/gameFull";

type QueryState = { game: Record<string, unknown> | null; bookings: Array<{ user_id: string | null }>; profiles: Array<Record<string, unknown>> };
const state: QueryState = { game: null, bookings: [], profiles: [] };

class Query {
  constructor(private table: string) {}
  select() { return this; }
  eq() { return this; }
  in() { return this; }
  not() { return this; }
  async maybeSingle<T>() { return { data: state.game as T | null, error: null }; }
  then(resolve: (value: unknown) => void) {
    resolve(this.table === "bookings" ? { data: state.bookings, error: null } : { data: state.profiles, error: null });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.EMAIL_BROADCAST_TEST_RECIPIENT;
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  state.game = {
    id: 10,
    title: "Friday Football",
    location: "Whittington Park, Archway",
    time: "Friday 5pm",
    starts_at: "2026-09-25T16:00:00.000Z",
    price: 5,
    pricing_mode: "paid",
    max_players: 3,
    tags: ["8-a-side"],
  };
  state.bookings = [{ user_id: "user-1" }, { user_id: "user-2" }, { user_id: "user-3" }];
  state.profiles = [
    { id: "user-1", email: "one@example.com", username: "One Player" },
    { id: "user-2", email: "two@example.com", username: "Two Player" },
    { id: "user-3", email: null, username: "No Email" },
  ];
  supabaseFromMock.mockImplementation((table: string) => new Query(table));
  sendResendEmailMock.mockResolvedValue({ id: "email-1" });
  const sent = new Set<string>();
  sendEmailWithDeliveryTrackingMock.mockImplementation(async (params: { deliveryKey: string; send: () => Promise<unknown> }) => {
    if (sent.has(params.deliveryKey)) return { skipped: true, status: "sent" };
    sent.add(params.deliveryKey);
    await params.send();
    return { skipped: false, status: "sent" };
  });
});

describe("sendGameFullEmails", () => {
  it("skips below capacity and sends only to current booked profiles at capacity", async () => {
    state.bookings = state.bookings.slice(0, 2);
    expect(await sendGameFullEmails({ gameId: 10 })).toEqual({ skipped: true, sentCount: 0 });
    expect(sendResendEmailMock).not.toHaveBeenCalled();

    state.bookings = [{ user_id: "user-1" }, { user_id: "user-2" }, { user_id: "user-3" }];
    expect(await sendGameFullEmails({ gameId: 10 })).toEqual({ skipped: false, sentCount: 2 });
    expect(sendResendEmailMock).toHaveBeenCalledTimes(2);
    const email = sendResendEmailMock.mock.calls[0][0] as { subject: string; text: string; html: string };
    expect(email.subject).toBe("Game On — Whittington Park, Archway, 5:00 PM");
    expect(email.text).toContain("Price\n£5.00");
    expect(email.text).toContain("MATCH REMINDERS");
    expect(email.html).toContain("Join the WhatsApp group");
    expect(email.html).toContain("https://chat.whatsapp.com/JAGpOaEd8jf2njevCRK7JE?mode=gi_t");
  });

  it("renders FREE and remains idempotent on replay", async () => {
    state.game = { ...state.game, pricing_mode: "free", price: 0 };
    await sendGameFullEmails({ gameId: 10 });
    await sendGameFullEmails({ gameId: 10 });
    expect(sendResendEmailMock).toHaveBeenCalledTimes(2);
    expect(sendResendEmailMock.mock.calls[0][0].text).toContain("FREE GAME");
  });
});
