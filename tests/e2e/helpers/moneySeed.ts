import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  requireDatabaseMutationE2EEnv,
  type E2ESupabaseMutationEnv,
} from "./supabaseEnv";

type SeededPlayer = {
  id: string;
  email: string;
  password: string;
  username: string;
};

type SeededPayment = {
  id: number;
  bookingId: number;
  gameId: number;
  checkoutReference: string;
};

type SeededWalletCredit = {
  id: number;
  amount: number;
};

type BalanceBreakdown = {
  completed_balance: number | string | null;
  reserved_refund_amount: number | string | null;
  available_balance: number | string | null;
};

export type MoneyFlowSeed = {
  runId: string;
  player: SeededPlayer;
  sourceCredit: SeededWalletCredit;
  payment: SeededPayment;
};

export type MoneyFlowSeedOptions = {
  creditAmount?: number;
  seedPendingRefundRequest?: boolean;
};

export function createE2ESupabaseClient(
  env: E2ESupabaseMutationEnv = requireDatabaseMutationE2EEnv()
) {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function uniqueRunId() {
  return `e2e_wallet_refund_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanupPartialSeed(
  supabase: SupabaseClient,
  params: {
    runId: string;
    userId?: string;
    gameId?: number;
    bookingId?: number;
    paymentId?: number;
    sourceCreditId?: number;
  }
) {
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

  if (params.sourceCreditId) {
    await runCleanup("delete partial refund requests for source credit", () => {
      let query = supabase
        .from("wallet_transactions")
        .delete()
        .eq("transaction_type", "refund_requested")
        .filter("metadata->>source_wallet_transaction_id", "eq", String(params.sourceCreditId));

      if (params.userId) {
        query = query.eq("user_id", params.userId);
      }

      return query;
    });
    await runCleanup("delete partial source wallet credit", () =>
      supabase.from("wallet_transactions").delete().eq("id", params.sourceCreditId)
    );
  }

  await runCleanup("delete partial tagged wallet transactions", () =>
    supabase
      .from("wallet_transactions")
      .delete()
      .filter("metadata->>e2e_run_id", "eq", params.runId)
  );
  await runCleanup("delete partial idempotent wallet transactions", () =>
    supabase
      .from("wallet_transactions")
      .delete()
      .like("idempotency_key", `e2e:${params.runId}:%`)
  );

  if (params.paymentId) {
    await runCleanup("delete partial booking payment", () =>
      supabase.from("booking_payments").delete().eq("id", params.paymentId)
    );
  } else {
    await runCleanup("delete partial booking payment by checkout reference", () =>
      supabase.from("booking_payments").delete().eq("checkout_reference", `${params.runId}_reference`)
    );
  }

  if (params.bookingId) {
    await runCleanup("delete partial booking", () =>
      supabase.from("bookings").delete().eq("id", params.bookingId)
    );
  }

  if (params.userId) {
    await runCleanup("delete partial profile", () =>
      supabase.from("profiles").delete().eq("id", params.userId)
    );

    const { error: deleteUserError } = await supabase.auth.admin.deleteUser(params.userId);

    if (deleteUserError) {
      failures.push(`delete partial auth user: ${deleteUserError.message}`);
    }
  }

  if (params.gameId) {
    await runCleanup("delete partial game", () =>
      supabase.from("games").delete().eq("id", params.gameId)
    );
  }

  if (failures.length > 0) {
    throw new Error(
      `Partial E2E cleanup failed for run ${params.runId}. ${failures.join(" | ")}`
    );
  }
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

export async function seedWalletRefundFlow(
  supabase: SupabaseClient,
  options: MoneyFlowSeedOptions = {}
): Promise<MoneyFlowSeed> {
  const runId = uniqueRunId();
  const creditAmount = options.creditAmount ?? 20;
  let createdUserId: string | undefined;
  let createdGameId: number | undefined;
  let createdBookingId: number | undefined;
  let createdPaymentId: number | undefined;
  let createdSourceCreditId: number | undefined;
  const player = {
    email: `${runId}@example.test`,
    password: `Password-${runId}`,
    username: `E2E Wallet ${runId.slice(-6)}`,
  };

  try {
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: player.email,
      password: player.password,
      email_confirm: true,
      user_metadata: {
        username: player.username,
        e2e_run_id: runId,
      },
    });

    if (authError || !authData.user) {
      throw new Error(`create test user: ${authError?.message || "no user returned"}`);
    }

    createdUserId = authData.user.id;

    const seededPlayer = {
      ...player,
      id: authData.user.id,
    };

    await insertSingle(
      supabase
        .from("profiles")
        .upsert({
          id: seededPlayer.id,
          email: seededPlayer.email,
          username: seededPlayer.username,
          age: 25,
          gender: "Prefer not to say",
          favourite_position: "Midfielder",
        })
        .select("id")
        .single(),
      "upsert test profile"
    );

    const game = await insertSingle<{ id: number }>(
      supabase
        .from("games")
        .insert({
          title: `E2E Wallet Refund ${runId}`,
          location: "E2E Test Pitch",
          time: "2099-01-01 20:00",
          price: creditAmount,
          max_players: 12,
          status: "cancelled",
          cancellation_reason: "E2E seeded cancellation",
        })
        .select("id")
        .single(),
      "insert test game"
    );

    createdGameId = game.id;

    const booking = await insertSingle<{ id: number }>(
      supabase
        .from("bookings")
        .insert({
          game_id: game.id,
          user_id: seededPlayer.id,
          player_name: seededPlayer.username,
        })
        .select("id")
        .single(),
      "insert test booking"
    );

    createdBookingId = booking.id;

    const payment = await insertSingle<{ id: number }>(
      supabase
        .from("booking_payments")
        .insert({
          user_id: seededPlayer.id,
          game_id: game.id,
          player_name: seededPlayer.username,
          checkout_id: `${runId}_checkout`,
          checkout_reference: `${runId}_reference`,
          payment_status: "paid",
          booking_id: booking.id,
          hosted_checkout_url: "https://example.test/e2e-checkout",
          amount: creditAmount,
          currency: "GBP",
          transaction_code: `${runId}_txn_code`,
          sumup_transaction_id: `${runId}_txn_id`,
          raw_checkout: {
            e2e_run_id: runId,
          },
        })
        .select("id")
        .single(),
      "insert test booking payment"
    );

    createdPaymentId = payment.id;

    const sourceCredit = await insertSingle<{ id: number; amount: number | string }>(
      supabase
        .from("wallet_transactions")
        .insert({
          user_id: seededPlayer.id,
          amount: creditAmount,
          idempotency_key: `e2e:${runId}:source_credit`,
          currency: "GBP",
          transaction_type: "game_cancelled_credit",
          status: "completed",
          game_id: game.id,
          booking_id: booking.id,
          payment_id: payment.id,
          description: `E2E cancelled-game credit ${runId}`,
          metadata: {
            e2e_run_id: runId,
            original_payment_method: "sumup",
            original_payment_id: payment.id,
            original_game_id: game.id,
            original_booking_id: booking.id,
          },
        })
        .select("id,amount")
        .single(),
      "insert test source wallet credit"
    );

    createdSourceCreditId = sourceCredit.id;

    if (options.seedPendingRefundRequest) {
      await insertSingle(
        supabase
          .from("wallet_transactions")
          .insert({
            user_id: seededPlayer.id,
            amount: -creditAmount,
            idempotency_key: `e2e:${runId}:refund_request`,
            currency: "GBP",
            transaction_type: "refund_requested",
            status: "pending",
            game_id: game.id,
            booking_id: booking.id,
            payment_id: payment.id,
            description: `E2E refund requested ${runId}`,
            metadata: {
              e2e_run_id: runId,
              source_wallet_transaction_id: sourceCredit.id,
              source_transaction_type: "game_cancelled_credit",
              original_payment_method: "sumup",
              original_payment_id: payment.id,
              original_game_id: game.id,
              original_booking_id: booking.id,
              refund_mode: "source_credit",
              automatic_refund_eligible: true,
            },
          })
          .select("id")
          .single(),
        "insert test pending refund request"
      );
    }

    return {
      runId,
      player: seededPlayer,
      sourceCredit: {
        id: sourceCredit.id,
        amount: Number(sourceCredit.amount),
      },
      payment: {
        id: payment.id,
        bookingId: booking.id,
        gameId: game.id,
        checkoutReference: `${runId}_reference`,
      },
    };
  } catch (error) {
    try {
      await cleanupPartialSeed(supabase, {
        runId,
        userId: createdUserId,
        gameId: createdGameId,
        bookingId: createdBookingId,
        paymentId: createdPaymentId,
        sourceCreditId: createdSourceCreditId,
      });
    } catch (cleanupError) {
      throw new Error(
        `${error instanceof Error ? error.message : "Unable to seed wallet refund flow."} ${
          cleanupError instanceof Error ? cleanupError.message : cleanupError
        }`
      );
    }

    throw error;
  }
}

export async function getWalletBalanceBreakdown(
  supabase: SupabaseClient,
  userId: string
) {
  const { data, error } = await supabase.rpc("get_wallet_balance_breakdown", {
    p_user_id: userId,
    p_currency: "GBP",
  });

  if (error) {
    throw new Error(`load wallet balance breakdown: ${error.message}`);
  }

  const result = (Array.isArray(data) ? data[0] : data) as BalanceBreakdown | null;

  if (!result) {
    throw new Error("load wallet balance breakdown: no result returned.");
  }

  return {
    completedBalance: Number(result.completed_balance ?? 0),
    reservedRefundAmount: Number(result.reserved_refund_amount ?? 0),
    availableBalance: Number(result.available_balance ?? 0),
  };
}

export async function getRefundRequestsForSourceCredit(
  supabase: SupabaseClient,
  userId: string,
  sourceWalletTransactionId: number
) {
  const { data, error } = await supabase
    .from("wallet_transactions")
    .select("id,amount,status,metadata")
    .eq("user_id", userId)
    .eq("transaction_type", "refund_requested");

  if (error) {
    throw new Error(`load refund requests: ${error.message}`);
  }

  return (data ?? []).filter((transaction) => {
    const metadata = transaction.metadata as Record<string, unknown> | null;
    return String(metadata?.source_wallet_transaction_id) === String(sourceWalletTransactionId);
  });
}

export async function cleanupMoneyFlowSeed(
  supabase: SupabaseClient,
  seed: MoneyFlowSeed
) {
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

  await runCleanup("delete test refund requests for source credit", () =>
    supabase
      .from("wallet_transactions")
      .delete()
      .eq("user_id", seed.player.id)
      .eq("transaction_type", "refund_requested")
      .filter("metadata->>source_wallet_transaction_id", "eq", String(seed.sourceCredit.id))
  );
  await runCleanup("delete test tagged wallet transactions", () =>
    supabase
      .from("wallet_transactions")
      .delete()
      .filter("metadata->>e2e_run_id", "eq", seed.runId)
  );
  await runCleanup("delete test idempotent wallet transactions", () =>
    supabase
      .from("wallet_transactions")
      .delete()
      .like("idempotency_key", `e2e:${seed.runId}:%`)
  );
  await runCleanup("delete test source wallet credit", () =>
    supabase.from("wallet_transactions").delete().eq("id", seed.sourceCredit.id)
  );
  await runCleanup("delete test booking payments", () =>
    supabase
      .from("booking_payments")
      .delete()
      .eq("id", seed.payment.id)
      .eq("checkout_reference", seed.payment.checkoutReference)
  );
  await runCleanup("delete test bookings", () =>
    supabase.from("bookings").delete().eq("id", seed.payment.bookingId)
  );
  await runCleanup("delete test profile", () =>
    supabase.from("profiles").delete().eq("id", seed.player.id)
  );
  await runCleanup("delete test game", () =>
    supabase.from("games").delete().eq("id", seed.payment.gameId)
  );

  const { error: deleteUserError } = await supabase.auth.admin.deleteUser(seed.player.id);

  if (deleteUserError) {
    failures.push(`delete test auth user: ${deleteUserError.message}`);
  }

  if (failures.length > 0) {
    throw new Error(
      `E2E cleanup failed for run ${seed.runId}. ${failures.join(" | ")}`
    );
  }
}
