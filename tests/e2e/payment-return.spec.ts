import { expect, test, type BrowserContext, type Page, type Request } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { signInWithEmail } from "./helpers/auth";
import { createE2ESupabaseClient } from "./helpers/moneySeed";
import {
  canRunDatabaseMutationE2E,
  requireDatabaseMutationE2EEnv,
} from "./helpers/supabaseEnv";

type PaymentReturnSeed = {
  runId: string;
  userId: string;
  email: string;
  password: string;
  username: string;
  gameId: number;
  gameTitle: string;
  bookingId?: number;
};

test.use({
  trace: "on-first-retry",
  screenshot: "only-on-failure",
  video: "retain-on-failure",
});

test.describe("SumUp payment return", () => {
  test.skip(
    !canRunDatabaseMutationE2E(),
    "TEST-only payment-return E2E requires E2E_ALLOW_DB_MUTATION=true and the TEST Supabase project."
  );
  test.describe.configure({ mode: "serial" });

  let supabase: SupabaseClient;
  const seeds: PaymentReturnSeed[] = [];

  test.beforeAll(() => {
    supabase = createE2ESupabaseClient(requireDatabaseMutationE2EEnv());
  });

  test.afterEach(async () => {
    const seed = seeds.pop();

    if (seed) {
      await cleanupSeed(supabase, seed);
    }
  });

  test("opens checkout details immediately and opens the paid game", async ({
    page,
  }) => {
    const seed = await createSeed(supabase, { label: "paid", booked: true });
    seeds.push(seed);
    const checkoutReference = `${seed.runId}_checkout_reference`;
    const diagnostics = collectDiagnostics(page);
    let statusRequests = 0;

    await page.route("**/api/sumup/status?**", async (route) => {
      statusRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, statusRequests === 1 ? 1200 : 0));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          paymentStatus: "paid",
          gameId: seed.gameId,
          bookingId: seed.bookingId,
        }),
      });
    });

    await signInWithEmail(page, seed.email, seed.password);
    await setPendingPaymentStorage(page, {
      checkoutReference,
      checkoutId: `${seed.runId}_checkout_id`,
      gameId: seed.gameId,
    });

    await page.goto(`/?sumup_checkout_reference=${checkoutReference}`);

    await expect(page.getByRole("heading", { name: "Confirming your booking" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Secure checkout" })).toBeVisible();
    await expect(page.getByText("Checking your payment...")).toBeVisible();
    await expect(page.getByText("We're confirming whether your payment was completed.")).toBeVisible();
    await startPaymentReturnFrameMonitor(page, seed.gameTitle);

    await expect(page.getByText("Payment confirmed. Your booking has been added.").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Game Info" })).toBeVisible();
    await expect(page.getByText(seed.gameTitle).first()).toBeVisible();
    await expect(page.getByText("Already Joined").first()).toBeVisible();
    await expect(page.getByText(seed.username).first()).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByRole("heading", { name: "Game Info" })).toBeVisible();
    const frames = await stopPaymentReturnFrameMonitor(page);
    expect(frames.some((frame) => frame.confirming)).toBe(false);
    expect(frames.some((frame) => frame.modal)).toBe(true);

    const bookingCountBeforeRefresh = await countBookings(supabase, seed);
    await page.goto(`/?sumup_checkout_reference=${checkoutReference}`);
    await expect(page.getByRole("heading", { name: "Confirming your booking" })).toHaveCount(0);
    await expect(page.getByText("Already Joined").first()).toBeVisible();
    await expect.poll(() => countBookings(supabase, seed)).toBe(bookingCountBeforeRefresh);
    expect(statusRequests).toBeGreaterThanOrEqual(2);
    expect(diagnostics.errors()).toEqual([]);
  });

  test("opens checkout details from a fresh browser return without the old return gate", async ({
    browser,
  }) => {
    const seed = await createSeed(supabase, { label: "fresh", booked: true });
    seeds.push(seed);
    const checkoutReference = `${seed.runId}_fresh_reference`;
    const checkoutId = `${seed.runId}_fresh_checkout`;
    await createPendingPayment(supabase, seed, {
      checkoutReference,
      checkoutId,
    });
    const context = await browser.newContext();
    const env = requireDatabaseMutationE2EEnv();
    const session = await signInForFreshContext(env, seed.email, seed.password);
    await installFreshPaymentReturnState(context, {
      supabaseUrl: env.supabaseUrl,
      session,
      checkoutReference,
      checkoutId,
      gameId: seed.gameId,
      gameTitle: seed.gameTitle,
    });
    const page = await context.newPage();
    const diagnostics = collectDiagnostics(page);
    let statusRequests = 0;

    await page.route("**/rest/v1/profiles?**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });
    await page.route("**/rest/v1/games?**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.continue();
    });
    await page.route("**/api/bookings", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    await page.route("**/api/sumup/status?**", async (route) => {
      statusRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          paymentStatus: "paid",
          gameId: seed.gameId,
          bookingId: seed.bookingId,
        }),
      });
    });

    try {
      await page.goto("/");

      await expect(page.getByRole("heading", { name: "Confirming your booking" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Secure checkout" })).toBeVisible();
      await expect(page.getByText("Checking your payment...")).toBeVisible();
      await expect.poll(() => statusRequests).toBeGreaterThan(0);

      await expect(page.getByRole("heading", { name: "Game Info" })).toBeVisible();
      await expect(page.getByText(seed.gameTitle).first()).toBeVisible();
      await expect(page.getByText(seed.username).first()).toBeVisible();
      await page.waitForTimeout(500);
      await expect(page.getByRole("heading", { name: "Game Info" })).toBeVisible();

      const frames = await getInstalledPaymentReturnFrames(page);
      expect(frames.some((frame) => frame.confirming)).toBe(false);
      expect(frames.some((frame) => frame.modal)).toBe(true);
      expect(diagnostics.errors()).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("keeps slow verification on the processing state without showing the games page", async ({
    page,
  }) => {
    const seed = await createSeed(supabase, { label: "slow", booked: false });
    seeds.push(seed);
    const checkoutReference = `${seed.runId}_slow_reference`;
    const diagnostics = collectDiagnostics(page);

    await page.route("**/api/sumup/status?**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ paymentStatus: "pending", gameId: seed.gameId }),
      });
    });

    await signInWithEmail(page, seed.email, seed.password);
    await setPendingPaymentStorage(page, {
      checkoutReference,
      checkoutId: `${seed.runId}_checkout_id`,
      gameId: seed.gameId,
    });

    await page.goto(`/?sumup_checkout_reference=${checkoutReference}`);

    await expect(page.getByRole("heading", { name: "Confirming your booking" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Secure checkout" })).toBeVisible();
    await expect(page.getByText("Checking your payment...")).toBeVisible();
    await expect(page.getByText("We're confirming whether your payment was completed.")).toBeVisible();
    await expect(page.getByRole("button", { name: `Pay £5 with SumUp` })).toBeDisabled();
    await page.waitForTimeout(1000);
    await expect(page.getByRole("heading", { name: "Secure checkout" })).toBeVisible();
    await expect(page.getByRole("button", { name: `Pay £5 with SumUp` })).toBeDisabled();
    expect(diagnostics.errors()).toEqual([]);
  });

  test("shows existing paid_no_space and failed return states", async ({ page }) => {
    const paidNoSpaceSeed = await createSeed(supabase, { label: "no_space", booked: false });
    seeds.push(paidNoSpaceSeed);
    const noSpaceDiagnostics = collectDiagnostics(page);

    await page.route("**/api/sumup/status?**", async (route) => {
      const url = new URL(route.request().url());
      const reference = url.searchParams.get("checkout_reference") ?? "";
      const isFailed = reference.includes("failed");
      const isCancelled = reference.includes("cancelled");

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          isCancelled
            ? { paymentStatus: "cancelled", gameId: paidNoSpaceSeed.gameId }
            : isFailed
            ? { paymentStatus: "failed", gameId: paidNoSpaceSeed.gameId }
            : { paymentStatus: "paid_no_space", gameId: paidNoSpaceSeed.gameId }
        ),
      });
    });

    await signInWithEmail(page, paidNoSpaceSeed.email, paidNoSpaceSeed.password);
    await page.goto(`/?sumup_checkout_reference=${paidNoSpaceSeed.runId}_paid_no_space_reference`);

    await expect(page.getByRole("heading", { name: "Confirming your booking" })).toHaveCount(0);
    await expect(page.getByText("Payment received, but this game is now full.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Game Info" })).toBeVisible();

    await page.goto(`/?sumup_checkout_reference=${paidNoSpaceSeed.runId}_failed_reference`);

    await expect(page.getByRole("heading", { name: "Confirming your booking" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Secure checkout" })).toBeVisible();
    await expect(page.getByText("Payment wasn't completed.")).toBeVisible();
    await expect(page.getByText("Your booking has not been confirmed.")).toBeVisible();
    await expect(page.getByRole("button", { name: `Pay £5 with SumUp` })).toBeEnabled();

    await page.goto(`/?sumup_checkout_reference=${paidNoSpaceSeed.runId}_cancelled_reference`);

    await expect(page.getByRole("heading", { name: "Confirming your booking" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Secure checkout" })).toBeVisible();
    await expect(page.getByText("Payment wasn't completed.")).toBeVisible();
    await expect(page.getByText("Your booking has not been confirmed.")).toBeVisible();
    await expect(page.getByRole("button", { name: `Pay £5 with SumUp` })).toBeEnabled();
    expect(noSpaceDiagnostics.errors()).toEqual([]);
  });

  test("recovers abandoned hosted checkout with a fresh retry checkout and a single confirmed booking", async ({ page }) => {
    const seed = await createSeed(supabase, { label: "retry", booked: false });
    seeds.push(seed);
    const diagnostics = collectDiagnostics(page);
    const abandonedReference = `${seed.runId}_abandoned_reference`;
    const abandonedCheckoutId = `${seed.runId}_abandoned_checkout`;
    const retryCheckouts: Array<{ checkoutId: string; checkoutReference: string }> = [];
    let abandonedStatusRequests = 0;
    let bookingId: number | null = null;

    await page.route("**/api/sumup/status?**", async (route) => {
      const url = new URL(route.request().url());
      const reference = url.searchParams.get("checkout_reference") ?? "";

      if (reference === abandonedReference) {
        abandonedStatusRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            paymentStatus: abandonedStatusRequests === 1 ? "pending" : "expired",
            gameId: seed.gameId,
            bookingId: null,
            checkoutId: abandonedCheckoutId,
          }),
        });
        return;
      }

      const retryCheckout = retryCheckouts.find((checkout) => checkout.checkoutReference === reference);

      if (!retryCheckout) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "Unknown checkout reference." }),
        });
        return;
      }

      if (!bookingId) {
        const booking = await insertSingle<{ id: number }>(
          supabase
            .from("bookings")
            .insert({
              game_id: seed.gameId,
              user_id: seed.userId,
              player_name: seed.username,
            })
            .select("id")
            .single(),
          "insert retry payment return booking"
        );
        bookingId = booking.id;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          paymentStatus: "paid",
          gameId: seed.gameId,
          bookingId,
          checkoutId: retryCheckout.checkoutId,
        }),
      });
    });

    await page.route("**/api/sumup/create-checkout", async (route) => {
      const requestNumber = retryCheckouts.length + 1;
      const checkout = {
        checkoutId: `${seed.runId}_retry_checkout_${requestNumber}`,
        checkoutReference: `${seed.runId}_retry_reference_${requestNumber}`,
      };
      retryCheckouts.push(checkout);

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          checkout_id: checkout.checkoutId,
          checkout_reference: checkout.checkoutReference,
          hosted_checkout_url: `/sumup-e2e-hosted-checkout?checkout_reference=${checkout.checkoutReference}`,
          payment_status: "pending",
        }),
      });
    });
    await page.route("**/sumup-e2e-hosted-checkout?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Mock SumUp checkout</title><h1>Mock SumUp checkout</h1>",
      });
    });

    await signInWithEmail(page, seed.email, seed.password);
    await setPendingPaymentStorage(page, {
      checkoutReference: abandonedReference,
      checkoutId: abandonedCheckoutId,
      gameId: seed.gameId,
    });

    await page.goto(`/?sumup_checkout_reference=${abandonedReference}`);

    await expect(page.getByRole("heading", { name: "Confirming your booking" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Secure checkout" })).toBeVisible();
    await expect(page.getByText("Checking your payment...")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Payment wasn't completed.")).toBeVisible();
    await expect(page.getByText("Your booking has not been confirmed.")).toBeVisible();
    await expect(page.getByRole("button", { name: `Pay £5 with SumUp` })).toBeEnabled();

    await expect(page.getByRole("heading", { name: "Secure checkout" })).toBeVisible();
    await page.getByRole("button", { name: /Pay £5 with SumUp|Pay by Card/ }).click();
    await expect.poll(() => retryCheckouts.length).toBe(1);
    expect(retryCheckouts[0].checkoutReference).not.toBe(abandonedReference);
    expect(retryCheckouts[0].checkoutId).not.toBe(abandonedCheckoutId);
    await expect(page).toHaveURL(new RegExp(`/sumup-e2e-hosted-checkout\\?checkout_reference=${retryCheckouts[0].checkoutReference}$`));

    await page.goto(`/?sumup_checkout_reference=${retryCheckouts[0].checkoutReference}`);

    await expect(page.getByRole("heading", { name: "Confirming your booking" })).toHaveCount(0);
    await expect(page.getByText("Payment confirmed. Your booking has been added.").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Game Info" })).toBeVisible();
    await expect(page.getByText("Already Joined").first()).toBeVisible();
    await expect.poll(() => countBookings(supabase, seed)).toBe(1);
    await expect.poll(() => countPayments(supabase, seed)).toBe(0);
    expect(abandonedStatusRequests).toBeGreaterThanOrEqual(2);
    expect(diagnostics.errors()).toEqual([]);
  });
});

function collectDiagnostics(page: Page) {
  const messages: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (message) => {
    const text = message.text();

    if (text === "Failed to load resource: the server responded with a status of 403 ()") {
      return;
    }

    if (
      message.type() === "error" ||
      /hydration/i.test(text) ||
      /did not match/i.test(text)
    ) {
      messages.push(text);
    }
  });

  page.on("requestfailed", (request: Request) => {
    const failure = request.failure();
    if (failure?.errorText === "net::ERR_ABORTED") {
      return;
    }

    failedRequests.push(`${request.method()} ${request.url()} ${failure?.errorText ?? ""}`.trim());
  });

  return {
    errors: () => [...messages, ...failedRequests],
  };
}

