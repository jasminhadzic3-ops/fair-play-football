import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signInWithEmail } from "./helpers/auth";
import { requireDatabaseMutationE2EEnv } from "./helpers/supabaseEnv";

const env = requireDatabaseMutationE2EEnv();
const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const run = `FREE_GAME_UI_TEST_20260924_${Date.now()}`;
const password = `Password-${run}`;
let adminId: string | null = null;
let playerId: string | null = null;
let gameId: number | null = null;

async function user(label: string, admin = false) {
  const email = `${run}_${label}@example.test`;
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username: label } });
  if (error || !data.user) throw new Error(error?.message || "create user failed");
  await supabase.from("profiles").upsert({ id: data.user.id, email, username: label, age: 25, gender: "Prefer not to say", favourite_position: "Midfielder" });
  if (admin) await supabase.from("admin_users").insert({ user_id: data.user.id });
  return { id: data.user.id, email };
}

test.afterAll(async () => {
  if (gameId) await supabase.from("games").delete().eq("id", gameId);
  if (adminId) await supabase.from("admin_users").delete().eq("user_id", adminId);
  if (adminId) await supabase.auth.admin.deleteUser(adminId);
  if (playerId) await supabase.auth.admin.deleteUser(playerId);
});

test("admin creates and player books a free game without financial records", async ({ page }) => {
  test.setTimeout(90_000);
  const admin = await user("free-admin", true); adminId = admin.id;
  const player = await user("free-player"); playerId = player.id;

  await signInWithEmail(page, admin.email, password);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin Panel" })).toBeVisible();
  await page.getByLabel("Game title").fill(run);
  await page.getByLabel("Location").fill("TEST ONLY");
  await page.getByLabel("Kickoff date").fill("2099-09-24");
  await page.getByLabel("Kickoff time").fill("20:00");
  await page.getByRole("button", { name: "FREE" }).click();
  await expect(page.getByText("Players can book this game without payment.")).toBeVisible();
  await page.getByLabel("Max players").fill("12");
  const createResponse = page.waitForResponse(
    (response) => response.url().includes("/api/admin/games") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Create Game" }).click();
  const createResult = await createResponse;
  const createBody = await createResult.json();
  expect(createResult.status(), JSON.stringify(createBody)).toBe(201);

  const { data: game, error: gameError } = await supabase.from("games").select("id,price,pricing_mode").eq("title", run).single();
  if (gameError || !game) throw new Error(gameError?.message || "free game not found");
  gameId = game.id;
  expect(game).toMatchObject({ price: 0, pricing_mode: "free" });

  await page.getByRole("button", { name: "Sign out" }).click();
  await signInWithEmail(page, player.email, password);
  await expect(page.getByText(run)).toBeVisible();
  await expect(page.getByText("FREE", { exact: true }).first()).toBeVisible();
  await page.getByText(run).first().click();
  await expect(page.getByText("Match Fee")).toBeVisible();
  await expect(page.getByText("FREE", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Book Your Spot" }).click();
  const requestPromise = page.waitForRequest((request) => request.url().includes("/api/free-bookings"));
  await page.getByRole("button", { name: "Book free place" }).click();
  await requestPromise;
  await expect(page.getByText("Your spot is confirmed and everything is set.")).toBeVisible();

  const { data: bookings } = await supabase.from("bookings").select("id,booking_source").eq("game_id", game.id).eq("user_id", player.id);
  expect(bookings).toHaveLength(1);
  expect(bookings?.[0]?.booking_source).toBe("fair_play");
  const bookingId = bookings?.[0]?.id;
  expect((await supabase.from("booking_payments").select("id").eq("booking_id", bookingId)).data).toHaveLength(0);
  expect((await supabase.from("wallet_transactions").select("id").eq("booking_id", bookingId)).data).toHaveLength(0);
});
