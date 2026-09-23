"use client";

import { useEffect, useState } from "react";
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
    <section className="rounded-[2rem] border border-amber-200/30 bg-[#11100d] p-5 shadow-[0_18px_60px_rgba(120,88,30,0.18)] sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-amber-200/80">
            Loyalty promotion
          </p>
          <h2 className="mt-2 text-xl font-black tracking-tight text-white">Play 5 games. Get your 6th free.</h2>
        </div>
        <span className="shrink-0 rounded-full border border-amber-200/35 bg-amber-200/10 px-3 py-1 text-[0.65rem] font-bold uppercase tracking-[0.18em] text-amber-100">
          6TH GAME FREE
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
          <p className="mt-6 text-2xl font-black tracking-tight text-white">
            Complete five qualifying Fair Play games and receive £5 wallet credit towards your sixth game.
          </p>
          <p className="mt-3 text-sm font-semibold leading-6 text-zinc-300">
            The reward repeats automatically, each time you complete another five qualifying games, you’ll receive another £5 credit towards your next game.
          </p>
          <p className="mt-6 text-2xl font-black tracking-tight text-white">
            {progress.current_progress} of {progress.target} games completed
          </p>

          <div className="mt-6 flex items-center gap-2" aria-label={`${Math.min(progress.current_progress, progress.target)} of ${progress.target} games completed`}>
            {Array.from({ length: 5 }, (_, index) => (
              <span
                key={index}
                aria-hidden="true"
                className={`h-2.5 flex-1 rounded-full border ${
                  index < Math.min(progress.current_progress, progress.target)
                    ? "border-amber-200 bg-amber-200"
                    : "border-amber-200/25 bg-amber-200/5"
                }`}
              />
            ))}
          </div>

        </>
      )}
    </section>
  );
}