type PaymentReturnFrame = {
  confirming: boolean;
  gamesList: boolean;
  modal: boolean;
  path: string;
};

async function signInForFreshContext(
  env: ReturnType<typeof requireDatabaseMutationE2EEnv>,
  email: string,
  password: string
) {
  const authClient = createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data, error } = await authClient.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    throw new Error(`sign in fresh payment return context: ${error?.message || "no session returned"}`);
  }

  return data.session;
}

async function installFreshPaymentReturnState(
  context: BrowserContext,
  params: {
    supabaseUrl: string;
    session: Awaited<ReturnType<typeof signInForFreshContext>>;
    checkoutReference: string;
    checkoutId: string;
    gameId: number;
    gameTitle: string;
  }
) {
  const supabaseRef = new URL(params.supabaseUrl).hostname.split(".")[0];
  const authStorageKey = `sb-${supabaseRef}-auth-token`;

  await context.addInitScript(
    ({ authStorageKey, session, checkoutReference, checkoutId, gameId, gameTitle }) => {
      localStorage.setItem(authStorageKey, JSON.stringify(session));
      localStorage.setItem("pendingSumUpGameId", String(gameId));
      localStorage.setItem("pendingSumUpCheckoutId", checkoutId);
      localStorage.setItem("pendingSumUpCheckoutReference", checkoutReference);

      const monitoredWindow = window as typeof window & {
        __paymentReturnFrames?: PaymentReturnFrame[];
      };
      monitoredWindow.__paymentReturnFrames = [];

      const isVisible = (element: Element | null) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const sample = () => {
        if (!document.body || document.body.children.length === 0) {
          window.requestAnimationFrame(sample);
          return;
        }

        const bodyText = document.body.innerText;
        const confirming =
          document.documentElement.getAttribute("data-payment-return-pending") === "true" ||
          bodyText.includes("Confirming your booking");
        const modal = Array.from(document.querySelectorAll("h2")).some((heading) =>
          ["Game Info", "Secure checkout"].includes(heading.textContent?.trim() ?? "") &&
          isVisible(heading)
        );
        const gamesHeader = bodyText.includes("Browse premium football matches in one clean list.");
        const gameCard = Array.from(document.querySelectorAll("#games .cursor-pointer")).some(
          (element) => element.textContent?.includes(gameTitle) && isVisible(element)
        );

        monitoredWindow.__paymentReturnFrames?.push({
          confirming,
          gamesList: gamesHeader || gameCard,
          modal,
          path: `${window.location.pathname}${window.location.search}`,
        });

        if (!modal || (monitoredWindow.__paymentReturnFrames?.length ?? 0) < 10) {
          window.requestAnimationFrame(sample);
        }
      };

      window.requestAnimationFrame(sample);
    },
    {
      authStorageKey,
      session: params.session,
      checkoutReference: params.checkoutReference,
      checkoutId: params.checkoutId,
      gameId: params.gameId,
      gameTitle: params.gameTitle,
    }
  );
}

