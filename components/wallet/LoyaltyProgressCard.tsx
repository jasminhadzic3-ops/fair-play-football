"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type LoyaltyProgress = {
  current_progress: number;
  target: number;
  remaining: number;
  total_rewards_earned: number;
};

type LoyaltyProgressCardProps = {
  userId: string;
};

function parseProgress(data: unknown): LoyaltyProgress {
  const row = Array.isArray(data) ? data[0] : data;

  if (!row || typeof row !== "object") {
    throw new Error("Invalid Loyalty progress response.");
  }

  const values = row as Record<string, unknown>;
  const progress = {
    current_progress: Number(values.current_progress),
    target: Number(values.target),
    remaining: Number(values.remaining),
    total_rewards_earned: Number(values.total_rewards_earned),
  };

  if (
    !Number.isInteger(progress.current_progress) ||
    progress.current_progress < 0 ||
    progress.target !== 5 ||
    !Number.isInteger(progress.remaining) ||
    progress.remaining < 0 ||
    !Number.isInteger(progress.total_rewards_earned) ||
    progress.total_rewards_earned < 0
  ) {
    throw new Error("Invalid Loyalty progress response.");
  }

  return progress;
}

export default function LoyaltyProgressCard({ userId }: LoyaltyProgressCardProps) {
  const [progress, setProgress] = useState<LoyaltyProgress | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadProgress = async () => {
      setIsLoading(true);
      setHasError(false);

      const { data, error } = await supabase.rpc("get_my_loyalty_progress");

      if (!isMounted) return;

      if (error) {
        setProgress(null);
        setHasError(true);
        setIsLoading(false);
        return;
      }

      try {
        setProgress(parseProgress(data));
        setHasError(false);
      } catch {
        setProgress(null);
        setHasError(true);
      } finally {
        setIsLoading(false);
      }
    };

    void loadProgress();

    return () => {
      isMounted = false;
    };
  }, [userId]);

  return (
    <section className="rounded-[2rem] border border-zinc-800 bg-zinc-900 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-zinc-500">
            Fair Play Rewards
          </p>
          <h2 className="mt-2 text-xl font-black tracking-tight text-white">Earn £5 wallet credit</h2>
        </div>
        <span className="shrink-0 rounded-full border border-stone-300/20 bg-stone-200/10 px-3 py-1 text-[0.65rem] font-bold uppercase tracking-[0.18em] text-stone-200">
          £5 credit
        </span>
      </div>

      {isLoading ? (
        <div className="mt-6 space-y-4" aria-label="Loading Fair Play Rewards progress">
          <div className="h-8 w-48 animate-pulse rounded-full bg-zinc-800" />
          <div className="h-3 w-full animate-pulse rounded-full bg-zinc-800" />
          <div className="h-4 w-64 animate-pulse rounded-full bg-zinc-800" />
        </div>
      ) : hasError || !progress ? (
        <p className="mt-6 text-sm font-semibold leading-6 text-zinc-400">
          Rewards progress is currently unavailable. Please try again later.
        </p>
      ) : (
        <>
          {progress.current_progress >= progress.target ? (
            <>
              <p className="mt-6 text-2xl font-black tracking-tight text-stone-100">Reward processing</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-zinc-300">
                Your £5 Fair Play credit is being processed.
              </p>
            </>
          ) : progress.current_progress === 0 ? (
            <>
              <p className="mt-6 text-2xl font-black tracking-tight text-stone-100">
                {progress.total_rewards_earned > 0 ? "Your next reward starts now" : "Your first reward starts here"}
              </p>
              <p className="mt-2 text-sm font-semibold leading-6 text-zinc-300">
                Complete 5 qualifying games to unlock £5 credit.
              </p>
            </>
          ) : (
            <>
              <p className="mt-6 text-2xl font-black tracking-tight text-stone-100">
                {progress.current_progress} of {progress.target} games completed
              </p>
              <p className="mt-2 text-sm font-semibold leading-6 text-zinc-300">
                {progress.remaining === 1
                  ? "One more qualifying game unlocks £5 credit."
                  : `${progress.remaining} more qualifying games to unlock £5 credit.`}
              </p>
            </>
          )}

          <div className="mt-6 flex items-center gap-2" aria-label={`${Math.min(progress.current_progress, progress.target)} of ${progress.target} games completed`}>
            {Array.from({ length: 5 }, (_, index) => (
              <span
                key={index}
                aria-hidden="true"
                className={`h-2.5 flex-1 rounded-full border ${
                  index < Math.min(progress.current_progress, progress.target)
                    ? "border-stone-200 bg-stone-200"
                    : "border-zinc-700 bg-zinc-800"
                }`}
              />
            ))}
          </div>

          <Link
            href="/rewards"
            className="mt-6 inline-flex min-h-11 items-center text-sm font-bold text-stone-200 underline decoration-stone-300/30 underline-offset-4 transition hover:text-white"
          >
            How Fair Play Rewards work <span className="ml-2" aria-hidden="true">→</span>
          </Link>
        </>
      )}
    </section>
  );
}
