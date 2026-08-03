import { expect, test, type Page } from "@playwright/test";
import { signInWithEmail } from "./helpers/auth";
import { createE2ESupabaseClient } from "./helpers/moneySeed";
import {
  canRunDatabaseMutationE2E,
  requireDatabaseMutationE2EEnv,
} from "./helpers/supabaseEnv";

test.use({ baseURL: "http://localhost:3000" });

function uniqueRunId() {
  return `e2e_calendar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function dateKeyFromOffset(offsetDays: number) {
  const date = new Date();
  date.setUTCHours(18, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);

  return date.toISOString().slice(0, 10);
}

function startsAtFromDateKey(dateKey: string) {
  return `${dateKey}T18:00:00.000Z`;
}

function displayTimeFromDateKey(dateKey: string) {
  const date = new Date(`${dateKey}T18:00:00.000Z`);

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function calendarLabelFromDateKey(dateKey: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${dateKey}T00:00:00.000Z`));
}

function calendarDatePattern(dateKey: string) {
  const label = calendarLabelFromDateKey(dateKey).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `${label}, \\d+ games?`,
    "i"
  );
}

async function seedCalendarGames(runId: string) {
  const supabase = createE2ESupabaseClient(requireDatabaseMutationE2EEnv());
  const titleRunLabel = runId.replaceAll("_", " ");
  const firstDateKey = dateKeyFromOffset(1);
  const emptyDateKey = dateKeyFromOffset(2);
  const secondDateKey = dateKeyFromOffset(3);
  const archivedDateKey = dateKeyFromOffset(4);
  const pastDateKey = dateKeyFromOffset(-1);
  const rows = [
    {
      title: `${titleRunLabel} Visible First`,
      location: "E2E Calendar Pitch",
      time: displayTimeFromDateKey(firstDateKey),
      starts_at: startsAtFromDateKey(firstDateKey),
      price: 5,
      max_players: 16,
      status: "active",
      archived_at: null,
    },
    {
      title: `${titleRunLabel} Visible Second`,
      location: "E2E Calendar Pitch",
      time: displayTimeFromDateKey(secondDateKey),
      starts_at: startsAtFromDateKey(secondDateKey),
      price: 5,
      max_players: 16,
      status: "active",
      archived_at: null,
    },
    {
      title: `${titleRunLabel} Cancelled Empty Date`,
      location: "E2E Calendar Pitch",
      time: displayTimeFromDateKey(emptyDateKey),
      starts_at: startsAtFromDateKey(emptyDateKey),
      price: 5,
      max_players: 16,
      status: "cancelled",
      archived_at: null,
    },
    {
      title: `${titleRunLabel} Archived Hidden Date`,
      location: "E2E Calendar Pitch",
      time: displayTimeFromDateKey(archivedDateKey),
      starts_at: startsAtFromDateKey(archivedDateKey),
      price: 5,
      max_players: 16,
      status: "active",
      archived_at: new Date().toISOString(),
    },
    {
      title: `${titleRunLabel} Past Hidden Date`,
      location: "E2E Calendar Pitch",
      time: displayTimeFromDateKey(pastDateKey),
      starts_at: startsAtFromDateKey(pastDateKey),
      price: 5,
      max_players: 16,
      status: "active",
      archived_at: null,
    },
  ];

  const { data, error } = await supabase.from("games").insert(rows).select("id,title");

  if (error) {
    throw new Error(`seed calendar games: ${error.message}`);
  }

  const insertedRows = data ?? [];
  const firstGameId = insertedRows.find((row) => row.title === `${titleRunLabel} Visible First`)?.id;
  const secondGameId = insertedRows.find((row) => row.title === `${titleRunLabel} Visible Second`)?.id;

  if (!firstGameId || !secondGameId) {
    throw new Error("seed calendar games: inserted game ids were not returned.");
  }

  return {
    supabase,
    firstGameId,
    firstDateKey,
    emptyDateKey,
    secondGameId,
    secondDateKey,
  };
}

async function seedCalendarUser(runId: string, label: string) {
  const supabase = createE2ESupabaseClient(requireDatabaseMutationE2EEnv());
  const email = `${runId}_${label}@example.test`;
  const password = `Password-${runId}-${label}`;
  const username = `Calendar ${label} ${runId.slice(-6)}`;
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      username,
      e2e_run_id: runId,
    },
  });

  if (authError || !authData.user) {
    throw new Error(`seed calendar user ${label}: ${authError?.message || "no user returned"}`);
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .upsert({
      id: authData.user.id,
      email,
      username,
      age: 25,
      gender: "Prefer not to say",
      favourite_position: "Midfielder",
    });

  if (profileError) {
    throw new Error(`seed calendar profile ${label}: ${profileError.message}`);
  }

  return {
    id: authData.user.id,
    email,
    password,
    username,
  };
}