async function getInstalledPaymentReturnFrames(page: Page) {
  return page.evaluate(() => {
    const monitoredWindow = window as typeof window & {
      __paymentReturnFrames?: PaymentReturnFrame[];
    };
    return monitoredWindow.__paymentReturnFrames ?? [];
  });
}

async function startPaymentReturnFrameMonitor(page: Page, gameTitle: string) {
  await page.evaluate((title) => {
    const monitoredWindow = window as typeof window & {
      __paymentReturnFrames?: PaymentReturnFrame[];
      __paymentReturnMonitorActive?: boolean;
    };
    monitoredWindow.__paymentReturnFrames = [];
    monitoredWindow.__paymentReturnMonitorActive = true;

    const isVisible = (element: Element | null) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const sample = () => {
      const bodyText = document.body.innerText;
      const confirming =
        document.documentElement.getAttribute("data-payment-return-pending") === "true" ||
        bodyText.includes("Confirming your booking");
      const modal = Array.from(document.querySelectorAll("h2")).some((heading) =>
        ["Game Info", "Secure checkout"].includes(heading.textContent?.trim() ?? "") &&
        isVisible(heading)
      );
      const gamesHeader = bodyText.includes("Browse premium football matches in one clean list.");
      const gameCard = Array.from(document.querySelectorAll("#games .cursor-pointer")).some(
        (element) => element.textContent?.includes(title) && isVisible(element)
      );

      monitoredWindow.__paymentReturnFrames?.push({
        confirming,
        gamesList: gamesHeader || gameCard,
        modal,
        path: `${window.location.pathname}${window.location.search}`,
      });

      if (monitoredWindow.__paymentReturnMonitorActive) {
        window.requestAnimationFrame(sample);
      }
    };

    window.requestAnimationFrame(sample);
  }, gameTitle);
}

