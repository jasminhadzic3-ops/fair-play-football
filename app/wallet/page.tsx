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
  description: string | null;
  created_at: string | null;
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
  const [balance, setBalance] = useState(0);
  const [refundAmount, setRefundAmount] = useState("");
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefundSubmitting, setIsRefundSubmitting] = useState(false);
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
      setBalance(0);
      setRefundAmount("");
      setIsLoading(false);
      return;
    }

    setUserId(user?.id ?? null);

    if (!user) {
      setTransactions([]);
      setBalance(0);
      setRefundAmount("");
      setIsLoading(false);
      return;
    }

    const [{ data: balanceData, error: balanceError }, { data: transactionData, error: transactionError }] =
      await Promise.all([
        supabase.rpc("get_my_wallet_balance", { p_currency: "GBP" }),
        supabase
          .from("wallet_transactions")
          .select("id,amount,currency,transaction_type,status,description,created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

    if (balanceError || transactionError) {
      setErrorMessage(balanceError?.message || transactionError?.message || "Unable to load wallet.");
      setTransactions([]);
      setBalance(0);
      setRefundAmount("");
      setIsLoading(false);
      return;
    }

    const nextBalance = Number(balanceData ?? 0);

    setBalance(nextBalance);
    setRefundAmount(nextBalance > 0 ? nextBalance.toFixed(2) : "");
    setTransactions((transactionData ?? []) as WalletTransaction[]);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  const requestRefund = async () => {
    if (isRefundSubmitting) return;

    const amount = Number(refundAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      setRefundMessage("Enter a refund amount greater than zero.");
      return;
    }

    if (amount > balance) {
      setRefundMessage("Refund amount cannot be greater than your wallet balance.");
      return;
    }

    setIsRefundSubmitting(true);
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
        body: JSON.stringify({ amount }),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        setRefundMessage(result?.error || "Unable to request refund.");
        return;
      }

      setRefundMessage("Refund request sent. Your wallet balance is unchanged until an admin processes it.");
      await loadWallet();
    } catch (error) {
      setRefundMessage(error instanceof Error ? error.message : "Unable to request refund.");
    } finally {
      setIsRefundSubmitting(false);
    }
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
                {formatBalance(balance)}
              </p>
              <div className="mt-6 border-t border-zinc-800 pt-5">
                <p className="text-sm font-semibold text-zinc-300">
                  Request a manual refund to your card.
                </p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="flex-1">
                    <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                      Refund amount
                    </span>
                    <input
                      type="number"
                      min="0.01"
                      max={balance > 0 ? balance : undefined}
                      step="0.01"
                      inputMode="decimal"
                      value={refundAmount}
                      onChange={(event) => setRefundAmount(event.target.value)}
                      disabled={balance <= 0 || isRefundSubmitting}
                      className="mt-2 w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm font-semibold text-white outline-none transition focus:border-stone-200/40 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void requestRefund()}
                    disabled={balance <= 0 || isRefundSubmitting}
                    className="rounded-2xl border border-stone-300/20 bg-stone-200 px-5 py-3 text-sm font-bold text-zinc-950 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isRefundSubmitting ? "Requesting..." : "Request refund"}
                  </button>
                </div>
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
