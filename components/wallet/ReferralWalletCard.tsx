"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type ReferralStatus = {
  referral_code: string | null;
  has_referred_reward: boolean;
  referred_reward_state: string | null;
  referred_reward_amount: number | string | null;
  qualifying_game_found: boolean;
  eligible_at: string | null;
};

type ReferralWalletCardProps = {
  userId: string;
};

function parseReferralStatus(data: unknown): ReferralStatus {
  const row = Array.isArray(data) ? data[0] : data;

  if (!row || typeof row !== "object") {
    throw new Error("Invalid referral status response.");
  }

  const values = row as Record<string, unknown>;

  if (
    (values.referral_code !== null && typeof values.referral_code !== "string") ||
    typeof values.has_referred_reward !== "boolean" ||
    (values.referred_reward_state !== null && typeof values.referred_reward_state !== "string") ||
    (values.referred_reward_amount !== null &&
      typeof values.referred_reward_amount !== "number" &&
      typeof values.referred_reward_amount !== "string") ||
    typeof values.qualifying_game_found !== "boolean" ||
    (values.eligible_at !== null && typeof values.eligible_at !== "string")
  ) {
    throw new Error("Invalid referral status response.");
  }

  return values as unknown as ReferralStatus;
}

export default function ReferralWalletCard({ userId }: ReferralWalletCardProps) {
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [copyLabel, setCopyLabel] = useState("Copy code");
  const [shareLabel, setShareLabel] = useState("Share code");
  const [feedback, setFeedback] = useState("");
  const sectionRef = useRef<HTMLElement | null>(null);
  const hasHandledReferralHashRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    const loadReferralStatus = async () => {
      setIsLoading(true);
      setHasError(false);

      const { data, error } = await supabase.rpc("get_my_referral_reward_status");

      if (!isMounted) return;

      if (error) {
        setStatus(null);
        setHasError(true);
        setIsLoading(false);
        return;
      }

      try {
        setStatus(parseReferralStatus(data));
        setHasError(false);
      } catch {
        setStatus(null);
        setHasError(true);
      } finally {
        setIsLoading(false);
      }
    };

    void loadReferralStatus();

    return () => {
      isMounted = false;
    };
  }, [userId]);

  useEffect(() => {
    if (hasHandledReferralHashRef.current || window.location.hash !== "#referral") {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      const section = sectionRef.current;

      if (!section) {
        return;
      }

      hasHandledReferralHashRef.current = true;
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      section.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });
      section.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  const referralCode = status?.referral_code?.trim() || null;
  const hasLockedReward =
    status?.has_referred_reward === true &&
    status.referred_reward_state === "locked";

  const copyCode = async () => {
    if (!referralCode) return;

    try {
      await navigator.clipboard.writeText(referralCode);
    } catch {
      setCopyLabel("Copy unavailable");
      setFeedback("Unable to copy referral code.");
      return;
    }

    setCopyLabel("Copied");
    setFeedback("Referral code copied.");
    window.setTimeout(() => setCopyLabel("Copy code"), 1800);
  };

  const shareCode = async () => {
    if (!referralCode) return;

    const shareText = `Join Fair Play Football with my referral code ${referralCode}.`;

    if (navigator.share) {
      try {
        await navigator.share({ text: shareText });
        setShareLabel("Shared");
        setFeedback("Referral code shared.");
        window.setTimeout(() => setShareLabel("Share code"), 1800);
        return;
      } catch {
        return;
      }
    }

    try {
      await navigator.clipboard.writeText(shareText);
      setShareLabel("Message copied");
      setFeedback("Referral message copied.");
      window.setTimeout(() => setShareLabel("Share code"), 1800);
    } catch {
      setShareLabel("Share unavailable");
      setFeedback("Unable to share referral code.");
    }
  };

  return (
    <section
      id="referral"
      tabIndex={-1}
      ref={sectionRef}
      className="scroll-mt-6 rounded-[2rem] border border-amber-200/30 bg-[#11100d] p-5 shadow-[0_18px_60px_rgba(120,88,30,0.18)] outline-none focus:ring-2 focus:ring-amber-200/80 sm:p-6"
      aria-labelledby="referral-heading"
    >
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-amber-200/80">Referral promotion</p>

      <p className="sr-only" aria-live="polite">
        {feedback}
      </p>

      {isLoading ? (
        <div className="mt-5 space-y-3" aria-label="Loading referral details">
          <h2 id="referral-heading" className="sr-only">Referral promotion</h2>
          <div className="h-7 w-52 animate-pulse rounded-full bg-stone-100/10" />
          <div className="h-3 w-32 animate-pulse rounded-full bg-stone-100/10" />
          <div className="h-24 w-full animate-pulse rounded-2xl bg-stone-100/10" />
        </div>
      ) : hasError || !status ? (
        <div className="mt-2">
          <h2 id="referral-heading" className="text-xl font-black tracking-tight text-white">
            Give £5. Get £5.
          </h2>
          <p className="mt-6 text-sm font-semibold leading-6 text-stone-400">
            Referral details are currently unavailable. Please try again later.
          </p>
        </div>
      ) : (
        <>
          {hasLockedReward ? (
            <div className="mt-2">
              <h2 id="referral-heading" className="text-xl font-black tracking-tight text-white">
                Your £5 referral credit
              </h2>

              <div className="mt-6 rounded-[1.5rem] border border-amber-200/15 bg-black/20 p-4 sm:p-5">
                <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-7">
                  <div
                    className="flex items-center gap-4"
                    aria-label={status.qualifying_game_found ? "Referral credit completed" : "Locked £5 referral credit"}
                  >
                    <span className="text-3xl font-black tracking-tight text-amber-100 sm:text-4xl">£5</span>
                    <span className={`flex size-16 items-center justify-center rounded-full border text-amber-100 sm:size-[4.5rem] ${
                      status.qualifying_game_found
                        ? "border-amber-200/35 bg-amber-200/15"
                        : "border-amber-200/25 bg-amber-200/10"
                    }`}>
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        className="size-8"
                      >
                        {status.qualifying_game_found ? (
                          <path d="m5.5 12.5 4.1 4.1L18.5 7.8" />
                        ) : (
                          <>
                            <rect x="5.5" y="10" width="13" height="10" rx="2.5" />
                            <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
                          </>
                        )}
                      </svg>
                    </span>
                  </div>

                  <p className="max-w-xl text-sm font-semibold leading-6 text-zinc-300">
                    {status.qualifying_game_found
                      ? "We hope you enjoyed the game. Your first qualifying game is complete, and your £5 credit will appear in your wallet shortly."
                      : "Complete your first paid game to unlock £5 credit towards your next booking."}
                  </p>
                </div>

                <div className="mt-6 border-t border-amber-200/15 pt-5">
                  <p className="text-xl font-black tracking-tight text-white">
                    {status.qualifying_game_found ? 1 : 0} of 1 game completed
                  </p>
                  <div
                    className="mt-4 h-2.5 overflow-hidden rounded-full border border-amber-200/25 bg-amber-200/5"
                    role="progressbar"
                    aria-label={`${status.qualifying_game_found ? 1 : 0} of 1 game completed`}
                    aria-valuemin={0}
                    aria-valuemax={1}
                    aria-valuenow={status.qualifying_game_found ? 1 : 0}
                  >
                    <span
                      aria-hidden="true"
                      className={`block h-full rounded-full bg-amber-200 transition-[width] ${
                        status.qualifying_game_found ? "w-full" : "w-0"
                      }`}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-2">
              <h2 id="referral-heading" className="text-xl font-black tracking-tight text-white">
                Give £5. Get £5.
              </h2>
              <p className="mt-6 max-w-none text-2xl font-black tracking-tight text-white">
                Invite a friend with your referral code and you’ll both receive £5 Fair Play credit. Their credit unlocks after their first qualifying paid game.
              </p>
              <p className="mt-3 max-w-xl text-sm font-semibold leading-6 text-zinc-300">
                Rewards are applied automatically once eligibility is confirmed.
              </p>
            </div>
          )}

          <div className="mt-7 rounded-[1.5rem] border border-amber-200/15 bg-black/20 p-4 sm:flex sm:items-end sm:justify-between sm:gap-6 sm:p-5">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-200/60">YOUR REFERRAL CODE</p>
              <p className="mt-2 break-all text-3xl font-black tracking-[0.04em] text-amber-100 sm:text-4xl">
                {referralCode || "Unavailable"}
              </p>
            </div>
            {referralCode ? (
              <div className="mt-5 grid shrink-0 grid-cols-2 gap-2 sm:mt-0 sm:flex">
                <button
                  type="button"
                  onClick={() => void copyCode()}
                  className="min-h-11 rounded-full border border-amber-200/25 px-4 text-sm font-bold text-stone-100 transition hover:border-amber-100/60 hover:bg-amber-100/5 focus:outline-none focus:ring-2 focus:ring-amber-100/70"
                >
                  {copyLabel}
                </button>
                <button
                  type="button"
                  onClick={() => void shareCode()}
                  className="min-h-11 rounded-full bg-amber-200 px-4 text-sm font-bold text-stone-950 transition hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-200/80"
                >
                  {shareLabel}
                </button>
              </div>
            ) : null}
          </div>

        </>
      )}
    </section>
  );
}
