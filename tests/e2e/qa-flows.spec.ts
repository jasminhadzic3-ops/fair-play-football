import { expect, test, type Dialog, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signInWithEmail } from "./helpers/auth";
import { createE2ESupabaseClient, getWalletBalanceBreakdown } from "./helpers/moneySeed";
import {
  canRunDatabaseMutationE2E,
  requireDatabaseMutationE2EEnv,
} from "./helpers/supabaseEnv";

type SeededUser = {
  id: string;
  email: string;
  password: string;
  username: string;
  admin: boolean;
};

type SeededGame = {
  id: number;
  title: string;
  location: string;
  price: number;
  maxPlayers: number;
};

type SeededBooking = {
  id: number;
  gameId: number;
  userId: string | null;
  playerName: string;
};

type SeededWaitingList = {
  id: number;
  gameId: number;
  userId: string;
};

type QaSeed = {
  runId: string;
  users: SeededUser[];
  games: SeededGame[];
  bookings: SeededBooking[];
  waitingList: SeededWaitingList[];
};

const futureStartsAt = "2099-01-15T20:00:00.000Z";
const futureDisplayTime = "15 Jan 2099, 20:00";
const pastStartsAt = "2026-01-15T20:00:00.000Z";
const pastDisplayTime = "15 Jan 2026, 20:00";

