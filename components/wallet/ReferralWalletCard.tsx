"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

const MAX_TIMEOUT_MS = 2_147_483_647;

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

function formatFutureEligibleAt(value: string | null, currentTime: number) {
  if (!value) {
    return null;
  }

  const eligibleAt = new Date(value);

  if (Number.isNaN(eligibleAt.getTime()) || eligibleAt.getTime() <= currentTime) {
    return null;
  }

  return eligibleAt.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export default function ReferralWalletCard({ userId }: ReferralWalletCardProps) {
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [copyLabel, setCopyLabel] = useState("Copy code");
  const [shareLabel, setShareLabel] = useState("Share code");
  const [feedback, setFeedback] = useState("");
  const [currentTime, setCurrentTime] = useState(() => Date.now());
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
  const isLockedRewardPending =
    status?.has_referred_reward === true &&
    status.referred_reward_state === "locked" &&
    status.qualifying_game_found;
  const eligibleAtMs = status?.eligible_at ? new Date(status.eligible_at).getTime() : null;
  const eligibleAtLabel = isLockedRewardPending
    ? formatFutureEligibleAt(status?.eligible_at ?? null, currentTime)
    : null;

  useEffect(() => {
    if (
      !isLockedRewardPending ||
      eligibleAtMs === null ||
      Number.isNaN(eligibleAtMs) ||
      eligibleAtMs <= currentTime
    ) {
      return;
    }

    const timeoutDelay = Math.max(0, Math.min(eligibleAtMs - Date.now(), MAX_TIMEOUT_MS));
    const timeout = window.setTimeout(() => setCurrentTime(Date.now()), timeoutDelay);

    return () => window.clearTimeout(timeout);
  }, [currentTime, eligibleAtMs, isLockedRewardPending]);

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
      <div className="max-w-xl">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-amber-200/80">Referral promotion</p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="referral-heading" className="text-xl font-black tracking-tight text-white">
            Give £5. Get £5.
          </h2>
        </div>
        <p className="mt-6 text-2xl font-black tracking-tight text-white">
          Invite a friend with your referral code and you’ll both receive £5 Fair Play credit. Their credit unlocks after their first qualifying paid game.
        </p>
        <p className="mt-3 text-sm font-semibold leading-6 text-zinc-300">
          Rewards are applied automatically once eligibility is confirmed.
        </p>
      </div>

      <p className="sr-only" aria-live="polite">
        {feedback}
      </p>

      {isLoading ? (
        <div className="mt-7 space-y-3" aria-label="Loading referral details">
          <div className="h-3 w-32 animate-pulse rounded-full bg-stone-100/10" />
          <div className="h-24 w-full animate-pulse rounded-2xl bg-stone-100/10" />
        </div>
      ) : hasError || !status ? (
        <p className="mt-7 text-sm font-semibold leading-6 text-stone-400">
          Referral details are currently unavailable. Please try again later.
        </p>
      ) : (
        <>
          <div className="mt-6 border-y border-amber-200/20 py-5 sm:py-6">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-500">YOUR REFERRAL CODE</p>
            <p className="mt-3 break-all text-3xl font-black text-amber-100 sm:text-4xl">{referralCode || "Unavailable"}</p>
            {referralCode ? (
              <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
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

          {status.has_referred_reward && status.referred_reward_state === "locked" ? (
            <div className="mt-6 border-t border-amber-200/20 pt-6">
              <p className="text-xl font-black text-white">£5 Locked</p>
              {status.qualifying_game_found ? (
                <>
                  <p className="mt-3 text-sm font-semibold leading-6 text-zinc-300">Thank you for booking with Fair Play. We hope you enjoyed the game!</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-zinc-300">Your £5 credit will be added to your wallet shortly.</p>
                  {eligibleAtLabel ? (
                    <p className="mt-4 text-xs font-semibold text-amber-200/80">
                      Expected after {eligibleAtLabel}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-3 text-sm font-semibold leading-6 text-zinc-300">Please complete your first qualifying paid Fair Play game to unlock your £5 credit towards your next game.</p>
              )}
            </div>
          ) : null}

        </>
      )}
    </section>
  );
}