async function stopPaymentReturnFrameMonitor(page: Page) {
  return page.evaluate(() => {
    const monitoredWindow = window as typeof window & {
      __paymentReturnFrames?: PaymentReturnFrame[];
      __paymentReturnMonitorActive?: boolean;
    };
    monitoredWindow.__paymentReturnMonitorActive = false;
    return monitoredWindow.__paymentReturnFrames ?? [];
  });
}

async function setPendingPaymentStorage(
  page: Page,
  params: { checkoutReference: string; checkoutId: string; gameId: number }
) {
  await page.evaluate(({ checkoutReference, checkoutId, gameId }) => {
    localStorage.setItem("pendingSumUpGameId", String(gameId));
    localStorage.setItem("pendingSumUpCheckoutId", checkoutId);
    localStorage.setItem("pendingSumUpCheckoutReference", checkoutReference);
  }, params);
}

async function createSeed(
  supabase: SupabaseClient,
  options: { label: string; booked: boolean }
): Promise<PaymentReturnSeed> {
  const runId = `e2e_payment_return_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const email = `${runId}_${options.label}@example.test`;
  const password = `Password-${runId}-${options.label}`;
  const username = `E2E Payment Return ${options.label}`;
  const gameTitle = `E2E Payment Return ${options.label} ${runId}`;
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
    throw new Error(`create payment return user: ${authError?.message || "no user returned"}`);
  }

  const userId = authData.user.id;

  await insertSingle(
    supabase
      .from("profiles")
      .upsert({
        id: userId,
        email,
        username,
        age: 25,
        gender: "Prefer not to say",
        favourite_position: "Midfielder",
      })
      .select("id")
      .single(),
    "upsert payment return profile"
  );

  const game = await insertSingle<{ id: number }>(
    supabase
      .from("games")
      .insert({
        title: gameTitle,
        location: `E2E Payment Pitch ${runId.slice(-6)}`,
        time: "15 Jan 2099, 20:00",
        starts_at: "2099-01-15T20:00:00.000Z",
        price: 5,
        max_players: 12,
        status: "active",
      })
      .select("id")
      .single(),
    "insert payment return game"
  );

  let bookingId: number | undefined;

  if (options.booked) {
    const booking = await insertSingle<{ id: number }>(
      supabase
        .from("bookings")
        .insert({
          game_id: game.id,
          user_id: userId,
          player_name: username,
        })
        .select("id")
        .single(),
      "insert payment return booking"
    );
    bookingId = booking.id;
  }

  return {
    runId,
    userId,
    email,
    password,
    username,
    gameId: game.id,
    gameTitle,
    bookingId,
  };
}

async function createPendingPayment(
  supabase: SupabaseClient,
  seed: PaymentReturnSeed,
  params: { checkoutReference: string; checkoutId: string }
) {
  await insertSingle(
    supabase
      .from("booking_payments")
      .insert({
        user_id: seed.userId,
        game_id: seed.gameId,
        booking_id: seed.bookingId ?? null,
        player_name: seed.username,
        checkout_id: params.checkoutId,
        checkout_reference: params.checkoutReference,
        hosted_checkout_url: "https://checkout.sumup.example/e2e",
        payment_status: "pending",
        amount: 5,
        currency: "GBP",
      })
      .select("id")
      .single(),
    "insert payment return pending payment"
  );
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

async function countBookings(supabase: SupabaseClient, seed: PaymentReturnSeed) {
  const { count, error } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("game_id", seed.gameId)
    .eq("user_id", seed.userId);

  if (error) {
    throw new Error(`count payment return bookings: ${error.message}`);
  }

  return count ?? 0;
}

async function countPayments(supabase: SupabaseClient, seed: PaymentReturnSeed) {
  const { count, error } = await supabase
    .from("booking_payments")
    .select("id", { count: "exact", head: true })
    .eq("game_id", seed.gameId)
    .eq("user_id", seed.userId);

  if (error) {
    throw new Error(`count payment return payments: ${error.message}`);
  }

  return count ?? 0;
}

async function cleanupSeed(supabase: SupabaseClient, seed: PaymentReturnSeed) {
  const failures: string[] = [];
  const runCleanup = async (
    label: string,
    cleanup: () => PromiseLike<{ error: { message: string } | null }>
  ) => {
    const { error } = await cleanup();

    if (error) {
      failures.push(`${label}: ${error.message}`);
    }
  };

  await runCleanup("delete payment return booking payments", () =>
    supabase.from("booking_payments").delete().eq("game_id", seed.gameId)
  );
  await runCleanup("delete payment return wallet transactions", () =>
    supabase.from("wallet_transactions").delete().eq("game_id", seed.gameId)
  );
  await runCleanup("delete payment return waiting list", () =>
    supabase.from("waiting_list").delete().eq("game_id", seed.gameId)
  );
  await runCleanup("delete payment return bookings", () =>
    supabase.from("bookings").delete().eq("game_id", seed.gameId)
  );
  await runCleanup("delete payment return game", () =>
    supabase.from("games").delete().eq("id", seed.gameId)
  );
  await runCleanup("delete payment return profile", () =>
    supabase.from("profiles").delete().eq("id", seed.userId)
  );

  const { error: deleteUserError } = await supabase.auth.admin.deleteUser(seed.userId);

  if (deleteUserError) {
    failures.push(`delete payment return auth user: ${deleteUserError.message}`);
  }

  if (failures.length > 0) {
    throw new Error(`Payment return E2E cleanup failed for ${seed.runId}. ${failures.join(" | ")}`);
  }
}