function uniqueRunId() {
  return `e2e_qa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createQaSeed(): QaSeed {
  return {
    runId: uniqueRunId(),
    users: [],
    games: [],
    bookings: [],
    waitingList: [],
  };
}

function canRunQaE2E() {
  return canRunDatabaseMutationE2E();
}

async function insertSingle<T>(
  query: PromiseLike<{ data: T | null; error: { message: string } | null }>,
  context: string
) {
  const { data, error } = await query;

  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }

  if (!data) {
    throw new Error(`${context}: no row returned.`);
  }

  return data;
}

async function createConfirmedUser(
  supabase: SupabaseClient,
  seed: QaSeed,
  options: { admin?: boolean; label?: string } = {}
) {
  const label = options.label ?? "player";
  const username = `E2E QA ${label} ${seed.runId.slice(-6)}`;
  const email = `${seed.runId}_${label}@example.test`;
  const password = `Password-${seed.runId}-${label}`;
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      username,
      e2e_run_id: seed.runId,
      role: options.admin ? "admin" : "player",
    },
  });

  if (authError || !authData.user) {
    throw new Error(`create ${label} user: ${authError?.message || "no user returned"}`);
  }

  const user = {
    id: authData.user.id,
    email,
    password,
    username,
    admin: options.admin === true,
  };
  seed.users.push(user);

  await insertSingle(
    supabase
      .from("profiles")
      .upsert({
        id: user.id,
        email,
        username,
        age: 25,
        gender: "Prefer not to say",
        favourite_position: "Midfielder",
      })
      .select("id")
      .single(),
    `upsert ${label} profile`
  );

  if (options.admin) {
    await insertSingle(
      supabase.from("admin_users").insert({ user_id: user.id }).select("user_id").single(),
      "insert admin allowlist"
    );
  }

  return user;
}

async function createGame(
  supabase: SupabaseClient,
  seed: QaSeed,
  options: {
    title?: string;
    price?: number;
    maxPlayers?: number;
    startsAt?: string | null;
    time?: string;
    status?: "active" | "cancelled";
  } = {}
) {
  const title = options.title ?? `E2E QA Game ${seed.runId}`;
  const price = options.price ?? 5;
  const maxPlayers = options.maxPlayers ?? 12;
  const game = await insertSingle<{ id: number }>(
    supabase
      .from("games")
      .insert({
        title,
        location: `E2E QA Pitch ${seed.runId.slice(-6)}`,
        time: options.time ?? futureDisplayTime,
        starts_at: options.startsAt === undefined ? futureStartsAt : options.startsAt,
        price,
        max_players: maxPlayers,
        status: options.status ?? "active",
      })
      .select("id")
      .single(),
    "insert QA game"
  );

  const seededGame = {
    id: game.id,
    title,
    location: `E2E QA Pitch ${seed.runId.slice(-6)}`,
    price,
    maxPlayers,
  };
  seed.games.push(seededGame);

  return seededGame;
}

async function createWalletCredit(
  supabase: SupabaseClient,
  seed: QaSeed,
  userId: string,
  amount: number
) {
  await insertSingle(
    supabase
      .from("wallet_transactions")
      .insert({
        user_id: userId,
        amount,
        idempotency_key: `e2e:${seed.runId}:wallet_credit:${userId}:${amount}`,
        currency: "GBP",
        transaction_type: "admin_credit",
        status: "completed",
        description: `E2E QA wallet credit ${seed.runId}`,
        metadata: {
          e2e_run_id: seed.runId,
        },
      })
      .select("id")
      .single(),
    "insert QA wallet credit"
  );
}

async function createBooking(
  supabase: SupabaseClient,
  seed: QaSeed,
  gameId: number,
  options: { userId?: string | null; playerName?: string } = {}
) {
  const playerName = options.playerName ?? `E2E QA Player ${seed.bookings.length + 1}`;
  const booking = await insertSingle<{ id: number }>(
    supabase
      .from("bookings")
      .insert({
        game_id: gameId,
        user_id: options.userId ?? null,
        player_name: playerName,
      })
      .select("id")
      .single(),
    "insert QA booking"
  );
  const seededBooking = {
    id: booking.id,
    gameId,
    userId: options.userId ?? null,
    playerName,
  };
  seed.bookings.push(seededBooking);

  return seededBooking;
}

async function createWalletPaidBooking(
  supabase: SupabaseClient,
  seed: QaSeed,
  game: SeededGame,
  user: SeededUser
) {
  const booking = await createBooking(supabase, seed, game.id, {
    userId: user.id,
    playerName: user.username,
  });

  await insertSingle(
    supabase
      .from("wallet_transactions")
      .insert({
        user_id: user.id,
        amount: -game.price,
        idempotency_key: `e2e:${seed.runId}:wallet_booking:${booking.id}`,
        currency: "GBP",
        transaction_type: "wallet_booking_payment",
        status: "completed",
        game_id: game.id,
        booking_id: booking.id,
        description: `E2E QA wallet booking ${seed.runId}`,
        metadata: {
          e2e_run_id: seed.runId,
        },
      })
      .select("id")
      .single(),
    "insert QA wallet booking debit"
  );

  return booking;
}

async function createSumUpPaidBooking(
  supabase: SupabaseClient,
  seed: QaSeed,
  game: SeededGame,
  user: SeededUser
) {
  const booking = await createBooking(supabase, seed, game.id, {
    userId: user.id,
    playerName: user.username,
  });

  await insertSingle(
    supabase
      .from("booking_payments")
      .insert({
        user_id: user.id,
        game_id: game.id,
        player_name: user.username,
        checkout_id: `${seed.runId}_${booking.id}_checkout`,
        checkout_reference: `${seed.runId}_${booking.id}_reference`,
        payment_status: "paid",
        booking_id: booking.id,
        hosted_checkout_url: "https://example.test/e2e-checkout",
        amount: game.price,
        currency: "GBP",
        transaction_code: `${seed.runId}_${booking.id}_txn_code`,
        sumup_transaction_id: `${seed.runId}_${booking.id}_txn_id`,
        raw_checkout: {
          e2e_run_id: seed.runId,
        },
      })
      .select("id")
      .single(),
    "insert QA SumUp booking payment"
  );

  return booking;
}

async function fillGameToCapacity(
  supabase: SupabaseClient,
  seed: QaSeed,
  game: SeededGame
) {
  for (let index = 0; index < game.maxPlayers; index += 1) {
    await createBooking(supabase, seed, game.id, {
      playerName: `E2E Filler ${index + 1}`,
    });
  }
}

async function cleanupQaSeed(supabase: SupabaseClient, seed: QaSeed) {
  const failures: string[] = [];
  const runCleanup = async (
    label: string,
    cleanup: () => PromiseLike<{ error: { message: string } | null }>,
    options?: { optionalPermission?: boolean }
  ) => {
    const { error } = await cleanup();

    if (error) {
      if (options?.optionalPermission && /permission denied/i.test(error.message)) {
        return;
      }

      failures.push(`${label}: ${error.message}`);
    }
  };

  const gameIds = seed.games.map((game) => game.id);
  const userIds = seed.users.map((user) => user.id);

  if (gameIds.length > 0) {
    await runCleanup("delete player booking cancellations", () =>
      supabase.from("player_booking_cancellations").delete().in("game_id", gameIds)
    );
    await runCleanup("delete reminder deliveries", () =>
      supabase.from("game_reminder_deliveries").delete().in("game_id", gameIds)
    );
    await runCleanup("delete waiting-list notifications by game", () =>
      supabase.from("waiting_list_notifications").delete().in("game_id", gameIds),
      { optionalPermission: true }
    );
    await runCleanup("delete waiting-list rows by game", () =>
      supabase.from("waiting_list").delete().in("game_id", gameIds)
    );
    await runCleanup("delete booking payments by game", () =>
      supabase.from("booking_payments").delete().in("game_id", gameIds)
    );
    await runCleanup("delete wallet transactions by game", () =>
      supabase.from("wallet_transactions").delete().in("game_id", gameIds)
    );
    await runCleanup("delete bookings by game", () =>
      supabase.from("bookings").delete().in("game_id", gameIds)
    );
  }

  await runCleanup("delete tagged wallet transactions", () =>
    supabase
      .from("wallet_transactions")
      .delete()
      .filter("metadata->>e2e_run_id", "eq", seed.runId)
  );

  if (userIds.length > 0) {
    await runCleanup("delete waiting-list rows by user", () =>
      supabase.from("waiting_list").delete().in("user_id", userIds)
    );
    await runCleanup("delete admin allowlist rows", () =>
      supabase.from("admin_users").delete().in("user_id", userIds)
    );
    await runCleanup("delete profiles", () =>
      supabase.from("profiles").delete().in("id", userIds)
    );
  }

  if (gameIds.length > 0) {
    await runCleanup("delete games", () => supabase.from("games").delete().in("id", gameIds));
  }

  for (const user of seed.users) {
    const { error } = await supabase.auth.admin.deleteUser(user.id);

    if (error) {
      failures.push(`delete auth user ${user.id}: ${error.message}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`QA E2E cleanup failed for ${seed.runId}. ${failures.join(" | ")}`);
  }
}