async function seedCalendarBooking(params: {
  gameId: number;
  userId: string;
  playerName: string;
}) {
  const supabase = createE2ESupabaseClient(requireDatabaseMutationE2EEnv());
  const { data, error } = await supabase
    .from("bookings")
    .insert({
      game_id: params.gameId,
      user_id: params.userId,
      player_name: params.playerName,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`seed calendar booking: ${error?.message || "no booking returned"}`);
  }

  return data.id as number;
}

async function seedAdditionalCalendarGame(params: {
  runId: string;
  title: string;
  dateKey: string;
}) {
  const supabase = createE2ESupabaseClient(requireDatabaseMutationE2EEnv());
  const { data, error } = await supabase
    .from("games")
    .insert({
      title: params.title,
      location: "E2E Calendar Pitch",
      time: displayTimeFromDateKey(params.dateKey),
      starts_at: startsAtFromDateKey(params.dateKey),
      price: 5,
      max_players: 16,
      status: "active",
      archived_at: null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`seed additional calendar game ${params.runId}: ${error?.message || "no game returned"}`);
  }

  return data.id as number;
}

async function refreshCalendarWithoutHardReload(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

async function cleanupCalendarSeed(runId: string, userIds: string[] = []) {
  const supabase = createE2ESupabaseClient(requireDatabaseMutationE2EEnv());
  await supabase.from("bookings").delete().like("player_name", `Calendar % ${runId.slice(-6)}`);
  await supabase.from("games").delete().like("title", `${runId.replaceAll("_", " ")}%`);
  await supabase.from("profiles").delete().in("id", userIds.length > 0 ? userIds : ["00000000-0000-0000-0000-000000000000"]);

  for (const userId of userIds) {
    await supabase.auth.admin.deleteUser(userId);
  }
}

test.describe("Games calendar navigation", () => {
  test.describe.configure({ mode: "serial" });

  test.skip(
    !canRunDatabaseMutationE2E(),
    "Calendar E2E seeds TEST games and requires E2E_ALLOW_DB_MUTATION=true."
  );

  test("game-date ticks and All Games navigation filter visible upcoming games", async ({
    page,
  }) => {
    const runId = uniqueRunId();
    const titleRunLabel = runId.replaceAll("_", " ");
    const seed = await seedCalendarGames(runId);
    const player = await seedCalendarUser(runId, "player");
    const otherPlayer = await seedCalendarUser(runId, "other");
    const playerBookingId = await seedCalendarBooking({
      gameId: seed.firstGameId,
      userId: player.id,
      playerName: player.username,
    });
    await seedCalendarBooking({
      gameId: seed.secondGameId,
      userId: otherPlayer.id,
      playerName: otherPlayer.username,
    });

    try {
      await signInWithEmail(page, player.email, player.password);
      await page.getByRole("link", { name: "Find Games" }).first().click();
      await expect(page.locator("#games")).toBeVisible();

      const firstDate = page.getByRole("button", {
        name: calendarDatePattern(seed.firstDateKey),
      });
      const secondDate = page.getByRole("button", {
        name: calendarDatePattern(seed.secondDateKey),
      });
      const emptyDate = page.locator('#games button[aria-label*="0 games"]').first();

      await expect(firstDate).toBeVisible();
      await expect(secondDate).toBeVisible();
      await expect(emptyDate).toBeVisible();
      await expect(page.getByTestId(`calendar-game-count-${seed.firstDateKey}`)).not.toHaveText("0");
      await expect(page.getByTestId(`calendar-game-count-${seed.secondDateKey}`)).not.toHaveText("0");
      await expect(page.getByTestId(`calendar-booked-tick-${seed.firstDateKey}`)).toBeVisible();
      await expect(page.getByTestId(`calendar-booked-tick-${seed.secondDateKey}`)).toHaveCount(0);
      await expect(emptyDate.locator("[data-testid^='calendar-booked-tick-']")).toHaveCount(0);
      await expect(page.getByText("= Your Booking")).toBeVisible();
      await expect(page.getByText("= Games on This Date")).toBeVisible();
      await expect(page.getByText(`${titleRunLabel} Cancelled Empty Date`)).toHaveCount(0);
      await expect(page.getByText(`${titleRunLabel} Archived Hidden Date`)).toHaveCount(0);
      await expect(page.getByText(`${titleRunLabel} Past Hidden Date`)).toHaveCount(0);

      await firstDate.click();
      await expect(page.getByText(`${titleRunLabel} Visible First`)).toBeVisible();
      await expect(page.getByText(`${titleRunLabel} Visible Second`)).toHaveCount(0);

      await page.getByRole("button", { name: "Show next week" }).click();
      await expect(firstDate).toHaveCount(0);
      await page.getByRole("button", { name: "Show previous week" }).click();
      await expect(firstDate).toBeVisible();

      const allGames = page.getByRole("button", { name: "All Games" });
      await allGames.click();
      await expect(allGames).toHaveAttribute("aria-pressed", "true");
      await expect(firstDate).toHaveAttribute("aria-pressed", "false");
      await expect(page.getByText(`${titleRunLabel} Visible First`)).toBeVisible();
      await expect(page.getByText(`${titleRunLabel} Visible Second`)).toBeVisible();
      if (process.env.E2E_CAPTURE_CALENDAR_SCREENSHOTS === "true") {
        await page.locator("#games").screenshot({ path: "/tmp/fair-play-calendar-desktop.png" });
      }

      await firstDate.click();
      await expect(firstDate).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByText(`${titleRunLabel} Visible First`)).toBeVisible();
      await expect(page.getByText(`${titleRunLabel} Visible Second`)).toHaveCount(0);

      await allGames.focus();
      await page.keyboard.press("Enter");
      await expect(allGames).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByText(`${titleRunLabel} Visible Second`)).toBeVisible();

      await page.getByRole("button", { name: "Today" }).click();
      await expect(allGames).toHaveAttribute("aria-pressed", "false");
      await expect(page.getByText(`${titleRunLabel} Visible First`)).toHaveCount(0);
      await expect(page.getByText(`${titleRunLabel} Visible Second`)).toHaveCount(0);

      await seed.supabase.from("bookings").delete().eq("id", playerBookingId);
      await page.reload();
      await page.getByRole("link", { name: "Find Games" }).first().click();
      await expect(page.getByTestId(`calendar-booked-tick-${seed.firstDateKey}`)).toHaveCount(0);
      await expect(page.getByTestId(`calendar-game-count-${seed.firstDateKey}`)).not.toHaveText("0");
    } finally {
      await cleanupCalendarSeed(runId, [player.id, otherPlayer.id]);
    }
  });

  test("booking ticks follow visible games after deletion without a hard refresh", async ({
    page,
  }) => {
    const runId = uniqueRunId();
    const titleRunLabel = runId.replaceAll("_", " ");
    const seed = await seedCalendarGames(runId);
    const player = await seedCalendarUser(runId, "deletion");
    const sameDateGameId = await seedAdditionalCalendarGame({
      runId,
      title: `${titleRunLabel} Visible Same Date`,
      dateKey: seed.firstDateKey,
    });
    await seedCalendarBooking({
      gameId: seed.firstGameId,
      userId: player.id,
      playerName: player.username,
    });
    await seedCalendarBooking({
      gameId: sameDateGameId,
      userId: player.id,
      playerName: player.username,
    });

    try {
      await signInWithEmail(page, player.email, player.password);
      await page.getByRole("link", { name: "Find Games" }).first().click();
      await expect(page.locator("#games")).toBeVisible();
      await expect(page.getByTestId(`calendar-game-count-${seed.firstDateKey}`)).toHaveText("2");
      await expect(page.getByTestId(`calendar-booked-tick-${seed.firstDateKey}`)).toBeVisible();

      await seed.supabase.from("games").delete().eq("id", seed.firstGameId);
      await refreshCalendarWithoutHardReload(page);
      await expect(page.getByTestId(`calendar-game-count-${seed.firstDateKey}`)).toHaveText("1");
      await expect(page.getByTestId(`calendar-booked-tick-${seed.firstDateKey}`)).toBeVisible();

      await seed.supabase.from("games").delete().eq("id", sameDateGameId);
      await refreshCalendarWithoutHardReload(page);
      await expect(page.getByTestId(`calendar-game-count-${seed.firstDateKey}`)).toHaveText("0");
      await expect(page.getByTestId(`calendar-booked-tick-${seed.firstDateKey}`)).toHaveCount(0);
    } finally {
      await cleanupCalendarSeed(runId, [player.id]);
    }
  });

  test("mobile calendar controls do not overflow the page", async ({ page }) => {
    const runId = uniqueRunId();
    const seed = await seedCalendarGames(runId);
    const player = await seedCalendarUser(runId, "mobile");
    await seedCalendarBooking({
      gameId: seed.firstGameId,
      userId: player.id,
      playerName: player.username,
    });

    try {
      await signInWithEmail(page, player.email, player.password);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("link", { name: "Find Games" }).first().click();
      await expect(page.locator("#games")).toBeVisible();
      await expect(page.getByRole("button", { name: "All Games" })).toBeVisible();
      await expect(page.getByText("= Your Booking")).toBeVisible();
      await expect(page.getByText("= Games on This Date")).toBeVisible();
      if (process.env.E2E_CAPTURE_CALENDAR_SCREENSHOTS === "true") {
        await page.locator("#games").screenshot({ path: "/tmp/fair-play-calendar-mobile.png" });
      }

      const bodyWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const viewportWidth = await page.evaluate(() => window.innerWidth);

      expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1);
    } finally {
      await cleanupCalendarSeed(runId, [player.id]);
    }
  });

  test("FAQ explains the calendar symbols in the existing accordion", async ({ page }) => {
    await page.goto("/");

    const question = page.getByText("What do the calendar symbols mean?");
    await expect(question).toBeVisible();
    await question.click();

    await expect(
      page.getByText(
        "The green tick shows a date where you have booked a game. The number shows how many games are available on that date."
      )
    ).toBeVisible();
  });
});
