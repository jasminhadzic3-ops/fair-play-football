"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type WalletTransaction = {
  id: number;
  amount: number;
  currency: string | null;
  transaction_type: string | null;
  status: string | null;
  game_id: number | null;
  booking_id: number | null;
  payment_id: number | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
};

type WalletBalanceBreakdown = {
  completed_balance?: number | string | null;
  reserved_refund_amount?: number | string | null;
  available_balance?: number | string | null;
};

function formatMoney(amount: number, currency = "GBP") {
  const absoluteAmount = Math.abs(amount);

  try {
    const formattedAmount = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
    }).format(absoluteAmount);

    return `${amount < 0 ? "-" : "+"}${formattedAmount}`;
  } catch {
    return `${amount < 0 ? "-" : "+"}${currency} ${absoluteAmount.toFixed(2)}`;
  }
}

function formatBalance(amount: number, currency = "GBP") {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatDate(dateValue: string | null) {
  if (!dateValue) {
    return "";
  }

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTransactionType(transactionType: string | null) {
  if (!transactionType) {
    return "Wallet activity";
  }

  return transactionType
    .split("_")
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

export default function WalletPage() {
  const [availableBalance, setAvailableBalance] = useState(0);
  const [completedBalance, setCompletedBalance] = useState(0);
  const [reservedRefundAmount, setReservedRefundAmount] = useState(0);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [submittingRefundSourceId, setSubmittingRefundSourceId] = useState<number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refundMessage, setRefundMessage] = useState<string | null>(null);

  const loadWallet = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      setErrorMessage(userError.message);
      setUserId(null);
      setTransactions([]);
      setAvailableBalance(0);
      setCompletedBalance(0);
      setReservedRefundAmount(0);
      setIsLoading(false);
      return;
    }

    setUserId(user?.id ?? null);

    if (!user) {
      setTransactions([]);
      setAvailableBalance(0);
      setCompletedBalance(0);
      setReservedRefundAmount(0);
      setIsLoading(false);
      return;
    }

    const [{ data: balanceData, error: balanceError }, { data: transactionData, error: transactionError }] =
      await Promise.all([
        supabase.rpc("get_my_wallet_balance_breakdown", { p_currency: "GBP" }),
        supabase
          .from("wallet_transactions")
          .select("id,amount,currency,transaction_type,status,game_id,booking_id,payment_id,description,metadata,created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

    if (balanceError || transactionError) {
      setErrorMessage(balanceError?.message || transactionError?.message || "Unable to load wallet.");
      setTransactions([]);
      setAvailableBalance(0);
      setCompletedBalance(0);
      setReservedRefundAmount(0);
      setIsLoading(false);
      return;
    }

    const balanceBreakdown = (Array.isArray(balanceData) ? balanceData[0] : balanceData) as
      | WalletBalanceBreakdown
      | null
      | undefined;

    setAvailableBalance(Number(balanceBreakdown?.available_balance ?? 0));
    setCompletedBalance(Number(balanceBreakdown?.completed_balance ?? 0));
    setReservedRefundAmount(Number(balanceBreakdown?.reserved_refund_amount ?? 0));
    setTransactions((transactionData ?? []) as WalletTransaction[]);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  const hasRefundRequestForSourceCredit = (sourceWalletTransactionId: number) =>
    transactions.some(
      (transaction) =>
        transaction.transaction_type === "refund_requested" &&
        (transaction.status === "pending" ||
          transaction.status === "processing" ||
          transaction.status === "completed") &&
        String(transaction.metadata?.source_wallet_transaction_id) === String(sourceWalletTransactionId)
    );

  const isRefundableSourceCredit = (transaction: WalletTransaction) =>
    transaction.transaction_type === "game_cancelled_credit" &&
    transaction.status === "completed" &&
    Number(transaction.amount) > 0 &&
    Boolean(transaction.payment_id) &&
    transaction.metadata?.original_payment_method === "sumup" &&
    !hasRefundRequestForSourceCredit(transaction.id);

  const getRefundRequestStatusForSourceCredit = (sourceWalletTransactionId: number) => {
    const refundRequest = transactions.find(
      (transaction) =>
        transaction.transaction_type === "refund_requested" &&
        String(transaction.metadata?.source_wallet_transaction_id) === String(sourceWalletTransactionId)
    );

    return refundRequest?.status ?? null;
  };

  const requestRefund = async (sourceWalletTransactionId: number) => {
    if (submittingRefundSourceId) return;

    const sourceCredit = transactions.find((transaction) => transaction.id === sourceWalletTransactionId);

    if (!sourceCredit || !isRefundableSourceCredit(sourceCredit)) {
      setRefundMessage("This wallet credit is not available for refund request.");
      return;
    }

    if (Number(sourceCredit.amount) > availableBalance) {
      setRefundMessage("Refund amount cannot be greater than your wallet balance.");
      return;
    }

    setSubmittingRefundSourceId(sourceWalletTransactionId);
    setRefundMessage(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setRefundMessage("Please sign in to request a refund.");
        return;
      }

      const response = await fetch("/api/wallet/refund-requests", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source_wallet_transaction_id: sourceWalletTransactionId }),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        setRefundMessage(result?.error || "Unable to request refund.");
        return;
      }

      setRefundMessage("Refund request sent. This amount is now reserved until an admin processes it.");
      await loadWallet();
    } catch (error) {
      setRefundMessage(error instanceof Error ? error.message : "Unable to request refund.");
    } finally {
      setSubmittingRefundSourceId(null);
    }
  };

  const renderRefundAction = (transaction: WalletTransaction) => {
    const refundRequestStatus = getRefundRequestStatusForSourceCredit(transaction.id);

    if (refundRequestStatus === "pending" || refundRequestStatus === "processing") {
      return (
        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-amber-100">
          Refund requested
        </span>
      );
    }

    if (refundRequestStatus === "completed") {
      return (
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">
          Refund completed
        </span>
      );
    }

    if (!isRefundableSourceCredit(transaction)) {
      return null;
    }

    return (
      <button
        type="button"
        onClick={() => void requestRefund(transaction.id)}
        disabled={submittingRefundSourceId === transaction.id}
        className="rounded-full border border-stone-300/20 bg-stone-200 px-4 py-2 text-xs font-bold text-zinc-950 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submittingRefundSourceId === transaction.id ? "Requesting..." : "Request refund"}
      </button>
    );
  };

  return (
    <main className="min-h-screen bg-black p-4 text-white sm:p-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-10 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="mb-3 text-xs uppercase tracking-[0.35em] text-zinc-500">
              Account
            </p>
            <h1 className="text-4xl font-bold md:text-5xl">Wallet</h1>
          </div>
          <Link
            href="/"
            className="rounded-3xl border border-stone-300/20 bg-zinc-950 px-6 py-3 text-sm font-bold text-stone-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:border-stone-200/35 hover:bg-zinc-900 md:text-base"
          >
            Back to Home
          </Link>
        </div>

        {isLoading ? (
          <div className="rounded-[2rem] border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
            Loading wallet...
          </div>
        ) : null}

        {!isLoading && !userId ? (
          <div className="rounded-[2rem] border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
            Sign in to view your wallet.
          </div>
        ) : null}

        {!isLoading && userId && errorMessage ? (
          <div className="rounded-[2rem] border border-rose-500/40 bg-rose-500/10 p-6 text-sm font-semibold text-rose-100">
            {errorMessage}
          </div>
        ) : null}

        {!isLoading && userId && !errorMessage ? (
          <div className="space-y-6">
            <section className="rounded-[2rem] border border-zinc-800 bg-zinc-950 p-6 shadow-[0_18px_60px_rgba(0,0,0,0.35)] sm:p-8">
              <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                Available balance
              </p>
              <p className="mt-4 text-5xl font-black tracking-tight text-stone-100 sm:text-6xl">
                {formatBalance(availableBalance)}
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-3xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                    Total wallet balance
                  </p>
                  <p className="mt-2 text-lg font-black text-stone-100">
                    {formatBalance(completedBalance)}
                  </p>
                </div>
                <div className="rounded-3xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                    Reserved for refunds
                  </p>
                  <p className="mt-2 text-lg font-black text-stone-100">
                    {formatBalance(reservedRefundAmount)}
                  </p>
                </div>
              </div>
              <div className="mt-6 border-t border-zinc-800 pt-5">
                <p className="text-sm font-semibold text-zinc-300">
                  Eligible cancelled-game credits can be requested back to your card.
                </p>
                {refundMessage ? (
                  <p className="mt-3 text-sm font-semibold text-zinc-300">{refundMessage}</p>
                ) : null}
              </div>
            </section>

            <section className="rounded-[2rem] border border-zinc-800 bg-zinc-900 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] sm:p-6">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                    Recent activity
                  </p>
                </div>
              </div>

              {transactions.length === 0 ? (
                <div className="rounded-3xl border border-zinc-800 bg-zinc-950 px-5 py-6 text-zinc-400">
                  <p className="font-semibold text-zinc-200">No wallet activity yet.</p>
                  <p className="mt-2 text-sm leading-6">
                    If one of your games is cancelled, your credit will appear here automatically.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-zinc-800 overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950">
                  {transactions.map((transaction) => {
                    const amount = Number(transaction.amount ?? 0);
                    const description =
                      transaction.description?.trim() || formatTransactionType(transaction.transaction_type);
                    const formattedDate = formatDate(transaction.created_at);

                    return (
                      <div
                        key={transaction.id}
                        className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="break-words text-sm font-bold text-white">{description}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                            {formattedDate ? <span>{formattedDate}</span> : null}
                            {transaction.status ? <span>{transaction.status}</span> : null}
                          </div>
                        </div>
                        <p
                          className={`text-lg font-black ${
                            amount >= 0 ? "text-stone-200" : "text-zinc-300"
                          }`}
                        >
                          {formatMoney(amount, transaction.currency || "GBP")}
                        </p>
                        {renderRefundAction(transaction)}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