async function acceptNextDialog(page: Page) {
  const dialogPromise = page.waitForEvent("dialog");
  const accept = async () => {
    const dialog = await dialogPromise;
    await dialog.accept();
    return dialog;
  };

  return accept();
}

async function getBrowserAccessToken(page: Page) {
  return page.evaluate(() => {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      const rawValue = key ? window.localStorage.getItem(key) : null;

      if (!rawValue || !key?.includes("auth-token")) {
        continue;
      }

      try {
        const parsedValue = JSON.parse(rawValue);
        const token =
          parsedValue?.access_token ??
          parsedValue?.currentSession?.access_token ??
          parsedValue?.session?.access_token;

        if (typeof token === "string" && token.trim()) {
          return token;
        }
      } catch {
        continue;
      }
    }

    return null;
  });
}

test.describe("TEST-only launch QA flows", () => {
  test.skip(
    !canRunQaE2E(),
    "TEST-only QA E2E requires E2E_ALLOW_DB_MUTATION=true and the TEST Supabase project."
  );
  test.describe.configure({ mode: "serial" });

  let supabase: SupabaseClient;
  let qaSchemaReady = false;
  let qaSchemaSkipReason =
    "TEST Supabase schema readiness has not been checked yet.";
  const seeds: QaSeed[] = [];

  test.beforeAll(async () => {
    supabase = createE2ESupabaseClient(requireDatabaseMutationE2EEnv());
    const { error } = await supabase.from("games").select("id,starts_at,archived_at").limit(1);

    if (error) {
      qaSchemaSkipReason = [
        "TEST Supabase is missing the game reminder/archive foundation columns required by the current app.",
        "Run the approved SQL migrations on the TEST project before this QA suite: supabase/game_reminder_foundation.sql and supabase/game_archiving.sql.",
        `Supabase reported: ${error.message}`,
      ].join(" ");
      return;
    }

    const { error: cancellationSchemaError } = await supabase
      .from("player_booking_cancellations")
      .select("id")
      .limit(1);

    if (cancellationSchemaError) {
      qaSchemaSkipReason = [
        "TEST Supabase is missing the player self-cancellation foundation required by the current app.",
        "Run the approved SQL migration on the TEST project before this QA suite: supabase/player_booking_cancellations.sql.",
        `Supabase reported: ${cancellationSchemaError.message}`,
      ].join(" ");
      return;
    }

    qaSchemaReady = true;
  });

  test.afterEach(async () => {
    const seed = seeds.pop();

    if (seed) {
      await cleanupQaSeed(supabase, seed);
    }
  });

  test("email/password login works with a confirmed seeded player", async ({ page }) => {
    test.skip(!qaSchemaReady, qaSchemaSkipReason);

    const seed = createQaSeed();
    seeds.push(seed);
    const player = await createConfirmedUser(supabase, seed, { label: "login_player" });

    await signInWithEmail(page, player.email, player.password);

    await expect(page.getByRole("link", { name: "Wallet" })).toBeVisible();
    await expect(page.getByRole("link", { name: "My Bookings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("wallet booking appears in My Bookings, updates capacity, and prevents duplicates", async ({
    page,
  }) => {
    test.skip(!qaSchemaReady, qaSchemaSkipReason);

    const seed = createQaSeed();
    seeds.push(seed);
    const player = await createConfirmedUser(supabase, seed, { label: "wallet_player" });
    const game = await createGame(supabase, seed, {
      title: `E2E QA Wallet Game ${seed.runId}`,
      price: 5,
      maxPlayers: 12,
    });
    await createWalletCredit(supabase, seed, player.id, 20);

    await expect.poll(async () => getWalletBalanceBreakdown(supabase, player.id)).toEqual({
      completedBalance: 20,
      reservedRefundAmount: 0,
      availableBalance: 20,
    });

    await signInWithEmail(page, player.email, player.password);
    await page.getByRole("link", { name: "Find Games" }).click();
    const gameCard = page.locator("#games").locator(".cursor-pointer").filter({ hasText: game.title }).first();
    await expect(gameCard).toBeVisible();
    await gameCard.click();
    await expect(page.getByRole("heading", { name: "Game Info" })).toBeVisible();
    await page.getByRole("button", { name: "Join Game" }).click();
    await expect(page.getByRole("heading", { name: "Secure checkout" })).toBeVisible();
    await page.getByRole("button", { name: "Pay £5 with Wallet" }).click();

    await expect(page.getByRole("heading", { name: "Secure checkout" })).toHaveCount(0);
    await expect.poll(async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("id")
        .eq("game_id", game.id)
        .eq("user_id", player.id);

      if (error) {
        throw new Error(error.message);
      }

      return data?.length ?? 0;
    }).toBe(1);

    await page.goto("/my-bookings");
    await expect(page.getByRole("heading", { name: "My Bookings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: game.title })).toBeVisible();

    const token = await getBrowserAccessToken(page);
    expect(token).toBeTruthy();
    const duplicateResult = await page.evaluate(
      async ({ accessToken, gameId }) => {
        const response = await fetch("/api/wallet/bookings", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ gameId }),
        });

        return {
          status: response.status,
          body: await response.json(),
        };
      },
      { accessToken: token, gameId: game.id }
    );

    expect(duplicateResult.status).toBe(200);
    expect(duplicateResult.body.payment_status).toBe("paid");

    await expect.poll(async () => {
      const { count, error } = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("game_id", game.id);

      if (error) {
        throw new Error(error.message);
      }

      return count ?? 0;
    }).toBe(1);
  });

  test("waiting-list join, duplicate prevention and leave work for a full game", async ({
    page,
  }) => {
    test.skip(!qaSchemaReady, qaSchemaSkipReason);

    const seed = createQaSeed();
    seeds.push(seed);
    const player = await createConfirmedUser(supabase, seed, { label: "waiting_player" });
    const game = await createGame(supabase, seed, {
      title: `E2E QA Full Game ${seed.runId}`,
      maxPlayers: 12,
    });
    await fillGameToCapacity(supabase, seed, game);

    await signInWithEmail(page, player.email, player.password);
    await page.getByRole("link", { name: "Find Games" }).click();
    const gameCard = page.locator("#games").locator(".cursor-pointer").filter({ hasText: game.title }).first();
    await expect(gameCard).toBeVisible();
    await gameCard.click();
    await expect(page.getByRole("heading", { name: "Game Info" })).toBeVisible();

    await page.getByRole("button", { name: "Join waiting list" }).click();
    await expect(page.getByText("You've been added to the waiting list.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Leave Waiting List" })).toBeVisible();

    const token = await getBrowserAccessToken(page);
    expect(token).toBeTruthy();
    const duplicateResult = await page.evaluate(
      async ({ accessToken, gameId, playerName }) => {
        const response = await fetch("/api/waiting-list", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ game_id: gameId, player_name: playerName }),
        });

        return {
          status: response.status,
          body: await response.json(),
        };
      },
      { accessToken: token, gameId: game.id, playerName: player.username }
    );

    expect(duplicateResult.status).toBe(200);
    expect(duplicateResult.body.message).toBe("You are already on the waiting list.");

    await page.getByRole("button", { name: "Leave Waiting List" }).click();
    await expect(page.getByText("You've left the waiting list for this game.")).toBeVisible();
    await expect.poll(async () => {
      const { data, error } = await supabase
        .from("waiting_list")
        .select("id")
        .eq("game_id", game.id)
        .eq("user_id", player.id)
        .eq("status", "waiting");

      if (error) {
        throw new Error(error.message);
      }

      return data?.length ?? 0;
    }).toBe(0);
  });

  test("admin can create, edit, archive and restore games", async ({ page }) => {
    test.setTimeout(60_000);
    test.skip(!qaSchemaReady, qaSchemaSkipReason);

    const seed = createQaSeed();
    seeds.push(seed);
    const admin = await createConfirmedUser(supabase, seed, { admin: true, label: "admin" });
    const createdTitle = `E2E QA Admin Created ${seed.runId}`;
    const editedTitle = `E2E QA Admin Edited ${seed.runId}`;
    const pastGame = await createGame(supabase, seed, {
      title: `E2E QA Archive Game ${seed.runId}`,
      startsAt: pastStartsAt,
      time: pastDisplayTime,
    });

    await signInWithEmail(page, admin.email, admin.password);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Admin Panel" })).toBeVisible();

    await page.getByLabel("Game title").fill(createdTitle);
    await page.getByLabel("Location").fill(`E2E QA Admin Pitch ${seed.runId.slice(-6)}`);
    await page.getByLabel("Kickoff date").fill("2099-02-01");
    await page.getByLabel("Kickoff time").fill("20:30");
    await page.getByLabel("Price").fill("7");
    await page.getByLabel("Max players").fill("12");
    await page.getByRole("button", { name: "Create Game" }).click();
    await expect(page.getByText(`"${createdTitle}" created.`)).toBeVisible();
    const createdGame = await insertSingle<{ id: number }>(
      supabase
        .from("games")
        .select("id")
        .eq("title", createdTitle)
        .single(),
      "load created admin game"
    );
    seed.games.push({
      id: createdGame.id,
      title: createdTitle,
      location: `E2E QA Admin Pitch ${seed.runId.slice(-6)}`,
      price: 7,
      maxPlayers: 12,
    });

    await page.reload();
    await expect(page.getByRole("heading", { name: "Admin Panel" })).toBeVisible();
    await page.getByPlaceholder("Search games by title or location").fill(createdTitle);
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { name: "Editing Game" })).toBeVisible();
    await page.getByLabel("Game title").fill(editedTitle);
    await page.getByRole("button", { name: "Update Game" }).click();
    await expect.poll(async () => {
      const { data, error } = await supabase.from("games").select("title").eq("id", createdGame.id).single();

      if (error) {
        throw new Error(error.message);
      }

      return data.title;
    }).toBe(editedTitle);

    await page.getByRole("button", { name: "Past / Legacy" }).click();
    await page.getByPlaceholder("Search games by title or location").fill(pastGame.title);
    const archiveDialogPromise = page.waitForEvent("dialog").then(async (dialog) => {
      expect(dialog.message()).toContain("No payment, wallet, refund, booking, or cancellation history will be deleted.");
      await dialog.accept();
    });
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await archiveDialogPromise;
    await page.getByRole("button", { name: "Archived" }).click();
    await page.getByPlaceholder("Search games by title or location").fill(pastGame.title);
    await expect(page.getByText("Archived").first()).toBeVisible();

    const restoreDialogPromise = page.waitForEvent("dialog").then(async (dialog) => {
      expect(dialog.message()).toContain("Unarchive");
      await dialog.accept();
    });
    await page.getByRole("button", { name: "Restore" }).click();
    await restoreDialogPromise;
    await expect.poll(async () => {
      const { data, error } = await supabase.from("games").select("archived_at").eq("id", pastGame.id).single();

      if (error) {
        throw new Error(error.message);
      }

      return data.archived_at;
    }).toBeNull();
  });

  test("admin can move a wallet-paid player between eligible games", async ({ page }) => {
    test.skip(!qaSchemaReady, qaSchemaSkipReason);

    const seed = createQaSeed();
    seeds.push(seed);
    const admin = await createConfirmedUser(supabase, seed, { admin: true, label: "move_admin" });
    const player = await createConfirmedUser(supabase, seed, { label: "move_player" });
    const sourceGame = await createGame(supabase, seed, {
      title: `E2E QA Move Source ${seed.runId}`,
      price: 5,
      maxPlayers: 12,
    });
    const targetGame = await createGame(supabase, seed, {
      title: `E2E QA Move Target ${seed.runId}`,
      price: 5,
      maxPlayers: 12,
    });
    const booking = await createWalletPaidBooking(supabase, seed, sourceGame, player);

    await signInWithEmail(page, admin.email, admin.password);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Bookings" })).toBeVisible();

    const bookingCard = page
      .locator("div.rounded-3xl")
      .filter({ hasText: player.username })
      .filter({ hasText: sourceGame.title })
      .filter({ has: page.locator("select[name='target_game_id']") })
      .first();
    await expect(bookingCard).toContainText(sourceGame.title);
    await bookingCard.locator("select[name='target_game_id']").selectOption(String(targetGame.id));
    const token = await getBrowserAccessToken(page);
    expect(token).toBeTruthy();
    const moveResult = await page.evaluate(
      async ({ accessToken, bookingId, targetGameId }) => {
        const response = await fetch(`/api/admin/bookings/${bookingId}/move`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ target_game_id: targetGameId }),
        });

        return {
          status: response.status,
          body: await response.json(),
        };
      },
      { accessToken: token, bookingId: booking.id, targetGameId: targetGame.id }
    );

    expect(moveResult, JSON.stringify(moveResult)).toMatchObject({ status: 200 });
    expect(moveResult.body.ok).toBe(true);

    await expect.poll(async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("game_id")
        .eq("id", booking.id)
        .single();

      if (error) {
        throw new Error(error.message);
      }

      return Number(data.game_id);
    }).toBe(targetGame.id);

    await expect.poll(async () => {
      const { data, error } = await supabase
        .from("wallet_transactions")
        .select("game_id")
        .eq("booking_id", booking.id)
        .eq("transaction_type", "wallet_booking_payment")
        .single();

      if (error) {
        throw new Error(error.message);
      }

      return Number(data.game_id);
    }).toBe(targetGame.id);
  });

  test("admin delete explains blocked games with history", async ({ page }) => {
    test.skip(!qaSchemaReady, qaSchemaSkipReason);

    const seed = createQaSeed();
    seeds.push(seed);
    const admin = await createConfirmedUser(supabase, seed, { admin: true, label: "delete_admin" });
    const game = await createGame(supabase, seed, {
      title: `E2E QA Delete Blocked ${seed.runId}`,
    });
    await createBooking(supabase, seed, game.id, { playerName: "E2E Delete Block Player" });

    await signInWithEmail(page, admin.email, admin.password);
    await page.goto("/admin");
    await page.getByRole("button", { name: "All" }).click();
    await page.getByPlaceholder("Search games by title or location").fill(game.title);
    await expect(page.getByText("Delete blocked", { exact: true })).toBeVisible();

    const confirmPromise = page.waitForEvent("dialog").then((dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await confirmPromise;

    const alertDialog = await page.waitForEvent("dialog");
    expect(alertDialog.message()).toContain("This game cannot be deleted");
    expect(alertDialog.message()).toContain("1 booking");
    await alertDialog.accept();

    await expect.poll(async () => {
      const { data, error } = await supabase.from("games").select("id").eq("id", game.id).maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      return Boolean(data);
    }).toBe(true);
  });

  test("player cancellation for an eligible SumUp booking creates a reserved card refund without calling SumUp", async ({
    page,
  }) => {
    test.skip(!qaSchemaReady, qaSchemaSkipReason);

    const seed = createQaSeed();
    seeds.push(seed);
    const player = await createConfirmedUser(supabase, seed, { label: "sumup_cancel_player" });
    const game = await createGame(supabase, seed, {
      title: `E2E QA SumUp Cancel ${seed.runId}`,
      price: 5,
      maxPlayers: 12,
    });
    const booking = await createSumUpPaidBooking(supabase, seed, game, player);

    await signInWithEmail(page, player.email, player.password);
    const token = await getBrowserAccessToken(page);
    expect(token).toBeTruthy();

    const cancelResult = await page.evaluate(
      async ({ accessToken, bookingId }) => {
        const response = await fetch(`/api/bookings/${bookingId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        return {
          status: response.status,
          body: await response.json(),
        };
      },
      { accessToken: token, bookingId: booking.id }
    );

    expect(cancelResult.status).toBe(200);
    expect(cancelResult.body).toMatchObject({
      ok: true,
      released: true,
      refund_eligible: true,
      payment_method: "sumup",
      refund_policy: "eligible_24h",
      automatic_refund: {
        status: "disabled",
      },
    });

    await expect.poll(async () => {
      const { count, error } = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("id", booking.id);

      if (error) {
        throw new Error(error.message);
      }

      return count ?? 0;
    }).toBe(0);

    const { data: cancellations, error: cancellationError } = await supabase
      .from("player_booking_cancellations")
      .select("id,payment_method,refund_policy,status,amount")
      .eq("booking_id", booking.id)
      .eq("user_id", player.id);

    if (cancellationError) {
      throw new Error(cancellationError.message);
    }

    expect(cancellations).toHaveLength(1);
    expect(cancellations?.[0]).toMatchObject({
      payment_method: "sumup",
      refund_policy: "eligible_24h",
      status: "released",
    });
    expect(Number(cancellations?.[0].amount)).toBe(5);

    const { data: walletRows, error: walletError } = await supabase
      .from("wallet_transactions")
      .select("id,amount,status,transaction_type,metadata")
      .eq("user_id", player.id)
      .filter("metadata->>original_booking_id", "eq", String(booking.id));

    if (walletError) {
      throw new Error(walletError.message);
    }

    expect(walletRows?.filter((row) => row.transaction_type === "player_cancelled_credit")).toHaveLength(1);
    expect(walletRows?.filter((row) => row.transaction_type === "refund_requested")).toHaveLength(1);
    await expect.poll(async () => getWalletBalanceBreakdown(supabase, player.id)).toEqual({
      completedBalance: 5,
      reservedRefundAmount: 5,
      availableBalance: 0,
    });

    const { count: attemptCount, error: attemptError } = await supabase
      .from("sumup_refund_attempts")
      .select("id", { count: "exact", head: true })
      .eq("refund_request_id", Number(cancelResult.body.refund_request_id));

    if (attemptError) {
      throw new Error(attemptError.message);
    }

    expect(attemptCount ?? 0).toBe(0);
  });

  test("player cancellation for an eligible wallet booking restores the original wallet debit once", async ({
    page,
  }) => {
    test.skip(!qaSchemaReady, qaSchemaSkipReason);

    const seed = createQaSeed();
    seeds.push(seed);
    const player = await createConfirmedUser(supabase, seed, { label: "wallet_cancel_player" });
    const game = await createGame(supabase, seed, {
      title: `E2E QA Wallet Cancel ${seed.runId}`,
      price: 5,
      maxPlayers: 12,
    });
    await createWalletCredit(supabase, seed, player.id, 5);
    const booking = await createWalletPaidBooking(supabase, seed, game, player);

    await expect.poll(async () => getWalletBalanceBreakdown(supabase, player.id)).toEqual({
      completedBalance: 0,
      reservedRefundAmount: 0,
      availableBalance: 0,
    });

    await signInWithEmail(page, player.email, player.password);
    const token = await getBrowserAccessToken(page);
    expect(token).toBeTruthy();

    const cancelResult = await page.evaluate(
      async ({ accessToken, bookingId }) => {
        const response = await fetch(`/api/bookings/${bookingId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        return {
          status: response.status,
          body: await response.json(),
        };
      },
      { accessToken: token, bookingId: booking.id }
    );

    expect(cancelResult.status).toBe(200);
    expect(cancelResult.body).toMatchObject({
      ok: true,
      released: true,
      refund_eligible: true,
      payment_method: "wallet",
      refund_policy: "eligible_24h",
      refund_request_id: null,
    });

    const { data: walletRestorations, error: walletError } = await supabase
      .from("wallet_transactions")
      .select("id,amount,status,transaction_type,metadata")
      .eq("user_id", player.id)
      .eq("transaction_type", "player_cancelled_credit")
      .filter("metadata->>original_booking_id", "eq", String(booking.id));

    if (walletError) {
      throw new Error(walletError.message);
    }

    expect(walletRestorations).toHaveLength(1);
    expect(Number(walletRestorations?.[0].amount)).toBe(5);
    await expect.poll(async () => getWalletBalanceBreakdown(supabase, player.id)).toEqual({
      completedBalance: 5,
      reservedRefundAmount: 0,
      availableBalance: 5,
    });
  });

  test("duplicate player cancellation requests return the same durable result without duplicate refund rows", async ({
    page,
  }) => {
    test.skip(!qaSchemaReady, qaSchemaSkipReason);

    const seed = createQaSeed();
    seeds.push(seed);
    const player = await createConfirmedUser(supabase, seed, { label: "duplicate_cancel_player" });
    const game = await createGame(supabase, seed, {
      title: `E2E QA Duplicate Cancel ${seed.runId}`,
      price: 5,
      maxPlayers: 12,
    });
    const booking = await createSumUpPaidBooking(supabase, seed, game, player);

    await signInWithEmail(page, player.email, player.password);
    const token = await getBrowserAccessToken(page);
    expect(token).toBeTruthy();

    const results = await page.evaluate(
      async ({ accessToken, bookingId }) => {
        const request = () =>
          fetch(`/api/bookings/${bookingId}`, {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }).then(async (response) => ({
            status: response.status,
            body: await response.json(),
          }));

        return Promise.all([request(), request()]);
      },
      { accessToken: token, bookingId: booking.id }
    );

    expect(results.every((result) => result.status === 200)).toBe(true);
    expect(new Set(results.map((result) => result.body.refund_request_id)).size).toBe(1);

    const { count: cancellationCount, error: cancellationError } = await supabase
      .from("player_booking_cancellations")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", booking.id)
      .eq("user_id", player.id);

    if (cancellationError) {
      throw new Error(cancellationError.message);
    }

    expect(cancellationCount ?? 0).toBe(1);

    const { data: walletRows, error: walletError } = await supabase
      .from("wallet_transactions")
      .select("id,transaction_type")
      .eq("user_id", player.id)
      .filter("metadata->>original_booking_id", "eq", String(booking.id));

    if (walletError) {
      throw new Error(walletError.message);
    }

    expect(walletRows?.filter((row) => row.transaction_type === "player_cancelled_credit")).toHaveLength(1);
    expect(walletRows?.filter((row) => row.transaction_type === "refund_requested")).toHaveLength(1);
    await expect.poll(async () => {
      const { count, error } = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("id", booking.id);

      if (error) {
        throw new Error(error.message);
      }

      return count ?? 0;
    }).toBe(0);
  });

  test("waiting-list notification is created only after a successful cancellation release", async ({
    page,
  }) => {
    test.skip(!qaSchemaReady, qaSchemaSkipReason);

    const seed = createQaSeed();
    seeds.push(seed);
    const player = await createConfirmedUser(supabase, seed, { label: "notify_cancel_player" });
    const waitingPlayer = await createConfirmedUser(supabase, seed, { label: "notify_waiting_player" });
    const game = await createGame(supabase, seed, {
      title: `E2E QA Notify Cancel ${seed.runId}`,
      price: 5,
      maxPlayers: 1,
    });
    await createWalletCredit(supabase, seed, player.id, 5);
    const booking = await createWalletPaidBooking(supabase, seed, game, player);
    const waitingRow = await insertSingle<{ id: number }>(
      supabase
        .from("waiting_list")
        .insert({
          game_id: game.id,
          user_id: waitingPlayer.id,
          player_name: waitingPlayer.username,
          status: "waiting",
        })
        .select("id")
        .single(),
      "insert QA waiting-list row for cancellation notification"
    );
    seed.waitingList.push({
      id: waitingRow.id,
      gameId: game.id,
      userId: waitingPlayer.id,
    });

    await signInWithEmail(page, player.email, player.password);
    const token = await getBrowserAccessToken(page);
    expect(token).toBeTruthy();

    const cancelResult = await page.evaluate(
      async ({ accessToken, bookingId }) => {
        const response = await fetch(`/api/bookings/${bookingId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        return {
          status: response.status,
          body: await response.json(),
        };
      },
      { accessToken: token, bookingId: booking.id }
    );

    expect(cancelResult.status).toBe(200);
    expect(cancelResult.body).toMatchObject({
      released: true,
      waiting_list_notified: true,
    });

    await expect.poll(async () => {
      const { count, error } = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("id", booking.id);

      if (error) {
        throw new Error(error.message);
      }

      return count ?? 0;
    }).toBe(0);

    await expect.poll(async () => {
      const { count, error } = await supabase
        .from("waiting_list_notifications")
        .select("id", { count: "exact", head: true })
        .eq("game_id", game.id)
        .eq("waiting_list_id", waitingRow.id)
        .eq("user_id", waitingPlayer.id);

      if (error) {
        throw new Error(error.message);
      }

      return count ?? 0;
    }).toBe(1);
  });

  test("player cancellation within 24 hours releases the booking without a refund", async ({
    page,
  }) => {
    test.skip(!qaSchemaReady, qaSchemaSkipReason);

    const seed = createQaSeed();
    seeds.push(seed);
    const player = await createConfirmedUser(supabase, seed, { label: "late_cancel_player" });
    const startsAt = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
    const game = await createGame(supabase, seed, {
      title: `E2E QA Late Cancel ${seed.runId}`,
      startsAt,
      price: 5,
      maxPlayers: 12,
    });
    await createWalletCredit(supabase, seed, player.id, 5);
    const booking = await createWalletPaidBooking(supabase, seed, game, player);

    await signInWithEmail(page, player.email, player.password);
    const token = await getBrowserAccessToken(page);
    expect(token).toBeTruthy();

    const cancelResult = await page.evaluate(
      async ({ accessToken, bookingId }) => {
        const response = await fetch(`/api/bookings/${bookingId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        return {
          status: response.status,
          body: await response.json(),
        };
      },
      { accessToken: token, bookingId: booking.id }
    );

    expect(cancelResult.status).toBe(200);
    expect(cancelResult.body).toMatchObject({
      ok: true,
      released: true,
      refund_eligible: false,
      refund_policy: "ineligible_within_24h",
      wallet_restoration_transaction_id: null,
    });

    const { count: creditCount, error: creditError } = await supabase
      .from("wallet_transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", player.id)
      .eq("transaction_type", "player_cancelled_credit")
      .filter("metadata->>original_booking_id", "eq", String(booking.id));

    if (creditError) {
      throw new Error(creditError.message);
    }

    expect(creditCount ?? 0).toBe(0);
    await expect.poll(async () => getWalletBalanceBreakdown(supabase, player.id)).toEqual({
      completedBalance: 0,
      reservedRefundAmount: 0,
      availableBalance: 0,
    });
  });

  test("player cancellation for missing structured kickoff fails closed and keeps the booking", async ({
    page,
  }) => {
    test.skip(!qaSchemaReady, qaSchemaSkipReason);

    const seed = createQaSeed();
    seeds.push(seed);
    const player = await createConfirmedUser(supabase, seed, { label: "legacy_cancel_player" });
    const game = await createGame(supabase, seed, {
      title: `E2E QA Legacy Cancel ${seed.runId}`,
      startsAt: null,
      time: "Legacy time",
      price: 5,
      maxPlayers: 12,
    });
    await createWalletCredit(supabase, seed, player.id, 5);
    const booking = await createWalletPaidBooking(supabase, seed, game, player);

    await signInWithEmail(page, player.email, player.password);
    const token = await getBrowserAccessToken(page);
    expect(token).toBeTruthy();

    const cancelResult = await page.evaluate(
      async ({ accessToken, bookingId }) => {
        const response = await fetch(`/api/bookings/${bookingId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        return {
          status: response.status,
          body: await response.json(),
        };
      },
      { accessToken: token, bookingId: booking.id }
    );

    expect(cancelResult.status).toBe(409);
    expect(cancelResult.body).toMatchObject({
      reason: "missing_starts_at",
    });

    await expect.poll(async () => {
      const { count, error } = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("id", booking.id);

      if (error) {
        throw new Error(error.message);
      }

      return count ?? 0;
    }).toBe(1);
  });
});
