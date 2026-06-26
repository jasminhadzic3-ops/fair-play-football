import "server-only";

import { assertSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabaseAdmin";

export type WalletTransactionType =
  | "game_cancelled_credit"
  | "wallet_booking_payment"
  | "refund_requested"
  | "refund_completed"
  | "manual_adjustment"
  | "admin_credit"
  | "promotion_bonus";

export type WalletTransactionStatus = "pending" | "completed" | "failed" | "cancelled";

export type WalletTransaction = {
  id: number;
  user_id: string;
  amount: number;
  idempotency_key: string | null;
  currency: string;
  transaction_type: WalletTransactionType;
  status: WalletTransactionStatus;
  game_id: number | null;
  booking_id: number | null;
  payment_id: number | null;
  description: string | null;
  admin_note: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type WalletTransactionInput = {
  userId: string;
  amount: number;
  transactionType: WalletTransactionType;
  status: WalletTransactionStatus;
  idempotencyKey?: string | null;
  currency?: string;
  gameId?: number | null;
  bookingId?: number | null;
  paymentId?: number | null;
  description?: string | null;
  adminNote?: string | null;
  metadata?: Record<string, unknown>;
};

type GetWalletBalanceParams = {
  userId: string;
  currency?: string;
};

type GetWalletTransactionsParams = {
  userId: string;
  currency?: string;
  limit?: number;
};

type WalletCreditInput = Omit<WalletTransactionInput, "status"> & {
  status?: WalletTransactionStatus;
};

type WalletDebitInput = Omit<WalletTransactionInput, "status"> & {
  status?: WalletTransactionStatus;
};

type WalletDebitRpcResult = {
  success: boolean;
  transaction_id: number | null;
  reason: string | null;
  balance: number | null;
};

type BookGameWithWalletParams = {
  userId: string;
  gameId: number;
  playerName: string;
  amount: number;
  currency?: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

type BookGameWithWalletRpcResult = {
  success: boolean;
  booking_id: number | null;
  wallet_transaction_id: number | null;
  reason: string | null;
  balance: number | null;
};

export type BookGameWithWalletResult = {
  success: boolean;
  bookingId: number | null;
  walletTransactionId: number | null;
  reason: string | null;
  balance: number | null;
};

function normalizeCurrency(currency?: string) {
  return currency?.trim() || "GBP";
}

function assertUserId(userId: string) {
  if (!userId) {
    throw new Error("Wallet userId is required.");
  }
}

function assertValidAmount(amount: number) {
  if (!Number.isFinite(amount) || amount === 0) {
    throw new Error("Wallet transaction amount must be a non-zero number.");
  }
}

function assertPositiveAmount(amount: number, action: "credit" | "debit") {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Wallet ${action} amount must be greater than zero.`);
  }
}

function normalizeIdempotencyKey(idempotencyKey?: string | null) {
  return idempotencyKey?.trim() || null;
}

export async function getWalletBalance({ userId, currency }: GetWalletBalanceParams) {
  assertSupabaseAdminConfigured();
  assertUserId(userId);

  const { data, error } = await supabaseAdmin.rpc("get_wallet_balance", {
    p_user_id: userId,
    p_currency: normalizeCurrency(currency),
  });

  if (error) {
    throw error;
  }

  return Number(data ?? 0);
}

export async function getWalletTransactions({
  userId,
  currency,
  limit = 50,
}: GetWalletTransactionsParams): Promise<WalletTransaction[]> {
  assertSupabaseAdminConfigured();
  assertUserId(userId);

  let query = supabaseAdmin
    .from("wallet_transactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 100)));

  if (currency) {
    query = query.eq("currency", normalizeCurrency(currency));
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []) as WalletTransaction[];
}

export async function createWalletTransaction(params: WalletTransactionInput): Promise<WalletTransaction> {
  assertSupabaseAdminConfigured();
  assertUserId(params.userId);
  assertValidAmount(params.amount);

  const { data, error } = await supabaseAdmin
    .from("wallet_transactions")
    .insert({
      user_id: params.userId,
      amount: params.amount,
      idempotency_key: normalizeIdempotencyKey(params.idempotencyKey),
      currency: normalizeCurrency(params.currency),
      transaction_type: params.transactionType,
      status: params.status,
      game_id: params.gameId ?? null,
      booking_id: params.bookingId ?? null,
      payment_id: params.paymentId ?? null,
      description: params.description ?? null,
      admin_note: params.adminNote ?? null,
      metadata: params.metadata ?? {},
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as WalletTransaction;
}

async function getWalletTransactionById(transactionId: number): Promise<WalletTransaction> {
  const { data, error } = await supabaseAdmin
    .from("wallet_transactions")
    .select("*")
    .eq("id", transactionId)
    .single();

  if (error) {
    throw error;
  }

  return data as WalletTransaction;
}

export async function creditWallet(params: WalletCreditInput): Promise<WalletTransaction> {
  assertPositiveAmount(params.amount, "credit");

  return createWalletTransaction({
    ...params,
    status: params.status ?? "completed",
  });
}

export async function debitWallet(params: WalletDebitInput): Promise<WalletTransaction> {
  assertPositiveAmount(params.amount, "debit");

  const status = params.status ?? "completed";
  const currency = normalizeCurrency(params.currency);

  if (status === "completed") {
    assertSupabaseAdminConfigured();
    assertUserId(params.userId);

    const idempotencyKey = normalizeIdempotencyKey(params.idempotencyKey);

    if (!idempotencyKey) {
      throw new Error("Wallet completed debit requires an idempotency key.");
    }

    const { data, error } = await supabaseAdmin.rpc("create_wallet_debit_if_balance", {
      p_user_id: params.userId,
      p_amount: params.amount,
      p_currency: currency,
      p_transaction_type: params.transactionType,
      p_idempotency_key: idempotencyKey,
      p_game_id: params.gameId ?? null,
      p_booking_id: params.bookingId ?? null,
      p_payment_id: params.paymentId ?? null,
      p_description: params.description ?? null,
      p_admin_note: params.adminNote ?? null,
      p_metadata: params.metadata ?? {},
    });

    if (error) {
      throw error;
    }

    const result = (Array.isArray(data) ? data[0] : data) as WalletDebitRpcResult | null;

    if (!result) {
      throw new Error("Wallet debit did not return a result.");
    }

    if (!result.success) {
      if (result.reason === "insufficient_balance") {
        throw new Error("Insufficient wallet balance for this debit.");
      }

      throw new Error(`Unable to complete wallet debit: ${result.reason || "unknown_reason"}.`);
    }

    if (!result.transaction_id) {
      throw new Error("Wallet debit did not return a transaction id.");
    }

    return getWalletTransactionById(result.transaction_id);
  }

  return createWalletTransaction({
    ...params,
    amount: -params.amount,
    currency,
    status,
  });
}

export async function bookGameWithWallet({
  userId,
  gameId,
  playerName,
  amount,
  currency,
  idempotencyKey,
  metadata,
}: BookGameWithWalletParams): Promise<BookGameWithWalletResult> {
  assertSupabaseAdminConfigured();
  assertUserId(userId);
  assertPositiveAmount(amount, "debit");

  const normalizedPlayerName = playerName.trim();
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);

  if (!gameId) {
    throw new Error("Wallet booking gameId is required.");
  }

  if (!normalizedPlayerName) {
    throw new Error("Wallet booking playerName is required.");
  }

  if (!normalizedIdempotencyKey) {
    throw new Error("Wallet booking requires an idempotency key.");
  }

  const { data, error } = await supabaseAdmin.rpc("create_wallet_booking_if_balance", {
    p_user_id: userId,
    p_game_id: gameId,
    p_player_name: normalizedPlayerName,
    p_amount: amount,
    p_currency: normalizeCurrency(currency),
    p_idempotency_key: normalizedIdempotencyKey,
    p_metadata: metadata ?? {},
  });

  if (error) {
    throw error;
  }

  const result = (Array.isArray(data) ? data[0] : data) as BookGameWithWalletRpcResult | null;

  if (!result) {
    throw new Error("Wallet booking did not return a result.");
  }

  return {
    success: result.success,
    bookingId: result.booking_id,
    walletTransactionId: result.wallet_transaction_id,
    reason: result.reason,
    balance: result.balance === null ? null : Number(result.balance),
  };
}
